import { z } from 'zod';

/** BigQuery explorer, editor, results and jobs (SPEC-0008 D-01 to D-04). */

/** Default ceiling of bytes billed per query (D-02): 10 GiB. */
export const BQ_DEFAULT_MAX_BYTES = 10 * 1024 ** 3;
/** Streaming download limit (D-03); beyond it, an export job. */
export const BQ_DOWNLOAD_MAX_ROWS = 100_000;

const PROJECT = /^[a-z][-a-z0-9.:]{4,62}[a-z0-9]$/;
const DATASET = /^[A-Za-z0-9_]{1,1024}$/;
const TABLE = /^[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}\p{Zs}$*]{1,1024}$/u;

export const BqProjectSchema = z.string().regex(PROJECT);
export const BqDatasetIdSchema = z.string().regex(DATASET);
export const BqTableIdSchema = z.string().max(1024).regex(TABLE);
export const BqLocationSchema = z.string().regex(/^[A-Za-z0-9-]{2,40}$/);
export const BqJobIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/);

export interface BqDatasetSummary {
  projectId: string;
  datasetId: string;
  location: string;
  labels: Record<string, string>;
}

export interface BqDatasetView extends BqDatasetSummary {
  description: string | null;
  defaultTableExpirationMs: string | null;
  createTime: string | null;
  modifiedTime: string | null;
  etag: string | null;
}

export type BqTableType = 'TABLE' | 'VIEW' | 'MATERIALIZED_VIEW' | 'EXTERNAL' | 'SNAPSHOT' | 'CLONE' | string;

export interface BqTableSummary {
  projectId: string;
  datasetId: string;
  tableId: string;
  type: BqTableType;
  createTime: string | null;
  expirationTime: string | null;
}

export interface BqField {
  name: string;
  /** Standard SQL type names: STRING, INT64, NUMERIC, TIMESTAMP, STRUCT, JSON... */
  type: string;
  mode: 'NULLABLE' | 'REQUIRED' | 'REPEATED';
  description: string | null;
  policyTags: string[];
  fields: BqField[];
}

export interface BqTableView extends BqTableSummary {
  location: string | null;
  description: string | null;
  labels: Record<string, string>;
  schema: BqField[];
  numRows: string | null;
  logicalBytes: string | null;
  physicalBytes: string | null;
  longTermBytes: string | null;
  partitioning: string | null;
  clustering: string[];
  modifiedTime: string | null;
  viewQuery: string | null;
  materializedQuery: string | null;
  externalUris: string[];
  etag: string | null;
}

export interface BqRoutineSummary {
  routineId: string;
  type: string;
  language: string | null;
}

export interface BqModelSummary {
  modelId: string;
  type: string | null;
}

/**
 * A result value (D-03): scalars stay strings so 64-bit integers and NUMERIC are exact; TIMESTAMP
 * is an ISO string with microseconds; BYTES base64; GEOGRAPHY WKT; JSON parsed; STRUCT an object;
 * ARRAY an array; NULL null.
 */
export type BqValue = string | null | BqValue[] | { [key: string]: BqValue };

/** Microseconds since the epoch, as BigQuery returns TIMESTAMP with `useInt64Timestamp`, as ISO. */
export function bqTimestamp(micros: string): string {
  const big = BigInt(micros);
  const ms = big / 1000n;
  const rest = Number(((big % 1000000n) + 1000000n) % 1000000n);
  const iso = new Date(Number(ms - (big < 0n && big % 1000n !== 0n ? 1n : 0n))).toISOString();
  return `${iso.slice(0, 19)}.${String(rest).padStart(6, '0')}Z`;
}

/** One `{f: [{v}]}` row of the REST API as typed values, by schema. */
export function bqRow(fields: readonly BqField[], row: unknown): BqValue[] {
  const cells = ((row as { f?: { v?: unknown }[] } | null)?.f ?? []) as { v?: unknown }[];
  return fields.map((field, i) => bqCell(field, cells[i]?.v));
}

function bqScalar(field: BqField, v: unknown): BqValue {
  if (v === null || v === undefined) return null;
  const s = String(v);
  switch (field.type) {
    case 'TIMESTAMP':
      return /^-?\d+$/.test(s) ? bqTimestamp(s) : s;
    case 'JSON':
      try {
        return JSON.parse(s) as BqValue;
      } catch {
        return s;
      }
    default:
      return s;
  }
}

