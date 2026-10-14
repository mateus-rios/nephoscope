import { z } from 'zod';

/** Cloud Build and Cloud Deploy (SPEC-0007 D-12, D-13). */

export const buildStatuses = [
  'STATUS_UNKNOWN',
  'PENDING',
  'QUEUED',
  'WORKING',
  'SUCCESS',
  'FAILURE',
  'INTERNAL_ERROR',
  'TIMEOUT',
  'CANCELLED',
  'EXPIRED',
] as const;
export type BuildStatus = (typeof buildStatuses)[number];

export const BUILD_DONE: readonly string[] = ['SUCCESS', 'FAILURE', 'INTERNAL_ERROR', 'TIMEOUT', 'CANCELLED', 'EXPIRED'];

export interface BuildSummary {
  name: string;
  id: string;
  location: string;
  status: string;
  createTime: string | null;
  startTime: string | null;
  finishTime: string | null;
  triggerId: string | null;
  source: string | null;
  tags: string[];
  images: string[];
  failure: string | null;
  /** WAITING for an approval, then APPROVED or REJECTED. */
  approval: string | null;
}

export interface BuildStepView {
  id: string | null;
  name: string;
  args: string[];
  entrypoint: string | null;
  status: string;
  startTime: string | null;
  endTime: string | null;
}

export interface BuildDetail extends BuildSummary {
  steps: BuildStepView[];
  substitutions: Record<string, string>;
  serviceAccount: string | null;
  logsBucket: string | null;
  /** CLOUD_LOGGING_ONLY builds have no log object; their logs come from Cloud Logging. */
  logging: string | null;
  timeout: string | null;
  raw: unknown;
}

export const BuildListQuerySchema = z.object({
  location: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64)
    .default('global'),
  status: z.enum(buildStatuses).optional(),
  trigger: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(128)
    .optional(),
  tag: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+$/)
    .max(128)
    .optional(),
  pageToken: z.string().max(4096).optional(),
});
export type BuildListQuery = z.infer<typeof BuildListQuerySchema>;

export const ApproveBuildSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), comment: z.string().max(1000).default('') });

export interface TriggerView {
  name: string;
  id: string;
  triggerName: string;
  location: string;
  description: string | null;
  disabled: boolean;
  event: 'push' | 'pull_request' | 'manual' | 'pubsub' | 'webhook' | 'other';
  repo: string | null;
  branch: string | null;
  tag: string | null;
  filename: string | null;
  createTime: string | null;
}

export const RunTriggerSchema = z.object({
  ref: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('branch'), value: z.string().min(1).max(256) }),
    z.object({ kind: z.literal('tag'), value: z.string().min(1).max(256) }),
    z.object({ kind: z.literal('commit'), value: z.string().regex(/^[0-9a-f]{7,40}$/) }),
  ]),
  substitutions: z.record(z.string().regex(/^_[A-Z0-9_]+$/, 'User substitutions start with _'), z.string().max(4000)).default({}),
});
export type RunTrigger = z.infer<typeof RunTriggerSchema>;

export const SaveTriggerSchema = z.object({
  location: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default('global'),
  /** The BuildTrigger as JSON (SPEC-0007 D-12). */
  json: z.string().min(2).max(200_000),
});
export type SaveTrigger = z.infer<typeof SaveTriggerSchema>;

/** `build.logs` live channel (SPEC-0007 D-12). */
export const BuildLogsParamsSchema = z.object({
  location: z.string().regex(/^[a-z0-9-]+$/),
  buildId: z.string().regex(/^[0-9a-f-]{36}$/),
});
export type BuildLogsParams = z.infer<typeof BuildLogsParamsSchema>;

export interface BuildLogsMessage {
  /** New text since the previous message. */
  text: string;
  status: string;
  done: boolean;
}

// ---- Cloud Deploy ------------------------------------------------------------------------------

export interface DeployPipelineView {
  name: string;
  id: string;
  location: string;
  description: string | null;
  stages: { targetId: string; profiles: string[]; strategy: string | null }[];
  suspended: boolean;
  createTime: string | null;
  updateTime: string | null;
}

export interface DeployTargetView {
  name: string;
  id: string;
  location: string;
  description: string | null;
  kind: string;
  detail: string | null;
  requireApproval: boolean;
}

export interface DeployReleaseView {
  name: string;
  id: string;
  renderState: string;
  abandoned: boolean;
  createTime: string | null;
  targetRenders: Record<string, string>;
}

export interface DeployRolloutView {
  name: string;
  id: string;
  targetId: string;
  state: string;
  approvalState: string;
  createTime: string | null;
  deployStartTime: string | null;
  deployEndTime: string | null;
  failureReason: string | null;
  phases: { id: string; state: string; jobs: { id: string; state: string }[] }[];
}

export const rolloutActions = ['approve', 'reject', 'advance', 'retryJob', 'cancel'] as const;
export type RolloutAction = (typeof rolloutActions)[number];

export const RolloutActionSchema = z.object({
  phaseId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64)
    .optional(),
  jobId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64)
    .optional(),
});
export type RolloutActionBody = z.infer<typeof RolloutActionSchema>;

export const PromoteReleaseSchema = z.object({
  targetId: z
    .string()
    .regex(/^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/)
    .max(63),
});
