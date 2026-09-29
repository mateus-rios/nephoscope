import { z } from 'zod';

/** SPEC-0001 CA-51. Never carries request bodies. */
export const AuditEntrySchema = z.object({
  ts: z.string(),
  profileId: z.string().nullable(),
  principal: z.string().nullable(),
  projectId: z.string().nullable(),
  method: z.string(),
  route: z.string(),
  resource: z.string().nullable(),
  verb: z.string(),
  outcome: z.enum(['ok', 'error', 'rejected']),
  problemCode: z.string().nullable(),
  operationId: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditQuerySchema = z.object({
  profileId: z.string().optional(),
  projectId: z.string().optional(),
  product: z.string().optional(),
  outcome: z.enum(['ok', 'error', 'rejected']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
