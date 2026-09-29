import { z } from 'zod';
import { storageClasses } from './storage-preview.js';

/** Cloud Storage (SPEC-0006 D-09 to D-12). */

export const BucketNameSchema = z
  .string()
  .min(3)
  .max(222)
  .regex(
    /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/,
    'Lowercase letters, digits, dashes, underscores and dots, starting and ending with a letter or digit',
  )
  .refine(
    (n) => !n.startsWith('goog') && !n.includes('google') && !/^\d+\.\d+\.\d+\.\d+$/.test(n),
    'Names cannot start with "goog", contain "google", or be an IP address',
  );

export const LifecycleRuleSchema = z.object({
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('Delete') }),
    z.object({ type: z.literal('SetStorageClass'), storageClass: z.enum(storageClasses) }),
    z.object({ type: z.literal('AbortIncompleteMultipartUpload') }),
  ]),
  condition: z.object({
    age: z.number().int().min(0).optional(),
    createdBefore: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    isLive: z.boolean().optional(),
    numNewerVersions: z.number().int().min(0).optional(),
    matchesStorageClass: z.array(z.string()).optional(),
    matchesPrefix: z.array(z.string().max(1024)).optional(),
    matchesSuffix: z.array(z.string().max(1024)).optional(),
    daysSinceNoncurrentTime: z.number().int().min(0).optional(),
    noncurrentTimeBefore: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    daysSinceCustomTime: z.number().int().min(0).optional(),
    customTimeBefore: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
});
export type LifecycleRule = z.infer<typeof LifecycleRuleSchema>;

export const CorsRuleSchema = z.object({
  origin: z.array(z.string().min(1).max(1024)).min(1),
  method: z.array(z.string().min(1).max(16)).min(1),
  responseHeader: z.array(z.string().min(1).max(256)).optional(),
  maxAgeSeconds: z
    .number()
    .int()
    .min(0)
    .max(86_400 * 30)
    .optional(),
});
export type CorsRule = z.infer<typeof CorsRuleSchema>;

export interface StorageBucket {
  name: string;
  location: string;
  locationType: string | null;
  storageClass: string;
  created: string | null;
  updated: string | null;
  metageneration: string | null;
  uniformAccess: boolean;
  publicAccessPrevention: 'enforced' | 'inherited';
  versioning: boolean;
  /** Null when soft delete is off. */
  softDeleteSeconds: number | null;
  hierarchicalNamespace: boolean;
  autoclass: boolean;
  labels: Record<string, string>;
  retention: { periodSeconds: number; locked: boolean; effectiveTime: string | null } | null;
  requesterPays: boolean;
  website: { mainPageSuffix: string | null; notFoundPage: string | null } | null;
  defaultKmsKeyName: string | null;
  lifecycle: LifecycleRule[];
  cors: CorsRule[];
}

export interface StorageObject {
  name: string;
  bucket: string;
  generation: string;
  metageneration: string | null;
  size: string;
  contentType: string | null;
  storageClass: string | null;
  created: string | null;
  updated: string | null;
  customTime: string | null;
  md5: string | null;
  crc32c: string | null;
  etag: string | null;
  cacheControl: string | null;
  contentDisposition: string | null;
  contentEncoding: string | null;
  contentLanguage: string | null;
  metadata: Record<string, string>;
  eventBasedHold: boolean;
  temporaryHold: boolean;
  retentionExpirationTime: string | null;
  kmsKeyName: string | null;
  /** Set on noncurrent versions. */
  timeDeleted: string | null;
  /** Set on soft-deleted objects. */
  softDeleteTime: string | null;
  hardDeleteTime: string | null;
}

export interface ObjectsPage {
  /** Folders at this level: prefixes for flat buckets, folders for hierarchical ones. */
  prefixes: string[];
  items: StorageObject[];
  nextPageToken: string | null;
}

export const OBJECTS_PAGE = 1000;

export const ListObjectsQuerySchema = z.object({
  prefix: z.string().max(1024).default(''),
  /** Browse one level (delimiter "/") or list everything under the prefix. */
  flat: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  versions: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  softDeleted: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  pageToken: z.string().max(4096).optional(),
});
export type ListObjectsQuery = z.input<typeof ListObjectsQuerySchema>;

const labels = z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/), z.string().max(63)).default({});

export const CreateBucketSchema = z.object({
  name: BucketNameSchema,
  location: z.string().min(2).max(40),
  storageClass: z.enum(storageClasses).default('STANDARD'),
  autoclass: z.boolean().default(false),
  hierarchicalNamespace: z.boolean().default(false),
  uniformAccess: z.boolean().default(true),
  publicAccessPrevention: z.boolean().default(true),
  /** Null turns soft delete off; the default keeps Google's 7 days. */
  softDeleteSeconds: z
    .number()
    .int()
    .min(0)
    .max(90 * 86_400)
    .nullable()
    .default(7 * 86_400),
  versioning: z.boolean().default(false),
  retentionSeconds: z.number().int().min(1).max(3_155_760_000).optional(),
  labels,
});
export type CreateBucket = z.input<typeof CreateBucketSchema>;

