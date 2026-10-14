import { z } from 'zod';

/** Cloud Monitoring: Metrics Explorer, dashboards, alerts, uptime checks, channels (SPEC-0005 D-08 to D-10). */

export interface MetricDescriptorView {
  type: string;
  displayName: string;
  description: string;
  metricKind: 'GAUGE' | 'DELTA' | 'CUMULATIVE' | 'METRIC_KIND_UNSPECIFIED';
  valueType: string;
  unit: string;
  labels: { key: string; description: string }[];
  resourceTypes: string[];
  launchStage: string | null;
}

/** One line of a chart: its labels and `[epoch ms, value]` points. */
export interface SeriesView {
  labels: Record<string, string>;
  points: [number, number | null][];
}

export interface SeriesResult {
  series: SeriesView[];
  /** Why the query returned nothing useful, when it can be said. */
  note?: string;
  /** Step between points, in seconds. */
  stepSeconds?: number;
}

const range = {
  since: z.string().datetime({ offset: true }),
  until: z.string().datetime({ offset: true }).optional(),
};

export const SeriesQuerySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('promql'), query: z.string().min(1).max(20_000), ...range }),
  z.object({ kind: z.literal('mql'), query: z.string().min(1).max(20_000), ...range }),
  z.object({
    kind: z.literal('filter'),
    filter: z.string().min(1).max(20_000),
    aggregation: z
      .object({
        alignmentPeriod: z.string().max(32).optional(),
        perSeriesAligner: z.string().max(64).optional(),
        crossSeriesReducer: z.string().max(64).optional(),
        groupByFields: z.array(z.string().max(256)).max(20).optional(),
      })
      .optional(),
    ...range,
  }),
]);
export type SeriesQuery = z.infer<typeof SeriesQuerySchema>;

export const MetricSearchSchema = z.object({ q: z.string().max(200).default('') });

/**
 * The PromQL name of a Cloud Monitoring metric type (SPEC-0005 D-08): the domain's dots and the
 * path's slashes become underscores, joined by a colon. Prometheus metrics keep their own name.
 */
export function promMetricName(type: string): string {
  const prom = /^prometheus\.googleapis\.com\/(.+)\/[^/]+$/.exec(type);
  if (prom) return prom[1] as string;
  const slash = type.indexOf('/');
  if (slash < 0) return type.replace(/[^A-Za-z0-9_:]/g, '_');
  const domain = type.slice(0, slash).replace(/\./g, '_');
  const path = type.slice(slash + 1).replace(/[/.]/g, '_');
  return `${domain}:${path}`;
}

export const promAggregations = ['sum', 'avg', 'max', 'min', 'count', 'p50', 'p95', 'p99'] as const;
export type PromAggregation = (typeof promAggregations)[number];

export interface PromBuild {
  metricType: string;
  metricKind: MetricDescriptorView['metricKind'];
  valueType: string;
  resourceType?: string;
  groupBy: string[];
  aggregation: PromAggregation;
  /** Rate window for counters, such as `5m`. */
  window: string;
  /** Exact label matches. */
  filters?: Record<string, string>;
}

const quote = (v: string) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

/** PromQL for a picked metric (SPEC-0005 D-08): rate for counters, quantiles for distributions. */
export function buildPromQL(b: PromBuild): string {
  const name = promMetricName(b.metricType);
  const matchers = [
    ...(b.resourceType ? [`monitored_resource=${quote(b.resourceType)}`] : []),
    ...Object.entries(b.filters ?? {}).map(([k, v]) => `${k}=${quote(v)}`),
  ];
  const selector = (suffix = '') => `${name}${suffix}${matchers.length ? `{${matchers.join(',')}}` : ''}`;
  const by = (extra: string[] = []) => {
    const keys = [...extra, ...b.groupBy];
    return keys.length ? ` by (${keys.join(', ')})` : '';
  };
  const counter = b.metricKind === 'DELTA' || b.metricKind === 'CUMULATIVE';
  if (b.valueType === 'DISTRIBUTION') {
    const q = b.aggregation === 'p50' ? 0.5 : b.aggregation === 'p99' ? 0.99 : 0.95;
    if (b.aggregation.startsWith('p')) return `histogram_quantile(${q}, sum${by(['le'])} (rate(${selector('_bucket')}[${b.window}])))`;
    return `sum${by()} (rate(${selector('_sum')}[${b.window}])) / sum${by()} (rate(${selector('_count')}[${b.window}]))`;
  }
  const inner = counter ? `rate(${selector()}[${b.window}])` : selector();
  const op = b.aggregation.startsWith('p') ? 'avg' : b.aggregation;
  return `${op}${by()} (${inner})`;
}

