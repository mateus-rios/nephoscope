import { z } from 'zod';

/** Logs Explorer and Log Router (SPEC-0005 D-04, D-05). */

export interface LogsCatalog {
  /** Log ids of the project, decoded (`cloudaudit.googleapis.com/activity`). */
  logNames: string[];
  /** Monitored resource types Logging knows. */
  resourceTypes: string[];
}

export const LogDownloadQuerySchema = z.object({
  filter: z.string().max(20_000).default(''),
  since: z.string().datetime({ offset: true }),
  until: z.string().datetime({ offset: true }).optional(),
  format: z.enum(['json', 'csv']).default('json'),
  limit: z.coerce.number().int().min(1).max(10_000).default(10_000),
});
export type LogDownloadQuery = z.infer<typeof LogDownloadQuerySchema>;

// ---- sinks ------------------------------------------------------------------------------------

export const sinkDestinationKinds = ['storage', 'bigquery', 'pubsub', 'logbucket', 'project', 'other'] as const;
export type SinkDestinationKind = (typeof sinkDestinationKinds)[number];

export interface LogExclusionView {
  name: string;
  description: string | null;
  filter: string;
  disabled: boolean;
}

export interface LogSink {
  name: string;
  destination: string;
  destinationKind: SinkDestinationKind;
  filter: string;
  description: string | null;
  disabled: boolean;
  writerIdentity: string | null;
  /** The role the writer identity needs on the destination (SPEC-0005 D-05). */
  requiredRole: string | null;
  exclusions: LogExclusionView[];
  /** `_Required` cannot be changed; `_Default` cannot be deleted. */
  builtIn: '_Required' | '_Default' | null;
  createTime: string | null;
  updateTime: string | null;
}

const sinkId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/, 'Letters, digits, underscores, periods and hyphens');
export const SinkIdSchema = sinkId;

const ExclusionInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_.-]+$/),
  description: z.string().max(8000).optional(),
  filter: z.string().min(1).max(20_000),
  disabled: z.boolean().default(false),
});

export const SaveSinkSchema = z.object({
  name: sinkId,
  /** `storage.googleapis.com/…`, `bigquery.googleapis.com/…`, `pubsub.googleapis.com/…` or `logging.googleapis.com/…`. */
  destination: z
    .string()
    .min(1)
    .max(1000)
    .regex(/^(storage|bigquery|pubsub|logging)\.googleapis\.com\/\S+$/, 'A destination such as storage.googleapis.com/my-bucket'),
  filter: z.string().max(20_000).default(''),
  description: z.string().max(8000).optional(),
  disabled: z.boolean().default(false),
  exclusions: z.array(ExclusionInputSchema).max(50).default([]),
});
export type SaveSink = z.infer<typeof SaveSinkSchema>;

// ---- buckets and views -----------------------------------------------------------------------

export interface LogBucket {
  name: string;
  id: string;
  location: string;
  description: string | null;
  retentionDays: number | null;
  locked: boolean;
  analyticsEnabled: boolean;
  lifecycleState: string;
  builtIn: boolean;
  createTime: string | null;
  updateTime: string | null;
}

export const CreateLogBucketSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/),
  location: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(8000).optional(),
  retentionDays: z.number().int().min(1).max(3650),
  analyticsEnabled: z.boolean().default(false),
  locked: z.boolean().default(false),
});
export type CreateLogBucket = z.infer<typeof CreateLogBucketSchema>;

export const UpdateLogBucketSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650).optional(),
  description: z.string().max(8000).optional(),
  analyticsEnabled: z.boolean().optional(),
});
export type UpdateLogBucket = z.infer<typeof UpdateLogBucketSchema>;

export interface LogView {
  name: string;
  id: string;
  description: string | null;
  filter: string;
  createTime: string | null;
}

export const CreateLogViewSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/),
  description: z.string().max(8000).optional(),
  filter: z.string().max(20_000).default(''),
});
export type CreateLogView = z.infer<typeof CreateLogViewSchema>;

/** A BigQuery dataset linked to a log bucket, which is how SQL reaches logs (SPEC-0005 D-06). */
export interface LogBucketLink {
  name: string;
  datasetId: string | null;
  lifecycleState: string;
}

// ---- log-based metrics -----------------------------------------------------------------------

export interface LogMetric {
  name: string;
  description: string | null;
  filter: string;
  kind: 'counter' | 'distribution';
  unit: string | null;
  labelExtractors: Record<string, string>;
  valueExtractor: string | null;
  disabled: boolean;
  /** The Cloud Monitoring metric type: `logging.googleapis.com/user/{name}`. */
  metricType: string;
  createTime: string | null;
  updateTime: string | null;
}

export const SaveLogMetricSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_.\-/]+$/, 'Letters, digits and _ . - /'),
  description: z.string().max(8000).optional(),
  filter: z.string().min(1).max(20_000),
  kind: z.enum(['counter', 'distribution']),
  unit: z.string().max(64).optional(),
  labelExtractors: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,99}$/), z.string().min(1).max(2000)).default({}),
  valueExtractor: z.string().max(2000).optional(),
  /** Distribution buckets: exponential growth from a scale (Google's default family). */
  buckets: z
    .object({ count: z.number().int().min(1).max(200), growthFactor: z.number().gt(1).max(100), scale: z.number().gt(0) })
    .optional(),
  disabled: z.boolean().default(false),
});
export type SaveLogMetric = z.infer<typeof SaveLogMetricSchema>;

export const SaveExclusionSchema = ExclusionInputSchema;
export type SaveExclusion = z.infer<typeof SaveExclusionSchema>;

// ---- saved queries (SPEC-0001 CA-53) ------------------------------------------------------------

export const savedKinds = ['logs', 'promql', 'bigquery', 'chart'] as const;
export type SavedKind = (typeof savedKinds)[number];

export interface SavedItem {
  id: string;
  name: string;
  value: string;
  projectId: string | null;
  createdAt: string;
}

export const SaveItemSchema = z.object({
  name: z.string().min(1).max(200),
  value: z.string().min(1).max(100_000),
  projectId: z.string().max(100).nullable().default(null),
});
export type SaveItem = z.infer<typeof SaveItemSchema>;
