import { z } from 'zod';

export const ProjectSummarySchema = z.object({
  projectId: z.string(),
  name: z.string(),
  projectNumber: z.string().nullable(),
  state: z.enum(['ACTIVE', 'DELETE_REQUESTED', 'STATE_UNSPECIFIED']),
  parent: z
    .object({
      type: z.enum(['organization', 'folder', 'unknown']),
      id: z.string(),
    })
    .nullable(),
  labels: z.record(z.string(), z.string()),
  createTime: z.string().nullable(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ServiceSummarySchema = z.object({
  /** Service name, such as `run.googleapis.com`. */
  name: z.string(),
  title: z.string(),
  state: z.enum(['ENABLED', 'DISABLED', 'STATE_UNSPECIFIED']),
});
export type ServiceSummary = z.infer<typeof ServiceSummarySchema>;

export const CapabilitiesSchema = z.object({
  profileId: z.string(),
  projectId: z.string(),
  checkedAt: z.string(),
  services: z.object({
    /** False when Service Usage could not be read (SPEC-0001 CA-46). */
    known: z.boolean(),
    enabled: z.array(z.string()),
    problemCode: z.string().optional(),
  }),
  permissions: z.object({
    known: z.boolean(),
    tested: z.array(z.string()),
    granted: z.array(z.string()),
    /** Permissions Google rejected as invalid; excluded from the probe. */
    invalid: z.array(z.string()),
  }),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const EnableServiceSchema = z.object({
  /** Project to enable the service in; defaults to the page's project (SPEC-0001 D-24). */
  consumerProject: z.string().optional(),
});
export type EnableService = z.infer<typeof EnableServiceSchema>;
