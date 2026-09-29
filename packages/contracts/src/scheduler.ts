import { z } from 'zod';

/** Cloud Scheduler (SPEC-0003 D-12, §7.5). */

export const schedulerStates = ['enabled', 'paused', 'disabled', 'update_failed', 'unknown'] as const;
export type SchedulerState = (typeof schedulerStates)[number];

export const httpMethods = ['POST', 'GET', 'HEAD', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const;

const headerMap = z.record(z.string().min(1).max(256), z.string().max(4096));

export const SchedulerTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('http'),
    uri: z.string().url().max(2048),
    method: z.enum(httpMethods).default('POST'),
    headers: headerMap.default({}),
    body: z
      .string()
      .max(100 * 1024)
      .default(''),
    auth: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('none') }),
        z.object({ kind: z.literal('oidc'), serviceAccount: z.string().min(3).max(320), audience: z.string().max(2048).optional() }),
        z.object({ kind: z.literal('oauth'), serviceAccount: z.string().min(3).max(320), scope: z.string().max(2048).optional() }),
      ])
      .default({ kind: 'none' }),
  }),
  z.object({
    kind: z.literal('pubsub'),
    topic: z
      .string()
      .regex(/^projects\/[^/]+\/topics\/[^/]+$/, 'A topic such as projects/p/topics/t')
      .max(512),
    data: z
      .string()
      .max(100 * 1024)
      .default(''),
    attributes: headerMap.default({}),
  }),
  z.object({
    kind: z.literal('appengine'),
    relativeUri: z.string().startsWith('/').max(2048),
    method: z.enum(httpMethods).default('POST'),
    service: z.string().max(63).optional(),
    version: z.string().max(63).optional(),
    headers: headerMap.default({}),
    body: z
      .string()
      .max(100 * 1024)
      .default(''),
  }),
]);
export type SchedulerTarget = z.infer<typeof SchedulerTargetSchema>;

export const RetryConfigSchema = z.object({
  retryCount: z.number().int().min(0).max(5).optional(),
  maxRetryDurationSeconds: z.number().int().min(0).optional(),
  minBackoffSeconds: z.number().min(0).optional(),
  maxBackoffSeconds: z.number().min(0).optional(),
  maxDoublings: z.number().int().min(0).optional(),
});
export type RetryConfig = z.infer<typeof RetryConfigSchema>;

export interface SchedulerJob {
  name: string;
  id: string;
  location: string;
  description: string | null;
  schedule: string;
  timeZone: string;
  state: SchedulerState;
  target: SchedulerTarget;
  /** True when the HTTP body or Pub/Sub data is not UTF-8 text; it is shown as base64. */
  binaryPayload: boolean;
  lastAttemptTime: string | null;
  lastAttemptStatus: { code: number; message: string | null } | null;
  nextRunTime: string | null;
  retry: RetryConfig;
  attemptDeadlineSeconds: number | null;
  userUpdateTime: string | null;
}

export const SchedulerJobIdSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, hyphens and underscores');

export const SaveSchedulerJobSchema = z.object({
  description: z.string().max(500).default(''),
  schedule: z.string().min(1).max(500),
  timeZone: z.string().min(1).max(100).default('Etc/UTC'),
  target: SchedulerTargetSchema,
  retry: RetryConfigSchema.default({}),
  attemptDeadlineSeconds: z.number().int().min(15).max(1800).optional(),
});
export type SaveSchedulerJob = z.infer<typeof SaveSchedulerJobSchema>;

export const CreateSchedulerJobSchema = SaveSchedulerJobSchema.extend({
  id: SchedulerJobIdSchema,
  region: z
    .string()
    .regex(/^[a-z]+(-[a-z0-9]+)+$/, 'A region such as us-central1')
    .max(40),
});
export type CreateSchedulerJob = z.infer<typeof CreateSchedulerJobSchema>;

export const schedulerActions = ['pause', 'resume', 'run'] as const;
export type SchedulerAction = (typeof schedulerActions)[number];

/** Pause, resume, run now or delete many jobs at once (SPEC-0003 CA-26). */
export const BulkSchedulerSchema = z.object({
  action: z.enum([...schedulerActions, 'delete']),
  names: z
    .array(z.string().regex(/^projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+$/))
    .min(1)
    .max(200),
  /** For delete: the number of jobs, typed (SPEC-0001 D-13). */
  confirm: z.string().optional(),
});
export type BulkScheduler = z.infer<typeof BulkSchedulerSchema>;

export interface BulkResult {
  name: string;
  ok: boolean;
  error: string | null;
}
