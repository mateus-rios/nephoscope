import type {
  AuditConfigView,
  IamPolicyView,
  PolicyBinding,
  RoleDetail,
  ServiceAccountKeyView,
  ServiceAccountView,
  SetIamPolicy,
  TestablePermission,
  TroubleshootView,
} from '@nephoscope/contracts';

// biome-ignore lint/suspicious/noExplicitAny: IAM REST resources are read field by field.
type Any = any;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function mapBindings(list: unknown): PolicyBinding[] {
  return ((Array.isArray(list) ? list : []) as Any[]).map((b) => ({
    role: String(b?.role ?? ''),
    members: Array.isArray(b?.members) ? b.members.map(String) : [],
    condition: b?.condition
      ? {
          title: String(b.condition.title ?? ''),
          description: str(b.condition.description),
          expression: String(b.condition.expression ?? ''),
        }
      : null,
  }));
}

export function mapAuditConfigs(list: unknown): AuditConfigView[] {
  return ((Array.isArray(list) ? list : []) as Any[]).map((a) => ({
    service: String(a?.service ?? ''),
    logTypes: ((a?.auditLogConfigs ?? []) as Any[]).map((c) => ({
      logType: c?.logType,
      exemptedMembers: Array.isArray(c?.exemptedMembers) ? c.exemptedMembers.map(String) : [],
    })),
  }));
}

export function mapPolicy(p: Any): IamPolicyView {
  return {
    version: Number(p?.version ?? 1),
    etag: String(p?.etag ?? ''),
    bindings: mapBindings(p?.bindings),
    auditConfigs: mapAuditConfigs(p?.auditConfigs),
  };
}

/** The policy body of a setIamPolicy. Version 3 keeps conditional bindings (SPEC-0007 D-01). */
export function policyBody(b: Pick<SetIamPolicy, 'etag' | 'bindings' | 'auditConfigs'>): Any {
  const body: Any = {
    version: 3,
    etag: b.etag,
    bindings: b.bindings.map((x) => ({
      role: x.role,
      members: x.members,
      ...(x.condition
        ? { condition: { title: x.condition.title, description: x.condition.description ?? undefined, expression: x.condition.expression } }
        : {}),
    })),
  };
  if (b.auditConfigs) {
    body.auditConfigs = b.auditConfigs.map((a) => ({
      service: a.service,
      auditLogConfigs: a.logTypes.map((t) => ({
        logType: t.logType,
        ...(t.exemptedMembers.length ? { exemptedMembers: t.exemptedMembers } : {}),
      })),
    }));
  }
  return body;
}

/** The IAM member of a profile principal: service accounts by suffix, other emails as users. */
export function memberOf(principal: string | null | undefined): string | null {
  if (!principal?.includes('@')) return null;
  return /\.gserviceaccount\.com$/.test(principal) ? `serviceAccount:${principal}` : `user:${principal}`;
}

export function mapRole(r: Any): RoleDetail {
  const name = String(r?.name ?? '');
  const perms = Array.isArray(r?.includedPermissions) ? r.includedPermissions.map(String) : [];
  return {
    name,
    title: String(r?.title ?? name.split('/').pop() ?? ''),
    description: String(r?.description ?? ''),
    stage: String(r?.stage ?? 'GA'),
    permissionCount: perms.length,
    custom: !name.startsWith('roles/'),
    deleted: !!r?.deleted,
    includedPermissions: perms,
    etag: str(r?.etag),
  };
}

export function mapServiceAccount(a: Any, keyCount: number | null): ServiceAccountView {
  return {
    name: String(a?.name ?? ''),
    email: String(a?.email ?? ''),
    uniqueId: String(a?.uniqueId ?? ''),
    displayName: str(a?.displayName),
    description: str(a?.description),
    disabled: !!a?.disabled,
    keyCount,
  };
}

export function mapKey(k: Any): ServiceAccountKeyView {
  const name = String(k?.name ?? '');
  return {
    name,
    id: name.split('/').pop() ?? name,
    keyType: String(k?.keyType ?? ''),
    algorithm: str(k?.keyAlgorithm),
    origin: str(k?.keyOrigin),
    validAfter: str(k?.validAfterTime),
    validBefore: str(k?.validBeforeTime),
    disabled: !!k?.disabled,
  };
}

export function mapTestable(p: Any): TestablePermission {
  return {
    name: String(p?.name ?? ''),
    title: str(p?.title),
    stage: str(p?.stage),
    supportLevel: String(p?.customRolesSupportLevel ?? 'SUPPORTED'),
  };
}

/** Policy Troubleshooter v3 to the page's explanation (SPEC-0007 D-04). */
export function mapTroubleshoot(r: Any): TroubleshootView {
  const allow = r?.allowPolicyExplanation ?? {};
  return {
    access: String(r?.overallAccessState ?? allow.allowAccessState ?? 'UNKNOWN'),
    denyAccess: str(r?.denyPolicyExplanation?.denyAccessState),
    explanations: ((allow.explainedPolicies ?? []) as Any[]).map((p) => ({
      resource: String(p?.fullResourceName ?? ''),
      access: str(p?.allowAccessState),
      bindings: ((p?.bindingExplanations ?? []) as Any[]).map((b) => ({
        role: String(b?.role ?? ''),
        granted: str(b?.rolePermission),
        membership: str(Object.values((b?.memberships ?? {}) as Record<string, Any>)[0]?.membership),
        condition: str(b?.condition?.expression),
        relevance: str(b?.relevance),
      })),
    })),
    raw: r,
  };
}
