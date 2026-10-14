import { z } from 'zod';

/** Cloud Armor security policies (SPEC-0007 D-09). */

export const ARMOR_DEFAULT_PRIORITY = 2147483647;

export interface ArmorPolicySummary {
  /** `global/securityPolicies/{name}` or `regions/{r}/securityPolicies/{name}`. */
  path: string;
  name: string;
  scope: string;
  type: string;
  description: string | null;
  ruleCount: number;
  adaptiveProtection: boolean;
  labels: Record<string, string>;
  /** Backend services and buckets the policy is attached to. */
  targets: string[];
}

export interface ArmorRule {
  priority: number;
  action: string;
  description: string | null;
  preview: boolean;
  match: { kind: 'ip' | 'expr' | 'other'; srcIpRanges: string[]; expression: string | null };
  rateLimitOptions: unknown | null;
  redirectOptions: unknown | null;
  headerAction: unknown | null;
}

export interface ArmorPolicyView extends ArmorPolicySummary {
  fingerprint: string | null;
  rules: ArmorRule[];
  raw: unknown;
}

export interface WafExpressionSet {
  id: string;
  aliases: string[];
  expressions: { id: string; sensitivity: number | null }[];
}

export interface ArmorTarget {
  /** `global/backendServices/x`, `regions/r/backendServices/x` or `global/backendBuckets/x`. */
  path: string;
  name: string;
  scope: string;
  kind: 'backendService' | 'backendBucket';
  scheme: string | null;
  securityPolicy: string | null;
  edgeSecurityPolicy: string | null;
}

export const armorActions = ['allow', 'deny(403)', 'deny(404)', 'deny(502)', 'rate_based_ban', 'throttle', 'redirect'] as const;

const ipRange = z.string().regex(/^(\*|[0-9a-fA-F:.]+(\/\d{1,3})?)$/, 'An IP address or CIDR range');

export const SaveArmorRuleSchema = z.object({
  priority: z.number().int().min(0).max(ARMOR_DEFAULT_PRIORITY),
  action: z.enum(armorActions),
  description: z.string().max(2048).default(''),
  preview: z.boolean().default(false),
  match: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ip'), srcIpRanges: z.array(ipRange).min(1).max(10) }),
    z.object({ kind: z.literal('expr'), expression: z.string().min(1).max(8192) }),
  ]),
  rateLimitOptions: z.record(z.string(), z.unknown()).optional(),
  redirectOptions: z.record(z.string(), z.unknown()).optional(),
  headerAction: z.record(z.string(), z.unknown()).optional(),
});
export type SaveArmorRule = z.infer<typeof SaveArmorRuleSchema>;

export const CreateArmorPolicySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z]([-a-z0-9]*[a-z0-9])?$/, 'Lowercase letters, digits and hyphens'),
  /** `global` or a region. */
  scope: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default('global'),
  type: z.enum(['CLOUD_ARMOR', 'CLOUD_ARMOR_EDGE', 'CLOUD_ARMOR_NETWORK']).default('CLOUD_ARMOR'),
  description: z.string().max(2048).default(''),
});
export type CreateArmorPolicy = z.infer<typeof CreateArmorPolicySchema>;

/** The new order of the rules, by their current priorities; the default rule stays last. */
export const ReorderRulesSchema = z.object({
  order: z
    .array(
      z
        .number()
        .int()
        .min(0)
        .max(ARMOR_DEFAULT_PRIORITY - 1),
    )
    .min(1)
    .max(1000),
  /** The number of steps of the plan the user reviewed, typed (SPEC-0001 D-13). */
  confirm: z.string().max(16),
});
export type ReorderRules = z.infer<typeof ReorderRulesSchema>;

export const AttachArmorSchema = z.object({
  target: z.string().regex(/^(global|regions\/[a-z0-9-]+)\/(backendServices|backendBuckets)\/[a-z0-9-]+$/),
  /** `edge` attaches as the edge security policy. */
  slot: z.enum(['backend', 'edge']).default('backend'),
  attach: z.boolean(),
});
export type AttachArmor = z.infer<typeof AttachArmorSchema>;

export interface ReorderStep {
  from: number;
  to: number;
  /** A move to a free priority that makes room for another rule. */
  temporary: boolean;
}

/** First free priority above the usual range, for temporary moves. */
const TEMP_BASE = 1_000_000_000;

/**
 * The priority changes that put the rules in `order` at 10, 20, 30… (SPEC-0007 D-09). Priorities
 * are unique, so a rule only moves to a free priority, and a cycle goes through a temporary one.
 * Each step copies the rule to `to` and then removes it from `from`.
 */
export function reorderPlan(current: readonly number[], order: readonly number[]): ReorderStep[] {
  const known = new Set(current);
  const movable = current.filter((p) => p !== ARMOR_DEFAULT_PRIORITY);
  if (order.length !== new Set(order).size || order.some((p) => !known.has(p)) || order.length !== movable.length) {
    throw new Error('The new order must list every rule but the default one, once.');
  }
  const occupied = new Set(current);
  const moves = order.map((p, i) => ({ from: p, to: (i + 1) * 10 })).filter((m) => m.from !== m.to);
  const steps: ReorderStep[] = [];
  let temp = TEMP_BASE;
  while (moves.length > 0) {
    let progressed = false;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i] as { from: number; to: number };
      if (!occupied.has(m.to)) {
        steps.push({ from: m.from, to: m.to, temporary: false });
        occupied.delete(m.from);
        occupied.add(m.to);
        moves.splice(i, 1);
        i--;
        progressed = true;
      }
    }
    if (!progressed) {
      const m = moves[0] as { from: number; to: number };
      while (occupied.has(temp)) temp++;
      steps.push({ from: m.from, to: temp, temporary: true });
      occupied.delete(m.from);
      occupied.add(temp);
      m.from = temp;
    }
  }
  return steps;
}
