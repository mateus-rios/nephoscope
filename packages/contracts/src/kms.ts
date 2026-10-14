import { z } from 'zod';

/** Cloud KMS (SPEC-0007 D-08). */

export const KMS_TOOL_MAX_BYTES = 64 * 1024;

export interface KeyRingView {
  name: string;
  id: string;
  location: string;
  createTime: string | null;
}

export const kmsPurposes = ['ENCRYPT_DECRYPT', 'ASYMMETRIC_SIGN', 'ASYMMETRIC_DECRYPT', 'MAC', 'RAW_ENCRYPT_DECRYPT'] as const;
export type KmsPurpose = (typeof kmsPurposes)[number];
export const kmsProtectionLevels = ['SOFTWARE', 'HSM', 'EXTERNAL', 'EXTERNAL_VPC'] as const;

export interface CryptoKeyView {
  name: string;
  id: string;
  keyRing: string;
  location: string;
  purpose: string;
  protectionLevel: string | null;
  algorithm: string | null;
  primary: { id: string; state: string } | null;
  rotationPeriodSeconds: number | null;
  nextRotationTime: string | null;
  destroyScheduledDuration: string | null;
  labels: Record<string, string>;
  createTime: string | null;
}

export interface KeyVersionView {
  name: string;
  id: string;
  state: string;
  algorithm: string | null;
  protectionLevel: string | null;
  createTime: string | null;
  destroyTime: string | null;
  primary: boolean;
}

const id = (what: string) =>
  z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-zA-Z0-9_-]+$/, `${what}: letters, digits, underscores and hyphens`);
export const KmsIdSchema = id('Id');

export const CreateKeyRingSchema = z.object({
  id: id('Key ring'),
  location: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64),
});
export type CreateKeyRing = z.infer<typeof CreateKeyRingSchema>;

export const CreateCryptoKeySchema = z.object({
  id: id('Key'),
  purpose: z.enum(kmsPurposes),
  protectionLevel: z.enum(kmsProtectionLevels).default('SOFTWARE'),
  algorithm: z
    .string()
    .regex(/^[A-Z0-9_]+$/)
    .max(64),
  rotationPeriodSeconds: z
    .number()
    .int()
    .min(86_400)
    .max(100 * 365 * 86_400)
    .optional(),
  labels: z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/), z.string().max(63)).default({}),
});
export type CreateCryptoKey = z.infer<typeof CreateCryptoKeySchema>;

export const UpdateCryptoKeySchema = z.object({
  rotationPeriodSeconds: z.number().int().min(86_400).nullable().optional(),
  labels: z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/), z.string().max(63)).optional(),
});
export type UpdateCryptoKey = z.infer<typeof UpdateCryptoKeySchema>;

export const kmsToolOps = ['encrypt', 'decrypt', 'sign', 'verify', 'macSign', 'macVerify'] as const;
export type KmsToolOp = (typeof kmsToolOps)[number];

/** A crypto tool request (SPEC-0007 D-08): inputs as base64, at most 64 KiB decoded. */
export const KmsToolSchema = z.object({
  op: z.enum(kmsToolOps),
  /** Plaintext, ciphertext or data to sign, as base64. */
  input: z
    .string()
    .min(1)
    .max(Math.ceil((KMS_TOOL_MAX_BYTES * 4) / 3) + 4),
  /** Signature or MAC to verify, as base64. */
  signature: z.string().max(16_384).optional(),
  /** Key version for sign, verify and MAC; encrypt uses the primary. */
  version: z
    .string()
    .regex(/^[0-9]+$/)
    .optional(),
});
export type KmsTool = z.infer<typeof KmsToolSchema>;

export interface KmsToolResult {
  /** Base64 output (ciphertext, plaintext, signature or MAC); null for verifications. */
  output: string | null;
  /** UTF-8 text of a decrypted plaintext, when it is valid text. */
  text: string | null;
  verified: boolean | null;
  version: string | null;
}

/** Algorithms per purpose offered by the create form; Google validates the final choice. */
export const kmsAlgorithms: Record<KmsPurpose, string[]> = {
  ENCRYPT_DECRYPT: ['GOOGLE_SYMMETRIC_ENCRYPTION'],
  RAW_ENCRYPT_DECRYPT: ['AES_256_GCM', 'AES_128_GCM', 'AES_256_CBC', 'AES_256_CTR'],
  ASYMMETRIC_SIGN: [
    'EC_SIGN_P256_SHA256',
    'EC_SIGN_P384_SHA384',
    'RSA_SIGN_PSS_2048_SHA256',
    'RSA_SIGN_PSS_3072_SHA256',
    'RSA_SIGN_PSS_4096_SHA256',
    'RSA_SIGN_PKCS1_2048_SHA256',
    'RSA_SIGN_PKCS1_3072_SHA256',
    'RSA_SIGN_PKCS1_4096_SHA256',
    'EC_SIGN_ED25519',
  ],
  ASYMMETRIC_DECRYPT: ['RSA_DECRYPT_OAEP_2048_SHA256', 'RSA_DECRYPT_OAEP_3072_SHA256', 'RSA_DECRYPT_OAEP_4096_SHA256'],
  MAC: ['HMAC_SHA256', 'HMAC_SHA1', 'HMAC_SHA384', 'HMAC_SHA512', 'HMAC_SHA224'],
};
