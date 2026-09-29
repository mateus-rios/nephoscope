import type {
  CreateService,
  DeployService,
  ExecuteJob,
  InvokeRequest,
  InvokeResponse,
  ListResponse,
  OperationSummary,
  PublicAccessMode,
  Revision,
  RunExecution,
  RunJob,
  RunJobSummary,
  RunService as RunServiceDto,
  RunServiceSummary,
  RunTask,
  ServiceAccess,
  TrafficTarget,
  UpdateJob,
} from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { lroPoller, type OperationLike, operationGetter } from '../../core/gcp/lro.js';
import { rawJson, secondsToDuration } from '../../core/gcp/proto.js';
import { sdk } from '../../core/gcp/sdk.js';
import { InvokeService } from '../../core/invoke/invoke.service.js';
import { OperationsService, type Poller } from '../../core/operations/operations.service.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';
import { applyDeploy, applyJobUpdate, applyRollback, applyTraffic, newService } from './run-deploy.js';
import { mapExecution, mapJob, mapKnativeJob, mapKnativeService, mapRevision, mapService, mapTask } from './run-mapping.js';

// biome-ignore lint/suspicious/noExplicitAny: v2 messages are passed through as plain objects.
type Any = any;

const INVOKER_ROLE = 'roles/run.invoker';
const OPERATION_KINDS = [
  'run.service.create',
  'run.service.deploy',
  'run.service.traffic',
  'run.service.access',
  'run.service.delete',
  'run.revision.delete',
  'run.job.update',
  'run.job.run',
  'run.job.delete',
  'run.execution.cancel',
  'run.execution.delete',
] as const;
type OperationKind = (typeof OPERATION_KINDS)[number];

const shortName = (name: string) => name.split('/').pop() ?? name;
const locationOf = (name: string) => /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '';
const projectOf = (name: string) => /^projects\/([^/]+)\//.exec(name)?.[1] ?? '';

/** Web routes for the operations tray. */
export function runHref(name: string): string | null {
  const project = projectOf(name);
  const location = locationOf(name);
  const parts = name.split('/');
  const i = parts.indexOf('services');
  if (i > 0) return `/p/${project}/run/services/${location}/${parts[i + 1]}`;
  const j = parts.indexOf('jobs');
  if (j > 0) {
    const e = parts.indexOf('executions');
    return e > 0
      ? `/p/${project}/run/jobs/${location}/${parts[j + 1]}/executions/${parts[e + 1]}`
      : `/p/${project}/run/jobs/${location}/${parts[j + 1]}`;
  }
  return null;
}

/** Cloud Run services, revisions, jobs and executions (SPEC-0003 §7.1, §7.2). */
@Injectable()
export class RunService {
  constructor(
    private readonly clients: GcpClientFactory,
    private readonly operations: OperationsService,
    private readonly invoker: InvokeService,
  ) {
    for (const kind of OPERATION_KINDS) {
      this.operations.registerResumer(kind, (op) => (op.googleName ? this.poller(op.profileId, op.googleName) : null));
    }
  }

  // ---- clients -------------------------------------------------------------------------------

  private async services(profileId: string) {
    const { ServicesClient } = await sdk.run();
    return this.clients.get(profileId, 'run.services', (auth) => new ServicesClient({ auth }));
  }
  private async revisions(profileId: string) {
    const { RevisionsClient } = await sdk.run();
    return this.clients.get(profileId, 'run.revisions', (auth) => new RevisionsClient({ auth }));
  }
  private async jobs(profileId: string) {
    const { JobsClient } = await sdk.run();
    return this.clients.get(profileId, 'run.jobs', (auth) => new JobsClient({ auth }));
  }
  private async executions(profileId: string) {
    const { ExecutionsClient } = await sdk.run();
    return this.clients.get(profileId, 'run.executions', (auth) => new ExecutionsClient({ auth }));
  }
  private async tasks(profileId: string) {
    const { TasksClient } = await sdk.run();
    return this.clients.get(profileId, 'run.tasks', (auth) => new TasksClient({ auth }));
  }
  /** The v1 API: the global endpoint lists every region; reads of one resource need its region. */
  private async v1(h: ProfileHandle, region?: string) {
    const { run } = await sdk.runRest();
    const rootUrl = region ? `https://${region}-run.googleapis.com/` : undefined;
    return this.clients.get(h.profile.id, `run.v1.${region ?? 'global'}`, (auth) => run({ version: 'v1', auth: auth as never, rootUrl }));
  }

  private poller(profileId: string, googleName: string, onDone?: () => Promise<void>): Poller {
    const base = lroPoller(async (name) => operationGetter((await this.services(profileId)) as never)(name), googleName);
    if (!onDone) return base;
    return async () => {
      const r = await base();
      if (r.done && !r.error && !r.cancelled) await onDone();
      return r;
    };
  }

