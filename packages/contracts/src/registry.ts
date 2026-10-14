import { z } from 'zod';

/** Artifact Registry beyond the image picker (SPEC-0007 D-11). */

export interface RegistryRepositoryView {
  name: string;
  id: string;
  location: string;
  format: string;
  mode: string;
  description: string | null;
  sizeBytes: string | null;
  cleanupPolicies: Record<string, unknown>;
  cleanupPolicyDryRun: boolean;
  labels: Record<string, string>;
  createTime: string | null;
  updateTime: string | null;
  registryUri: string | null;
}

export interface RegistryPackageView {
  name: string;
  /** Package id as Google names it; Docker image paths are URL-encoded there. */
  id: string;
  displayName: string;
  createTime: string | null;
  updateTime: string | null;
}

export interface RegistryVersionView {
  name: string;
  id: string;
  description: string | null;
  tags: string[];
  createTime: string | null;
  updateTime: string | null;
  sizeBytes: string | null;
}

export interface RegistryTagView {
  name: string;
  id: string;
  version: string;
}

export interface RegistryDockerImageView {
  name: string;
  uri: string;
  digest: string;
  image: string;
  tags: string[];
  sizeBytes: string | null;
  uploadTime: string | null;
  buildTime: string | null;
  updateTime: string | null;
  mediaType: string | null;
}

export interface VulnerabilityView {
  severity: string;
  cve: string;
  packageName: string | null;
  fixAvailable: boolean;
  cvssScore: number | null;
  description: string | null;
}

export interface VulnerabilityReport {
  /** False when Container Analysis is off or the key cannot read it. */
  available: boolean;
  reason: string | null;
  counts: Record<string, number>;
  findings: VulnerabilityView[];
}

export const SaveCleanupSchema = z.object({
  /** The `cleanupPolicies` map as JSON (SPEC-0007 D-11). */
  policiesJson: z.string().max(200_000),
  dryRun: z.boolean(),
});
export type SaveCleanup = z.infer<typeof SaveCleanupSchema>;

export const RegistryPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(
    /^projects\/[a-z0-9.:-]+\/locations\/[a-z0-9-]+\/repositories\/[a-z0-9-]+(\/(packages|versions|tags|dockerImages)\/[^/?#]+)*$/,
    'An Artifact Registry resource name',
  )
  .refine((p) => !p.split('/').some((s) => s === '.' || s === '..'));

export const CreateTagSchema = z.object({
  /** The package resource name. */
  package: RegistryPathSchema,
  tag: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.-]+$/),
  /** The version resource name the tag points to. */
  version: RegistryPathSchema,
});
export type CreateTag = z.infer<typeof CreateTagSchema>;

export const RegistryNameQuerySchema = z.object({ name: RegistryPathSchema, pageToken: z.string().max(4096).optional() });
export type RegistryNameQuery = z.infer<typeof RegistryNameQuerySchema>;

export const DeleteRegistryItemSchema = z.object({ name: RegistryPathSchema, confirm: z.string().min(1).max(512) });
export type DeleteRegistryItem = z.infer<typeof DeleteRegistryItemSchema>;

/** What the user types to delete a registry item: its id, or the first 12 hex digits of a digest. */
export function registryConfirmToken(name: string): string {
  const last = name.split('/').pop() ?? name;
  let id = last;
  try {
    id = decodeURIComponent(last);
  } catch {
    id = last;
  }
  return id.startsWith('sha256:') ? id.slice(0, 19) : id;
}
