import { z } from 'zod';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE, PROBLEM_CONTENT_TYPE, PROFILE_HEADER, problemCodes } from './constants.js';

export const ProblemCodeSchema = z.enum(problemCodes);
export type ProblemCode = z.infer<typeof ProblemCodeSchema>;

export const ProblemHelpLinkSchema = z.object({
  description: z.string(),
  url: z.string(),
});

/** A Firestore composite index a failed query needs (SPEC-0004 D-09). */
export const IndexFieldSchema = z.object({
  fieldPath: z.string().min(1).max(1500),
  order: z.enum(['ASCENDING', 'DESCENDING']).optional(),
  arrayConfig: z.literal('CONTAINS').optional(),
  vectorDimension: z.number().int().min(1).max(2048).optional(),
});
export type IndexField = z.infer<typeof IndexFieldSchema>;

export const IndexDefinitionSchema = z.object({
  collectionGroup: z.string().min(1).max(1500),
  queryScope: z.enum(['COLLECTION', 'COLLECTION_GROUP']),
  fields: z.array(IndexFieldSchema).min(1).max(100),
});
export type IndexDefinition = z.infer<typeof IndexDefinitionSchema>;

export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  code: ProblemCodeSchema,
  reason: z.string().optional(),
  service: z.string().optional(),
  serviceTitle: z.string().optional(),
  /** Project Google names as needing the API (SPEC-0001 D-24), as `projects/{number}` or an id. */
  consumer: z.string().optional(),
  permission: z.string().optional(),
  activationUrl: z.string().optional(),
  help: z.array(ProblemHelpLinkSchema).optional(),
  retryable: z.boolean(),
  /** Seconds to wait before retrying, for quota waits (SPEC-0005 D-02). */
  retryAfterSeconds: z.number().optional(),
  grpcCode: z.number().int().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  /** Set when a Firestore query needs a composite index; `derived` when read from the query, not Google's link. */
  suggestedIndex: IndexDefinitionSchema.extend({ derived: z.boolean() }).optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;

/** Body of destructive requests (SPEC-0001 D-13, CA-50). */
export const ConfirmSchema = z.object({ confirm: z.string().min(1) });
export type Confirm = z.infer<typeof ConfirmSchema>;

export { CLIENT_HEADER, CLIENT_HEADER_VALUE, PROBLEM_CONTENT_TYPE, PROFILE_HEADER, problemCodes };
