import {
  type AssignColabRuntime,
  COLAB_REGIONS,
  type ColabExecution,
  type ColabExecutionList,
  type ColabExecutionOutput,
  type ColabRuntime,
  type ColabRuntimeAction,
  type ColabSchedule,
  type ColabTemplate,
  type CreateColabExecution,
  type CreateColabSchedule,
  type CreateColabTemplate,
  type ListResponse,
  NOTEBOOK_MAX_BYTES,
  type NotebookDocument,
  type OperationSummary,
  type SaveColabSchedule,
  type UpdateColabTemplate,
} from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { fanOut } from '../../core/gcp/fan-out.js';
import { lroPoller, type OperationLike } from '../../core/gcp/lro.js';
import { sdk } from '../../core/gcp/sdk.js';
import { OperationsService, type Poller } from '../../core/operations/operations.service.js';
import { ProblemException } from '../../core/problem/problem.js';
import { StorageService } from '../storage/storage.service.js';
import {
  locationOf,
  mapExecution,
  mapRuntime,
  mapSchedule,
  mapTemplate,
  projectOf,
  schedulePatch,
  shortName,
  templatePatch,
  toJob,
  toSchedule,
  toTemplate,
} from './colab-mapping.js';
import { renderNotebook } from './notebook-render.js';

// biome-ignore lint/suspicious/noExplicitAny: REST responses are mapped field by field.
type Any = any;

/** Vertex AI answers each region on its own endpoint (SPEC-0010 D-02). */
const at = (location: string) => ({ rootUrl: `https://${location}-aiplatform.googleapis.com/` });
export const regionsOf = (region: string): string[] => (region === 'all' ? [...COLAB_REGIONS] : [region]);

/** Most items read per region for one list. */
const CAP = 2000;
/** Executions read per region: the newest page, since scheduled notebooks pile up (SPEC-0010 D-03). */
const EXECUTION_PAGE = 100;
/** Executions scanned for the runs of one schedule or notebook. */
const RUNS_SCAN = 500;
/** Largest executed notebook read from Cloud Storage for the viewer. */
const OUTPUT_CAP = 3 * NOTEBOOK_MAX_BYTES;

const OPERATION_KINDS = [
  'colab.template.create',
  'colab.template.delete',
  'colab.runtime.assign',
  'colab.runtime.start',
  'colab.runtime.stop',
  'colab.runtime.upgrade',
  'colab.runtime.delete',
  'colab.execution.create',
  'colab.execution.delete',
  'colab.schedule.delete',
] as const;
type Kind = (typeof OPERATION_KINDS)[number];

const SEGMENTS: [string, string][] = [
  ['notebookRuntimeTemplates', 'templates'],
  ['notebookRuntimes', 'runtimes'],
  ['notebookExecutionJobs', 'executions'],
  ['schedules', 'schedules'],
  ['repositories', 'notebooks'],
];

/** The Nephoscope page of a Colab resource. Google may name the project by number, so the caller's id is used. */
export function colabHref(projectId: string, name: string): string | null {
  const parts = name.split('/');
  for (const [collection, segment] of SEGMENTS) {
    const i = parts.indexOf(collection);
    if (i > 0 && parts[i + 1]) return `/p/${projectId}/colab/${segment}/${locationOf(name)}/${parts[i + 1]}`;
  }
  return null;
}

/** Reads pages until there are none left or `cap` items are in. */
export async function readPages<T>(fetch: (pageToken?: string) => Promise<{ items: T[]; next: string | null }>, cap = CAP): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  do {
    const page = await fetch(token);
    out.push(...page.items);
    token = page.next ?? undefined;
  } while (token && out.length < cap);
  return out;
}

/** Parses gs://bucket/path into its parts. */
export function parseGsUri(uri: string): { bucket: string; path: string } | null {
  const m = /^gs:\/\/([^/]+)\/?(.*)$/.exec(uri);
  return m ? { bucket: m[1] as string, path: (m[2] ?? '').replace(/\/+$/, '') } : null;
}

/** Runtime templates, runtimes, executions and schedules through the Vertex AI REST API (SPEC-0010). */
@Injectable()
export class ColabService {
  constructor(
    private readonly clients: GcpClientFactory,
    private readonly operations: OperationsService,
    private readonly storage: StorageService,
  ) {
    for (const kind of OPERATION_KINDS) {
      this.operations.registerResumer(kind, (op) => (op.googleName ? this.poller(op.profileId, op.googleName) : null));
    }
  }

