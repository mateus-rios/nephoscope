import { randomUUID } from 'node:crypto';
import {
  type ColabCommit,
  type ColabNotebook,
  type ColabNotebookDetail,
  type CreateColabNotebook,
  type ListResponse,
  NOTEBOOK_FILE,
  NOTEBOOK_LABEL,
  NOTEBOOK_MAX_BYTES,
  type NotebookDocument,
  type SaveColabNotebook,
} from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { fanOut } from '../../core/gcp/fan-out.js';
import { sdk } from '../../core/gcp/sdk.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';
import { colabHref, readPages, regionsOf } from './colab.service.js';
import { mapCommit, mapNotebook, shortName } from './colab-mapping.js';
import { emptyNotebook, renderNotebook, validateNotebook } from './notebook-render.js';

// biome-ignore lint/suspicious/noExplicitAny: REST responses are mapped field by field.
type Any = any;

/** An empty repository answers "not found" or "failed precondition" to file and history reads. */
const isEmptyRepo = (err: unknown) => ['NOT_FOUND', 'FAILED_PRECONDITION'].includes(toProblem(err).code);

/**
 * Notebooks are Dataform repositories labeled `single-file-asset-type=notebook`, holding one
 * .ipynb file (SPEC-0010 D-04). Versions are the repository's commits (D-05).
 */
@Injectable()
export class NotebooksService {
  constructor(
    private readonly clients: GcpClientFactory,
    private readonly operations: OperationsService,
  ) {}

  private async repositories(profileId: string): Promise<Any> {
    const { dataform } = await sdk.dataformRest();
    return this.clients.get(profileId, 'colab.dataform', (auth) => dataform({ version: 'v1', auth: auth as never })).projects.locations
      .repositories;
  }

