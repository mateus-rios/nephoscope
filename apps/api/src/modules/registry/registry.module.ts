import {
  type CreateTag,
  CreateTagSchema,
  type DeleteRegistryItem,
  DeleteRegistryItemSchema,
  type ListResponse,
  type OperationAccepted,
  ProjectIdParamSchema,
  type RegistryDockerImageView,
  type RegistryNameQuery,
  RegistryNameQuerySchema,
  type RegistryPackageView,
  type RegistryRepositoryView,
  type RegistryTagView,
  type RegistryVersionView,
  registryConfirmToken,
  type SaveCleanup,
  SaveCleanupSchema,
  type VulnerabilityReport,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, Injectable, Module, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { fanOut, WildcardSupport } from '../../core/gcp/fan-out.js';
import { rest } from '../../core/gcp/rest.js';
import { RestOperations } from '../../core/gcp/rest-ops.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';

// biome-ignore lint/suspicious/noExplicitAny: Artifact Registry REST resources are read field by field.
type Any = any;

const AR = 'https://artifactregistry.googleapis.com/v1/';
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const short = (n: string) => n.split('/').pop() ?? n;
const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function mapRepository(r: Any, projectId: string): RegistryRepositoryView {
  const name = String(r?.name ?? '');
  const location = /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '';
  const id = short(name);
  const format = String(r?.format ?? '').replace(/^FORMAT_UNSPECIFIED$/, '');
  return {
    name,
    id,
    location,
    format,
    mode: String(r?.mode ?? 'STANDARD_REPOSITORY'),
    description: str(r?.description),
    sizeBytes: r?.sizeBytes === undefined || r?.sizeBytes === null ? null : String(r.sizeBytes),
    cleanupPolicies: (r?.cleanupPolicies ?? {}) as Record<string, unknown>,
    cleanupPolicyDryRun: !!r?.cleanupPolicyDryRun,
    labels: (r?.labels ?? {}) as Record<string, string>,
    createTime: str(r?.createTime),
    updateTime: str(r?.updateTime),
    registryUri: format === 'DOCKER' ? `${location}-docker.pkg.dev/${projectId}/${id}` : null,
  };
}

export function mapDockerImage(i: Any): RegistryDockerImageView {
  const uri = String(i?.uri ?? '');
  const at = uri.lastIndexOf('@');
  const withoutDigest = at > 0 ? uri.slice(0, at) : uri;
  return {
    name: String(i?.name ?? ''),
    uri,
    digest: at > 0 ? uri.slice(at + 1) : '',
    image: withoutDigest.split('/').slice(3).join('/'),
    tags: ((i?.tags ?? []) as Any[]).map(String),
    sizeBytes: i?.imageSizeBytes === undefined || i?.imageSizeBytes === null ? null : String(i.imageSizeBytes),
    uploadTime: str(i?.uploadTime),
    buildTime: str(i?.buildTime),
    updateTime: str(i?.updateTime),
    mediaType: str(i?.mediaType),
  };
}

/** Artifact Registry through REST (SPEC-0007 D-11, SPEC-0001 D-29). */
@Injectable()
export class RegistryService {
  private readonly wildcard = new WildcardSupport();

  constructor(private readonly restOps: RestOperations) {}

  private own(projectId: string, name: string) {
    if (!name.startsWith(`projects/${projectId}/`))
      throw ProblemException.of('INVALID_ARGUMENT', `The resource is not in project ${projectId}.`);
  }

  async repositories(h: ProfileHandle, projectId: string): Promise<ListResponse<RegistryRepositoryView>> {
    const client = rest(h, AR);
    const list = async (location: string) =>
      (await client.all<Any>(`projects/${projectId}/locations/${location}/repositories`, 'repositories', { pageSize: 1000 })).map((r) =>
        mapRepository(r, projectId),
      );
    const result = await this.wildcard.list(
      'artifactregistry.rest.repositories',
      async () => ({ items: await list('-'), nextPageToken: null }),
      async () => {
        const locations = (await client.all<Any>(`projects/${projectId}/locations`, 'locations', {}, 500))
          .map((l) => String(l.locationId ?? ''))
          .filter(Boolean);
        return fanOut(locations, list);
      },
    );
    result.items.sort((a, b) => a.location.localeCompare(b.location) || a.id.localeCompare(b.id));
    return result;
  }

  async repository(h: ProfileHandle, projectId: string, name: string): Promise<RegistryRepositoryView> {
    this.own(projectId, name);
    return mapRepository(await rest(h, AR).get(name), projectId);
  }

  async saveCleanup(h: ProfileHandle, projectId: string, name: string, b: SaveCleanup): Promise<RegistryRepositoryView> {
    this.own(projectId, name);
    let policies: unknown;
    try {
      policies = JSON.parse(b.policiesJson || '{}');
    } catch (err) {
      throw ProblemException.of('INVALID_ARGUMENT', `The cleanup policies are not valid JSON: ${(err as Error).message}`);
    }
    if (!policies || typeof policies !== 'object' || Array.isArray(policies))
      throw ProblemException.of('INVALID_ARGUMENT', 'Cleanup policies are a JSON object keyed by policy id.');
    const r = await rest(h, AR).patch<Any>(
      name,
      { cleanupPolicies: policies, cleanupPolicyDryRun: b.dryRun },
      { updateMask: 'cleanup_policies,cleanup_policy_dry_run' },
    );
    return mapRepository(r, projectId);
  }

  async packages(h: ProfileHandle, projectId: string, q: RegistryNameQuery): Promise<ListResponse<RegistryPackageView>> {
    this.own(projectId, q.name);
    const page = await rest(h, AR).page<Any>(`${q.name}/packages`, 'packages', { pageSize: 500, pageToken: q.pageToken });
    return {
      items: page.items.map((p) => ({
        name: String(p.name),
        id: short(String(p.name)),
        displayName: str(p.displayName) ?? decode(short(String(p.name))),
        createTime: str(p.createTime),
        updateTime: str(p.updateTime),
      })),
      nextPageToken: page.next,
    };
  }

  async versions(h: ProfileHandle, projectId: string, q: RegistryNameQuery): Promise<ListResponse<RegistryVersionView>> {
    this.own(projectId, q.name);
    const page = await rest(h, AR).page<Any>(`${q.name}/versions`, 'versions', {
      pageSize: 500,
      pageToken: q.pageToken,
      view: 'FULL',
      orderBy: 'update_time desc',
    });
    return {
      items: page.items.map((v) => ({
        name: String(v.name),
        id: decode(short(String(v.name))),
        description: str(v.description),
        tags: ((v.relatedTags ?? []) as Any[]).map((t) => decode(short(String(t?.name ?? '')))),
        createTime: str(v.createTime),
        updateTime: str(v.updateTime),
        sizeBytes: v?.metadata?.imageSizeBytes ? String(v.metadata.imageSizeBytes) : null,
      })),
      nextPageToken: page.next,
    };
  }

  async tags(h: ProfileHandle, projectId: string, q: RegistryNameQuery): Promise<RegistryTagView[]> {
    this.own(projectId, q.name);
    const list = await rest(h, AR).all<Any>(`${q.name}/tags`, 'tags', { pageSize: 1000 });
    return list.map((t) => ({ name: String(t.name), id: decode(short(String(t.name))), version: String(t.version ?? '') }));
  }

  async createTag(h: ProfileHandle, projectId: string, b: CreateTag): Promise<RegistryTagView> {
    this.own(projectId, b.package);
    this.own(projectId, b.version);
    const t = await rest(h, AR).post<Any>(
      `${b.package}/tags`,
      { name: `${b.package}/tags/${b.tag}`, version: b.version },
      { tagId: b.tag },
    );
    return { name: String(t.name), id: short(String(t.name)), version: String(t.version ?? '') };
  }

  async dockerImages(h: ProfileHandle, projectId: string, q: RegistryNameQuery): Promise<ListResponse<RegistryDockerImageView>> {
    this.own(projectId, q.name);
    const page = await rest(h, AR).page<Any>(`${q.name}/dockerImages`, 'dockerImages', {
      pageSize: 500,
      pageToken: q.pageToken,
      orderBy: 'update_time desc',
    });
    return { items: page.items.map(mapDockerImage), nextPageToken: page.next };
  }

  /** Deletes a version (an operation) or a tag (at once) (SPEC-0007 D-11). */
  async remove(h: ProfileHandle, projectId: string, b: DeleteRegistryItem) {
    this.own(projectId, b.name);
    const isTag = /\/tags\/[^/]+$/.test(b.name);
    requireConfirmation(b.confirm, registryConfirmToken(b.name));
    const response = await rest(h, AR).delete(b.name, isTag ? undefined : { force: true });
    return this.restOps.track(h, {
      projectId,
      product: 'artifactregistry',
      kind: isTag ? 'artifactregistry.tag.delete' : 'artifactregistry.version.delete',
      resource: { name: b.name, displayName: `Delete ${isTag ? 'tag' : 'version'} ${decode(short(b.name)).slice(0, 40)}`, href: null },
      root: AR,
      response,
    });
  }

  /** Vulnerabilities of an image digest from Container Analysis, when it is on (SPEC-0007 D-11). */
  async vulnerabilities(h: ProfileHandle, projectId: string, uri: string): Promise<VulnerabilityReport> {
    const resourceUrl = `https://${uri}`;
    try {
      const list = await rest(h, 'https://containeranalysis.googleapis.com/v1/').all<Any>(
        `projects/${projectId}/occurrences`,
        'occurrences',
        { filter: `kind="VULNERABILITY" AND resourceUrl="${resourceUrl.replaceAll('"', '')}"`, pageSize: 1000 },
        5000,
      );
      const findings = list.map((o) => {
        const v = o?.vulnerability ?? {};
        const pkg = v.packageIssue?.[0];
        return {
          severity: String(v.effectiveSeverity ?? v.severity ?? 'SEVERITY_UNSPECIFIED'),
          cve: short(String(o?.noteName ?? '')),
          packageName: str(pkg?.affectedPackage),
          fixAvailable: !!v.fixAvailable,
          cvssScore: typeof v.cvssScore === 'number' ? v.cvssScore : null,
          description: str(v.shortDescription),
        };
      });
      const counts: Record<string, number> = {};
      for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
      const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'MINIMAL'];
      findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
      return { available: true, reason: null, counts, findings };
    } catch (err) {
      const p = toProblem(err);
      if (p.code === 'API_DISABLED' || p.code === 'PERMISSION_DENIED')
        return { available: false, reason: p.detail, counts: {}, findings: [] };
      throw err;
    }
  }
}