  private async client(profileId: string): Promise<Any> {
    const { aiplatform } = await sdk.aiplatformRest();
    return this.clients.get(profileId, 'colab.aiplatform', (auth) => aiplatform({ version: 'v1', auth: auth as never }));
  }

  private async locations(profileId: string): Promise<Any> {
    return (await this.client(profileId)).projects.locations;
  }

  private poller(profileId: string, googleName: string): Poller {
    return lroPoller(async (name) => {
      const res = await (await this.locations(profileId)).operations.get({ name }, at(locationOf(name)));
      return res.data as OperationLike;
    }, googleName);
  }

  private track(
    h: ProfileHandle,
    projectId: string,
    kind: Kind,
    resource: string,
    displayName: string,
    op: OperationLike,
  ): OperationSummary {
    const googleName = op.name ?? null;
    return this.operations.track({
      profileId: h.profile.id,
      projectId,
      product: 'colab',
      kind,
      family: 'longrunning',
      googleName,
      resource: { name: resource, displayName, href: kind.endsWith('.delete') ? null : colabHref(projectId, resource) },
      poll: googleName ? this.poller(h.profile.id, googleName) : async () => ({ done: true }),
    });
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

  /** One list per region, merged; failing regions come back in `unreachable` (SPEC-0001 D-17). */
  private async list<T>(region: string, inLocation: (location: string) => Promise<T[]>): Promise<ListResponse<T>> {
    if (region !== 'all') return { items: await inLocation(region), nextPageToken: null };
    return fanOut(regionsOf(region), inLocation);
  }

  // ---- runtime templates ---------------------------------------------------------------------------

  async templates(h: ProfileHandle, projectId: string, region: string): Promise<ListResponse<ColabTemplate>> {
    const l = await this.locations(h.profile.id);
    const result = await this.list(region, (location) =>
      readPages<ColabTemplate>(async (pageToken) => {
        const res = await l.notebookRuntimeTemplates.list(
          { parent: `projects/${projectId}/locations/${location}`, pageSize: 100, pageToken },
          at(location),
        );
        return { items: (res.data.notebookRuntimeTemplates ?? []).map(mapTemplate), next: res.data.nextPageToken || null };
      }),
    );
    result.items.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return result;
  }

  async templateRaw(h: ProfileHandle, name: string): Promise<Any> {
    const res = await (await this.locations(h.profile.id)).notebookRuntimeTemplates.get({ name }, at(locationOf(name)));
    return res.data;
  }

  async template(h: ProfileHandle, name: string): Promise<ColabTemplate> {
    return mapTemplate(await this.templateRaw(h, name));
  }

  async createTemplate(h: ProfileHandle, projectId: string, body: CreateColabTemplate): Promise<OperationSummary> {
    const parent = `projects/${projectId}/locations/${body.region}`;
    const res = await (await this.locations(h.profile.id)).notebookRuntimeTemplates.create(
      { parent, notebookRuntimeTemplateId: body.id, requestBody: toTemplate(body) },
      at(body.region),
    );
    const resource = body.id ? `${parent}/notebookRuntimeTemplates/${body.id}` : parent;
    return this.track(h, projectId, 'colab.template.create', resource, `Create template ${body.displayName}`, res.data);
  }

  async updateTemplate(h: ProfileHandle, name: string, body: UpdateColabTemplate): Promise<ColabTemplate> {
    const current = await this.template(h, name);
    const { mask, template } = templatePatch(current, body);
    if (mask.length === 0) return current;
    const res = await (await this.locations(h.profile.id)).notebookRuntimeTemplates.patch(
      { name, updateMask: mask.join(','), requestBody: template },
      at(locationOf(name)),
    );
    this.record(h, projectOf(name), 'colab.template.update', name, `Update template ${body.displayName}`);
    return mapTemplate(res.data);
  }

  async deleteTemplate(h: ProfileHandle, projectId: string, name: string): Promise<OperationSummary> {
    const res = await (await this.locations(h.profile.id)).notebookRuntimeTemplates.delete({ name }, at(locationOf(name)));
    return this.track(h, projectId, 'colab.template.delete', name, `Delete template ${shortName(name)}`, res.data);
  }

  // ---- runtimes ------------------------------------------------------------------------------------

  async runtimes(h: ProfileHandle, projectId: string, region: string): Promise<ListResponse<ColabRuntime>> {
    const l = await this.locations(h.profile.id);
    const result = await this.list(region, (location) =>
      readPages<ColabRuntime>(async (pageToken) => {
        const res = await l.notebookRuntimes.list(
          { parent: `projects/${projectId}/locations/${location}`, pageSize: 100, pageToken },
          at(location),
        );
        return { items: (res.data.notebookRuntimes ?? []).map(mapRuntime), next: res.data.nextPageToken || null };
      }),
    );
    result.items.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return result;
  }

  async runtimeRaw(h: ProfileHandle, name: string): Promise<Any> {
    const res = await (await this.locations(h.profile.id)).notebookRuntimes.get({ name }, at(locationOf(name)));
    return res.data;
  }

  async runtime(h: ProfileHandle, name: string): Promise<ColabRuntime> {
    return mapRuntime(await this.runtimeRaw(h, name));
  }

  /** A runtime belongs to the identity that assigns it: the profile's principal (SPEC-0010 D-09). */
  async assignRuntime(h: ProfileHandle, projectId: string, body: AssignColabRuntime): Promise<OperationSummary> {
    const user = h.profile.principal;
    if (!user?.includes('@')) {
      throw ProblemException.of('FAILED_PRECONDITION', 'Assigning a runtime needs a profile whose identity has an email address.');
    }
    const parent = `projects/${projectId}/locations/${body.region}`;
    const res = await (await this.locations(h.profile.id)).notebookRuntimes.assign(
      {
        parent,
        requestBody: {
          notebookRuntimeTemplate: body.template,
          notebookRuntimeId: body.id,
          notebookRuntime: {
            displayName: body.displayName,
            runtimeUser: user,
            ...(body.description ? { description: body.description } : {}),
          },
        },
      },
      at(body.region),
    );
    const resource = body.id ? `${parent}/notebookRuntimes/${body.id}` : parent;
    return this.track(h, projectId, 'colab.runtime.assign', resource, `Assign runtime ${body.displayName}`, res.data);
  }

  async runtimeAction(h: ProfileHandle, projectId: string, name: string, action: ColabRuntimeAction): Promise<OperationSummary> {
    const r = (await this.locations(h.profile.id)).notebookRuntimes;
    const res = await r[action]({ name, requestBody: {} }, at(locationOf(name)));
    const verb = action === 'start' ? 'Start' : action === 'stop' ? 'Stop' : 'Upgrade';
    return this.track(h, projectId, `colab.runtime.${action}` as Kind, name, `${verb} runtime ${shortName(name)}`, res.data);
  }

  async deleteRuntime(h: ProfileHandle, projectId: string, name: string): Promise<OperationSummary> {
    const res = await (await this.locations(h.profile.id)).notebookRuntimes.delete({ name }, at(locationOf(name)));
    return this.track(h, projectId, 'colab.runtime.delete', name, `Delete runtime ${shortName(name)}`, res.data);
  }

  // ---- executions ----------------------------------------------------------------------------------

  private async executionPage(h: ProfileHandle, projectId: string, location: string, pageSize: number, pageToken?: string) {
    const res = await (await this.locations(h.profile.id)).notebookExecutionJobs.list(
      { parent: `projects/${projectId}/locations/${location}`, pageSize, pageToken, orderBy: 'create_time desc' },
      at(location),
    );
    return {
      items: (res.data.notebookExecutionJobs ?? []).map(mapExecution) as ColabExecution[],
      next: (res.data.nextPageToken as string) || null,
    };
  }

  /** The newest page of each region, or every page of one region through the token (SPEC-0010 D-03). */
  async executions(h: ProfileHandle, projectId: string, region: string, pageToken?: string): Promise<ColabExecutionList> {
    if (region !== 'all') {
      const page = await this.executionPage(h, projectId, region, EXECUTION_PAGE, pageToken);
      return { items: page.items, nextPageToken: page.next, truncated: [] };
    }
    const truncated: string[] = [];
    const result = await fanOut(regionsOf(region), async (location) => {
      const page = await this.executionPage(h, projectId, location, EXECUTION_PAGE);
      if (page.next) truncated.push(location);
      return page.items;
    });
    result.items.sort((a, b) => (b.createTime ?? '').localeCompare(a.createTime ?? ''));
    return { ...result, truncated: truncated.sort() };
  }

  /** Runs that match, among the newest executions of one region (SPEC-0010 D-03). */
  async executionsWhere(
    h: ProfileHandle,
    projectId: string,
    location: string,
    match: (e: ColabExecution) => boolean,
  ): Promise<ColabExecutionList> {
    let scanned = 0;
    let more = false;
    const items: ColabExecution[] = [];
    let token: string | undefined;
    do {
      const page = await this.executionPage(h, projectId, location, EXECUTION_PAGE, token);
      scanned += page.items.length;
      items.push(...page.items.filter(match));
      token = page.next ?? undefined;
      more = !!token;
    } while (token && scanned < RUNS_SCAN);
    return { items, nextPageToken: null, truncated: more ? [location] : [] };
  }

  async executionRaw(h: ProfileHandle, name: string): Promise<Any> {
    const res = await (await this.locations(h.profile.id)).notebookExecutionJobs.get(
      { name, view: 'NOTEBOOK_EXECUTION_JOB_VIEW_FULL' },
      at(locationOf(name)),
    );
    return res.data;
  }

  async execution(h: ProfileHandle, name: string): Promise<ColabExecution> {
    const res = await (await this.locations(h.profile.id)).notebookExecutionJobs.get({ name }, at(locationOf(name)));
    return mapExecution(res.data);
  }

  async createExecution(h: ProfileHandle, projectId: string, body: CreateColabExecution): Promise<OperationSummary> {
    const parent = `projects/${projectId}/locations/${body.region}`;
    const res = await (await this.locations(h.profile.id)).notebookExecutionJobs.create(
      { parent, notebookExecutionJobId: body.id, requestBody: toJob(body) },
      at(body.region),
    );
    const resource = body.id ? `${parent}/notebookExecutionJobs/${body.id}` : parent;
    return this.track(h, projectId, 'colab.execution.create', resource, `Run ${body.displayName}`, res.data);
  }

  async deleteExecution(h: ProfileHandle, projectId: string, name: string): Promise<OperationSummary> {
    const res = await (await this.locations(h.profile.id)).notebookExecutionJobs.delete({ name }, at(locationOf(name)));
    return this.track(h, projectId, 'colab.execution.delete', name, `Delete execution ${shortName(name)}`, res.data);
  }

  /** Where a run wrote its results: objects under the output folder named after the run (SPEC-0010 D-10). */
  private outputPrefix(e: ColabExecution): { bucket: string; prefix: string; uri: string } | null {
    const parsed = e.outputUri ? parseGsUri(e.outputUri) : null;
    if (!parsed) return null;
    const prefix = `${parsed.path ? `${parsed.path}/` : ''}${e.id}`;
    return { bucket: parsed.bucket, prefix, uri: `gs://${parsed.bucket}/${prefix}` };
  }

  async executionOutput(h: ProfileHandle, projectId: string, name: string): Promise<ColabExecutionOutput> {
    const e = await this.execution(h, name);
    const where = this.outputPrefix(e);
    if (!where) return { uri: e.outputUri, bucket: null, prefix: null, objects: [], notebook: null };
    const s = await this.storage.storage(h.profile.id, projectId);
    const [files]: Any[] = await s.bucket(where.bucket).getFiles({ prefix: where.prefix, maxResults: 200, autoPaginate: false });
    const objects = (files as Any[]).map((f) => ({
      name: String(f.metadata?.name ?? f.name),
      size: Number(f.metadata?.size ?? 0),
      updated: f.metadata?.updated ? String(f.metadata.updated) : null,
    }));
    return {
      uri: where.uri,
      bucket: where.bucket,
      prefix: where.prefix,
      objects,
      notebook: objects.find((o) => o.name.endsWith('.ipynb'))?.name ?? null,
    };
  }

  async executionOutputNotebook(h: ProfileHandle, projectId: string, name: string, object: string): Promise<NotebookDocument> {
    const where = this.outputPrefix(await this.execution(h, name));
    if (!where || !object.startsWith(where.prefix) || !object.endsWith('.ipynb')) {
      throw ProblemException.of('INVALID_ARGUMENT', 'Only notebooks the run wrote can be opened here.');
    }
    const file = (await this.storage.storage(h.profile.id, projectId)).bucket(where.bucket).file(object);
    const [meta]: Any[] = await file.getMetadata();
    const size = Number(meta?.size ?? 0);
    if (size > OUTPUT_CAP) {
      throw ProblemException.of(
        'FAILED_PRECONDITION',
        `The executed notebook is ${Math.round(size / 1024 / 1024)} MiB; open it from Cloud Storage instead.`,
      );
    }
    const [bytes]: [Buffer] = await file.download();
    return { path: object, commitSha: null, size, ...renderNotebook(bytes.toString('utf8')) };
  }

  // ---- schedules -------------------------------------------------------------------------------------

  async schedules(h: ProfileHandle, projectId: string, region: string): Promise<ListResponse<ColabSchedule>> {
    const l = await this.locations(h.profile.id);
    const result = await this.list(region, (location) =>
      readPages<ColabSchedule>(async (pageToken) => {
        const res = await l.schedules.list(
          {
            parent: `projects/${projectId}/locations/${location}`,
            // Pipeline schedules share the collection; only notebook schedules belong here.
            filter: 'create_notebook_execution_job_request:*',
            pageSize: 100,
            pageToken,
          },
          at(location),
        );
        return {
          items: (res.data.schedules ?? []).filter((s: Any) => s.createNotebookExecutionJobRequest).map(mapSchedule),
          next: res.data.nextPageToken || null,
        };
      }),
    );
    result.items.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return result;
  }

  async scheduleRaw(h: ProfileHandle, name: string): Promise<Any> {
    const res = await (await this.locations(h.profile.id)).schedules.get({ name }, at(locationOf(name)));
    return res.data;
  }

  async schedule(h: ProfileHandle, name: string): Promise<ColabSchedule> {
    return mapSchedule(await this.scheduleRaw(h, name));
  }

  async createSchedule(h: ProfileHandle, projectId: string, body: CreateColabSchedule): Promise<ColabSchedule> {
    const parent = `projects/${projectId}/locations/${body.region}`;
    const res = await (await this.locations(h.profile.id)).schedules.create(
      { parent, requestBody: toSchedule(parent, body) },
      at(body.region),
    );
    const schedule = mapSchedule(res.data);
    this.record(h, projectId, 'colab.schedule.create', schedule.name, `Create schedule ${schedule.displayName}`);
    return schedule;
  }

  async updateSchedule(h: ProfileHandle, projectId: string, name: string, body: SaveColabSchedule): Promise<ColabSchedule> {
    const current = await this.schedule(h, name);
    const { mask, schedule } = schedulePatch(current, `projects/${projectId}/locations/${locationOf(name)}`, body);
    if (mask.length === 0) return current;
    const res = await (await this.locations(h.profile.id)).schedules.patch(
      { name, updateMask: mask.join(','), requestBody: schedule },
      at(locationOf(name)),
    );
    this.record(h, projectId, 'colab.schedule.update', name, `Update schedule ${body.displayName}`);
    return mapSchedule(res.data);
  }

  async pauseSchedule(h: ProfileHandle, projectId: string, name: string): Promise<ColabSchedule> {
    await (await this.locations(h.profile.id)).schedules.pause({ name, requestBody: {} }, at(locationOf(name)));
    this.record(h, projectId, 'colab.schedule.pause', name, `Pause schedule ${shortName(name)}`);
    return this.schedule(h, name);
  }

  async resumeSchedule(h: ProfileHandle, projectId: string, name: string, catchUp: boolean): Promise<ColabSchedule> {
    await (await this.locations(h.profile.id)).schedules.resume({ name, requestBody: { catchUp } }, at(locationOf(name)));
    this.record(h, projectId, 'colab.schedule.resume', name, `Resume schedule ${shortName(name)}`);
    return this.schedule(h, name);
  }

  async deleteSchedule(h: ProfileHandle, projectId: string, name: string): Promise<OperationSummary> {
    const res = await (await this.locations(h.profile.id)).schedules.delete({ name }, at(locationOf(name)));
    return this.track(h, projectId, 'colab.schedule.delete', name, `Delete schedule ${shortName(name)}`, res.data);
  }
}
