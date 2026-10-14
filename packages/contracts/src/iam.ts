import { z } from 'zod';
import { ColorTagSchema } from './profile.js';

/** IAM: allow policy, service accounts and keys, roles, troubleshooting (SPEC-0007 D-01 to D-05). */

export interface PolicyCondition {
  title: string;
  description: string | null;
  expression: string;
}

export interface PolicyBinding {
  role: string;
  members: string[];
  condition: PolicyCondition | null;
}

export const auditLogTypes = ['ADMIN_READ', 'DATA_READ', 'DATA_WRITE'] as const;
export type AuditLogType = (typeof auditLogTypes)[number];

export interface AuditConfigView {
  service: string;
  logTypes: { logType: AuditLogType; exemptedMembers: string[] }[];
}

export interface IamPolicyView {
  version: number;
  etag: string;
  bindings: PolicyBinding[];
  auditConfigs: AuditConfigView[];
}

export interface InheritedPolicy {
  /** `folders/123` or `organizations/456`. */
  resource: string;
  displayName: string | null;
  bindings: PolicyBinding[];
}

export interface ProjectIamView {
  policy: IamPolicyView;
  inherited: InheritedPolicy[];
  /** Why ancestors could not be read, when they could not. */
  inheritedError: string | null;
  /** The active profile as an IAM member, such as `serviceAccount:x@p.iam.gserviceaccount.com`. */
  self: string | null;
}

const ConditionSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(256).nullable().default(null),
  expression: z.string().min(1).max(12_800),
});

const MemberSchema = z
  .string()
  .min(3)
  .max(512)
  .regex(
    /^(user|serviceAccount|group|domain|principal|principalSet|deleted:[a-zA-Z]+):\S+$|^allUsers$|^allAuthenticatedUsers$/,
    'A member such as user:ana@example.com',
  );

export const BindingSchema = z.object({
  role: z
    .string()
    .min(1)
    .max(512)
    .regex(/^(roles\/|projects\/[^/]+\/roles\/|organizations\/[^/]+\/roles\/)\S+$/, 'A role such as roles/run.viewer'),
  members: z.array(MemberSchema).min(1).max(1500),
  condition: ConditionSchema.nullable().default(null),
});

export const AuditConfigSchema = z.object({
  service: z.string().min(1).max(256),
  logTypes: z.array(z.object({ logType: z.enum(auditLogTypes), exemptedMembers: z.array(MemberSchema).max(1500).default([]) })).max(3),
});

export const SetIamPolicySchema = z.object({
  /** The etag read with the policy: a concurrent change makes the save fail (SPEC-0007 D-01). */
  etag: z.string().min(1).max(256),
  bindings: z.array(BindingSchema).max(1500),
  auditConfigs: z.array(AuditConfigSchema).max(500).optional(),
  /** Set when the user confirmed removing the active profile's own access. */
  confirmSelf: z.boolean().default(false),
  /** Set when the user confirmed removing the last owner. */
  confirmLastOwner: z.boolean().default(false),
});
export type SetIamPolicy = z.infer<typeof SetIamPolicySchema>;

/** Members of `roles/owner` across unconditional bindings. */
export function owners(bindings: readonly PolicyBinding[]): string[] {
  return [...new Set(bindings.filter((b) => b.role === 'roles/owner' && !b.condition).flatMap((b) => b.members))];
}

/** Every role a member holds through unconditional or conditional bindings. */
export function rolesOf(bindings: readonly PolicyBinding[], member: string): string[] {
  return [...new Set(bindings.filter((b) => b.members.includes(member)).map((b) => b.role))];
}

/** One change between two policies, for the diff shown before saving (SPEC-0007 D-01). */
export interface BindingChange {
  kind: 'add' | 'remove';
  role: string;
  member: string;
  condition: string | null;
}

const bindingKey = (b: PolicyBinding) => `${b.role}\u0000${b.condition ? `${b.condition.title}\u0000${b.condition.expression}` : ''}`;

/** Members added and removed per (role, condition), in a stable order. */
export function policyDiff(before: readonly PolicyBinding[], after: readonly PolicyBinding[]): BindingChange[] {
  const index = (list: readonly PolicyBinding[]) => {
    const m = new Map<string, { binding: PolicyBinding; members: Set<string> }>();
    for (const b of list) {
      const k = bindingKey(b);
      const cur = m.get(k) ?? { binding: b, members: new Set<string>() };
      for (const member of b.members) cur.members.add(member);
      m.set(k, cur);
    }
    return m;
  };
  const a = index(before);
  const b = index(after);
  const out: BindingChange[] = [];
  for (const [k, { binding, members }] of b) {
    const old = a.get(k)?.members ?? new Set<string>();
    for (const m of members)
      if (!old.has(m)) out.push({ kind: 'add', role: binding.role, member: m, condition: binding.condition?.title ?? null });
  }
  for (const [k, { binding, members }] of a) {
    const now = b.get(k)?.members ?? new Set<string>();
    for (const m of members)
      if (!now.has(m)) out.push({ kind: 'remove', role: binding.role, member: m, condition: binding.condition?.title ?? null });
  }
  return out.sort((x, y) => x.role.localeCompare(y.role) || x.member.localeCompare(y.member) || x.kind.localeCompare(y.kind));
}

// ---- roles ---------------------------------------------------------------------------------------

export interface RoleSummary {
  name: string;
  title: string;
  description: string;
  stage: string;
  permissionCount: number;
  custom: boolean;
  deleted: boolean;
}

