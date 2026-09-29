/**
 * Runtime constants without zod, so the web app can import them without bundling the schemas.
 * Each is re-exported by the module that owns its meaning.
 */

// problem
/** Problem codes of SPEC-0001 CA-28. */
export const problemCodes = [
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'API_DISABLED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'FAILED_PRECONDITION',
  'INVALID_ARGUMENT',
  'RESOURCE_EXHAUSTED',
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'CONFLICT',
  'READ_ONLY',
  'CONFIRMATION_REQUIRED',
  'CLIENT_HEADER_REQUIRED',
  'HOST_NOT_ALLOWED',
  'CROSS_SITE_REQUEST',
  'UNKNOWN_PROFILE',
  'NO_CREDENTIALS',
  'INTERNAL',
] as const;
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
/** Header every API request must carry (SPEC-0001 CA-13). */
export const CLIENT_HEADER = 'x-nephoscope-client';
export const CLIENT_HEADER_VALUE = '1';
/** Header naming the active profile of the tab (SPEC-0001 CA-07). */
export const PROFILE_HEADER = 'x-nephoscope-profile';

// live
/** Live channel names (SPEC-0001 CA-42; product specs add theirs). */
export const liveChannels = [
  'ops',
  'logging.tail',
  'firestore.listen',
  'pubsub.watch',
  'build.logs',
  'run.execution',
  'workflows.execution',
  'compute.serial',
] as const;
/** Maximum buffered messages per subscription (SPEC-0001 CA-41). */
export const LIVE_BUFFER_LIMIT = 1000;
export const LIVE_PATH = '/api/live';

// profile
export const colorTags = ['none', 'gray', 'blue', 'green', 'amber', 'red', 'violet'] as const;
export const ENV_PROFILE_ID = 'env';
/** Maximum size of an uploaded key (SPEC-0001 CA-03). */
export const MAX_KEY_BYTES = 64 * 1024;

// common
export const DEFAULT_PAGE_SIZE = 50;
