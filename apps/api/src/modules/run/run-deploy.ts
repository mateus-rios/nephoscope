import type { ContainerPatch, DeployService, EnvVar, TrafficTarget, UpdateJob } from '@nephoscope/contracts';
import { secondsToDuration } from '../../core/gcp/proto.js';
import { INGRESS_TO_V2, trafficToV2 } from './run-mapping.js';

// biome-ignore lint/suspicious/noExplicitAny: v2 messages are edited as plain objects and sent back whole.
type Any = any;

const EXEC_ENV = {
  GEN1: 'EXECUTION_ENVIRONMENT_GEN1',
  GEN2: 'EXECUTION_ENVIRONMENT_GEN2',
  UNSPECIFIED: 'EXECUTION_ENVIRONMENT_UNSPECIFIED',
} as const;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v ?? null)) as T;
}

export function envToV2(env: EnvVar[]): Any[] {
  return env.map((e) =>
    e.secret
      ? { name: e.name, valueSource: { secretKeyRef: { secret: e.secret.secret, version: e.secret.version } } }
      : { name: e.name, value: e.value ?? '' },
  );
}

/** The container that receives requests: the one with a port, else the first (SPEC-0003 D-02). */
export function pickContainer(containers: Any[], name?: string): Any {
  if (name) {
    const named = containers.find((c) => c?.name === name);
    if (!named) throw new Error(`There is no container named ${name}.`);
    return named;
  }
  return containers.find((c) => (c?.ports ?? []).length > 0) ?? containers[0];
}

/** Applies the container fields that were set; everything else is kept (SPEC-0003 R-01). */
export function patchContainer(container: Any, patch: Omit<ContainerPatch, 'name'>): void {
  if (patch.image !== undefined) container.image = patch.image;
  if (patch.command !== undefined) container.command = [...patch.command];
  if (patch.args !== undefined) container.args = [...patch.args];
  if (patch.env !== undefined) container.env = envToV2(patch.env);
  if (patch.port !== undefined) {
    const existing = container.ports?.[0] ?? {};
    container.ports = patch.port === null ? [] : [{ ...existing, name: existing.name || 'http1', containerPort: patch.port }];
  }
  if (patch.cpu !== undefined || patch.memory !== undefined || patch.cpuIdle !== undefined || patch.startupCpuBoost !== undefined) {
    container.resources ??= {};
    container.resources.limits = { ...(container.resources.limits ?? {}) };
    if (patch.cpu !== undefined) container.resources.limits.cpu = patch.cpu;
    if (patch.memory !== undefined) container.resources.limits.memory = patch.memory;
    if (patch.cpuIdle !== undefined) container.resources.cpuIdle = patch.cpuIdle;
    if (patch.startupCpuBoost !== undefined) container.resources.startupCpuBoost = patch.startupCpuBoost;
  }
}

function applyVpc(template: Any, vpc: DeployService['vpc']): void {
  if (vpc === undefined) return;
  if (vpc === null) {
    template.vpcAccess = null;
    return;
  }
  const next: Any = { ...(template.vpcAccess ?? {}) };
  if (vpc.egress !== undefined) next.egress = vpc.egress;
  if (vpc.connector !== undefined) {
    next.connector = vpc.connector ?? '';
    if (vpc.connector) next.networkInterfaces = [];
  }
  if (vpc.network !== undefined || vpc.subnetwork !== undefined || vpc.tags !== undefined) {
    const current = next.networkInterfaces?.[0] ?? {};
    const iface = {
      network: vpc.network !== undefined ? (vpc.network ?? '') : (current.network ?? ''),
      subnetwork: vpc.subnetwork !== undefined ? (vpc.subnetwork ?? '') : (current.subnetwork ?? ''),
      tags: vpc.tags ?? current.tags ?? [],
    };
    next.networkInterfaces = iface.network || iface.subnetwork ? [iface] : [];
    if (next.networkInterfaces.length > 0) next.connector = '';
  }
  template.vpcAccess = next;
}

/**
 * Builds the service to send to `updateService` for "Deploy revision" (SPEC-0003 D-02): the
 * current service with only the edited fields changed.
 */