  private track(
    h: ProfileHandle,
    kind: OperationKind,
    resource: string,
    displayName: string,
    op: OperationLike,
    onDone?: () => Promise<void>,
  ): OperationSummary {
    const googleName = op.name ?? null;
    return this.operations.track({
      profileId: h.profile.id,
      projectId: projectOf(resource),
      product: 'run',
      kind,
      family: 'longrunning',
      googleName,
      resource: { name: resource, displayName, href: runHref(resource) },
      poll: googleName ? this.poller(h.profile.id, googleName, onDone) : async () => ({ done: true }),
    });
  }

  // ---- services ------------------------------------------------------------------------------

  async listServices(h: ProfileHandle, projectId: string, pageSize: number, pageToken?: string): Promise<ListResponse<RunServiceSummary>> {
    const client = await this.v1(h);
    const res = await client.namespaces.services.list({ parent: `namespaces/${projectId}`, limit: pageSize, continue: pageToken });
    return {
      items: (res.data.items ?? []).map((s) => mapKnativeService(s, projectId)),
      nextPageToken: res.data.metadata?.continue || null,
      unreachable: res.data.unreachable ?? [],
    };
  }

  async getService(h: ProfileHandle, name: string): Promise<RunServiceDto> {
    const [s] = await (await this.services(h.profile.id)).getService({ name });
    return mapService(s);
  }

  async rawService(h: ProfileHandle, name: string): Promise<unknown> {
    const client = await this.v1(h, locationOf(name));
    const res = await client.namespaces.services.get({ name: `namespaces/${projectOf(name)}/services/${shortName(name)}` });
    return res.data;
  }

  async createService(h: ProfileHandle, projectId: string, body: CreateService): Promise<OperationSummary> {
    const client = await this.services(h.profile.id);
    const [op] = await client.createService({
      parent: `projects/${projectId}/locations/${body.region}`,
      serviceId: body.id,
      service: newService(projectId, body),
    });
    const name = `projects/${projectId}/locations/${body.region}/services/${body.id}`;
    const allowPublic = body.allowPublic ? () => this.setInvokerBinding(h, name, true) : undefined;
    return this.track(h, 'run.service.create', name, `Create ${body.id} in ${body.region}`, op, allowPublic);
  }

  private async current(h: ProfileHandle, name: string): Promise<Any> {
    const [s] = await (await this.services(h.profile.id)).getService({ name });
    return s;
  }

  private async update(h: ProfileHandle, kind: OperationKind, name: string, displayName: string, service: Any): Promise<OperationSummary> {
    const [op] = await (await this.services(h.profile.id)).updateService({ service });
    return this.track(h, kind, name, displayName, op);
  }

  async deploy(h: ProfileHandle, name: string, patch: DeployService): Promise<OperationSummary> {
    const service = applyDeploy(await this.current(h, name), patch);
    return this.update(h, 'run.service.deploy', name, `Deploy ${shortName(name)}`, service);
  }

  async setTraffic(h: ProfileHandle, name: string, traffic: TrafficTarget[], etag?: string): Promise<OperationSummary> {
    const service = applyTraffic(await this.current(h, name), traffic, etag);
    return this.update(h, 'run.service.traffic', name, `Update traffic of ${shortName(name)}`, service);
  }

  async rollback(h: ProfileHandle, name: string, revision: string): Promise<OperationSummary> {
    const service = applyRollback(await this.current(h, name), revision);
    return this.update(h, 'run.service.traffic', name, `Roll back ${shortName(name)} to ${revision}`, service);
  }

  async deleteService(h: ProfileHandle, name: string): Promise<OperationSummary> {
    const [op] = await (await this.services(h.profile.id)).deleteService({ name });
    return this.track(h, 'run.service.delete', name, `Delete ${shortName(name)}`, op);
  }

  // ---- public access (SPEC-0003 D-04) ----------------------------------------------------------

  async getAccess(h: ProfileHandle, name: string): Promise<ServiceAccess> {
    const client = await this.services(h.profile.id);
    const [[service], [policy]] = await Promise.all([client.getService({ name }), client.getIamPolicy({ resource: name })]);
    const invokers = (policy.bindings ?? []).filter((b) => b.role === INVOKER_ROLE).flatMap((b) => b.members ?? []);
    const mode: PublicAccessMode = service.invokerIamDisabled ? 'invokerIamDisabled' : invokers.includes('allUsers') ? 'allUsers' : 'none';
    return { name, mode, invokers };
  }

