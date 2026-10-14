import type { PolicyBinding, PolicyCondition } from '@nephoscope/contracts';

/** One role a member holds, optionally under a condition. */
export interface Assignment {
  role: string;
  condition: PolicyCondition | null;
}

const sameCondition = (a: PolicyCondition | null, b: PolicyCondition | null) =>
  (a === null && b === null) || (!!a && !!b && a.title === b.title && a.expression === b.expression);

/** Every member of the policy, sorted, with what it holds. */
export function membersOf(bindings: readonly PolicyBinding[]): { member: string; assignments: Assignment[] }[] {
  const map = new Map<string, Assignment[]>();
  for (const b of bindings) {
    for (const m of b.members) {
      const list = map.get(m) ?? [];
      list.push({ role: b.role, condition: b.condition });
      map.set(m, list);
    }
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([member, assignments]) => ({ member, assignments }));
}

/**
 * Replaces what `member` holds with `assignments`: the member leaves bindings it no longer has,
 * joins (or creates) the bindings it gains, and empty bindings disappear.
 */
export function withMember(bindings: readonly PolicyBinding[], member: string, assignments: readonly Assignment[]): PolicyBinding[] {
  const next = bindings.map((b) => ({ ...b, members: b.members.filter((m) => m !== member) }));
  for (const a of assignments) {
    const existing = next.find((b) => b.role === a.role && sameCondition(b.condition, a.condition));
    if (existing) existing.members = [...existing.members, member].sort();
    else next.push({ role: a.role, members: [member], condition: a.condition });
  }
  return next.filter((b) => b.members.length > 0);
}

export type MemberType = 'User' | 'Service account' | 'Group' | 'Domain' | 'Public' | 'Workload identity' | 'Deleted' | 'Other';

export function memberType(member: string): MemberType {
  if (member === 'allUsers' || member === 'allAuthenticatedUsers') return 'Public';
  if (member.startsWith('deleted:')) return 'Deleted';
  const kind = member.split(':')[0];
  switch (kind) {
    case 'user':
      return 'User';
    case 'serviceAccount':
      return 'Service account';
    case 'group':
      return 'Group';
    case 'domain':
      return 'Domain';
    case 'principal':
    case 'principalSet':
      return 'Workload identity';
    default:
      return 'Other';
  }
}

/** The member without its type prefix, for display. */
export const memberName = (member: string) => member.replace(/^(user|serviceAccount|group|domain|principal|principalSet):/, '');

/** Condition templates of SPEC-0007 D-01: expiration and resource name prefix. */
export const conditionTemplates = {
  expiry: (iso: string): PolicyCondition => ({
    title: `Expires ${iso.slice(0, 10)}`,
    description: null,
    expression: `request.time < timestamp("${iso}")`,
  }),
  prefix: (prefix: string): PolicyCondition => ({
    title: `Resources under ${prefix}`,
    description: null,
    expression: `resource.name.startsWith("${prefix.replaceAll('"', '\\"')}")`,
  }),
};
