import type {
  Condition,
  Container,
  ExecutionOutcome,
  Ingress,
  Revision,
  RevisionTemplate,
  RunExecution,
  RunJob,
  RunJobSummary,
  RunService,
  RunServiceSummary,
  RunStatus,
  RunTask,
  TrafficStatus,
  TrafficTarget,
  VpcAccess,
} from '@nephoscope/contracts';
import { durationToSeconds, timestampToIso, toInt } from '../../core/gcp/proto.js';

// The generated types are deep; the mapping reads plain objects and tolerates missing fields.
// biome-ignore lint/suspicious/noExplicitAny: gax messages and Knative JSON are read field by field.
type Any = any;

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const shortName = (name: unknown): string => (typeof name === 'string' ? (name.split('/').pop() ?? name) : '');
const locationOf = (name: string): string => /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '';

// ---- v2 --------------------------------------------------------------------------------------

const CONDITION_STATES: Record<string, Condition['state']> = {
  CONDITION_PENDING: 'PENDING',
  CONDITION_RECONCILING: 'RECONCILING',
  CONDITION_FAILED: 'FAILED',
  CONDITION_SUCCEEDED: 'SUCCEEDED',
};

export function mapCondition(c: Any): Condition {
  const reason = nonEmpty(c?.reason) ?? nonEmpty(c?.revisionReason) ?? nonEmpty(c?.executionReason);
  return {
    type: String(c?.type ?? ''),
    state: CONDITION_STATES[String(c?.state)] ?? 'UNSPECIFIED',
    message: nonEmpty(c?.message),
    reason: reason && !reason.endsWith('_UNDEFINED') && !reason.endsWith('_UNSPECIFIED') ? reason : null,
    severity: (['ERROR', 'WARNING', 'INFO'] as const).find((s) => s === c?.severity) ?? 'UNSPECIFIED',
    lastTransitionTime: timestampToIso(c?.lastTransitionTime),
  };
}

/** One status from the terminal condition (SPEC-0003 CA-01). */
export function statusOf(terminal: Any, reconciling: boolean): { status: RunStatus; message: string | null } {
  const c = terminal ? mapCondition(terminal) : null;
  if (c?.state === 'FAILED') return { status: 'failed', message: c.message };
  if (reconciling || c?.state === 'PENDING' || c?.state === 'RECONCILING') return { status: 'deploying', message: c?.message ?? null };
  if (c?.state === 'SUCCEEDED') return { status: 'ready', message: c.message };
  return { status: 'unknown', message: c?.message ?? null };
}

export function mapContainer(c: Any): Container {
  const limits = c?.resources?.limits ?? {};
  return {
    name: String(c?.name ?? ''),
    image: String(c?.image ?? ''),
    command: [...(c?.command ?? [])],
    args: [...(c?.args ?? [])],
    env: (c?.env ?? []).map((e: Any) => {
      const ref = e?.valueSource?.secretKeyRef;
      return {
        name: String(e?.name ?? ''),
        value: ref ? null : String(e?.value ?? ''),
        secret: ref ? { secret: String(ref.secret ?? ''), version: String(ref.version || 'latest') } : null,
      };
    }),
    port: toInt(c?.ports?.[0]?.containerPort),
    cpu: nonEmpty(limits.cpu),
    memory: nonEmpty(limits.memory),
    cpuIdle: typeof c?.resources?.cpuIdle === 'boolean' ? c.resources.cpuIdle : null,
    startupCpuBoost: typeof c?.resources?.startupCpuBoost === 'boolean' ? c.resources.startupCpuBoost : null,
    workingDir: nonEmpty(c?.workingDir),
    hasProbes: Boolean(c?.livenessProbe || c?.startupProbe),
    volumeMounts: (c?.volumeMounts ?? []).map((v: Any) => ({ name: String(v?.name ?? ''), mountPath: String(v?.mountPath ?? '') })),
  };
}

