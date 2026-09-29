import { z } from 'zod';
import { colorTags, ENV_PROFILE_ID, MAX_KEY_BYTES } from './constants.js';

export const ColorTagSchema = z.enum(colorTags);
export type ColorTag = z.infer<typeof ColorTagSchema>;

export const credentialTypes = [
  'service_account',
  'authorized_user',
  'external_account',
  'impersonated_service_account',
  'metadata_server',
  /** No Google credentials; only the configured emulators answer (SPEC-0001 D-18). */
  'emulator_only',
] as const;
export const CredentialTypeSchema = z.enum(credentialTypes);
export type CredentialType = z.infer<typeof CredentialTypeSchema>;

/** Public view of a profile. Never carries key material (SPEC-0001 CA-06). */
export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.enum(['environment', 'saved']),
  colorTag: ColorTagSchema,
  readOnly: z.boolean(),
  defaultProject: z.string().nullable(),
  quotaProjectId: z.string().nullable(),
  principal: z.string().nullable(),
  type: CredentialTypeSchema,
  keyId: z.string().nullable(),
  keyProjectId: z.string().nullable(),
  createdAt: z.string(),
});
export type Profile = z.infer<typeof ProfileSchema>;

const projectIdLike = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9:.-]+$/i, 'Use a project id such as my-project-123');

export const AddProfileSchema = z.object({
  key: z.string().min(2).max(MAX_KEY_BYTES),
  name: z.string().trim().min(1).max(80).optional(),
  colorTag: ColorTagSchema.optional(),
  readOnly: z.boolean().optional(),
  defaultProject: projectIdLike.optional(),
  quotaProjectId: projectIdLike.optional(),
});
export type AddProfile = z.infer<typeof AddProfileSchema>;

export const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  colorTag: ColorTagSchema.optional(),
  readOnly: z.boolean().optional(),
  defaultProject: projectIdLike.nullable().optional(),
  quotaProjectId: projectIdLike.nullable().optional(),
});
export type UpdateProfile = z.infer<typeof UpdateProfileSchema>;

export const profileCheckSteps = ['parse', 'type', 'token', 'projects'] as const;
export const ProfileCheckStepSchema = z.object({
  step: z.enum(profileCheckSteps),
  ok: z.boolean(),
  message: z.string().optional(),
});
export const ProfileCheckSchema = z.object({
  ok: z.boolean(),
  steps: z.array(ProfileCheckStepSchema),
  visibleProjects: z.number().int().nullable(),
});
export type ProfileCheck = z.infer<typeof ProfileCheckSchema>;

export const AddProfileResultSchema = z.object({
  profile: ProfileSchema,
  check: ProfileCheckSchema,
});
export type AddProfileResult = z.infer<typeof AddProfileResultSchema>;

export { colorTags, ENV_PROFILE_ID, MAX_KEY_BYTES };
