import type { Problem, ProblemCode } from '@nephoscope/contracts';
import { HttpException } from '@nestjs/common';
import { makeProblem, ProblemException } from './problem.js';

/** gRPC status names by code. */
const GRPC_NAMES = [
  'OK',
  'CANCELLED',
  'UNKNOWN',
  'INVALID_ARGUMENT',
  'DEADLINE_EXCEEDED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'FAILED_PRECONDITION',
  'ABORTED',
  'OUT_OF_RANGE',
  'UNIMPLEMENTED',
  'INTERNAL',
  'UNAVAILABLE',
  'DATA_LOSS',
  'UNAUTHENTICATED',
] as const;
type GrpcName = (typeof GRPC_NAMES)[number];

/** HTTP status by gRPC status name (SPEC-0001 CA-29). */
const HTTP_BY_GRPC: Record<GrpcName, number> = {
  OK: 200,
  CANCELLED: 499,
  UNKNOWN: 500,
  INVALID_ARGUMENT: 400,
  DEADLINE_EXCEEDED: 504,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  PERMISSION_DENIED: 403,
  RESOURCE_EXHAUSTED: 429,
  FAILED_PRECONDITION: 400,
  ABORTED: 409,
  OUT_OF_RANGE: 400,
  UNIMPLEMENTED: 501,
  INTERNAL: 500,
  UNAVAILABLE: 503,
  DATA_LOSS: 500,
  UNAUTHENTICATED: 401,
};

const PROBLEM_BY_GRPC: Record<GrpcName, ProblemCode> = {
  OK: 'INTERNAL',
  CANCELLED: 'INTERNAL',
  UNKNOWN: 'INTERNAL',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  DEADLINE_EXCEEDED: 'DEADLINE_EXCEEDED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
  FAILED_PRECONDITION: 'FAILED_PRECONDITION',
  ABORTED: 'CONFLICT',
  OUT_OF_RANGE: 'INVALID_ARGUMENT',
  UNIMPLEMENTED: 'INTERNAL',
  INTERNAL: 'INTERNAL',
  UNAVAILABLE: 'UNAVAILABLE',
  DATA_LOSS: 'INTERNAL',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
};

const HTTP_TO_GRPC: Record<number, GrpcName> = {
  400: 'INVALID_ARGUMENT',
  401: 'UNAUTHENTICATED',
  403: 'PERMISSION_DENIED',
  404: 'NOT_FOUND',
  409: 'ABORTED',
  412: 'FAILED_PRECONDITION',
  429: 'RESOURCE_EXHAUSTED',
  499: 'CANCELLED',
  500: 'INTERNAL',
  501: 'UNIMPLEMENTED',
  503: 'UNAVAILABLE',
  504: 'DEADLINE_EXCEEDED',
};

interface ErrorInfoLike {
  reason?: string;
  domain?: string;
  metadata?: Record<string, string>;
}
interface HelpLinkLike {
  description?: string;
  url?: string;
}

