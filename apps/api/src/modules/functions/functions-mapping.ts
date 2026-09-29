import type { CloudFunction, FunctionState, FunctionSummary, FunctionTrigger, RunServiceSummary } from '@nephoscope/contracts';
import { timestampToIso, toInt } from '../../core/gcp/proto.js';

// biome-ignore lint/suspicious/noExplicitAny: v2 Function messages are read field by field.
type Any = any;

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const STATES: Record<string, FunctionState> = { ACTIVE: 'active', DEPLOYING: 'deploying', FAILED: 'failed', DELETING: 'deleting' };

export function mapTrigger(f: Any): FunctionTrigger {
  const t = f?.eventTrigger;
  if (!t || !nonEmpty(t.eventType)) return { kind: 'http', eventType: null, resource: null, retry: null };
  const filters: Any[] = t.eventFilters ?? [];
  const bucket = filters.find((x) => x?.attribute === 'bucket')?.value;
  return {
    kind: 'event',
    eventType: String(t.eventType),
    resource:
      nonEmpty(t.pubsubTopic) ??
      nonEmpty(bucket) ??
      nonEmpty(t.trigger) ??
      (filters.length > 0 ? filters.map((x) => `${x.attribute}=${x.value}`).join(', ') : null),
    retry: t.retryPolicy === 'RETRY_POLICY_RETRY' ? true : t.retryPolicy === 'RETRY_POLICY_DO_NOT_RETRY' ? false : null,
  };
}

export function mapFunctionSummary(f: Any): FunctionSummary {
  const name = String(f?.name ?? '');
  return {
    name,
    id: name.split('/').pop() ?? '',
    location: /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '',
    generation: f?.environment === 'GEN_1' ? 'gen1' : 'gen2',
    runtime: nonEmpty(f?.buildConfig?.runtime),
    trigger: mapTrigger(f),
    state: STATES[String(f?.state)] ?? 'unknown',
    updateTime: timestampToIso(f?.updateTime),
    url: nonEmpty(f?.url) ?? nonEmpty(f?.serviceConfig?.uri),
    runService: f?.environment === 'GEN_1' ? null : nonEmpty(f?.serviceConfig?.service),
  };
}

export function mapFunction(f: Any): CloudFunction {
  const summary = mapFunctionSummary(f);
  const s = f?.serviceConfig ?? {};
  const b = f?.buildConfig ?? {};
  const storage = b?.source?.storageSource;
  const repo = b?.source?.repoSource;
  return {
    ...summary,
    description: nonEmpty(f?.description),
    stateMessages: (f?.stateMessages ?? []).map((m: Any) => ({
      severity: String(m?.severity ?? ''),
      type: String(m?.type ?? ''),
      message: String(m?.message ?? ''),
    })),
    entryPoint: nonEmpty(b.entryPoint),
    memory: nonEmpty(s.availableMemory),
    cpu: nonEmpty(s.availableCpu),
    timeoutSeconds: toInt(s.timeoutSeconds),
    serviceAccount: nonEmpty(s.serviceAccountEmail),
    environment: { ...(s.environmentVariables ?? {}) },
    secretEnvironment: (s.secretEnvironmentVariables ?? []).map((e: Any) => ({
      key: String(e?.key ?? ''),
      secret: String(e?.secret ?? ''),
      version: String(e?.version ?? 'latest'),
    })),
    minInstances: toInt(s.minInstanceCount),
    maxInstances: toInt(s.maxInstanceCount) || null,
    concurrency: toInt(s.maxInstanceRequestConcurrency) || null,
    ingress: nonEmpty(s.ingressSettings),
    vpcConnector: nonEmpty(s.vpcConnector),
    buildId: nonEmpty(b.build)?.split('/').pop() ?? null,
    dockerRepository: nonEmpty(b.dockerRepository),
    source: storage?.bucket
      ? {
          bucket: String(storage.bucket),
          object: String(storage.object ?? ''),
          generation: storage.generation ? String(storage.generation) : null,
        }
      : repo
        ? { repository: [repo.projectId, repo.repoName, repo.branchName ?? repo.tagName ?? repo.commitSha].filter(Boolean).join('/') }
        : null,
    labels: { ...(f?.labels ?? {}) },
    createTime: timestampToIso(f?.createTime),
    sourceEditable: summary.generation === 'gen2' && Boolean(storage?.bucket),
  };
}

/** A Cloud Run service deployed from function source, which only Cloud Run knows (SPEC-0003 D-07). */
export function runServiceAsFunction(s: RunServiceSummary): FunctionSummary {
  return {
    name: s.name,
    id: s.id,
    location: s.location,
    generation: 'run',
    runtime: s.functionRuntime,
    trigger: { kind: 'http', eventType: null, resource: null, retry: null },
    state: s.status === 'ready' ? 'active' : s.status === 'deploying' ? 'deploying' : s.status === 'failed' ? 'failed' : 'unknown',
    updateTime: s.lastDeployTime,
    url: s.uri,
    runService: s.name,
  };
}

/**
 * One list from two sources (SPEC-0003 D-07): Functions API entries, plus Cloud Run services built
 * from function source that do not back one of those entries.
 */
export function mergeFunctions(api: FunctionSummary[], run: RunServiceSummary[]): FunctionSummary[] {
  const backing = new Set(api.map((f) => f.runService).filter((n): n is string => Boolean(n)));
  const extra = run
    .filter((s) => s.isFunction && !backing.has(s.name) && s.labels['goog-managed-by'] !== 'cloudfunctions')
    .map(runServiceAsFunction);
  return [...api, ...extra].sort((a, b) => a.id.localeCompare(b.id) || a.location.localeCompare(b.location));
}