const p = { schema: ProjectIdParamSchema };

@Controller('api/projects/:projectId/artifactregistry')
export class RegistryController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly registry: RegistryService,
  ) {}

  @Get('repositories')
  repositories(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string) {
    return this.registry.repositories(this.profiles.get(profileId), projectId);
  }

  @Get('repository')
  repository(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: RegistryNameQuerySchema }) q: RegistryNameQuery,
  ) {
    return this.registry.repository(this.profiles.get(profileId), projectId, q.name);
  }

  @Put('repository/cleanup')
  @Mutation({ product: 'artifactregistry', verb: 'repository.cleanup', resource: 'projects/:projectId/repositories' })
  cleanup(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: RegistryNameQuerySchema }) q: RegistryNameQuery,
    @Body({ schema: SaveCleanupSchema }) body: SaveCleanup,
  ) {
    return this.registry.saveCleanup(this.profiles.get(profileId), projectId, q.name, body);
  }

  @Get('packages')
  packages(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: RegistryNameQuerySchema }) q: RegistryNameQuery,
  ) {
    return this.registry.packages(this.profiles.get(profileId), projectId, q);
  }

  @Get('versions')
  versions(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: RegistryNameQuerySchema }) q: RegistryNameQuery,
  ) {
    return this.registry.versions(this.profiles.get(profileId), projectId, q);
  }

  @Get('tags')
  tags(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: RegistryNameQuerySchema }) q: RegistryNameQuery,
  ) {
    return this.registry.tags(this.profiles.get(profileId), projectId, q);
  }

  @Post('tags')
  @Mutation({ product: 'artifactregistry', verb: 'tag.create', resource: 'projects/:projectId/repositories' })
  createTag(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateTagSchema }) body: CreateTag,
  ) {
    return this.registry.createTag(this.profiles.get(profileId), projectId, body);
  }

  @Get('docker-images')
  dockerImages(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: RegistryNameQuerySchema }) q: RegistryNameQuery,
  ) {
    return this.registry.dockerImages(this.profiles.get(profileId), projectId, q);
  }

  @Delete('item')
  @Mutation({ product: 'artifactregistry', verb: 'item.delete', resource: 'projects/:projectId/repositories' })
  async remove(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: DeleteRegistryItemSchema }) body: DeleteRegistryItem,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OperationAccepted> {
    const operation = await this.registry.remove(this.profiles.get(profileId), projectId, body);
    res.status(operation.family === 'instant' ? 200 : 202);
    return { operation };
  }

  @Get('vulnerabilities')
  vulnerabilities(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: z.object({ uri: z.string().regex(/^[a-z0-9.-]+-docker\.pkg\.dev\/[^?#\s]+@sha256:[0-9a-f]{64}$/) }) }) q: {
      uri: string;
    },
  ): Promise<VulnerabilityReport> {
    return this.registry.vulnerabilities(this.profiles.get(profileId), projectId, q.uri);
  }
}

/** Artifact Registry at L2 (SPEC-0007 M5.4). */
@Module({ controllers: [RegistryController], providers: [RegistryService] })
export class RegistryModule {}
