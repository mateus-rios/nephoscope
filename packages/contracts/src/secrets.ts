import { z } from 'zod';

/** Secret Manager: global and regional secrets, versions, reveal (SPEC-0007 D-06, D-07). */

export const SECRET_MAX_BYTES = 64 * 1024;

export interface SecretView {
  name: string;
  id: string;
  /** `global`, or the region of a regional secret. */
  location: string;
  replication: 'automatic' | 'user-managed' | 'regional';
  replicaLocations: string[];
  labels: Record<string, string>;
  annotations: Record<string, string>;
  expireTime: string | null;
  rotation: { periodSeconds: number | null; nextRotationTime: string | null } | null;
  topics: string[];
  /** Seconds a destroyed version waits before it is gone; null destroys at once. */
  versionDestroyTtlSeconds: number | null;
  createTime: string | null;
  etag: string | null;
}

export const secretVersionStates = ['ENABLED', 'DISABLED', 'DESTROYED', 'STATE_UNSPECIFIED'] as const;

export interface SecretVersionView {
  name: string;
  id: string;
  state: (typeof secretVersionStates)[number];
  createTime: string | null;
  destroyTime: string | null;
  scheduledDestroyTime: string | null;
  etag: string | null;
}

export interface SecretUsage {
  kind: 'service' | 'job' | 'function';
  name: string;
  location: string;
  href: string;
  /** Environment variables or mount paths that use the secret. */
  where: string[];
}

export interface RevealedSecret {
  version: string;
  /** The payload as base64; text is set when it is valid UTF-8. */
  base64: string;
  text: string | null;
  /** True when Google's CRC32C matched the payload. */
  checksumOk: boolean;
}

const secretId = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, underscores and hyphens');
export const SecretIdSchema = secretId;

const labels = z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/), z.string().max(63));

export const CreateSecretSchema = z.object({
  id: secretId,
  /** `global` or a region for a regional secret. */
  location: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64)
    .default('global'),
  replication: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('automatic'), kmsKey: z.string().max(512).optional() }),
    z.object({
      kind: z.literal('user'),
      replicas: z
        .array(z.object({ location: z.string().regex(/^[a-z0-9-]+$/), kmsKey: z.string().max(512).optional() }))
        .min(1)
        .max(20),
    }),
  ]),
  labels: labels.default({}),
  annotations: z.record(z.string().max(63), z.string().max(16_384)).default({}),
  expireTime: z.string().datetime({ offset: true }).optional(),
  rotation: z
    .object({
      periodSeconds: z
        .number()
        .int()
        .min(3600)
        .max(100 * 365 * 86_400),
      nextRotationTime: z.string().datetime({ offset: true }),
    })
    .optional(),
  topics: z
    .array(z.string().regex(/^projects\/[^/]+\/topics\/[^/]+$/))
    .max(10)
    .default([]),
  versionDestroyTtlSeconds: z
    .number()
    .int()
    .min(86_400)
    .max(30 * 86_400)
    .optional(),
  /** First version, as text. */
  initialValue: z.string().max(SECRET_MAX_BYTES).optional(),
});
export type CreateSecret = z.infer<typeof CreateSecretSchema>;

export const UpdateSecretSchema = z.object({
  labels: labels.optional(),
  annotations: z.record(z.string().max(63), z.string().max(16_384)).optional(),
  /** Empty string clears it. */
  expireTime: z.union([z.string().datetime({ offset: true }), z.literal('')]).optional(),
  rotation: z
    .object({ periodSeconds: z.number().int().min(3600), nextRotationTime: z.string().datetime({ offset: true }) })
    .nullable()
    .optional(),
  topics: z
    .array(z.string().regex(/^projects\/[^/]+\/topics\/[^/]+$/))
    .max(10)
    .optional(),
  versionDestroyTtlSeconds: z
    .number()
    .int()
    .min(86_400)
    .max(30 * 86_400)
    .nullable()
    .optional(),
  etag: z.string().max(256).optional(),
});
export type UpdateSecret = z.infer<typeof UpdateSecretSchema>;

export const AddSecretVersionSchema = z.object({
  /** UTF-8 text, or base64 when `base64` is true. */
  data: z
    .string()
    .min(1)
    .max(Math.ceil((SECRET_MAX_BYTES * 4) / 3) + 4),
  base64: z.boolean().default(false),
});
export type AddSecretVersion = z.infer<typeof AddSecretVersionSchema>;

export const SecretListQuerySchema = z.object({
  location: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64)
    .default('global'),
});