  private record(h: ProfileHandle, projectId: string, kind: string, name: string, displayName: string, href = true): void {
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'colab',
      kind,
      resource: { name, displayName, href: href ? colabHref(projectId, name) : null },
    });
  }

  async list(h: ProfileHandle, projectId: string, region: string): Promise<ListResponse<ColabNotebook>> {
    const repos = await this.repositories(h.profile.id);
    const inLocation = (location: string) =>
      readPages<ColabNotebook>(async (pageToken) => {
        const res = await repos.list({ parent: `projects/${projectId}/locations/${location}`, pageSize: 500, pageToken });
        return {
          // Saved queries, data canvases and pipelines live in the same collection.
          items: (res.data.repositories ?? []).filter((r: Any) => r.labels?.[NOTEBOOK_LABEL] === 'notebook').map(mapNotebook),
          next: res.data.nextPageToken || null,
        };
      }, 5000);
    const result =
      region === 'all' ? await fanOut(regionsOf(region), inLocation) : { items: await inLocation(region), nextPageToken: null };
    result.items.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return result;
  }

  async raw(h: ProfileHandle, name: string): Promise<Any> {
    return (await (await this.repositories(h.profile.id)).get({ name })).data;
  }

  /** The .ipynb file of the repository: content.ipynb when present, else the first notebook at the root. */
  private async findPath(repos: Any, name: string, commitSha?: string): Promise<string | null> {
    try {
      const res = await repos.queryDirectoryContents({ name, commitSha, pageSize: 200 });
      const files: string[] = (res.data.directoryEntries ?? []).map((e: Any) => e.file).filter((f: unknown) => typeof f === 'string');
      const notebooks = files.filter((f) => f.endsWith('.ipynb'));
      return notebooks.find((f) => f === NOTEBOOK_FILE) ?? notebooks[0] ?? null;
    } catch (err) {
      if (isEmptyRepo(err)) return null;
      throw err;
    }
  }

  private async head(repos: Any, name: string): Promise<ColabCommit | null> {
    try {
      const res = await repos.fetchHistory({ name, pageSize: 1 });
      const c = res.data.commits?.[0];
      return c ? mapCommit(c) : null;
    } catch (err) {
      if (isEmptyRepo(err)) return null;
      throw err;
    }
  }

  async detail(h: ProfileHandle, name: string): Promise<ColabNotebookDetail> {
    const repos = await this.repositories(h.profile.id);
    const [repo, path, head] = await Promise.all([repos.get({ name }), this.findPath(repos, name), this.head(repos, name)]);
    if (repo.data.labels?.[NOTEBOOK_LABEL] !== 'notebook') {
      throw ProblemException.of('NOT_FOUND', `${shortName(name)} is a Dataform repository, not a notebook.`);
    }
    return { ...mapNotebook(repo.data), path, head };
  }

  async history(h: ProfileHandle, name: string, pageToken?: string): Promise<ListResponse<ColabCommit>> {
    try {
      const res = await (await this.repositories(h.profile.id)).fetchHistory({ name, pageSize: 50, pageToken });
      return { items: (res.data.commits ?? []).map(mapCommit), nextPageToken: res.data.nextPageToken || null };
    } catch (err) {
      if (isEmptyRepo(err)) return { items: [], nextPageToken: null };
      throw err;
    }
  }

  private async read(h: ProfileHandle, name: string, commitSha?: string): Promise<{ path: string; bytes: Buffer }> {
    const repos = await this.repositories(h.profile.id);
    const path = await this.findPath(repos, name, commitSha);
    if (!path) throw ProblemException.of('NOT_FOUND', 'This notebook has no .ipynb file yet.');
    const res = await repos.readFile({ name, path, commitSha });
    return { path, bytes: Buffer.from(String(res.data.contents ?? ''), 'base64') };
  }

  async document(h: ProfileHandle, name: string, commitSha?: string): Promise<NotebookDocument> {
    const { path, bytes } = await this.read(h, name, commitSha);
    if (bytes.byteLength > 3 * NOTEBOOK_MAX_BYTES) {
      return {
        path,
        commitSha: commitSha ?? null,
        size: bytes.byteLength,
        notebook: null,
        error: 'The notebook is too large to show; download it instead.',
      };
    }
    return { path, commitSha: commitSha ?? null, size: bytes.byteLength, ...renderNotebook(bytes.toString('utf8')) };
  }

  async download(h: ProfileHandle, name: string, commitSha?: string): Promise<{ bytes: Buffer; fileName: string }> {
    const repos = await this.repositories(h.profile.id);
    const [{ bytes }, repo] = await Promise.all([this.read(h, name, commitSha), repos.get({ name })]);
    const display = String(repo.data.displayName || shortName(name));
    return { bytes, fileName: display.endsWith('.ipynb') ? display : `${display}.ipynb` };
  }

  /** The commit author: the profile's identity, which is who Google authorizes the write as (SPEC-0010 D-05). */
  private author(h: ProfileHandle): { name: string; emailAddress: string } {
    const email = h.profile.principal?.includes('@') ? h.profile.principal : 'nephoscope@localhost';
    return { name: h.profile.principal ?? h.profile.name, emailAddress: email };
  }

  private async commit(h: ProfileHandle, repos: Any, name: string, path: string, content: string, message: string, base: string | null) {
    const res = await repos.commit({
      name,
      requestBody: {
        commitMetadata: { author: this.author(h), commitMessage: message || `Update ${path} from Nephoscope` },
        ...(base ? { requiredHeadCommitSha: base } : {}),
        fileOperations: { [path]: { writeFile: { contents: Buffer.from(content, 'utf8').toString('base64') } } },
      },
    });
    return String(res.data.commitSha ?? '');
  }

  async create(h: ProfileHandle, projectId: string, body: CreateColabNotebook): Promise<ColabNotebookDetail> {
    const content = body.content ?? emptyNotebook();
    const invalid = validateNotebook(content);
    if (invalid) throw ProblemException.of('INVALID_ARGUMENT', invalid, { errors: [{ path: 'content', message: invalid }] });
    const repos = await this.repositories(h.profile.id);
    const parent = `projects/${projectId}/locations/${body.region}`;
    const res = await repos.create({
      parent,
      repositoryId: randomUUID(),
      requestBody: { displayName: body.displayName, labels: { [NOTEBOOK_LABEL]: 'notebook' }, setAuthenticatedUserAdmin: true },
    });
    const name = String(res.data.name);
    try {
      await this.commit(h, repos, name, NOTEBOOK_FILE, content, `Create ${body.displayName} from Nephoscope`, null);
    } catch (err) {
      // An empty repository would show as a notebook that cannot open; take it back.
      await repos.delete({ name, force: true }).catch(() => undefined);
      throw err;
    }
    this.record(h, projectId, 'colab.notebook.create', name, `Create notebook ${body.displayName}`);
    return this.detail(h, name);
  }

  /** Commits a new version; refused when the notebook moved past the version the user opened (SPEC-0010 D-05). */
  async save(h: ProfileHandle, projectId: string, name: string, body: SaveColabNotebook): Promise<ColabNotebookDetail> {
    const invalid = validateNotebook(body.content);
    if (invalid) throw ProblemException.of('INVALID_ARGUMENT', invalid, { errors: [{ path: 'content', message: invalid }] });
    const repos = await this.repositories(h.profile.id);
    const path = (await this.findPath(repos, name)) ?? NOTEBOOK_FILE;
    try {
      await this.commit(h, repos, name, path, body.content, body.message, body.baseCommitSha);
    } catch (err) {
      const head = body.baseCommitSha ? await this.head(repos, name).catch(() => null) : null;
      if (head && head.sha !== body.baseCommitSha) {
        throw ProblemException.of(
          'CONFLICT',
          `Someone saved this notebook after you opened it${head.authorEmail ? ` (${head.authorEmail})` : ''}. Reload it and upload again.`,
        );
      }
      throw err;
    }
    this.record(h, projectId, 'colab.notebook.save', name, `Save a new version of ${shortName(name)}`);
    return this.detail(h, name);
  }

  async rename(h: ProfileHandle, projectId: string, name: string, displayName: string): Promise<ColabNotebook> {
    const res = await (await this.repositories(h.profile.id)).patch({ name, updateMask: 'display_name', requestBody: { displayName } });
    this.record(h, projectId, 'colab.notebook.rename', name, `Rename notebook to ${displayName}`);
    return mapNotebook(res.data);
  }

  async remove(h: ProfileHandle, projectId: string, name: string): Promise<void> {
    await (await this.repositories(h.profile.id)).delete({ name, force: true });
    this.record(h, projectId, 'colab.notebook.delete', name, `Delete notebook ${shortName(name)}`, false);
  }
}
