import type { Problem, ProblemCode } from '@nephoscope/contracts';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE, PROFILE_HEADER, problemCodes } from '@nephoscope/contracts/constants';
import { useSession } from '../state/session';

/** An API failure carrying the server's problem (SPEC-0001 CA-28). */
export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail);
    this.name = 'ApiError';
  }

  get code(): ProblemCode {
    return this.problem.code;
  }
}

function isProblem(value: unknown): value is Problem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Problem).code === 'string' &&
    (problemCodes as readonly string[]).includes((value as Problem).code) &&
    typeof (value as Problem).detail === 'string'
  );
}

function fallbackProblem(status: number, text: string): Problem {
  const code: ProblemCode =
    status === 401
      ? 'UNAUTHENTICATED'
      : status === 403
        ? 'PERMISSION_DENIED'
        : status === 404
          ? 'NOT_FOUND'
          : status === 429
            ? 'RESOURCE_EXHAUSTED'
            : status === 503
              ? 'UNAVAILABLE'
              : status >= 500
                ? 'INTERNAL'
                : 'INVALID_ARGUMENT';
  return {
    type: 'about:blank',
    title: `Request failed (${status})`,
    status,
    detail: text.slice(0, 300) || `The server answered ${status}.`,
    code,
    retryable: status >= 500 || status === 429,
  };
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Overrides the active profile; `null` sends no profile header. */
  profileId?: string | null;
}

/** Same-origin JSON request with the headers every API call needs (SPEC-0001 CA-07, CA-13). */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    [CLIENT_HEADER]: CLIENT_HEADER_VALUE,
    accept: 'application/json, application/problem+json',
  };
  const profileId = options.profileId === undefined ? useSession.getState().profileId : options.profileId;
  if (profileId) headers[PROFILE_HEADER] = profileId;
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      body,
      signal: options.signal,
      credentials: 'same-origin',
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError({
      type: 'about:blank',
      title: 'Nephoscope is unreachable',
      status: 0,
      detail: 'The Nephoscope server did not answer. Check that the container is running.',
      code: 'UNAVAILABLE',
      retryable: true,
    });
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    throw new ApiError(isProblem(parsed) ? parsed : fallbackProblem(res.status, text));
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export function problemOf(err: unknown): Problem | null {
  if (err instanceof ApiError) return err.problem;
  return null;
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

/**
 * Downloads a file from the API. A plain link cannot send the client header every API call needs
 * (SPEC-0001 CA-13), so the file is fetched and handed to the browser as a blob.
 */
export async function downloadFromApi(path: string, fileName: string): Promise<void> {
  const headers: Record<string, string> = { [CLIENT_HEADER]: CLIENT_HEADER_VALUE };
  const profileId = useSession.getState().profileId;
  if (profileId) headers[PROFILE_HEADER] = profileId;
  const res = await fetch(path, { headers, credentials: 'same-origin' });
  if (!res.ok) {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = undefined;
    }
    throw new ApiError(isProblem(parsed) ? parsed : fallbackProblem(res.status, ''));
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