interface Extracted {
  grpc: GrpcName;
  message: string;
  errorInfo?: ErrorInfoLike;
  help: HelpLinkLike[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function grpcName(value: unknown): GrpcName | undefined {
  if (typeof value === 'number' && value >= 0 && value < GRPC_NAMES.length) return GRPC_NAMES[value];
  if (typeof value === 'string' && (GRPC_NAMES as readonly string[]).includes(value)) {
    return value as GrpcName;
  }
  return undefined;
}

/** Reads ErrorInfo and Help from decoded status details (gRPC) or `@type` details (REST). */
function readDetails(details: unknown[]): { errorInfo?: ErrorInfoLike; help: HelpLinkLike[] } {
  let errorInfo: ErrorInfoLike | undefined;
  const help: HelpLinkLike[] = [];
  for (const d of details) {
    if (!isRecord(d)) continue;
    const type = typeof d['@type'] === 'string' ? (d['@type'] as string) : '';
    if (type.endsWith('google.rpc.ErrorInfo') || (typeof d.reason === 'string' && 'domain' in d)) {
      errorInfo ??= {
        reason: typeof d.reason === 'string' ? d.reason : undefined,
        domain: typeof d.domain === 'string' ? d.domain : undefined,
        metadata: isRecord(d.metadata) ? (d.metadata as Record<string, string>) : undefined,
      };
    }
    if (type.endsWith('google.rpc.Help') || Array.isArray(d.links)) {
      for (const link of (d.links as unknown[]) ?? []) {
        if (isRecord(link) && typeof link.url === 'string') {
          help.push({ url: link.url, description: typeof link.description === 'string' ? link.description : '' });
        }
      }
    }
  }
  return { errorInfo, help };
}

/** Pulls status, message and details out of google-gax, gaxios and plain errors. */
export function extractGoogleError(err: unknown): Extracted | null {
  if (!isRecord(err)) return null;

  // REST: gaxios error with response.data.error = { code, message, status, details }
  const response = isRecord(err.response) ? err.response : undefined;
  const restBody = response && isRecord(response.data) && isRecord(response.data.error) ? response.data.error : undefined;
  if (restBody) {
    const grpc = grpcName(restBody.status) ?? HTTP_TO_GRPC[Number(restBody.code ?? response?.status)] ?? 'UNKNOWN';
    const { errorInfo, help } = readDetails(Array.isArray(restBody.details) ? restBody.details : []);
    return {
      grpc,
      message: typeof restBody.message === 'string' ? restBody.message : String(err.message ?? 'Request failed'),
      errorInfo,
      help,
    };
  }

  // gRPC / google-gax GoogleError: numeric code, details string, statusDetails decoded.
  const grpc = grpcName(err.code);
  if (grpc && grpc !== 'OK' && ('details' in err || 'statusDetails' in err || 'metadata' in err || 'reason' in err)) {
    const statusDetails = Array.isArray(err.statusDetails) ? err.statusDetails : [];
    const { errorInfo: fromDetails, help } = readDetails(statusDetails);
    const errorInfo: ErrorInfoLike | undefined =
      fromDetails ??
      (typeof err.reason === 'string'
        ? {
            reason: err.reason,
            domain: typeof err.domain === 'string' ? err.domain : undefined,
            metadata: isRecord(err.errorInfoMetadata) ? (err.errorInfoMetadata as Record<string, string>) : undefined,
          }
        : undefined);
    const message =
      (typeof err.details === 'string' && err.details) ||
      (typeof err.message === 'string' && err.message.replace(/^\d+\s+[A-Z_]+:\s*/, '')) ||
      'Request failed';
    return { grpc, message, errorInfo, help };
  }

  // gaxios error without a JSON body, but with an HTTP status.
  const status = Number(response?.status ?? err.status);
  if (Number.isInteger(status) && status >= 400) {
    return {
      grpc: HTTP_TO_GRPC[status] ?? (status >= 500 ? 'INTERNAL' : 'INVALID_ARGUMENT'),
      message: typeof err.message === 'string' ? err.message : 'Request failed',
      help: [],
    };
  }
  return null;
}

const PERMISSION_PATTERNS = [
  /Permission '([a-zA-Z0-9_.]+)' denied/,
  /permission ['"]?([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+)['"]? (?:is )?(?:required|denied)/i,
  /requires? (?:the )?(?:permission )?['"]?([a-z][a-zA-Z0-9]*\.[a-zA-Z]+\.[a-zA-Z]+)['"]?/i,
  /does not have ([a-z][a-zA-Z0-9]*\.[a-zA-Z]+\.[a-zA-Z]+) access/,
];

function findPermission(message: string, errorInfo?: ErrorInfoLike): string | undefined {
  const fromMeta = errorInfo?.metadata?.permission;
  if (fromMeta) return fromMeta;
  for (const re of PERMISSION_PATTERNS) {
    const m = re.exec(message);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** Converts any thrown value into a problem (SPEC-0001 CA-28, CA-29). */
export function toProblem(err: unknown): Problem {
  if (err instanceof ProblemException) return err.problem;
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const response = err.getResponse();
    const detail =
      typeof response === 'string' ? response : isRecord(response) && typeof response.message === 'string' ? response.message : err.message;
    const code: ProblemCode =
      status === 404
        ? 'NOT_FOUND'
        : status === 401
          ? 'UNAUTHENTICATED'
          : status === 403
            ? 'PERMISSION_DENIED'
            : status === 409
              ? 'CONFLICT'
              : status === 429
                ? 'RESOURCE_EXHAUSTED'
                : status >= 500
                  ? 'INTERNAL'
                  : 'INVALID_ARGUMENT';
    return makeProblem(code, detail, { status });
  }

  // google-auth-library's message when a profile has no usable credentials (an emulators-only profile).
  if (err instanceof Error && /Could not load the default credentials/.test(err.message)) {
    return makeProblem(
      'NO_CREDENTIALS',
      'This profile has no Google credentials, so only the configured emulators answer. Add a key on the Connections page to reach real projects.',
    );
  }

  const g = extractGoogleError(err);
  if (g) {
    const reason = g.errorInfo?.reason;
    const meta = g.errorInfo?.metadata ?? {};
    const help = g.help
      .filter((h): h is { url: string; description?: string } => typeof h.url === 'string')
      .map((h) => ({ url: h.url, description: h.description ?? '' }));
    if (reason === 'SERVICE_DISABLED') {
      return makeProblem('API_DISABLED', g.message, {
        status: 403,
        reason,
        service: meta.service,
        serviceTitle: meta.serviceTitle,
        consumer: meta.consumer,
        activationUrl: meta.activationUrl,
        help: help.length ? help : undefined,
        grpcCode: GRPC_NAMES.indexOf(g.grpc),
      });
    }
    const code = PROBLEM_BY_GRPC[g.grpc];
    return makeProblem(code, g.message, {
      status: HTTP_BY_GRPC[g.grpc],
      reason,
      service: meta.service,
      consumer: meta.consumer,
      permission: code === 'PERMISSION_DENIED' ? findPermission(g.message, g.errorInfo) : undefined,
      help: help.length ? help : undefined,
      grpcCode: GRPC_NAMES.indexOf(g.grpc),
    });
  }

  const message = err instanceof Error ? err.message : 'Unexpected error';
  return makeProblem('INTERNAL', message);
}
