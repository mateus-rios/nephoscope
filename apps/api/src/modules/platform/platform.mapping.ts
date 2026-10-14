import {
  type BudgetView,
  describeEffective,
  IMPORTANT_CONSTRAINTS,
  type InsightView,
  type Money,
  type OrgPolicyRow,
  type QuotaPreferenceView,
  type QuotaRow,
  type RecommendationView,
} from '@nephoscope/contracts';

// biome-ignore lint/suspicious/noExplicitAny: REST resources are read field by field.
type Any = any;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** A google.type.Money as a decimal string. */
export function money(m: Any): Money | null {
  if (!m || (m.units === undefined && m.nanos === undefined)) return null;
  const units = BigInt(String(m.units ?? '0'));
  const nanos = Number(m.nanos ?? 0);
  const negative = units < 0n || nanos < 0;
  const absUnits = units < 0n ? -units : units;
  const cents = Math.round(Math.abs(nanos) / 1e7);
  const whole = absUnits + BigInt(Math.floor(cents / 100));
  const amount = `${negative ? '-' : ''}${whole}.${String(cents % 100).padStart(2, '0')}`;
  return { currency: String(m.currencyCode ?? ''), amount };
}

export function mapBudget(b: Any, projectNumber: string | null): BudgetView {
  const projects = ((b?.budgetFilter?.projects ?? []) as Any[]).map(String);
  const specified = b?.amount?.specifiedAmount;
  return {
    name: String(b?.name ?? ''),
    displayName: String(b?.displayName ?? b?.name ?? ''),
    amount: specified ? money(specified) : null,
    lastPeriod: !!b?.amount?.lastPeriodAmount,
    thresholds: ((b?.thresholdRules ?? []) as Any[]).map((t) => ({
      percent: Math.round(Number(t?.thresholdPercent ?? 0) * 100),
      basis: String(t?.spendBasis ?? 'CURRENT_SPEND'),
    })),
    calendarPeriod: str(b?.budgetFilter?.calendarPeriod),
    coversProject: projects.length === 0 || (projectNumber !== null && projects.includes(`projects/${projectNumber}`)),
  };
}

/** One row per quota and dimension set, with the limit Cloud Quotas reports (D-03). */
export function quotaRows(info: Any): Omit<QuotaRow, 'usage' | 'percent'>[] {
  const rate = info?.refreshInterval ? `per ${String(info.refreshInterval).toLowerCase()}` : null;
  const dims = ((info?.dimensionsInfos ?? []) as Any[]).length ? (info.dimensionsInfos as Any[]) : [{ dimensions: {}, details: {} }];
  return dims.map((d) => {
    const entries = Object.entries((d?.dimensions ?? {}) as Record<string, string>);
    const location = String(d?.dimensions?.region ?? d?.dimensions?.zone ?? 'global');
    return {
      quotaId: String(info?.quotaId ?? ''),
      displayName: String(info?.quotaDisplayName ?? info?.metricDisplayName ?? info?.quotaId ?? ''),
      metric: String(info?.metric ?? ''),
      unit: String(info?.metricUnit ?? ''),
      rate,
      dimensions: entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(', ') : 'global',
      location,
      limit: d?.details?.value !== undefined ? String(d.details.value) : null,
      increaseEligible: !!info?.quotaIncreaseEligibility?.isEligible,
    };
  });
}

/** Adds usage from Cloud Monitoring where it reports it (D-03): latest value per metric and location. */
export function withUsage(rows: Omit<QuotaRow, 'usage' | 'percent'>[], series: Any[]): QuotaRow[] {
  const usage = new Map<string, number>();
  for (const ts of series) {
    const metric = String(ts?.metric?.labels?.quota_metric ?? '');
    const location = String(ts?.resource?.labels?.location ?? 'global');
    const point = ts?.points?.[0]?.value;
    const v = Number(point?.int64Value ?? point?.doubleValue ?? Number.NaN);
    if (metric && Number.isFinite(v)) usage.set(`${metric}|${location}`, Math.max(v, usage.get(`${metric}|${location}`) ?? 0));
  }
  return rows.map((r) => {
    const u = r.rate ? undefined : usage.get(`${r.metric}|${r.location}`);
    const limit = r.limit === null ? Number.NaN : Number(r.limit);
    const percent = u !== undefined && limit > 0 ? Math.round((u / limit) * 1000) / 10 : null;
    return { ...r, usage: u ?? null, percent };
  });
}