function mapVpc(v: Any): VpcAccess | null {
  if (!v || (!nonEmpty(v.connector) && !(v.networkInterfaces?.length > 0))) return null;
  return {
    connector: nonEmpty(v.connector),
    egress: v.egress === 'ALL_TRAFFIC' || v.egress === 'PRIVATE_RANGES_ONLY' ? v.egress : 'UNSPECIFIED',
    networkInterfaces: (v.networkInterfaces ?? []).map((n: Any) => ({
      network: nonEmpty(n?.network),
      subnetwork: nonEmpty(n?.subnetwork),
      tags: [...(n?.tags ?? [])],
    })),
  };
}

function executionEnvironment(v: unknown): RevisionTemplate['executionEnvironment'] {
  if (v === 'EXECUTION_ENVIRONMENT_GEN1') return 'GEN1';
  if (v === 'EXECUTION_ENVIRONMENT_GEN2') return 'GEN2';
  return 'UNSPECIFIED';
}

function volumeKind(v: Any): string {
  for (const k of ['secret', 'cloudSqlInstance', 'emptyDir', 'nfs', 'gcs']) if (v?.[k]) return k;
  return 'other';
}

/** A service template or a revision: the same fields in both (SPEC-0003 D-02). */
export function mapTemplate(t: Any): RevisionTemplate {
  return {
    revision: nonEmpty(t?.revision),
    containers: (t?.containers ?? []).map(mapContainer),
    minInstances: toInt(t?.scaling?.minInstanceCount),
    maxInstances: toInt(t?.scaling?.maxInstanceCount) || null,
    concurrency: toInt(t?.maxInstanceRequestConcurrency) || null,
    timeoutSeconds: durationToSeconds(t?.timeout),
    serviceAccount: nonEmpty(t?.serviceAccount),
    executionEnvironment: executionEnvironment(t?.executionEnvironment),
    vpc: mapVpc(t?.vpcAccess),
    labels: { ...(t?.labels ?? {}) },
    volumes: (t?.volumes ?? []).map((v: Any) => ({ name: String(v?.name ?? ''), kind: volumeKind(v) })),
    sessionAffinity: Boolean(t?.sessionAffinity),
  };
}

const INGRESS: Record<string, Ingress> = {
  INGRESS_TRAFFIC_ALL: 'ALL',
  INGRESS_TRAFFIC_INTERNAL_ONLY: 'INTERNAL_ONLY',
  INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER: 'INTERNAL_LOAD_BALANCER',
  INGRESS_TRAFFIC_NONE: 'NONE',
};
export const INGRESS_TO_V2: Record<Exclude<Ingress, 'UNSPECIFIED'>, string> = {
  ALL: 'INGRESS_TRAFFIC_ALL',
  INTERNAL_ONLY: 'INGRESS_TRAFFIC_INTERNAL_ONLY',
  INTERNAL_LOAD_BALANCER: 'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER',
  NONE: 'INGRESS_TRAFFIC_NONE',
};

function mapTrafficTarget(t: Any): TrafficTarget {
  const latest = t?.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST';
  return {
    type: latest ? 'LATEST' : 'REVISION',
    revision: latest ? null : nonEmpty(shortName(t?.revision)),
    percent: toInt(t?.percent) ?? 0,
    tag: nonEmpty(t?.tag),
  };
}

export function trafficToV2(t: TrafficTarget): Any {
  return t.type === 'LATEST'
    ? { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: t.percent, tag: t.tag ?? '' }
    : { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: t.revision ?? '', percent: t.percent, tag: t.tag ?? '' };
}