  /** Access modes of many services for the list, 8 at a time; failures read as `unknown`. */
  async accessMany(h: ProfileHandle, names: string[]): Promise<ServiceAccess[]> {
    const out: ServiceAccess[] = [];
    let next = 0;
    const worker = async () => {
      while (next < names.length) {
        const name = names[next++] as string;
        try {
          out.push(await this.getAccess(h, name));
        } catch {
          out.push({ name, mode: 'unknown', invokers: [] });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, names.length) }, worker));
    return out;
  }

  private async setInvokerBinding(h: ProfileHandle, name: string, allUsers: boolean): Promise<void> {
    const client = await this.services(h.profile.id);
    const [policy] = await client.getIamPolicy({ resource: name });
    const bindings = (policy.bindings ?? []).map((b) => ({ ...b, members: [...(b.members ?? [])] }));
    let binding = bindings.find((b) => b.role === INVOKER_ROLE && !b.condition);
    if (allUsers) {
      if (!binding) {
        binding = { role: INVOKER_ROLE, members: [] };
        bindings.push(binding);
      }
      if (!binding.members.includes('allUsers')) binding.members.push('allUsers');
    } else if (binding) {
      binding.members = binding.members.filter((m) => m !== 'allUsers');
    }
    await client.setIamPolicy({ resource: name, policy: { ...policy, bindings: bindings.filter((b) => b.members.length > 0) } });
  }

  async setAccess(h: ProfileHandle, name: string, mode: PublicAccessMode): Promise<OperationSummary> {
    const service = await this.current(h, name);
    const wantsDisabled = mode === 'invokerIamDisabled';
    const displayName = mode === 'none' ? `Require authentication on ${shortName(name)}` : `Allow public access to ${shortName(name)}`;
    if (mode !== 'invokerIamDisabled') await this.setInvokerBinding(h, name, mode === 'allUsers');
    if (Boolean(service.invokerIamDisabled) !== wantsDisabled) {
      return this.update(h, 'run.service.access', name, displayName, { ...service, invokerIamDisabled: wantsDisabled });
    }
    return this.operations.recordInstant({
      profileId: h.profile.id,
      projectId: projectOf(name),
      product: 'run',
      kind: 'run.service.access',
      resource: { name, displayName, href: runHref(name) },
    });
  }

  // ---- revisions -----------------------------------------------------------------------------

  async listRevisions(h: ProfileHandle, serviceName: string, pageSize: number, pageToken?: string): Promise<ListResponse<Revision>> {
    const [service, [items, , response]] = await Promise.all([
      this.getService(h, serviceName),
      (await this.revisions(h.profile.id)).listRevisions({ parent: serviceName, pageSize, pageToken }, { autoPaginate: false }),
    ]);
    const revisions = items.map((r) => mapRevision(r, service));
    revisions.sort((a, b) => (b.createTime ?? '').localeCompare(a.createTime ?? ''));
    return { items: revisions, nextPageToken: response?.nextPageToken || null };
  }

  async getRevision(h: ProfileHandle, name: string): Promise<Revision> {
    const serviceName = name.replace(/\/revisions\/[^/]+$/, '');
    const [[r], service] = await Promise.all([
      (await this.revisions(h.profile.id)).getRevision({ name }),
      this.getService(h, serviceName).catch(() => null),
    ]);
    return mapRevision(r, service);
  }

  async rawRevision(h: ProfileHandle, name: string): Promise<unknown> {
    const [r] = await (await this.revisions(h.profile.id)).getRevision({ name });
    return rawJson(r);
  }

  async deleteRevision(h: ProfileHandle, name: string): Promise<OperationSummary> {
    const revision = await this.getRevision(h, name);
    if (revision.percent > 0) {
      throw ProblemException.of(
        'FAILED_PRECONDITION',
        `${revision.id} serves ${revision.percent}% of the traffic. Move its traffic before deleting it.`,
      );
    }
    const [op] = await (await this.revisions(h.profile.id)).deleteRevision({ name });
    return this.track(h, 'run.revision.delete', name, `Delete revision ${revision.id}`, op);
  }

  async invoke(h: ProfileHandle, name: string, req: InvokeRequest): Promise<InvokeResponse> {
    const service = await this.getService(h, name);
    const url = req.tag ? service.trafficStatuses.find((t) => t.tag === req.tag)?.uri : service.uri;
    if (!url) {
      throw ProblemException.of(
        'FAILED_PRECONDITION',
        req.tag ? `The tag ${req.tag} has no URL.` : 'This service has no URL; its default URL may be disabled.',
      );
    }
    return this.invoker.invoke(h, url, req);
  }

  // ---- jobs ----------------------------------------------------------------------------------

  async listJobs(h: ProfileHandle, projectId: string, pageSize: number, pageToken?: string): Promise<ListResponse<RunJobSummary>> {
    const client = await this.v1(h);
    const res = await client.namespaces.jobs.list({ parent: `namespaces/${projectId}`, limit: pageSize, continue: pageToken });
    return {
      items: (res.data.items ?? []).map((j) => mapKnativeJob(j, projectId)),
      nextPageToken: res.data.metadata?.continue || null,
      unreachable: res.data.unreachable ?? [],
    };
  }

  async getJob(h: ProfileHandle, name: string): Promise<RunJob> {
    const [j] = await (await this.jobs(h.profile.id)).getJob({ name });
    return mapJob(j);
  }

  async rawJob(h: ProfileHandle, name: string): Promise<unknown> {
    const client = await this.v1(h, locationOf(name));
    const res = await client.namespaces.jobs.get({ name: `namespaces/${projectOf(name)}/jobs/${shortName(name)}` });
    return res.data;
  }

  async updateJob(h: ProfileHandle, name: string, patch: UpdateJob): Promise<OperationSummary> {
    const client = await this.jobs(h.profile.id);
    const [current] = await client.getJob({ name });
    const [op] = await client.updateJob({ job: applyJobUpdate(current, patch) });
    return this.track(h, 'run.job.update', name, `Update ${shortName(name)}`, op);
  }

  async deleteJob(h: ProfileHandle, name: string): Promise<OperationSummary> {
    const [op] = await (await this.jobs(h.profile.id)).deleteJob({ name });
    return this.track(h, 'run.job.delete', name, `Delete ${shortName(name)}`, op);
  }

  /** Execute with overrides (SPEC-0003 D-06). Returns the new execution's name when known. */
  async runJob(h: ProfileHandle, name: string, body: ExecuteJob): Promise<{ operation: OperationSummary; execution: string | null }> {
    const client = await this.jobs(h.profile.id);
    const hasContainerOverride = body.args !== undefined || body.env !== undefined;
    const overrides: Any = {};
    if (hasContainerOverride) {
      overrides.containerOverrides = [
        {
          name: body.containerName ?? '',
          args: body.args ?? [],
          clearArgs: body.args !== undefined && body.args.length === 0,
          env: (body.env ?? []).map((e) => ({ name: e.name, value: e.value })),
        },
      ];
    }
    if (body.taskCount !== undefined) overrides.taskCount = body.taskCount;
    if (body.timeoutSeconds !== undefined) overrides.timeout = secondsToDuration(body.timeoutSeconds);
    const [op] = await client.runJob({ name, overrides: Object.keys(overrides).length > 0 ? overrides : undefined });
    const execution = ((op as Any).metadata?.name as string | undefined) || null;
    const operation = this.track(h, 'run.job.run', execution ?? name, `Execute ${shortName(name)}`, op);
    return { operation, execution };
  }

  async listExecutions(h: ProfileHandle, jobName: string, pageSize: number, pageToken?: string): Promise<ListResponse<RunExecution>> {
    const [items, , response] = await (await this.executions(h.profile.id)).listExecutions(
      { parent: jobName, pageSize, pageToken },
      { autoPaginate: false },
    );
    return { items: items.map(mapExecution), nextPageToken: response?.nextPageToken || null };
  }

  async getExecution(h: ProfileHandle, name: string): Promise<RunExecution> {
    const [e] = await (await this.executions(h.profile.id)).getExecution({ name });
    return mapExecution(e);
  }

  async rawExecution(h: ProfileHandle, name: string): Promise<unknown> {
    const [e] = await (await this.executions(h.profile.id)).getExecution({ name });
    return rawJson(e);
  }

  async listTasks(h: ProfileHandle, executionName: string): Promise<RunTask[]> {
    const [items] = await (await this.tasks(h.profile.id)).listTasks({ parent: executionName, pageSize: 1000 });
    return items.map(mapTask).sort((a, b) => a.index - b.index);
  }

  async cancelExecution(h: ProfileHandle, name: string): Promise<OperationSummary> {
    const [op] = await (await this.executions(h.profile.id)).cancelExecution({ name });
    return this.track(h, 'run.execution.cancel', name, `Cancel ${shortName(name)}`, op);
  }

  async deleteExecution(h: ProfileHandle, name: string): Promise<OperationSummary> {
    const [op] = await (await this.executions(h.profile.id)).deleteExecution({ name });
    return this.track(h, 'run.execution.delete', name, `Delete ${shortName(name)}`, op);
  }

  /** A read of the execution and its tasks, for the live channel. */
  async executionSnapshot(h: ProfileHandle, name: string): Promise<{ execution: RunExecution; tasks: RunTask[] }> {
    const [execution, tasks] = await Promise.all([
      this.getExecution(h, name),
      this.listTasks(h, name).catch((err) => {
        // Tasks appear a moment after the execution; an empty list is fine until then.
        if (toProblem(err).code === 'NOT_FOUND') return [];
        throw err;
      }),
    ]);
    return { execution, tasks };
  }
}