export function mapPreference(p: Any): QuotaPreferenceView {
  return {
    name: String(p?.name ?? ''),
    service: String(p?.service ?? ''),
    quotaId: String(p?.quotaId ?? ''),
    dimensions:
      Object.entries((p?.dimensions ?? {}) as Record<string, string>)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') || 'global',
    preferred: p?.quotaConfig?.preferredValue !== undefined ? String(p.quotaConfig.preferredValue) : null,
    granted: p?.quotaConfig?.grantedValue !== undefined ? String(p.quotaConfig.grantedValue) : null,
    state: str(p?.quotaConfig?.stateDetail),
    createTime: str(p?.createTime),
  };
}

function targetsOf(r: Any): string[] {
  const fromOps = ((r?.content?.operationGroups ?? []) as Any[]).flatMap((g) =>
    ((g?.operations ?? []) as Any[]).map((o) => String(o?.resource ?? '')),
  );
  const fromInsight = ((r?.targetResources ?? []) as Any[]).map(String);
  return [...new Set([...fromInsight, ...fromOps].filter(Boolean))].map((t) => t.replace(/^\/\/[^/]+\//, ''));
}

export function mapRecommendation(r: Any, recommender: string, location: string): RecommendationView {
  const cost = r?.primaryImpact?.costProjection;
  return {
    name: String(r?.name ?? ''),
    recommender,
    location,
    description: String(r?.description ?? ''),
    priority: str(r?.priority),
    state: String(r?.stateInfo?.state ?? 'ACTIVE'),
    category: str(r?.primaryImpact?.category),
    cost: cost?.cost ? money(cost.cost) : null,
    costPeriod: str(cost?.duration),
    targets: targetsOf(r),
    lastRefreshTime: str(r?.lastRefreshTime),
    content: r?.content ?? null,
  };
}

export function mapInsight(i: Any, insightType: string, location: string): InsightView {
  return {
    name: String(i?.name ?? ''),
    insightType,
    location,
    description: String(i?.description ?? ''),
    category: str(i?.category),
    severity: str(i?.severity),
    state: String(i?.stateInfo?.state ?? 'ACTIVE'),
    targets: targetsOf(i),
    lastRefreshTime: str(i?.lastRefreshTime),
    content: i?.content ?? null,
  };
}

export function orgPolicyRow(c: Any, effectiveSpec: Any, setOnProject: boolean): OrgPolicyRow {
  const constraint = String(c?.name ?? '').replace(/^projects\/[^/]+\//, '');
  const id = constraint.replace(/^constraints\//, '');
  const type = c?.booleanConstraint ? 'boolean' : 'list';
  const { text, restricts } = describeEffective(type, effectiveSpec?.rules);
  return {
    constraint,
    id,
    displayName: String(c?.displayName ?? id),
    description: String(c?.description ?? ''),
    type,
    important: IMPORTANT_CONSTRAINTS.includes(id),
    setOnProject,
    effective: text,
    restricts,
    rules: effectiveSpec?.rules ?? [],
  };
}

/** Important constraints first (D-05, T-08), then the ones that restrict, then by name. */
export function sortPolicies(rows: OrgPolicyRow[]): OrgPolicyRow[] {
  const rank = (r: OrgPolicyRow) => {
    const i = IMPORTANT_CONSTRAINTS.indexOf(r.id);
    return i >= 0 ? i : 1000 + (r.restricts ? 0 : 1);
  };
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName));
}