export function applyDeploy(current: Any, patch: DeployService): Any {
  const service = clone(current);
  const serviceId =
    String(service.name ?? '')
      .split('/')
      .pop() ?? '';
  service.template ??= {};
  const template = service.template;
  template.containers ??= [];
  if (template.containers.length === 0) template.containers.push({});
  const { name: containerName, ...containerPatch } = patch.container ?? {};
  patchContainer(pickContainer(template.containers, containerName), containerPatch);

  if (patch.minInstances !== undefined || patch.maxInstances !== undefined) {
    template.scaling = { ...(template.scaling ?? {}) };
    if (patch.minInstances !== undefined) template.scaling.minInstanceCount = patch.minInstances ?? 0;
    if (patch.maxInstances !== undefined) template.scaling.maxInstanceCount = patch.maxInstances ?? 0;
  }
  if (patch.concurrency !== undefined) template.maxInstanceRequestConcurrency = patch.concurrency;
  if (patch.timeoutSeconds !== undefined) template.timeout = secondsToDuration(patch.timeoutSeconds);
  if (patch.executionEnvironment !== undefined) template.executionEnvironment = EXEC_ENV[patch.executionEnvironment];
  if (patch.serviceAccount !== undefined) template.serviceAccount = patch.serviceAccount ?? '';
  applyVpc(template, patch.vpc);
  if (patch.ingress !== undefined) service.ingress = INGRESS_TO_V2[patch.ingress];
  if (patch.labels !== undefined) service.labels = { ...patch.labels };

  // A revision name can be used once: set it from the suffix, or let Google generate one.
  template.revision = patch.revisionSuffix ? `${serviceId}-${patch.revisionSuffix}` : '';

  service.traffic = patch.serveImmediately
    ? serveLatest(service.traffic ?? [])
    : pinLatest(service.traffic ?? [], service.latestReadyRevision);
  if (patch.etag) service.etag = patch.etag;
  return service;
}

/** The new revision gets 100%; tag-only targets keep their tags at 0%. */
export function serveLatest(traffic: Any[]): Any[] {
  const latestTag = traffic.find((t) => t?.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST' && t.tag)?.tag ?? '';
  const tagged = traffic.filter((t) => t?.tag && t.type !== 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST').map((t) => ({ ...t, percent: 0 }));
  return [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100, tag: latestTag }, ...tagged];
}

/**
 * Keeps the current split when a new revision is deployed (`--no-traffic`): targets that follow
 * LATEST are pinned to the revision serving now, so the new one starts at 0%.
 */
export function pinLatest(traffic: Any[], latestReadyRevision: unknown): Any[] {
  const pinned = typeof latestReadyRevision === 'string' && latestReadyRevision ? latestReadyRevision.split('/').pop() : null;
  if (!pinned) return traffic;
  const targets = traffic.length > 0 ? traffic : [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }];
  return targets.map((t) =>
    t?.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST' ? { ...t, type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: pinned } : t,
  );
}

/** Traffic editor (SPEC-0003 D-03). Percentages must add up to 100; the schema checks it. */
export function applyTraffic(current: Any, traffic: TrafficTarget[], etag?: string): Any {
  const service = clone(current);
  service.traffic = traffic.map(trafficToV2);
  if (etag) service.etag = etag;
  return service;
}

/** Rollback: 100% to one revision, tags kept at 0% (SPEC-0003 CA-05). */
export function applyRollback(current: Any, revision: string): Any {
  const service = clone(current);
  const tags = (service.traffic ?? [])
    .filter(
      (t: Any) => t?.tag && !(t.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION' && String(t.revision).split('/').pop() === revision),
    )
    .map((t: Any) => ({ ...t, percent: 0 }));
  service.traffic = [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision, percent: 100 }, ...tags];
  return service;
}

/** Job configuration edit (SPEC-0003 D-06): same rules as a service template. */
export function applyJobUpdate(current: Any, patch: UpdateJob): Any {
  const job = clone(current);
  job.template ??= {};
  job.template.template ??= {};
  const task = job.template.template;
  task.containers ??= [];
  if (task.containers.length === 0) task.containers.push({});
  const { name: containerName, ...containerPatch } = patch.container ?? {};
  patchContainer(pickContainer(task.containers, containerName), containerPatch);
  if (patch.taskCount !== undefined) job.template.taskCount = patch.taskCount;
  if (patch.parallelism !== undefined) job.template.parallelism = patch.parallelism;
  if (patch.maxRetries !== undefined) task.maxRetries = patch.maxRetries;
  if (patch.timeoutSeconds !== undefined) task.timeout = secondsToDuration(patch.timeoutSeconds);
  if (patch.serviceAccount !== undefined) task.serviceAccount = patch.serviceAccount ?? '';
  if (patch.executionEnvironment !== undefined) task.executionEnvironment = EXEC_ENV[patch.executionEnvironment];
  if (patch.labels !== undefined) job.labels = { ...patch.labels };
  if (patch.etag) job.etag = patch.etag;
  return job;
}

/** A new service from the create form (SPEC-0003 T-01). */
export function newService(projectId: string, patch: DeployService & { id: string; region: string }): Any {
  const base = {
    name: `projects/${projectId}/locations/${patch.region}/services/${patch.id}`,
    template: { containers: [{ ports: [{ name: 'http1', containerPort: 8080 }] }] },
    traffic: [],
  };
  const service = applyDeploy(base, { ...patch, serveImmediately: true });
  // createService takes the id separately and rejects a name in the body.
  service.name = '';
  return service;
}
