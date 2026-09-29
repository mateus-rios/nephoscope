import type { Problem, ProblemCode } from '@nephoscope/contracts';
import { HttpException } from '@nestjs/common';

const defaultStatus: Record<ProblemCode, number> = {
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  API_DISABLED: 403,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  FAILED_PRECONDITION: 400,
  INVALID_ARGUMENT: 400,
  RESOURCE_EXHAUSTED: 429,
  UNAVAILABLE: 503,
  DEADLINE_EXCEEDED: 504,
  CONFLICT: 409,
  READ_ONLY: 403,
  CONFIRMATION_REQUIRED: 400,
  CLIENT_HEADER_REQUIRED: 403,
  HOST_NOT_ALLOWED: 421,
  CROSS_SITE_REQUEST: 403,
  UNKNOWN_PROFILE: 400,
  NO_CREDENTIALS: 400,
  INTERNAL: 500,
};

const titles: Record<ProblemCode, string> = {
  UNAUTHENTICATED: 'Not authenticated',
  PERMISSION_DENIED: 'Permission denied',
  API_DISABLED: 'API not enabled',
  NOT_FOUND: 'Not found',
  ALREADY_EXISTS: 'Already exists',
  FAILED_PRECONDITION: 'Precondition failed',
  INVALID_ARGUMENT: 'Invalid request',
  RESOURCE_EXHAUSTED: 'Quota or rate limit reached',
  UNAVAILABLE: 'Service unavailable',
  DEADLINE_EXCEEDED: 'Request timed out',
  CONFLICT: 'Conflict',
  READ_ONLY: 'Read-only',
  CONFIRMATION_REQUIRED: 'Confirmation required',
  CLIENT_HEADER_REQUIRED: 'Client header required',
  HOST_NOT_ALLOWED: 'Host not allowed',
  CROSS_SITE_REQUEST: 'Cross-site request refused',
  UNKNOWN_PROFILE: 'Unknown profile',
  NO_CREDENTIALS: 'No credentials',
  INTERNAL: 'Internal error',
};

const retryableCodes = new Set<ProblemCode>(['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'RESOURCE_EXHAUSTED']);

export type ProblemExtras = Partial<Omit<Problem, 'code' | 'detail' | 'type' | 'title'>> & {
  title?: string;
};

export function makeProblem(code: ProblemCode, detail: string, extras: ProblemExtras = {}): Problem {
  const { title, ...rest } = extras;
  return {
    type: `https://nephoscope.local/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title: title ?? titles[code],
    status: rest.status ?? defaultStatus[code],
    detail,
    code,
    retryable: rest.retryable ?? retryableCodes.has(code),
    ...rest,
  };
}

/** An error that is already a problem (SPEC-0001 CA-28). */
export class ProblemException extends HttpException {
  constructor(public readonly problem: Problem) {
    super(problem, problem.status);
  }

  static of(code: ProblemCode, detail: string, extras?: ProblemExtras): ProblemException {
    return new ProblemException(makeProblem(code, detail, extras));
  }
}
