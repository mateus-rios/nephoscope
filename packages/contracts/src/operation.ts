import { z } from 'zod';
import { ProblemSchema } from './problem.js';

export const operationStatuses = ['running', 'succeeded', 'failed', 'cancelled', 'unknown'] as const;
export const OperationStatusSchema = z.enum(operationStatuses);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

export const operationFamilies = ['longrunning', 'compute', 'cloudsql', 'gke', 'bigquery', 'instant', 'local'] as const;
export const OperationFamilySchema = z.enum(operationFamilies);
export type OperationFamily = z.infer<typeof OperationFamilySchema>;

/** SPEC-0001 CA-32. */
export const OperationSummarySchema = z.object({
  id: z.string(),
  profileId: z.string(),
  projectId: z.string(),
  product: z.string(),
  kind: z.string(),
  family: OperationFamilySchema,
  resource: z.object({
    name: z.string(),
    displayName: z.string(),
    href: z.string().nullable(),
  }),
  status: OperationStatusSchema,
  progress: z.number().min(0).max(100).nullable(),
  message: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: ProblemSchema.nullable(),
  /** The Google operation name, used to poll it again after a restart. */
  googleName: z.string().nullable(),
  /** Work Nephoscope runs itself can be stopped from the tray (SPEC-0004 CA-11). */
  cancellable: z.boolean().optional(),
});
export type OperationSummary = z.infer<typeof OperationSummarySchema>;

export const OperationAcceptedSchema = z.object({ operation: OperationSummarySchema });
export type OperationAccepted = z.infer<typeof OperationAcceptedSchema>;