function bqCell(field: BqField, v: unknown): BqValue {
  if (v === null || v === undefined) return null;
  if (field.mode === 'REPEATED') {
    const items = Array.isArray(v) ? (v as { v?: unknown }[]) : [];
    return items.map((item) => bqCell({ ...field, mode: 'NULLABLE' }, item?.v));
  }
  if (field.type === 'STRUCT' || field.type === 'RECORD') {
    const values = bqRow(field.fields, v);
    return Object.fromEntries(field.fields.map((f, i) => [f.name, values[i] ?? null]));
  }
  return bqScalar(field, v);
}

/** Legacy type names of the REST schema as standard SQL names. */
export function bqTypeName(t: string): string {
  const legacy: Record<string, string> = { INTEGER: 'INT64', FLOAT: 'FLOAT64', BOOLEAN: 'BOOL', RECORD: 'STRUCT' };
  return legacy[t] ?? t;
}

// ---- Editor and jobs ---------------------------------------------------------------------------

export const BqParamSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
  type: z.enum(['STRING', 'INT64', 'FLOAT64', 'NUMERIC', 'BOOL', 'DATE', 'TIMESTAMP', 'DATETIME']),
  value: z.string().max(10_000),
});
export type BqParam = z.infer<typeof BqParamSchema>;

export const BqDryRunSchema = z.object({
  query: z.string().min(1).max(1_000_000),
  params: z.array(BqParamSchema).max(100).default([]),
  location: BqLocationSchema.optional(),
});
export type BqDryRun = z.infer<typeof BqDryRunSchema>;

export interface BqDryRunResult {
  ok: boolean;
  totalBytesProcessed: string | null;
  statementType: string | null;
  referencedTables: string[];
  /** Syntax and semantic errors, with the position BigQuery names (`[line:column]`). */
  error: { message: string; line: number | null; column: number | null } | null;
}

export const BqRunSchema = BqDryRunSchema.extend({
  /** The ceiling for this run, in bytes, as a decimal string (D-02). */
  maximumBytesBilled: z.string().regex(/^\d{1,20}$/),
  destination: z
    .object({
      datasetId: BqDatasetIdSchema,
      tableId: BqTableIdSchema,
      writeDisposition: z.enum(['WRITE_EMPTY', 'WRITE_TRUNCATE', 'WRITE_APPEND']).default('WRITE_EMPTY'),
    })
    .optional(),
});
export type BqRun = z.infer<typeof BqRunSchema>;

export interface BqJobRef {
  projectId: string;
  jobId: string;
  location: string;
}

export interface BqJobSummary extends BqJobRef {
  type: string;
  state: string;
  user: string | null;
  createTime: string | null;
  startTime: string | null;
  endTime: string | null;
  /** The SQL of a query job, cut at 500 characters in lists. */
  query: string | null;
  totalBytesProcessed: string | null;
  totalBytesBilled: string | null;
  cacheHit: boolean | null;
  error: string | null;
}

export interface BqStage {
  name: string;
  status: string | null;
  recordsRead: string | null;
  recordsWritten: string | null;
  slotMs: string | null;
}

export interface BqJobDetail extends BqJobSummary {
  totalSlotMs: string | null;
  statementType: string | null;
  destination: { projectId: string; datasetId: string; tableId: string } | null;
  stages: BqStage[];
  errors: string[];
}

export interface BqResultsPage {
  schema: BqField[];
  rows: BqValue[][];
  totalRows: string | null;
  pageToken: string | null;
  jobComplete: boolean;
}

export const BqJobListQuerySchema = z.object({
  state: z.enum(['done', 'pending', 'running']).optional(),
  /** Only jobs of this principal (filtered after listing every user's jobs). */
  principal: z.string().max(320).optional(),
  pageToken: z.string().max(4096).optional(),
});
export type BqJobListQuery = z.infer<typeof BqJobListQuerySchema>;

