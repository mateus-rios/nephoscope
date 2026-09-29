import { z } from 'zod';
import { httpMethods } from './scheduler.js';

/** Cloud Tasks queues and tasks (SPEC-0003 D-13, CA-27). */

export const queueStates = ['running', 'paused', 'disabled', 'unknown'] as const;
export type QueueState = (typeof queueStates)[number];

export interface TaskQueue {
  name: string;
  id: string;
  location: string;
  state: QueueState;
  maxDispatchesPerSecond: number | null;
  maxBurstSize: number | null;
  maxConcurrentDispatches: number | null;
  maxAttempts: number | null;
  maxRetryDurationSeconds: number | null;
  minBackoffSeconds: number | null;
  maxBackoffSeconds: number | null;
  maxDoublings: number | null;
  purgeTime: string | null;
  loggingSamplingRatio: number | null;
}

export interface TaskAttempt {
  scheduleTime: string | null;
  dispatchTime: string | null;
  responseTime: string | null;
  status: { code: number; message: string | null } | null;
}

export interface QueueTask {
  name: string;
  id: string;
  kind: 'http' | 'appengine';
  method: string;
  url: string;
  scheduleTime: string | null;
  createTime: string | null;
  dispatchCount: number;
  responseCount: number;
  dispatchDeadlineSeconds: number | null;
  firstAttempt: TaskAttempt | null;
  lastAttempt: TaskAttempt | null;
}

const queueId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and hyphens');
export const QueueIdSchema = queueId;

export const SaveQueueSchema = z.object({
  maxDispatchesPerSecond: z.number().positive().max(500).optional(),
  maxConcurrentDispatches: z.number().int().min(1).max(5000).optional(),
  maxAttempts: z.number().int().min(-1).max(1000).optional(),
  maxRetryDurationSeconds: z.number().int().min(0).optional(),
  minBackoffSeconds: z.number().min(0).max(3600).optional(),
  maxBackoffSeconds: z.number().min(0).max(3600).optional(),
  maxDoublings: z.number().int().min(0).max(16).optional(),
  loggingSamplingRatio: z.number().min(0).max(1).optional(),
});
export type SaveQueue = z.infer<typeof SaveQueueSchema>;

export const CreateQueueSchema = SaveQueueSchema.extend({
  id: queueId,
  region: z
    .string()
    .regex(/^[a-z]+(-[a-z0-9]+)+$/, 'A region such as us-central1')
    .max(40),
});
export type CreateQueue = z.infer<typeof CreateQueueSchema>;

export const CreateTaskSchema = z.object({
  url: z.string().url().max(2048),
  method: z.enum(httpMethods).default('POST'),
  headers: z.record(z.string().min(1).max(256), z.string().max(4096)).default({}),
  body: z
    .string()
    .max(100 * 1024)
    .default(''),
  /** OIDC token as this service account (SPEC-0003 D-13). */
  serviceAccount: z.string().max(320).optional(),
  audience: z.string().max(2048).optional(),
  scheduleTime: z.string().datetime({ offset: true }).optional(),
});
export type CreateTask = z.infer<typeof CreateTaskSchema>;

export const queueActions = ['pause', 'resume'] as const;
export type QueueAction = (typeof queueActions)[number];