export const UpdateBucketSchema = z.object({
  storageClass: z.enum(storageClasses).optional(),
  versioning: z.boolean().optional(),
  softDeleteSeconds: z
    .number()
    .int()
    .min(0)
    .max(90 * 86_400)
    .nullable()
    .optional(),
  publicAccessPrevention: z.boolean().optional(),
  uniformAccess: z.boolean().optional(),
  labels: labels.optional(),
  requesterPays: z.boolean().optional(),
  website: z
    .object({ mainPageSuffix: z.string().max(1024), notFoundPage: z.string().max(1024) })
    .nullable()
    .optional(),
  defaultKmsKeyName: z.string().max(512).nullable().optional(),
  lifecycle: z.array(LifecycleRuleSchema).max(100).optional(),
  cors: z.array(CorsRuleSchema).max(100).optional(),
  /** Null removes an unlocked policy. */
  retentionSeconds: z.number().int().min(1).max(3_155_760_000).nullable().optional(),
});
export type UpdateBucket = z.input<typeof UpdateBucketSchema>;

export const LockRetentionSchema = z.object({ metageneration: z.string().regex(/^\d+$/), confirm: z.string().min(1) });

export const DeleteBucketSchema = z.object({
  confirm: z.string().min(1),
  /** The object count, typed, when the bucket still holds objects (D-10). */
  confirmObjects: z.string().optional(),
});
export type DeleteBucket = z.infer<typeof DeleteBucketSchema>;

export const ObjectRefSchema = z.object({ name: z.string().min(1).max(1024), generation: z.string().regex(/^\d+$/).optional() });
export type ObjectRef = z.infer<typeof ObjectRefSchema>;

export const DeleteObjectsSchema = z.object({
  objects: z.array(ObjectRefSchema).min(1).max(1000),
  /** The name for one object, the count for several (D-11). */
  confirm: z.string().min(1),
});
export type DeleteObjects = z.infer<typeof DeleteObjectsSchema>;

export const CopyObjectSchema = z.object({
  source: ObjectRefSchema,
  destinationBucket: BucketNameSchema,
  destinationName: z.string().min(1).max(1024),
  /** Move deletes the source after the copy; renaming is a move in the same bucket. */
  move: z.boolean().default(false),
});
export type CopyObject = z.input<typeof CopyObjectSchema>;

export const UpdateObjectSchema = z.object({
  name: z.string().min(1).max(1024),
  contentType: z.string().max(256).nullable().optional(),
  cacheControl: z.string().max(256).nullable().optional(),
  contentDisposition: z.string().max(1024).nullable().optional(),
  contentEncoding: z.string().max(64).nullable().optional(),
  contentLanguage: z.string().max(64).nullable().optional(),
  metadata: z.record(z.string().min(1).max(256), z.string().max(2048)).optional(),
  eventBasedHold: z.boolean().optional(),
  temporaryHold: z.boolean().optional(),
});
export type UpdateObject = z.infer<typeof UpdateObjectSchema>;

export const RestoreObjectSchema = z.object({ name: z.string().min(1).max(1024), generation: z.string().regex(/^\d+$/) });

export const SIGNED_URL_MAX_SECONDS = 7 * 86_400;
export const SignedUrlSchema = z.object({
  name: z.string().min(1).max(1024),
  expiresSeconds: z.number().int().min(60).max(SIGNED_URL_MAX_SECONDS),
});

export const objectDispositions = ['inline', 'attachment'] as const;
export const ObjectLinkSchema = z.object({
  name: z.string().min(1).max(1024),
  generation: z.string().regex(/^\d+$/).optional(),
  disposition: z.enum(objectDispositions),
});
export type ObjectLinkRequest = z.infer<typeof ObjectLinkSchema>;

export interface ObjectLink {
  /** Same-origin URL that streams the object for a few minutes; see SPEC-0006 D-11. */
  url: string;
  expiresAt: string;
  /** False when the type only downloads (unknown types, CA-73). HTML, SVG and XML are inline only as text. */
  inline: boolean;
}

export const FolderSchema = z.object({ name: z.string().min(1).max(1024).regex(/\/$/, 'A folder name ends with /') });
export const RenameFolderSchema = z.object({ source: z.string().min(1).max(1024), destination: z.string().min(1).max(1024) });

export interface StorageCapabilities {
  /** Signed URLs need a private key or iam.serviceAccounts.signBlob (D-11, CA-13). */
  canSign: boolean;
  signingAccount: string | null;
  emulator: boolean;
}

export interface IamBinding {
  role: string;
  members: string[];
  condition: { title: string; expression: string } | null;
}

export interface BucketIamPolicy {
  etag: string | null;
  version: number;
  bindings: IamBinding[];
}

export const SetBucketIamSchema = z.object({
  etag: z.string().nullable(),
  bindings: z
    .array(
      z.object({
        role: z.string().min(1).max(256),
        members: z.array(z.string().min(1).max(512)).min(1),
        condition: z.object({ title: z.string(), expression: z.string() }).nullable(),
      }),
    )
    .max(250),
});
export type SetBucketIam = z.infer<typeof SetBucketIamSchema>;

export {
  PREVIEW_CSV_ROWS,
  PREVIEW_IMAGE_MAX,
  PREVIEW_TEXT_MAX,
  type PreviewKind,
  previewKind,
  type StorageClass,
  servedType,
  storageClasses,
} from './storage-preview.js';
