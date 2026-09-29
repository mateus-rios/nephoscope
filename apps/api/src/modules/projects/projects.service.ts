import { AssetServiceClient } from '@google-cloud/asset';
import { ProjectsClient, type protos as rmProtos } from '@google-cloud/resource-manager';
import { ServiceUsageClient, type protos as suProtos } from '@google-cloud/service-usage';
import type { ListResponse, OperationSummary, ProjectSummary, ServiceSummary } from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { enumName, timestampToIso } from '../../core/gcp/proto.js';
import { RateLimiter } from '../../core/gcp/rate-limiter.js';
import { OperationsService, type Poller } from '../../core/operations/operations.service.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';

type IProject = rmProtos.google.cloud.resourcemanager.v3.IProject;
type IService = suProtos.google.api.serviceusage.v1.IService;

const PROJECT_STATES = ['STATE_UNSPECIFIED', 'ACTIVE', 'DELETE_REQUESTED'] as const;
const SERVICE_STATES = ['STATE_UNSPECIFIED', 'DISABLED', 'ENABLED'] as const;

export function mapProject(p: IProject): ProjectSummary {
  const parent = p.parent
    ? {
        type: p.parent.startsWith('organizations/')
          ? ('organization' as const)
          : p.parent.startsWith('folders/')
            ? ('folder' as const)
            : ('unknown' as const),
        id: p.parent.split('/')[1] ?? p.parent,
      }
    : null;
  return {
    projectId: p.projectId ?? '',
    name: p.displayName || p.projectId || '',
    projectNumber: p.name?.split('/')[1] ?? null,
    state: enumName(p.state, PROJECT_STATES, 'STATE_UNSPECIFIED'),
    parent,
    labels: { ...(p.labels ?? {}) },
    createTime: timestampToIso(p.createTime),
  };
}

export function mapService(s: IService): ServiceSummary {
  const name = s.config?.name ?? s.name?.split('/').pop() ?? '';
  return {
    name,
    title: s.config?.title || name,
    state: enumName(s.state, SERVICE_STATES, 'STATE_UNSPECIFIED'),
  };
}

export interface AssetResult {
  name: string;
  assetType: string;
  displayName: string;
  location: string | null;
  state: string | null;
  project: string | null;
  updateTime: string | null;
}