export function mapService(s: Any): RunService {
  const name = String(s?.name ?? '');
  const { status, message } = statusOf(s?.terminalCondition, Boolean(s?.reconciling));
  return {
    name,
    id: shortName(name),
    location: locationOf(name),
    uri: nonEmpty(s?.uri),
    urls: [...(s?.urls ?? [])],
    status,
    statusMessage: message,
    conditions: [s?.terminalCondition, ...(s?.conditions ?? [])].filter(Boolean).map(mapCondition),
    reconciling: Boolean(s?.reconciling),
    generation: String(s?.generation ?? '0'),
    creator: nonEmpty(s?.creator),
    lastModifier: nonEmpty(s?.lastModifier),
    createTime: timestampToIso(s?.createTime),
    updateTime: timestampToIso(s?.updateTime),
    description: nonEmpty(s?.description),
    ingress: INGRESS[String(s?.ingress)] ?? 'UNSPECIFIED',
    invokerIamDisabled: Boolean(s?.invokerIamDisabled),
    defaultUriDisabled: Boolean(s?.defaultUriDisabled),
    latestReadyRevision: nonEmpty(shortName(s?.latestReadyRevision)),
    latestCreatedRevision: nonEmpty(shortName(s?.latestCreatedRevision)),
    traffic: (s?.traffic ?? []).map(mapTrafficTarget),
    trafficStatuses: (s?.trafficStatuses ?? []).map((t: Any): TrafficStatus => ({ ...mapTrafficTarget(t), uri: nonEmpty(t?.uri) })),
    template: mapTemplate(s?.template),
    labels: { ...(s?.labels ?? {}) },
    functionTarget: nonEmpty(s?.buildConfig?.functionTarget),
    etag: nonEmpty(s?.etag),
  };
}

export function mapRevision(r: Any, service: RunService | null): Revision {
  const name = String(r?.name ?? '');
  const id = shortName(name);
  const { status, message } = statusOf(
    (r?.conditions ?? []).find((c: Any) => c?.type === 'Ready'),
    Boolean(r?.reconciling),
  );
  const statuses = service?.trafficStatuses ?? [];
  const serving = statuses.filter((t) => t.revision === id || (t.type === 'LATEST' && service?.latestReadyRevision === id));
  return {
    name,
    id,
    service: shortName(r?.service),
    status,
    statusMessage: message,
    createTime: timestampToIso(r?.createTime),
    creator: nonEmpty(r?.creator),
    percent: serving.reduce((sum, t) => sum + t.percent, 0),
    tags: serving.map((t) => t.tag).filter((t): t is string => Boolean(t)),
    images: (r?.containers ?? []).map((c: Any) => String(c?.image ?? '')),
    imageDigests: (r?.containers ?? []).map((c: Any) => {
      const digest = /@(sha256:[a-f0-9]+)$/.exec(String(c?.image ?? ''))?.[1];
      return digest ?? null;
    }),
    template: mapTemplate(r),
    conditions: (r?.conditions ?? []).map(mapCondition),
    logUri: nonEmpty(r?.logUri),
  };
}

const COMPLETION: Record<string, ExecutionOutcome> = {
  EXECUTION_SUCCEEDED: 'succeeded',
  EXECUTION_FAILED: 'failed',
  EXECUTION_RUNNING: 'running',
  EXECUTION_PENDING: 'pending',
  EXECUTION_CANCELLED: 'cancelled',
};

export function mapJob(j: Any): RunJob {
  const name = String(j?.name ?? '');
  const { status, message } = statusOf(j?.terminalCondition, Boolean(j?.reconciling));
  const task = j?.template?.template ?? {};
  return {
    name,
    id: shortName(name),
    location: locationOf(name),
    status,
    statusMessage: message,
    conditions: [j?.terminalCondition, ...(j?.conditions ?? [])].filter(Boolean).map(mapCondition),
    reconciling: Boolean(j?.reconciling),
    creator: nonEmpty(j?.creator),
    lastModifier: nonEmpty(j?.lastModifier),
    createTime: timestampToIso(j?.createTime),
    updateTime: timestampToIso(j?.updateTime),
    taskCount: toInt(j?.template?.taskCount) || 1,
    parallelism: toInt(j?.template?.parallelism) ?? 0,
    maxRetries: toInt(task.maxRetries),
    timeoutSeconds: durationToSeconds(task.timeout),
    serviceAccount: nonEmpty(task.serviceAccount),
    executionEnvironment: executionEnvironment(task.executionEnvironment),
    containers: (task.containers ?? []).map(mapContainer),
    vpc: mapVpc(task.vpcAccess),
    labels: { ...(j?.labels ?? {}) },
    executionCount: toInt(j?.executionCount) ?? 0,
    latestExecution: nonEmpty(j?.latestCreatedExecution?.name),
    etag: nonEmpty(j?.etag),
  };
}

