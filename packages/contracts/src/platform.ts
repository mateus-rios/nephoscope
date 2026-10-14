import { z } from 'zod';

/** Billing, costs, quotas, recommendations and organization policies (SPEC-0009 D-02 to D-05). */

// ---- Billing (D-02) ----------------------------------------------------------------------------

export interface Money {
  currency: string;
  /** Decimal string, such as `1234.56`. */
  amount: string;
}

export interface BudgetView {
  name: string;
  displayName: string;
  amount: Money | null;
  /** True when the budget follows last period's spend instead of a fixed amount. */
  lastPeriod: boolean;
  thresholds: { percent: number; basis: string }[];
  calendarPeriod: string | null;
  /** True when the budget covers this project (no project filter, or the project is in it). */
  coversProject: boolean;
}

export interface BillingView {
  billingEnabled: boolean;
  /** `billingAccounts/{id}`, or null when the project has none. */
  account: string | null;
  accountDisplayName: string | null;
  accountOpen: boolean | null;
  /** Why the account could not be read, when it could not. */
  accountError: string | null;
  budgets: BudgetView[] | null;
  budgetsError: string | null;
}

/** A billing export table: `project.dataset.table`. */
export const BillingExportTableSchema = z
  .string()
  .regex(/^[a-z][-a-z0-9.:]{4,62}[a-z0-9]\.[A-Za-z0-9_]{1,1024}\.[A-Za-z0-9_]{1,1024}$/, 'project.dataset.table');

export type CostQuery = 'service' | 'sku' | 'day';

/** The ready-made cost queries over the standard billing export (D-02). Identifiers are checked first. */
export function costSql(kind: CostQuery, table: string, projectId: string): string {
  if (!BillingExportTableSchema.safeParse(table).success) throw new Error('Not a billing export table.');
  if (!/^[a-z][-a-z0-9]{4,28}[a-z0-9]$/.test(projectId)) throw new Error('Not a project id.');
  const net = 'SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0))';
  const where = `WHERE project.id = '${projectId}'\n  AND usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)`;
  const from = `FROM \`${table}\``;
  switch (kind) {
    case 'service':
      return `-- Net cost by service, last 30 days\nSELECT service.description AS service, currency, ROUND(${net}, 2) AS net_cost\n${from}\n${where}\nGROUP BY service, currency\nORDER BY net_cost DESC`;
    case 'sku':
      return `-- Net cost by SKU, last 30 days, top 50\nSELECT service.description AS service, sku.description AS sku, currency, ROUND(${net}, 2) AS net_cost\n${from}\n${where}\nGROUP BY service, sku, currency\nORDER BY net_cost DESC\nLIMIT 50`;
    case 'day':
      return `-- Net cost by day, last 30 days\nSELECT DATE(usage_start_time) AS day, currency, ROUND(${net}, 2) AS net_cost\n${from}\n${where}\nGROUP BY day, currency\nORDER BY day`;
  }
}

// ---- Quotas (D-03) -----------------------------------------------------------------------------

export interface QuotaRow {
  quotaId: string;
  displayName: string;
  metric: string;
  unit: string;
  /** `per minute`, `per day`, or null for allocation quotas. */
  rate: string | null;
  /** Such as `region=us-central1`; `global` when the quota has no dimensions. */
  dimensions: string;
  location: string;
  /** The limit; `-1` is unlimited. */
  limit: string | null;
  usage: number | null;
  /** Usage as a share of the limit, 0 to 100 and over. */
  percent: number | null;
  increaseEligible: boolean;
}

export interface QuotaPreferenceView {
  name: string;
  service: string;
  quotaId: string;
  dimensions: string;
  preferred: string | null;
  granted: string | null;
  state: string | null;
  createTime: string | null;
}

export interface QuotasView {
  service: string;
  rows: QuotaRow[];
  /** Why usage could not be read from Cloud Monitoring, when it could not. */
  usageError: string | null;
}

/** Quota at or above this share of its limit is flagged (D-03). */
export const QUOTA_WARN_PERCENT = 80;