export const BqExportSchema = z.object({
  uri: z.string().regex(/^gs:\/\/[a-z0-9._-]+\/.+$/, 'A gs:// path; use * to split large results, such as gs://b/out-*.csv'),
  format: z.enum(['CSV', 'NEWLINE_DELIMITED_JSON', 'AVRO', 'PARQUET']).default('CSV'),
});
export type BqExport = z.infer<typeof BqExportSchema>;

// ---- Explorer management (D-01, L2) ------------------------------------------------------------

const labelsSchema = z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/), z.string().regex(/^[a-z0-9_-]{0,63}$/));
/** Label updates: a null value removes the label (BigQuery PATCH semantics). */
const labelUpdatesSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/),
  z
    .string()
    .regex(/^[a-z0-9_-]{0,63}$/)
    .nullable(),
);

export const CreateBqDatasetSchema = z.object({
  datasetId: BqDatasetIdSchema,
  location: BqLocationSchema.default('US'),
  description: z.string().max(16_384).default(''),
  defaultTableExpirationDays: z.number().int().min(0).max(36_500).optional(),
  labels: labelsSchema.default({}),
});
export type CreateBqDataset = z.infer<typeof CreateBqDatasetSchema>;

export const UpdateBqDatasetSchema = z.object({
  description: z.string().max(16_384).optional(),
  defaultTableExpirationDays: z.number().int().min(0).max(36_500).nullable().optional(),
  labels: labelUpdatesSchema.optional(),
  etag: z.string().max(256).optional(),
});
export type UpdateBqDataset = z.infer<typeof UpdateBqDatasetSchema>;

export const DeleteBqDatasetSchema = z.object({
  confirm: z.string().min(1),
  /** A dataset with tables also needs the number of tables typed (D-01). */
  tables: z.number().int().min(0).optional(),
});
export type DeleteBqDataset = z.infer<typeof DeleteBqDatasetSchema>;

export const CreateBqTableSchema = z.object({
  tableId: BqTableIdSchema,
  /** The schema as JSON: an array of fields, as `bq show --schema` prints it. */
  schemaJson: z.string().min(2).max(1_000_000),
  description: z.string().max(16_384).default(''),
  expirationDays: z.number().int().min(1).max(36_500).optional(),
  labels: labelsSchema.default({}),
});
export type CreateBqTable = z.infer<typeof CreateBqTableSchema>;

export const UpdateBqTableSchema = z.object({
  description: z.string().max(16_384).optional(),
  /** Milliseconds since the epoch, or null to remove the expiration. */
  expirationTime: z
    .string()
    .regex(/^\d{1,16}$/)
    .nullable()
    .optional(),
  labels: labelUpdatesSchema.optional(),
  /** New SQL of a view. */
  viewQuery: z.string().min(1).max(1_000_000).optional(),
  etag: z.string().max(256).optional(),
});
export type UpdateBqTable = z.infer<typeof UpdateBqTableSchema>;

export const CopyBqTableSchema = z.object({
  projectId: BqProjectSchema.optional(),
  datasetId: BqDatasetIdSchema,
  tableId: BqTableIdSchema,
  writeDisposition: z.enum(['WRITE_EMPTY', 'WRITE_TRUNCATE', 'WRITE_APPEND']).default('WRITE_EMPTY'),
});
export type CopyBqTable = z.infer<typeof CopyBqTableSchema>;

export const BqPreviewQuerySchema = z.object({
  pageToken: z.string().max(4096).optional(),
  maxResults: z.coerce.number().int().min(1).max(1000).default(100),
});

/** Bytes as BigQuery bills them, for the Run button: `1.23 GiB`. */
export function formatBqBytes(bytes: string | number | null): string {
  if (bytes === null) return '';
  let n = Number(bytes);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${u === 0 ? n : n.toFixed(2)} ${units[u]}`;
}

/** The `[line:column]` BigQuery puts at the end of a query error. */
export function bqErrorPosition(message: string): { line: number | null; column: number | null } {
  const m = /\[(\d+):(\d+)\]\s*$/.exec(message);
  return m ? { line: Number(m[1]), column: Number(m[2]) } : { line: null, column: null };
}

/** The label changes that turn `before` into `after`: new values, and null for removed keys. */
export function bqLabelChanges(before: Record<string, string>, after: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = { ...after };
  for (const k of Object.keys(before)) if (!(k in after)) out[k] = null;
  return out;
}
