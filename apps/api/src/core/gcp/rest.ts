import type { ProfileHandle } from '../credentials/profiles.service.js';
import { ProblemException } from '../problem/problem.js';

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];

export interface RestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** `text` returns the body as a string, for log objects and other plain payloads. */
  responseType?: 'json' | 'text';
}

/** Builds a query string; arrays repeat the key, empty values are left out. */
export function queryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) for (const item of v) u.append(k, String(item));
    else u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Google REST hosts Nephoscope may call (SPEC-0001 CA-20). */
export function isGoogleApiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'googleapis.com' || u.hostname.endsWith('.googleapis.com'));
  } catch {
    return false;
  }
}

/**
 * A Google REST API called with the profile's credentials and quota project (SPEC-0001 D-03,
 * D-24). Products without streaming use REST rather than gRPC clients, which cost 30 MB to 230 MB
 * of memory each (SPEC-0001 D-29). Errors are gaxios errors, which `toProblem` maps.
 */
export class GoogleRest {
  constructor(
    private readonly h: ProfileHandle,
    /** Root with the version and a trailing slash, such as `https://secretmanager.googleapis.com/v1/`. */
    readonly root: string,
  ) {}

  url(path: string, query?: Record<string, QueryValue>): string {
    const full = /^https:\/\//.test(path) ? path : `${this.root}${path.replace(/^\//, '')}`;
    if (!isGoogleApiUrl(full)) throw ProblemException.of('INVALID_ARGUMENT', 'Only Google API hosts can be called.');
    return `${full}${queryString(query)}`;
  }

  async call<T>(path: string, o: RestOptions = {}): Promise<T> {
    const res = await this.h.auth.request<T>({
      url: this.url(path, o.query),
      method: o.method ?? (o.body === undefined ? 'GET' : 'POST'),
      data: o.body,
      headers: o.headers,
      signal: o.signal,
      responseType: o.responseType ?? 'json',
    });
    return res.data;
  }

  get<T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal): Promise<T> {
    return this.call<T>(path, { query, signal });
  }

  post<T>(path: string, body: unknown = {}, query?: Record<string, QueryValue>): Promise<T> {
    return this.call<T>(path, { method: 'POST', body, query });
  }

  patch<T>(path: string, body: unknown, query?: Record<string, QueryValue>): Promise<T> {
    return this.call<T>(path, { method: 'PATCH', body, query });
  }

  put<T>(path: string, body: unknown, query?: Record<string, QueryValue>): Promise<T> {
    return this.call<T>(path, { method: 'PUT', body, query });
  }

  delete<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.call<T>(path, { method: 'DELETE', query });
  }

  /** One page of a list: `items` from `key`, and the next page token. */
  async page<T>(path: string, key: string, query: Record<string, QueryValue> = {}): Promise<{ items: T[]; next: string | null }> {
    const data = await this.get<Record<string, unknown>>(path, query);
    const items = (Array.isArray(data?.[key]) ? data[key] : []) as T[];
    return { items, next: typeof data?.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : null };
  }

  /** Reads pages until none are left or `cap` items are in. */
  async all<T>(path: string, key: string, query: Record<string, QueryValue> = {}, cap = 2000): Promise<T[]> {
    const out: T[] = [];
    let pageToken: string | undefined;
    do {
      const p = await this.page<T>(path, key, { ...query, pageToken });
      out.push(...p.items);
      pageToken = p.next ?? undefined;
    } while (pageToken && out.length < cap);
    return out;
  }
}

export function rest(h: ProfileHandle, root: string): GoogleRest {
  return new GoogleRest(h, root);
}

/** The last segment of a resource name. */
export const shortName = (name: string): string => name.split('/').pop() ?? name;
/** The location segment of a resource name, or ''. */
export const locationOf = (name: string): string => /\/locations\/([^/]+)/.exec(name)?.[1] ?? '';
/** The zone or region segment of a Compute self link or name, or ''. */
export const scopeOf = (name: string): string =>
  /\/(?:zones|regions)\/([^/]+)/.exec(name)?.[1] ?? (name.includes('/global/') ? 'global' : '');