export const QuotaServiceSchema = z.string().regex(/^[a-z][a-z0-9.-]{2,100}\.googleapis\.com$/);

// ---- Recommendations (D-04) ------------------------------------------------------------------

export interface RecommendationView {
  name: string;
  recommender: string;
  location: string;
  description: string;
  priority: string | null;
  state: string;
  category: string | null;
  /** Estimated cost change per period; negative is a saving. */
  cost: Money | null;
  costPeriod: string | null;
  targets: string[];
  lastRefreshTime: string | null;
  content: unknown;
}

export interface InsightView {
  name: string;
  insightType: string;
  location: string;
  description: string;
  category: string | null;
  severity: string | null;
  state: string;
  targets: string[];
  lastRefreshTime: string | null;
  content: unknown;
}

export interface RecommendationsView {
  recommendations: RecommendationView[];
  insights: InsightView[];
  /** Recommender and location pairs that could not be read. */
  unreachable: string[];
}

// ---- Organization policies (D-05) ------------------------------------------------------------

/** Constraints that most often explain an error elsewhere; shown first (D-05). */
export const IMPORTANT_CONSTRAINTS: readonly string[] = [
  'iam.allowedPolicyMemberDomains',
  'iam.managed.allowedPolicyMembers',
  'gcp.resourceLocations',
  'storage.publicAccessPrevention',
  'iam.disableServiceAccountKeyCreation',
  'iam.managed.disableServiceAccountKeyCreation',
  'iam.disableServiceAccountKeyUpload',
  'compute.vmExternalIpAccess',
  'run.allowedIngress',
  'run.allowedVPCEgress',
  'cloudfunctions.allowedIngressSettings',
  'sql.restrictPublicIp',
  'compute.requireOsLogin',
  'storage.uniformBucketLevelAccess',
  'iam.automaticIamGrantsForDefaultServiceAccounts',
  'gcp.restrictServiceUsage',
];

export interface OrgPolicyRow {
  /** `constraints/iam.allowedPolicyMemberDomains`. */
  constraint: string;
  id: string;
  displayName: string;
  description: string;
  type: 'boolean' | 'list';
  important: boolean;
  /** Set on the project itself, not only inherited. */
  setOnProject: boolean;
  /** The effective policy in a line: `Enforced`, `Allowed: a, b`, `Default`... */
  effective: string;
  /** False for `Default`, `Not enforced` and `Allow all`. */
  restricts: boolean;
  rules: unknown;
}

export interface OrgPoliciesView {
  policies: OrgPolicyRow[];
  /** Constraints whose effective policy could not be read. */
  unreadable: string[];
}

/** The effective policy of a constraint as one line (D-05). */
export function describeEffective(type: 'boolean' | 'list', rules: unknown): { text: string; restricts: boolean } {
  const list = Array.isArray(rules) ? (rules as Record<string, unknown>[]) : [];
  if (list.length === 0) return { text: 'Default', restricts: false };
  const parts: string[] = [];
  let restricts = false;
  for (const r of list) {
    const cond = (r.condition as { title?: string; expression?: string } | undefined)?.title ?? (r.condition ? 'conditional' : null);
    const suffix = cond ? ` (${cond})` : '';
    if (type === 'boolean' || 'enforce' in r) {
      const on = r.enforce === true;
      restricts ||= on;
      parts.push(`${on ? 'Enforced' : 'Not enforced'}${suffix}`);
    } else if (r.allowAll) parts.push(`Allow all${suffix}`);
    else if (r.denyAll) {
      restricts = true;
      parts.push(`Deny all${suffix}`);
    } else if (r.values) {
      const v = r.values as { allowedValues?: string[]; deniedValues?: string[] };
      if (v.allowedValues?.length) parts.push(`Allowed: ${v.allowedValues.join(', ')}${suffix}`);
      if (v.deniedValues?.length) parts.push(`Denied: ${v.deniedValues.join(', ')}${suffix}`);
      restricts = true;
    }
  }
  return { text: parts.join('; ') || 'Default', restricts };
}
