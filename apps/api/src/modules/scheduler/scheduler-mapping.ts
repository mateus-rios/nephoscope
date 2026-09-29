import { httpMethods, type SaveSchedulerJob, type SchedulerJob, type SchedulerState, type SchedulerTarget } from '@nephoscope/contracts';
import { durationToSeconds, secondsToDuration, timestampToIso, toInt } from '../../core/gcp/proto.js';

// biome-ignore lint/suspicious/noExplicitAny: Scheduler messages are read and built field by field.
type Any = any;

const STATES: Record<string, SchedulerState> = {
  ENABLED: 'enabled',
  PAUSED: 'paused',
  DISABLED: 'disabled',
  UPDATE_FAILED: 'update_failed',
};

function httpMethod(v: unknown): (typeof httpMethods)[number] {
  return (httpMethods as readonly string[]).includes(String(v)) ? (String(v) as (typeof httpMethods)[number]) : 'POST';
}

/** Bytes to text; binary payloads come back as base64 and are flagged. */
function bytesToText(v: unknown): { text: string; binary: boolean } {
  if (v === null || v === undefined || v === '') return { text: '', binary: false };
  const buf = typeof v === 'string' ? Buffer.from(v, 'base64') : Buffer.from(v as Uint8Array);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), binary: false };
  } catch {
    return { text: buf.toString('base64'), binary: true };
  }
}

function mapTarget(j: Any): { target: SchedulerTarget; binary: boolean } {
  if (j?.pubsubTarget) {
    const data = bytesToText(j.pubsubTarget.data);
    return {
      target: {
        kind: 'pubsub',
        topic: String(j.pubsubTarget.topicName ?? ''),
        data: data.text,
        attributes: { ...(j.pubsubTarget.attributes ?? {}) },
      },
      binary: data.binary,
    };
  }
  if (j?.appEngineHttpTarget) {
    const t = j.appEngineHttpTarget;
    const body = bytesToText(t.body);
    return {
      target: {
        kind: 'appengine',
        relativeUri: String(t.relativeUri || '/'),
        method: httpMethod(t.httpMethod),
        service: t.appEngineRouting?.service || undefined,
        version: t.appEngineRouting?.version || undefined,
        headers: { ...(t.headers ?? {}) },
        body: body.text,
      },
      binary: body.binary,
    };
  }
  const t = j?.httpTarget ?? {};
  const body = bytesToText(t.body);
  const auth = t.oidcToken?.serviceAccountEmail
    ? ({ kind: 'oidc', serviceAccount: String(t.oidcToken.serviceAccountEmail), audience: t.oidcToken.audience || undefined } as const)
    : t.oauthToken?.serviceAccountEmail
      ? ({ kind: 'oauth', serviceAccount: String(t.oauthToken.serviceAccountEmail), scope: t.oauthToken.scope || undefined } as const)
      : ({ kind: 'none' } as const);
  return {
    target: {
      kind: 'http',
      uri: String(t.uri ?? ''),
      method: httpMethod(t.httpMethod),
      headers: { ...(t.headers ?? {}) },
      body: body.text,
      auth,
    },
    binary: body.binary,
  };
}

export function mapSchedulerJob(j: Any): SchedulerJob {
  const name = String(j?.name ?? '');
  const { target, binary } = mapTarget(j);
  const status = j?.status;
  const r = j?.retryConfig ?? {};
  return {
    name,
    id: name.split('/').pop() ?? '',
    location: /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '',
    description: j?.description || null,
    schedule: String(j?.schedule ?? ''),
    timeZone: String(j?.timeZone || 'Etc/UTC'),
    state: STATES[String(j?.state)] ?? 'unknown',
    target,
    binaryPayload: binary,
    lastAttemptTime: timestampToIso(j?.lastAttemptTime),
    lastAttemptStatus:
      status && (status.code || status.message)
        ? { code: toInt(status.code) ?? 0, message: status.message || null }
        : status
          ? { code: 0, message: null }
          : null,
    nextRunTime: timestampToIso(j?.scheduleTime),
    retry: {
      retryCount: toInt(r.retryCount) ?? undefined,
      maxRetryDurationSeconds: durationToSeconds(r.maxRetryDuration) ?? undefined,
      minBackoffSeconds: durationToSeconds(r.minBackoffDuration) ?? undefined,
      maxBackoffSeconds: durationToSeconds(r.maxBackoffDuration) ?? undefined,
      maxDoublings: toInt(r.maxDoublings) ?? undefined,
    },
    attemptDeadlineSeconds: durationToSeconds(j?.attemptDeadline),
    userUpdateTime: timestampToIso(j?.userUpdateTime),
  };
}

/** The Scheduler job message from the form (create and update). */
export function toSchedulerJob(name: string, s: SaveSchedulerJob): Any {
  const job: Any = { name, description: s.description, schedule: s.schedule, timeZone: s.timeZone };
  const t = s.target;
  if (t.kind === 'http') {
    job.httpTarget = { uri: t.uri, httpMethod: t.method, headers: t.headers, body: t.body ? Buffer.from(t.body) : undefined };
    if (t.auth.kind === 'oidc') job.httpTarget.oidcToken = { serviceAccountEmail: t.auth.serviceAccount, audience: t.auth.audience ?? '' };
    if (t.auth.kind === 'oauth') {
      job.httpTarget.oauthToken = {
        serviceAccountEmail: t.auth.serviceAccount,
        scope: t.auth.scope || 'https://www.googleapis.com/auth/cloud-platform',
      };
    }
  } else if (t.kind === 'pubsub') {
    job.pubsubTarget = { topicName: t.topic, data: t.data ? Buffer.from(t.data) : undefined, attributes: t.attributes };
  } else {
    job.appEngineHttpTarget = {
      relativeUri: t.relativeUri,
      httpMethod: t.method,
      headers: t.headers,
      body: t.body ? Buffer.from(t.body) : undefined,
      appEngineRouting: t.service || t.version ? { service: t.service ?? '', version: t.version ?? '' } : undefined,
    };
  }
  const r = s.retry;
  job.retryConfig = {
    retryCount: r.retryCount ?? 0,
    maxRetryDuration: r.maxRetryDurationSeconds !== undefined ? secondsToDuration(r.maxRetryDurationSeconds) : undefined,
    minBackoffDuration: r.minBackoffSeconds !== undefined ? secondsToDuration(r.minBackoffSeconds) : undefined,
    maxBackoffDuration: r.maxBackoffSeconds !== undefined ? secondsToDuration(r.maxBackoffSeconds) : undefined,
    maxDoublings: r.maxDoublings,
  };
  if (s.attemptDeadlineSeconds !== undefined) job.attemptDeadline = secondsToDuration(s.attemptDeadlineSeconds);
  return job;
}