// ---- dashboards -------------------------------------------------------------------------------

export interface DashboardSummary {
  name: string;
  id: string;
  displayName: string;
  etag: string | null;
  layout: 'grid' | 'mosaic' | 'row' | 'column' | 'none';
  widgets: number;
  labels: Record<string, string>;
}

export const SaveDashboardSchema = z.object({
  /** The dashboard as JSON, with its etag so a concurrent edit conflicts (SPEC-0005 D-09). */
  json: z.string().min(2).max(2_000_000),
});
export type SaveDashboard = z.infer<typeof SaveDashboardSchema>;

// ---- alert policies -----------------------------------------------------------------------------

export const alertComparisons = ['COMPARISON_GT', 'COMPARISON_GE', 'COMPARISON_LT', 'COMPARISON_LE'] as const;

export interface AlertConditionView {
  name: string;
  displayName: string;
  kind: 'threshold' | 'absent' | 'promql' | 'mql' | 'log' | 'other';
  filter: string | null;
  query: string | null;
  comparison: string | null;
  threshold: number | null;
  duration: string | null;
  aggregations: { alignmentPeriod?: string; perSeriesAligner?: string; crossSeriesReducer?: string; groupByFields?: string[] }[];
}

export interface AlertPolicyView {
  name: string;
  id: string;
  displayName: string;
  enabled: boolean;
  combiner: string;
  severity: string | null;
  conditions: AlertConditionView[];
  channels: string[];
  documentation: string | null;
  userLabels: Record<string, string>;
  createTime: string | null;
  updateTime: string | null;
}

export const CreateAlertPolicySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('threshold'),
    displayName: z.string().min(1).max(512),
    source: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('metric'),
        metricType: z.string().min(1).max(512),
        resourceType: z.string().max(256).optional(),
        extraFilter: z.string().max(4000).optional(),
        aligner: z.string().max(64).default('ALIGN_MEAN'),
      }),
      z.object({ kind: z.literal('promql'), query: z.string().min(1).max(20_000) }),
    ]),
    comparison: z.enum(alertComparisons).default('COMPARISON_GT'),
    threshold: z.number(),
    durationSeconds: z.number().int().min(0).max(86_400).default(300),
    alignmentSeconds: z.number().int().min(60).max(86_400).default(60),
    channels: z.array(z.string().max(512)).max(16).default([]),
    documentation: z.string().max(10_000).optional(),
    severity: z.enum(['CRITICAL', 'ERROR', 'WARNING']).optional(),
  }),
  z.object({ mode: z.literal('json'), json: z.string().min(2).max(500_000) }),
]);
export type CreateAlertPolicy = z.infer<typeof CreateAlertPolicySchema>;

// ---- uptime checks --------------------------------------------------------------------------------

export interface UptimeCheckView {
  name: string;
  id: string;
  displayName: string;
  protocol: 'HTTP' | 'HTTPS' | 'TCP' | 'OTHER';
  target: string;
  path: string | null;
  port: number | null;
  periodSeconds: number | null;
  timeoutSeconds: number | null;
  regions: string[];
  /** Share of passed checks over the last hour, 0 to 1; null when there is no data. */
  passRate: number | null;
}

export const CreateUptimeCheckSchema = z.object({
  displayName: z.string().min(1).max(100),
  protocol: z.enum(['HTTP', 'HTTPS', 'TCP']),
  host: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9.-]+$/, 'A host name or IP address'),
  path: z.string().max(2048).default('/'),
  port: z.number().int().min(1).max(65_535).optional(),
  periodSeconds: z.union([z.literal(60), z.literal(300), z.literal(600), z.literal(900)]).default(60),
  timeoutSeconds: z.number().int().min(1).max(60).default(10),
});
export type CreateUptimeCheck = z.infer<typeof CreateUptimeCheckSchema>;

// ---- notification channels ---------------------------------------------------------------------------

export interface NotificationChannelView {
  name: string;
  id: string;
  type: string;
  displayName: string;
  labels: Record<string, string>;
  enabled: boolean;
  verificationStatus: string | null;
}

export interface ChannelDescriptorView {
  type: string;
  displayName: string;
  description: string;
  labels: { key: string; description: string }[];
}

export const CreateChannelSchema = z.object({
  type: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z_.]+$/),
  displayName: z.string().min(1).max(512),
  labels: z.record(z.string().max(128), z.string().max(4096)).default({}),
});
export type CreateChannel = z.infer<typeof CreateChannelSchema>;