export interface RoleDetail extends RoleSummary {
  includedPermissions: string[];
  etag: string | null;
}

export const RoleSearchSchema = z.object({
  q: z.string().max(200).default(''),
  /** Roles that grant this permission (SPEC-0007 D-03). */
  permission: z
    .string()
    .max(200)
    .regex(/^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+){2}$|^$/)
    .optional(),
  custom: z.enum(['all', 'custom', 'predefined']).default('all'),
});
export type RoleSearch = z.infer<typeof RoleSearchSchema>;

export const roleStages = ['ALPHA', 'BETA', 'GA', 'DEPRECATED', 'DISABLED', 'EAP'] as const;

export const SaveCustomRoleSchema = z.object({
  roleId: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_.]+$/, 'Letters, digits, underscores and periods'),
  title: z.string().min(1).max(100),
  description: z.string().max(300).default(''),
  stage: z.enum(roleStages).default('GA'),
  includedPermissions: z
    .array(z.string().regex(/^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+){2}$/))
    .min(1)
    .max(3000),
});
export type SaveCustomRole = z.infer<typeof SaveCustomRoleSchema>;

export interface TestablePermission {
  name: string;
  title: string | null;
  stage: string | null;
  supportLevel: 'SUPPORTED' | 'TESTING' | 'NOT_SUPPORTED' | string;
}

// ---- service accounts and keys ----------------------------------------------------------------------

export interface ServiceAccountView {
  name: string;
  email: string;
  uniqueId: string;
  displayName: string | null;
  description: string | null;
  disabled: boolean;
  /** User-managed keys; null when they could not be counted. */
  keyCount: number | null;
}

export interface ServiceAccountKeyView {
  name: string;
  id: string;
  keyType: 'USER_MANAGED' | 'SYSTEM_MANAGED' | string;
  algorithm: string | null;
  origin: string | null;
  validAfter: string | null;
  validBefore: string | null;
  disabled: boolean;
}

export const ServiceAccountIdSchema = z
  .string()
  .min(6)
  .max(30)
  .regex(/^[a-z]([-a-z0-9]*[a-z0-9])$/, 'Lowercase letters, digits and hyphens, 6 to 30 characters');

export const CreateServiceAccountSchema = z.object({
  accountId: ServiceAccountIdSchema,
  displayName: z.string().max(100).optional(),
  description: z.string().max(256).optional(),
});
export type CreateServiceAccount = z.infer<typeof CreateServiceAccountSchema>;

export const UpdateServiceAccountSchema = z.object({
  displayName: z.string().max(100).optional(),
  description: z.string().max(256).optional(),
});
export type UpdateServiceAccount = z.infer<typeof UpdateServiceAccountSchema>;

export const ServiceAccountEmailSchema = z
  .string()
  .max(256)
  .regex(
    /^[a-z0-9-]+@[a-z0-9.-]+\.iam\.gserviceaccount\.com$|^[0-9]+-compute@developer\.gserviceaccount\.com$|^[a-z0-9-]+@appspot\.gserviceaccount\.com$/,
    'A service account email',
  );

/**
 * A key created by Nephoscope (SPEC-0007 D-02). The private key stays on the server; the page gets
 * a one-time handle to download it once or to add it as a profile.
 */
export interface NewKeyView {
  key: ServiceAccountKeyView;
  handle: string;
  expiresAt: string;
}

export const AddKeyAsProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  colorTag: ColorTagSchema.optional(),
  readOnly: z.boolean().optional(),
});
export type AddKeyAsProfile = z.infer<typeof AddKeyAsProfileSchema>;

export const UploadKeySchema = z.object({
  /** PEM X.509 certificate with the public key. */
  publicKeyPem: z.string().min(50).max(16_000),
});

export const UndeleteServiceAccountSchema = z.object({ uniqueId: z.string().regex(/^[0-9]{10,30}$/, 'The numeric unique id') });

// ---- testing and troubleshooting ------------------------------------------------------------------------

export const TestPermissionsSchema = z.object({
  permissions: z
    .array(z.string().regex(/^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+){2}$/, 'A permission such as run.services.get'))
    .min(1)
    .max(500),
});

export const TroubleshootSchema = z.object({
  principal: z.string().min(3).max(512),
  /** `//run.googleapis.com/projects/p/locations/l/services/s`; defaults to the project. */
  fullResourceName: z.string().max(2048).optional(),
  permission: z.string().regex(/^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+){2}$/),
});
export type Troubleshoot = z.infer<typeof TroubleshootSchema>;

export interface TroubleshootBindingView {
  role: string;
  granted: string | null;
  membership: string | null;
  condition: string | null;
  relevance: string | null;
}

export interface TroubleshootView {
  access: string;
  explanations: { resource: string; access: string | null; bindings: TroubleshootBindingView[] }[];
  denyAccess: string | null;
  raw: unknown;
}

// ---- resource policies (SPEC-0001 CA-64 Permissions tabs) -------------------------------------------

/** Resources whose IAM policy the shared Permissions tab edits; each kind has a name pattern on the server. */
export const resourceIamKinds = ['secret', 'kms-keyring', 'kms-key', 'ar-repo'] as const;
export type ResourceIamKind = (typeof resourceIamKinds)[number];

export const ResourceIamQuerySchema = z.object({
  kind: z.enum(resourceIamKinds),
  name: z.string().min(1).max(1024),
});
export type ResourceIamQuery = z.infer<typeof ResourceIamQuerySchema>;