/** Escapes a user query for Resource Manager's search syntax. */
function projectQuery(q: string | undefined): string | undefined {
  const text = q?.trim().replace(/["\\]/g, '');
  if (!text) return undefined;
  return `displayName:${text}* id:${text}*`;
}

@Injectable()
export class ProjectsService {
  /** Cloud Asset allows 400 calls per minute per quota project (SPEC-0001 CA-70). */
  private readonly assetLimiter = new RateLimiter(300);

  constructor(
    private readonly clients: GcpClientFactory,
    private readonly operations: OperationsService,
  ) {
    for (const kind of ['apis.service.enable', 'apis.service.disable']) {
      this.operations.registerResumer(kind, (op) => {
        if (!op.googleName) return null;
        const handle = { profileId: op.profileId };
        return this.pollerFor(handle.profileId, kind, op.googleName);
      });
    }
  }

  private projects(h: ProfileHandle) {
    return this.clients.get(h.profile.id, 'projects', (auth) => new ProjectsClient({ auth }));
  }

  private serviceUsage(profileId: string) {
    return this.clients.get(profileId, 'serviceusage', (auth) => new ServiceUsageClient({ auth }));
  }

  async search(h: ProfileHandle, q: string | undefined, pageSize: number, pageToken?: string): Promise<ListResponse<ProjectSummary>> {
    const [items, , response] = await this.projects(h).searchProjects(
      { query: projectQuery(q), pageSize, pageToken },
      { autoPaginate: false },
    );
    return {
      items: items.map(mapProject).filter((p) => p.projectId),
      nextPageToken: response?.nextPageToken || null,
    };
  }

  async get(h: ProfileHandle, projectId: string): Promise<ProjectSummary> {
    const [p] = await this.projects(h).getProject({ name: `projects/${projectId}` });
    return mapProject(p);
  }

  async listServices(
    h: ProfileHandle,
    projectId: string,
    state: 'ENABLED' | 'DISABLED' | undefined,
    pageSize: number,
    pageToken?: string,
  ): Promise<ListResponse<ServiceSummary>> {
    const [items, , response] = await this.serviceUsage(h.profile.id).listServices(
      { parent: `projects/${projectId}`, filter: state ? `state:${state}` : undefined, pageSize, pageToken },
      { autoPaginate: false },
    );
    return { items: items.map(mapService), nextPageToken: response?.nextPageToken || null };
  }

  private pollerFor(profileId: string, kind: string, googleName: string): Poller {
    return async () => {
      const client = this.serviceUsage(profileId);
      const op =
        kind === 'apis.service.enable'
          ? await client.checkEnableServiceProgress(googleName)
          : await client.checkDisableServiceProgress(googleName);
      if (!op.done) return { done: false };
      return op.error ? { done: true, error: toProblem({ code: op.error.code, details: op.error.message }) } : { done: true };
    };
  }

  /** Enables a service as an operation (SPEC-0001 CA-44, D-24: in the consumer project when named). */
  async enableService(h: ProfileHandle, projectId: string, service: string, consumerProject?: string): Promise<OperationSummary> {
    const target = consumerProject?.replace(/^projects\//, '') || projectId;
    const [operation] = await this.serviceUsage(h.profile.id).enableService({ name: `projects/${target}/services/${service}` });
    const googleName = operation.name ?? null;
    return this.operations.track({
      profileId: h.profile.id,
      projectId,
      product: 'apis',
      kind: 'apis.service.enable',
      family: 'longrunning',
      googleName,
      resource: {
        name: `projects/${target}/services/${service}`,
        displayName: target === projectId ? `Enable ${service}` : `Enable ${service} in ${target}`,
        href: null,
      },
      poll: googleName ? this.pollerFor(h.profile.id, 'apis.service.enable', googleName) : async () => ({ done: true }),
    });
  }

  async disableService(h: ProfileHandle, projectId: string, service: string): Promise<OperationSummary> {
    const [operation] = await this.serviceUsage(h.profile.id).disableService({
      name: `projects/${projectId}/services/${service}`,
      disableDependentServices: false,
    });
    const googleName = operation.name ?? null;
    return this.operations.track({
      profileId: h.profile.id,
      projectId,
      product: 'apis',
      kind: 'apis.service.disable',
      family: 'longrunning',
      googleName,
      resource: { name: `projects/${projectId}/services/${service}`, displayName: `Disable ${service}`, href: null },
      poll: googleName ? this.pollerFor(h.profile.id, 'apis.service.disable', googleName) : async () => ({ done: true }),
    });
  }

  /** Global resource search (SPEC-0001 D-21, CA-70). */
  async searchResources(h: ProfileHandle, projectId: string, q: string): Promise<AssetResult[]> {
    const slot = this.assetLimiter.tryAcquire(h.profile.quotaProjectId ?? h.profile.keyProjectId ?? h.profile.id);
    if (!slot.ok) {
      throw ProblemException.of('RESOURCE_EXHAUSTED', 'Too many searches in the last minute. Try again shortly.', { retryable: true });
    }
    const client = this.clients.get(h.profile.id, 'asset', (auth) => new AssetServiceClient({ auth }));
    const [results] = await client.searchAllResources(
      {
        scope: `projects/${projectId}`,
        query: q,
        pageSize: 20,
        readMask: { paths: ['name', 'asset_type', 'display_name', 'location', 'state', 'project', 'update_time'] },
      },
      { autoPaginate: false },
    );
    return results.map((r) => ({
      name: r.name ?? '',
      assetType: r.assetType ?? '',
      displayName: r.displayName || r.name?.split('/').pop() || '',
      location: r.location || null,
      state: r.state || null,
      project: r.project || null,
      updateTime: timestampToIso(r.updateTime),
    }));
  }
}
