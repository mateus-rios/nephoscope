import { z } from 'zod';

/** Shared Logs panel, live tail and Metrics tab (SPEC-0005 D-01 to D-03, D-07). */

export const logSeverities = ['DEFAULT', 'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'] as const;
export const LogSeveritySchema = z.enum(logSeverities);
export type LogSeverity = z.infer<typeof LogSeveritySchema>;

export const LogHttpSchema = z.object({
  method: z.string().nullable(),
  url: z.string().nullable(),
  status: z.number().int().nullable(),
  latencyMs: z.number().nullable(),
  responseSize: z.string().nullable(),
  userAgent: z.string().nullable(),
  remoteIp: z.string().nullable(),
});
export type LogHttp = z.infer<typeof LogHttpSchema>;

export const LogEntrySchema = z.object({
  /** insertId, unique within a log together with the timestamp. */
  id: z.string(),
  timestamp: z.string().nullable(),
  severity: LogSeveritySchema,
  logName: z.string(),
  resource: z.object({ type: z.string(), labels: z.record(z.string(), z.string()) }),
  /** Text shown in the row: HTTP summary, textPayload, or jsonPayload.message (SPEC-0005 D-01). */
  summary: z.string(),
  http: LogHttpSchema.nullable(),
  trace: z.string().nullable(),
  /** The entry in the REST JSON shape, for the expandable tree. Always rendered as text. */
  raw: z.unknown(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const LogQuerySchema = z.object({
  /** The resource's base filter (SPEC-0003 CA-30). */
  filter: z.string().min(1).max(20_000),
  /** Extra LQL typed by the user. */
  extra: z.string().max(20_000).optional(),
  minSeverity: LogSeveritySchema.optional(),
  since: z.string().datetime({ offset: true }),
  until: z.string().datetime({ offset: true }).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
  pageToken: z.string().max(4096).optional(),
});
export type LogQuery = z.infer<typeof LogQuerySchema>;

export interface LogPage {
  entries: LogEntry[];
  nextPageToken: string | null;
}

/** `logging.tail` params (SPEC-0005 D-03). */
export const LogTailParamsSchema = z.object({
  filter: z.string().min(1).max(20_000),
});
export type LogTailParams = z.infer<typeof LogTailParamsSchema>;

export type LogTailMessage =
  | { kind: 'started' }
  | { kind: 'entries'; entries: LogEntry[] }
  /** Entries Google skipped because of rate limits or the tail's own limits. */
  | { kind: 'suppressed'; count: number; reason: 'rate_limit' | 'not_consumed' | 'unknown' };

// ---- Metrics --------------------------------------------------------------------------------

export const metricPresetKinds = [
  'run-service',
  'run-job',
  'function-gen1',
  'workflow',
  'tasks-queue',
  'firestore-database',
  'pubsub-topic',
  'pubsub-subscription',
  'storage-bucket',
] as const;
export const MetricPresetKindSchema = z.enum(metricPresetKinds);
export type MetricPresetKind = z.infer<typeof MetricPresetKindSchema>;

export const MetricsQuerySchema = z.object({
  kind: MetricPresetKindSchema,
  /** Monitored resource labels that select the resource, such as `service_name` and `location`. */
  labels: z.record(z.string().max(64), z.string().max(256)),
  since: z.string().datetime({ offset: true }),
  until: z.string().datetime({ offset: true }).optional(),
});
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;

export const metricUnits = ['1/s', 'ms', 's', 'ratio', 'bytes', 'count'] as const;
export type MetricUnit = (typeof metricUnits)[number];

export interface MetricSeries {
  key: string;
  label: string;
  /** [epoch ms, value]; null marks a gap. */
  points: [number, number | null][];
}

export interface MetricChart {
  id: string;
  title: string;
  unit: MetricUnit;
  series: MetricSeries[];
}

export interface MetricsResponse {
  charts: MetricChart[];
  /** Presets left out because the metric does not exist in the project (SPEC-0005 CA-10). */
  hidden: { id: string; title: string; reason: string }[];
  alignmentSeconds: number;
  since: string;
  until: string;
}

// ---- Argument history (SPEC-0001 CA-53, SPEC-0003 D-11) ------------------------------------

export const HistoryKeySchema = z
  .string()
  .min(1)
  .max(600)
  .regex(/^[A-Za-z0-9._:/@-]+$/, 'Invalid history key');

export const AddHistorySchema = z.object({ value: z.string().min(1).max(65_536) });
export type AddHistory = z.infer<typeof AddHistorySchema>;
