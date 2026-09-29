import { z } from 'zod';

/** Workflows and their executions (SPEC-0003 D-10, D-11, §7.4). */

export const workflowStates = ['active', 'unavailable', 'unknown'] as const;
export type WorkflowState = (typeof workflowStates)[number];

export const callLogLevels = ['LOG_ALL_CALLS', 'LOG_ERRORS_ONLY', 'LOG_NONE', 'CALL_LOG_LEVEL_UNSPECIFIED'] as const;
export type CallLogLevel = (typeof callLogLevels)[number];

export const historyLevels = ['EXECUTION_HISTORY_BASIC', 'EXECUTION_HISTORY_DETAILED', 'EXECUTION_HISTORY_LEVEL_UNSPECIFIED'] as const;
export type HistoryLevel = (typeof historyLevels)[number];

export const workflowExecutionStates = ['queued', 'active', 'succeeded', 'failed', 'cancelled', 'unavailable', 'unknown'] as const;
export type WorkflowExecutionState = (typeof workflowExecutionStates)[number];

export interface WorkflowSummary {
  name: string;
  id: string;
  location: string;
  state: WorkflowState;
  revisionId: string | null;
  updateTime: string | null;
  callLogLevel: CallLogLevel;
  description: string | null;
  labels: Record<string, string>;
}

export interface Workflow extends WorkflowSummary {
  createTime: string | null;
  revisionCreateTime: string | null;
  serviceAccount: string | null;
  sourceContents: string;
  stateError: string | null;
  executionHistoryLevel: HistoryLevel;
  userEnvVars: Record<string, string>;
  cryptoKeyName: string | null;
}

export interface WorkflowRevision {
  revisionId: string;
  createTime: string | null;
  sourceContents: string;
}

export interface WorkflowError {
  payload: string | null;
  context: string | null;
  stackTrace: { step: string | null; routine: string | null; line: number | null; column: number | null }[];
}

export interface WorkflowExecution {
  name: string;
  id: string;
  workflow: string;
  state: WorkflowExecutionState;
  startTime: string | null;
  endTime: string | null;
  durationSeconds: number | null;
  argument: string | null;
  result: string | null;
  error: WorkflowError | null;
  revisionId: string | null;
  callLogLevel: CallLogLevel;
  historyLevel: HistoryLevel;
  currentSteps: { routine: string; step: string }[];
  labels: Record<string, string>;
}

export const stepEntryStates = ['in_progress', 'succeeded', 'failed', 'cancelled', 'unknown'] as const;
export type StepEntryState = (typeof stepEntryStates)[number];

export interface StepEntry {
  entryId: string;
  routine: string;
  step: string;
  stepType: string;
  state: StepEntryState;
  createTime: string | null;
  updateTime: string | null;
  exception: string | null;
  /** Variables in scope after the step, when the execution keeps detailed history (SPEC-0003 D-11). */
  variables: Record<string, unknown> | null;
  iteration: string | null;
}

// ---- Requests --------------------------------------------------------------------------------

export const WorkflowIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Letters, digits, hyphens and underscores, starting with a letter');

export const DeployWorkflowSchema = z.object({
  sourceContents: z
    .string()
    .min(1)
    .max(128 * 1024),
  description: z.string().max(1000).optional(),
  serviceAccount: z.string().max(320).nullable().optional(),
  callLogLevel: z.enum(callLogLevels).optional(),
  executionHistoryLevel: z.enum(historyLevels).optional(),
  labels: z.record(z.string().max(63), z.string().max(63)).optional(),
  userEnvVars: z.record(z.string().max(40), z.string().max(4000)).optional(),
});
export type DeployWorkflow = z.infer<typeof DeployWorkflowSchema>;

export const CreateWorkflowSchema = DeployWorkflowSchema.extend({
  id: WorkflowIdSchema,
  region: z
    .string()
    .regex(/^[a-z]+(-[a-z0-9]+)+$/, 'A region such as us-central1')
    .max(40),
});
export type CreateWorkflow = z.infer<typeof CreateWorkflowSchema>;

export const ExecuteWorkflowSchema = z.object({
  /** JSON text, validated before sending (SPEC-0003 CA-21). */
  argument: z
    .string()
    .max(32 * 1024)
    .refine((s) => {
      if (!s.trim()) return true;
      try {
        JSON.parse(s);
        return true;
      } catch {
        return false;
      }
    }, 'The argument must be valid JSON')
    .default(''),
  callLogLevel: z.enum(callLogLevels).optional(),
  historyLevel: z.enum(historyLevels).optional(),
});
export type ExecuteWorkflow = z.infer<typeof ExecuteWorkflowSchema>;

export const StepEntriesQuerySchema = z.object({
  pageToken: z.string().max(4096).optional(),
  detailed: z.enum(['0', '1']).optional(),
});

/** `workflows.execution` channel (SPEC-0003 CA-22). */
export const WorkflowExecutionChannelParamsSchema = z.object({ name: z.string().min(1).max(512) });
export interface WorkflowExecutionUpdate {
  execution: WorkflowExecution;
  steps: StepEntry[];
}