/** Outcome from the counts and the Completed condition. */
export function executionOutcome(e: Any): ExecutionOutcome {
  const completed = (e?.conditions ?? []).find((c: Any) => c?.type === 'Completed');
  const running = toInt(e?.runningCount) ?? 0;
  if (e?.completionTime && timestampToIso(e.completionTime)) {
    if ((toInt(e?.cancelledCount) ?? 0) > 0 || /CANCEL/.test(String(completed?.executionReason ?? ''))) return 'cancelled';
    if (completed?.state === 'CONDITION_FAILED' || (toInt(e?.failedCount) ?? 0) > 0) return 'failed';
    return 'succeeded';
  }
  if (completed?.state === 'CONDITION_FAILED') return 'failed';
  if (running > 0 || e?.startTime) return 'running';
  return 'pending';
}

export function mapExecution(e: Any): RunExecution {
  const name = String(e?.name ?? '');
  const completed = (e?.conditions ?? []).find((c: Any) => c?.type === 'Completed');
  return {
    name,
    id: shortName(name),
    job: shortName(e?.job),
    outcome: executionOutcome(e),
    statusMessage: nonEmpty(completed?.message),
    createTime: timestampToIso(e?.createTime),
    startTime: timestampToIso(e?.startTime),
    completionTime: timestampToIso(e?.completionTime),
    taskCount: toInt(e?.taskCount) ?? 0,
    parallelism: toInt(e?.parallelism) ?? 0,
    running: toInt(e?.runningCount) ?? 0,
    succeeded: toInt(e?.succeededCount) ?? 0,
    failed: toInt(e?.failedCount) ?? 0,
    cancelled: toInt(e?.cancelledCount) ?? 0,
    retried: toInt(e?.retriedCount) ?? 0,
    conditions: (e?.conditions ?? []).map(mapCondition),
    logUri: nonEmpty(e?.logUri),
    reconciling: Boolean(e?.reconciling),
  };
}

export function mapTask(t: Any): RunTask {
  const result = t?.lastAttemptResult;
  const completed = (t?.conditions ?? []).find((c: Any) => c?.type === 'Completed');
  let outcome: ExecutionOutcome = 'pending';
  if (t?.completionTime && timestampToIso(t.completionTime)) {
    if (/CANCEL/.test(String(completed?.executionReason ?? ''))) outcome = 'cancelled';
    else outcome = completed?.state === 'CONDITION_FAILED' || (result?.exitCode ?? 0) !== 0 ? 'failed' : 'succeeded';
  } else if (t?.startTime && timestampToIso(t.startTime)) {
    outcome = 'running';
  }
  return {
    name: String(t?.name ?? ''),
    index: toInt(t?.index) ?? 0,
    outcome,
    retried: toInt(t?.retried) ?? 0,
    exitCode: result ? toInt(result.exitCode) : null,
    lastAttemptMessage: nonEmpty(result?.status?.message) ?? nonEmpty(completed?.message),
    startTime: timestampToIso(t?.startTime),
    completionTime: timestampToIso(t?.completionTime),
    logUri: nonEmpty(t?.logUri),
  };
}

// ---- v1 (Knative) lists ----------------------------------------------------------------------

function knativeStatus(obj: Any): { status: RunStatus; message: string | null } {
  const ready = (obj?.status?.conditions ?? []).find((c: Any) => c?.type === 'Ready');
  const observed = toInt(obj?.status?.observedGeneration);
  const stale = observed !== null && observed < (toInt(obj?.metadata?.generation) ?? 0);
  if (ready?.status === 'False') return { status: 'failed', message: nonEmpty(ready.message) };
  if (stale || ready?.status === 'Unknown') return { status: 'deploying', message: nonEmpty(ready?.message) };
  if (ready?.status === 'True') return { status: 'ready', message: nonEmpty(ready.message) };
  return { status: 'unknown', message: null };
}

