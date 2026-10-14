import type { OperationFamily, OperationSummary, Problem } from '@nephoscope/contracts';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type ProfileHandle, ProfilesService } from '../credentials/profiles.service.js';
import { OperationsService, type Poller, type PollResult } from '../operations/operations.service.js';
import { toProblem } from '../problem/google-error.mapper.js';
import { isGoogleApiUrl, rest } from './rest.js';

// biome-ignore lint/suspicious/noExplicitAny: operations of four API families are read field by field.
type Any = any;

/** How a REST response that started work is followed (SPEC-0001 D-09). */
export interface RestOperation {
  family: Extract<OperationFamily, 'longrunning' | 'compute' | 'cloudsql' | 'gke' | 'bigquery'>;
  /** Full URL polled until the operation is done; kept as the Google name to resume after a restart. */
  url: string;
}

/**
 * Recognizes an operation in a REST response: `google.longrunning` (`name` and `done`), Compute
 * and Cloud SQL operations (`kind`), and GKE operations (`operationType` and `status`). Returns
 * null for a response that finished at once.
 */
export function detectOperation(res: unknown, root: string): RestOperation | null {
  if (!res || typeof res !== 'object') return null;
  const r = res as Any;
  if (r.kind === 'compute#operation' && typeof r.selfLink === 'string') return { family: 'compute', url: r.selfLink };
  if (r.kind === 'sql#operation' && typeof r.selfLink === 'string') return { family: 'cloudsql', url: r.selfLink };
  if (r.kind === 'bigquery#job' && r.jobReference?.jobId && r.jobReference?.projectId)
    return { family: 'bigquery', url: bigQueryJobUrl(r.jobReference) };
  if (
    typeof r.operationType === 'string' &&
    typeof r.status === 'string' &&
    typeof r.selfLink === 'string' &&
    r.selfLink.includes('container.googleapis.com')
  )
    return { family: 'gke', url: r.selfLink };
  if (typeof r.name === 'string' && /\/operations\//.test(r.name) && ('done' in r || 'metadata' in r))
    return { family: 'longrunning', url: `${root}${r.name}` };
  return null;
}

/** The poll URL of a BigQuery job, which names its location. */
export function bigQueryJobUrl(ref: { projectId: string; jobId: string; location?: string }): string {
  const q = ref.location ? `?location=${encodeURIComponent(ref.location)}` : '';
  return `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(ref.projectId)}/jobs/${encodeURIComponent(ref.jobId)}${q}`;
}

function errorProblem(status: number | undefined, message: string): Problem {
  return toProblem({ response: { status: status ?? 500, data: { error: { code: status ?? 500, message } } } });
}

/** Reads one poll of an operation of any REST family. */
export function readOperation(family: RestOperation['family'], op: Any): PollResult {
  switch (family) {
    case 'longrunning': {
      if (!op?.done) return { done: false };
      if (op.error?.code) {
        if (op.error.code === 1) return { done: true, cancelled: true, message: op.error.message ?? null };
        return { done: true, error: toProblem({ code: op.error.code, details: op.error.message ?? 'The operation failed.' }) };
      }
      return { done: true };
    }
    case 'compute': {
      const progress = typeof op?.progress === 'number' ? op.progress : null;
      if (op?.status !== 'DONE') return { done: false, progress, message: op?.statusMessage ?? null };
      const first = op.error?.errors?.[0];
      if (first)
        return { done: true, error: errorProblem(op.httpErrorStatusCode, first.message ?? op.httpErrorMessage ?? 'The operation failed.') };
      return { done: true };
    }
    case 'cloudsql': {
      if (op?.status !== 'DONE')
        return { done: false, message: op?.operationType ? `${String(op.operationType).toLowerCase().replace(/_/g, ' ')}` : null };
      const first = op.error?.errors?.[0];
      if (first) return { done: true, error: errorProblem(400, first.message ?? first.code ?? 'The operation failed.') };
      return { done: true };
    }
    case 'bigquery': {
      const state = String(op?.status?.state ?? '');
      if (state !== 'DONE') return { done: false, message: state ? state.toLowerCase() : null };
      const e = op.status?.errorResult;
      if (e) {
        if (e.reason === 'stopped') return { done: true, cancelled: true, message: e.message ?? null };
        const status =
          e.reason === 'bytesBilledLimitExceeded' || e.reason === 'invalidQuery' || e.reason === 'invalid'
            ? 400
            : e.reason === 'accessDenied'
              ? 403
              : e.reason === 'notFound'
                ? 404
                : 500;
        return { done: true, error: errorProblem(status, e.message ?? 'The job failed.') };
      }
      return { done: true };
    }
    case 'gke': {
      if (op?.status !== 'DONE') return { done: false, message: op?.detail ?? null };
      if (op.error?.code || op.error?.message) {
        return {
          done: true,
          error: toProblem({ code: op.error.code ?? 2, details: op.error.message ?? op.statusMessage ?? 'The operation failed.' }),
        };
      }
      if (op.statusMessage && /error|fail/i.test(op.statusMessage)) return { done: true, error: errorProblem(400, op.statusMessage) };
      return { done: true };
    }
  }
}

export function restPoller(h: ProfileHandle, op: RestOperation, onDone?: () => void): Poller {
  const client = rest(h, '');
  return async () => {
    const r = readOperation(op.family, await client.get<Any>(op.url));
    if (r.done) onDone?.();
    return r;
  };
}

export interface TrackRestInput {
  projectId: string;
  product: string;
  kind: string;
  resource: OperationSummary['resource'];
  /** API root of the call, used to poll `google.longrunning` operations by name. */
  root: string;
  response: unknown;
  onDone?: () => void;
  /** Asks Google to stop the work (operations tray, SPEC-0001 CA-34). */
  cancel?: () => Promise<void>;
}

/**
 * Follows operations started through REST calls (SPEC-0001 D-09) and resumes them after a restart
 * from the poll URL kept as the Google name (CA-35).
 */
@Injectable()
export class RestOperations implements OnModuleInit {
  constructor(
    private readonly operations: OperationsService,
    private readonly profiles: ProfilesService,
  ) {}

  onModuleInit(): void {
    this.operations.registerFallbackResumer((summary) => {
      const family = summary.family;
      if (!summary.googleName || !isGoogleApiUrl(summary.googleName)) return null;
      if (family !== 'longrunning' && family !== 'compute' && family !== 'cloudsql' && family !== 'gke' && family !== 'bigquery')
        return null;
      let h: ProfileHandle;
      try {
        h = this.profiles.get(summary.profileId);
      } catch {
        return null;
      }
      return restPoller(h, { family, url: summary.googleName });
    });
  }

  /** Tracks the operation in `response`, or records an instant entry when there is none. */
  track(h: ProfileHandle, input: TrackRestInput): OperationSummary {
    const op = detectOperation(input.response, input.root);
    if (!op) {
      input.onDone?.();
      return this.operations.recordInstant({
        profileId: h.profile.id,
        projectId: input.projectId,
        product: input.product,
        kind: input.kind,
        resource: input.resource,
      });
    }
    return this.operations.track({
      profileId: h.profile.id,
      projectId: input.projectId,
      product: input.product,
      kind: input.kind,
      family: op.family,
      resource: input.resource,
      googleName: op.url,
      poll: restPoller(h, op, input.onDone),
      cancel: input.cancel,
    });
  }
}
