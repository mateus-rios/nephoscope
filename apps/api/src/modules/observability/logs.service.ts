import type { LogPage, LogQuery } from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { RateLimiter } from '../../core/gcp/rate-limiter.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';
import { mapRestEntry } from './log-mapping.js';

const ENTRIES_LIST = 'https://logging.googleapis.com/v2/entries:list';
/** Two thirds of Google's 60 calls per minute per project (SPEC-0005 D-02). */
const CALLS_PER_MINUTE = 40;
const FIRST_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 120_000;

/** Joins LQL clauses; each is parenthesized so user text cannot change the base filter's meaning. */
export function buildFilter(q: Pick<LogQuery, 'filter' | 'extra' | 'minSeverity' | 'since' | 'until'>): string {
  const clauses = [`(${q.filter})`];
  if (q.extra?.trim()) clauses.push(`(${q.extra.trim()})`);
  if (q.minSeverity && q.minSeverity !== 'DEFAULT') clauses.push(`severity>=${q.minSeverity}`);
  clauses.push(`timestamp>="${q.since}"`);
  if (q.until) clauses.push(`timestamp<="${q.until}"`);
  return clauses.join(' AND ');
}

/** entries.list with the project quota guard of SPEC-0005 D-02. */
@Injectable()
export class LogsService {
  private readonly limiter = new RateLimiter(CALLS_PER_MINUTE);
  private readonly backoff = new Map<string, { until: number; next: number }>();

  private guard(projectId: string): void {
    const b = this.backoff.get(projectId);
    const now = Date.now();
    if (b && b.until > now) {
      throw this.waitProblem(b.until - now, 'Google reported the Logging read quota as exhausted.');
    }
    const slot = this.limiter.tryAcquire(projectId, now);
    if (!slot.ok) throw this.waitProblem(slot.retryAfterMs, 'Nephoscope keeps Logging reads under 40 per minute per project.');
  }

  private waitProblem(ms: number, why: string): ProblemException {
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    return ProblemException.of('RESOURCE_EXHAUSTED', `Waiting for Logging quota, about ${seconds} s. ${why}`, {
      retryable: true,
      retryAfterSeconds: seconds,
    });
  }

  async list(h: ProfileHandle, projectId: string, q: LogQuery): Promise<LogPage> {
    this.guard(projectId);
    try {
      const res = await h.auth.request<{ entries?: Record<string, unknown>[]; nextPageToken?: string }>({
        url: ENTRIES_LIST,
        method: 'POST',
        data: {
          resourceNames: [`projects/${projectId}`],
          filter: buildFilter(q),
          orderBy: 'timestamp desc',
          pageSize: q.pageSize ?? 100,
          pageToken: q.pageToken || undefined,
        },
      });
      this.backoff.delete(projectId);
      return {
        entries: (res.data.entries ?? []).map(mapRestEntry),
        nextPageToken: res.data.nextPageToken || null,
      };
    } catch (err) {
      const problem = toProblem(err);
      if (problem.code === 'RESOURCE_EXHAUSTED') {
        const previous = this.backoff.get(projectId)?.next ?? FIRST_BACKOFF_MS;
        this.backoff.set(projectId, { until: Date.now() + previous, next: Math.min(previous * 2, MAX_BACKOFF_MS) });
        throw this.waitProblem(previous, 'Google reported the Logging read quota as exhausted.');
      }
      throw err;
    }
  }
}