const KNATIVE_INGRESS: Record<string, Ingress> = {
  all: 'ALL',
  internal: 'INTERNAL_ONLY',
  'internal-and-cloud-load-balancing': 'INTERNAL_LOAD_BALANCER',
  none: 'NONE',
};

/** "nodejs22" from the base image annotations of a source deploy. */
function runtimeOf(annotations: Record<string, string>): string | null {
  let image = nonEmpty(annotations['run.googleapis.com/build-base-image']);
  if (!image) {
    try {
      const map = JSON.parse(annotations['run.googleapis.com/base-images'] ?? '{}') as Record<string, string>;
      image = Object.values(map)[0] ?? null;
    } catch {
      image = null;
    }
  }
  return image ? (image.split('/').pop()?.split(':')[0] ?? null) : null;
}

/** A v1 list item, named with its v2 name (SPEC-0003 D-01). */
export function mapKnativeService(s: Any, projectId: string): RunServiceSummary {
  const id = String(s?.metadata?.name ?? '');
  const location = String(s?.metadata?.labels?.['cloud.googleapis.com/location'] ?? '');
  const annotations = s?.metadata?.annotations ?? {};
  const labels = { ...(s?.metadata?.labels ?? {}) };
  const ready = (s?.status?.conditions ?? []).find((c: Any) => c?.type === 'Ready');
  const { status, message } = knativeStatus(s);
  return {
    name: `projects/${projectId}/locations/${location}/services/${id}`,
    id,
    location,
    uri: nonEmpty(s?.status?.url),
    status,
    statusMessage: message,
    lastDeployTime: nonEmpty(ready?.lastTransitionTime) ?? nonEmpty(s?.metadata?.creationTimestamp),
    lastDeployer: nonEmpty(annotations['serving.knative.dev/lastModifier']) ?? nonEmpty(annotations['serving.knative.dev/creator']),
    traffic: (s?.status?.traffic ?? []).map(
      (t: Any): TrafficStatus => ({
        type: t?.latestRevision ? 'LATEST' : 'REVISION',
        revision: nonEmpty(t?.revisionName),
        percent: toInt(t?.percent) ?? 0,
        tag: nonEmpty(t?.tag),
        uri: nonEmpty(t?.url),
      }),
    ),
    ingress: KNATIVE_INGRESS[String(annotations['run.googleapis.com/ingress'] ?? 'all')] ?? 'UNSPECIFIED',
    invokerIamDisabled: String(annotations['run.googleapis.com/invoker-iam-disabled']) === 'true',
    isFunction: Boolean(annotations['run.googleapis.com/build-function-target']) || labels['goog-managed-by'] === 'cloudfunctions',
    functionTarget: nonEmpty(annotations['run.googleapis.com/build-function-target']),
    functionRuntime: runtimeOf(annotations),
    labels,
  };
}

export function mapKnativeJob(j: Any, projectId: string): RunJobSummary {
  const id = String(j?.metadata?.name ?? '');
  const location = String(j?.metadata?.labels?.['cloud.googleapis.com/location'] ?? '');
  const annotations = j?.metadata?.annotations ?? {};
  const last = j?.status?.latestCreatedExecution;
  const { status, message } = knativeStatus(j);
  return {
    name: `projects/${projectId}/locations/${location}/jobs/${id}`,
    id,
    location,
    status,
    statusMessage: message,
    taskCount: toInt(j?.spec?.template?.spec?.taskCount),
    executionCount: toInt(j?.status?.executionCount) ?? 0,
    lastExecution: last?.name
      ? {
          name: `projects/${projectId}/locations/${location}/jobs/${id}/executions/${last.name}`,
          outcome: COMPLETION[String(last.completionStatus)] ?? 'unknown',
          createTime: nonEmpty(last.creationTimestamp),
          completionTime: nonEmpty(last.completionTimestamp),
        }
      : null,
    lastDeployer: nonEmpty(annotations['run.googleapis.com/lastModifier']) ?? nonEmpty(annotations['run.googleapis.com/creator']),
    labels: { ...(j?.metadata?.labels ?? {}) },
  };
}
