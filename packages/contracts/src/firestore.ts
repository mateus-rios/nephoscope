import { z } from 'zod';
import type { WireFields, WireValue, WriteFields, WriteValue } from './firestore-value.js';
import { IndexDefinitionSchema, IndexFieldSchema } from './problem.js';

/** Firestore and Datastore mode (SPEC-0004). */

// ---- values --------------------------------------------------------------------------------------

const doubleValue = z.union([z.number(), z.enum(['NaN', 'Infinity', '-Infinity', '-0'])]);

export const WireValueSchema: z.ZodType<WireValue> = z.lazy(() =>
  z.discriminatedUnion('t', [
    z.object({ t: z.literal('null') }),
    z.object({ t: z.literal('boolean'), v: z.boolean() }),
    z.object({ t: z.literal('integer'), v: z.string().regex(/^-?\d{1,19}$/) }),
    z.object({ t: z.literal('double'), v: doubleValue }),
    z.object({ t: z.literal('timestamp'), v: z.string().max(40) }),
    z.object({ t: z.literal('string'), v: z.string() }),
    z.object({ t: z.literal('bytes'), v: z.string() }),
    z.object({ t: z.literal('reference'), v: z.string().max(6144) }),
    z.object({
      t: z.literal('geopoint'),
      v: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
    }),
    z.object({ t: z.literal('array'), v: z.array(WireValueSchema) }),
    z.object({ t: z.literal('map'), v: z.record(z.string(), WireValueSchema) }),
    z.object({ t: z.literal('vector'), v: z.array(z.number()).max(2048) }),
    z.object({ t: z.literal('special'), kind: z.string(), v: z.record(z.string(), WireValueSchema) }),
  ]),
) as z.ZodType<WireValue>;

export const WireFieldsSchema = z.record(z.string(), WireValueSchema) as z.ZodType<WireFields>;

export const WriteValueSchema: z.ZodType<WriteValue> = z.lazy(() =>
  z.union([
    WireValueSchema,
    z.object({ t: z.literal('transform'), op: z.literal('serverTimestamp') }),
    z.object({ t: z.literal('transform'), op: z.enum(['increment', 'maximum', 'minimum']), v: WireValueSchema }),
    z.object({ t: z.literal('transform'), op: z.enum(['arrayUnion', 'arrayRemove']), v: z.array(WireValueSchema) }),
    z.object({ t: z.literal('map'), v: z.record(z.string(), WriteValueSchema) }),
  ]),
) as z.ZodType<WriteValue>;

export const WriteFieldsSchema = z.record(z.string(), WriteValueSchema) as z.ZodType<WriteFields>;

// ---- databases -------------------------------------------------------------------------------------

export interface FirestoreDatabase {
  name: string;
  id: string;
  locationId: string | null;
  type: 'native' | 'datastore';
  edition: 'standard' | 'enterprise';
  concurrencyMode: string | null;
  pointInTimeRecovery: boolean;
  deleteProtection: boolean;
  createTime: string | null;
  /** Oldest time a read or clone can use, when point-in-time recovery allows it. */
  earliestVersionTime: string | null;
  versionRetentionSeconds: number | null;
  /** True for databases of the Firestore emulator, where admin features do not exist (D-18). */
  emulator: boolean;
}

export const DatabaseIdSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^(\(default\)|[a-z][a-z0-9-]{2,62})$/, 'Lowercase letters, digits and hyphens, starting with a letter, or (default)');

export const CreateDatabaseSchema = z.object({
  id: DatabaseIdSchema,
  locationId: z.string().min(2).max(40),
  type: z.enum(['native', 'datastore']),
  edition: z.enum(['standard', 'enterprise']),
  pointInTimeRecovery: z.boolean(),
  deleteProtection: z.boolean(),
});
export type CreateDatabase = z.infer<typeof CreateDatabaseSchema>;

export const UpdateDatabaseSchema = z.object({
  pointInTimeRecovery: z.boolean().optional(),
  deleteProtection: z.boolean().optional(),
});
export type UpdateDatabase = z.infer<typeof UpdateDatabaseSchema>;

export const CloneDatabaseSchema = z.object({
  targetId: DatabaseIdSchema,
  /** RFC 3339, whole minutes, within the retention window. */
  snapshotTime: z.string().max(40),
});
export type CloneDatabase = z.infer<typeof CloneDatabaseSchema>;

// ---- documents -------------------------------------------------------------------------------------

export interface FirestoreDocument {
  /** Full resource name. */
  name: string;
  /** Path from the database root, such as users/abc. */
  path: string;
  id: string;
  fields: WireFields;
  createTime: string | null;
  /** Exact API string, used as the save precondition (CA-03). */
  updateTime: string | null;
  /** A path with subcollections and no document (D-04). */
  missing: boolean;
}

export interface DocumentsPage {
  items: FirestoreDocument[];
  nextPageToken: string | null;
  readTime: string | null;
}

export interface CollectionIdsPage {
  items: string[];
  nextPageToken: string | null;
}

export const PAGE_SIZES = [25, 50, 100, 250, 500] as const;
export const DEFAULT_DOCUMENT_PAGE = 50;
/** Reads or writes above this ask for confirmation with the number (D-15). */
export const COST_CONFIRM_THRESHOLD = 1000;

const pathSegment = z.string().min(1).max(1500);
/** A path from the database root; empty for the root itself. */
export const DocumentPathSchema = z
  .string()
  .max(6144)
  .refine((p) => p === '' || p.split('/').every((s) => s.length > 0), 'Empty path segment');

export const ListDocumentsQuerySchema = z.object({
  collection: DocumentPathSchema,
  pageSize: z.coerce.number().int().min(1).max(500).default(DEFAULT_DOCUMENT_PAGE),
  pageToken: z.string().max(4096).optional(),
  showMissing: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  orderBy: z.string().max(1500).optional(),
});
export type ListDocumentsQuery = z.input<typeof ListDocumentsQuerySchema>;

export const ListCollectionsQuerySchema = z.object({
  /** Document path whose subcollections to list; empty for root collections. */
  parent: DocumentPathSchema.default(''),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  pageToken: z.string().max(4096).optional(),
});
export type ListCollectionsQuery = z.input<typeof ListCollectionsQuerySchema>;

export const CreateDocumentSchema = z.object({
  collection: DocumentPathSchema.refine((p) => p !== '' && p.split('/').length % 2 === 1, 'Not a collection path'),
  /** Omit for a generated 20-character id. */
  id: pathSegment.refine((s) => !s.includes('/') && s !== '.' && s !== '..' && !/^__.*__$/.test(s), 'Invalid document id').optional(),
  fields: WriteFieldsSchema,
});
export type CreateDocument = z.infer<typeof CreateDocumentSchema>;

export const SaveDocumentSchema = z.object({
  fields: WriteFieldsSchema,
  /** Field paths to change; null replaces the whole document. */
  mask: z.array(z.string().max(1500)).max(1000).nullable(),
  /** Exact updateTime read with the document; null overwrites without a precondition (D-05). */
  updateTime: z.string().max(40).nullable(),
});
export type SaveDocument = z.infer<typeof SaveDocumentSchema>;

export const DeleteDocumentSchema = z.object({
  confirm: z.string().min(1),
  /** Also delete every subcollection (D-05). */
  recursive: z.boolean().default(false),
});
export type DeleteDocument = z.infer<typeof DeleteDocumentSchema>;

export const DeleteCollectionSchema = z.object({
  collection: DocumentPathSchema,
  /** The document count from a count() aggregation, typed (D-05). */
  confirm: z.string().min(1),
});
export type DeleteCollection = z.infer<typeof DeleteCollectionSchema>;

// ---- queries ---------------------------------------------------------------------------------------

export const fieldOperators = ['<', '<=', '>', '>=', '==', '!=', 'array-contains', 'in', 'array-contains-any', 'not-in'] as const;
export type FieldOperator = (typeof fieldOperators)[number];
export const unaryOperators = ['is-null', 'is-nan', 'is-not-null', 'is-not-nan'] as const;
export type UnaryOperator = (typeof unaryOperators)[number];

export type QueryFilter =
  | { kind: 'field'; field: string; op: FieldOperator; value: WireValue }
  | { kind: 'unary'; field: string; op: UnaryOperator }
  | { kind: 'and'; filters: QueryFilter[] }
  | { kind: 'or'; filters: QueryFilter[] };

export const QueryFilterSchema: z.ZodType<QueryFilter> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('field'), field: z.string().min(1).max(1500), op: z.enum(fieldOperators), value: WireValueSchema }),
    z.object({ kind: z.literal('unary'), field: z.string().min(1).max(1500), op: z.enum(unaryOperators) }),
    z.object({ kind: z.literal('and'), filters: z.array(QueryFilterSchema).max(100) }),
    z.object({ kind: z.literal('or'), filters: z.array(QueryFilterSchema).max(100) }),
  ]),
) as z.ZodType<QueryFilter>;

const cursorValues = z.array(WireValueSchema).min(1).max(100);

export const QuerySpecSchema = z.object({
  source: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('collection'),
      path: DocumentPathSchema.refine((p) => p.split('/').length % 2 === 1, 'Not a collection path'),
    }),
    z.object({
      kind: z.literal('group'),
      collectionId: pathSegment,
      /** Document path to search under; empty for the whole database. */
      parent: DocumentPathSchema.default(''),
    }),
  ]),
  where: QueryFilterSchema.optional(),
  orderBy: z
    .array(z.object({ field: z.string().min(1).max(1500), direction: z.enum(['asc', 'desc']) }))
    .max(100)
    .default([]),
  /** `at` is inclusive, `after` exclusive. */
  start: z.object({ mode: z.enum(['at', 'after']), values: cursorValues }).optional(),
  /** `at` is inclusive, `before` exclusive. */
  end: z.object({ mode: z.enum(['at', 'before']), values: cursorValues }).optional(),
  limit: z.number().int().min(1).max(10_000).optional(),
  offset: z.number().int().min(0).max(10_000).optional(),
  select: z.array(z.string().min(1).max(1500)).max(100).optional(),
  findNearest: z
    .object({
      field: z.string().min(1).max(1500),
      vector: z.array(z.number()).min(1).max(2048),
      measure: z.enum(['EUCLIDEAN', 'COSINE', 'DOT_PRODUCT']),
      limit: z.number().int().min(1).max(1000),
      distanceField: z.string().max(1500).optional(),
      threshold: z.number().optional(),
    })
    .optional(),
});
export type QuerySpec = z.infer<typeof QuerySpecSchema>;
export type QuerySpecInput = z.input<typeof QuerySpecSchema>;

export const AggregationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('count'), upTo: z.number().int().min(1).optional() }),
  z.object({ op: z.literal('sum'), field: z.string().min(1).max(1500) }),
  z.object({ op: z.literal('avg'), field: z.string().min(1).max(1500) }),
]);
export type Aggregation = z.infer<typeof AggregationSchema>;

export const explainModes = ['plan', 'analyze'] as const;
export type ExplainMode = (typeof explainModes)[number];

export const RunQuerySchema = z.object({
  query: QuerySpecSchema,
  explain: z.enum(explainModes).optional(),
});
export type RunQuery = z.input<typeof RunQuerySchema>;

export const RunAggregationSchema = z.object({
  query: QuerySpecSchema,
  aggregations: z.array(AggregationSchema).min(1).max(5),
  explain: z.enum(explainModes).optional(),
});
export type RunAggregation = z.input<typeof RunAggregationSchema>;

export interface ExplainMetrics {
  indexesUsed: Record<string, unknown>[];
  /** Only with `analyze`, from the last response of the stream (D-08). */
  stats: {
    resultsReturned: string | null;
    readOperations: string | null;
    executionDuration: string | null;
    debugStats: Record<string, unknown> | null;
  } | null;
}

export interface QueryResult {
  documents: FirestoreDocument[];
  readTime: string | null;
  /** Order-by values and the name of the last document, for `start: after` on the next page. */
  nextCursor: WireValue[] | null;
  explain: ExplainMetrics | null;
}

export interface AggregationResult {
  /** One value per aggregation, in order; typed per D-07. */
  values: WireValue[];
  readTime: string | null;
  explain: ExplainMetrics | null;
}

// ---- writes in bulk ------------------------------------------------------------------------------------

export const importModes = ['skip', 'overwrite', 'merge'] as const;
export type ImportMode = (typeof importModes)[number];
export const IMPORT_BATCH = 500;

export const ImportBatchSchema = z.object({
  collection: DocumentPathSchema.refine((p) => p !== '' && p.split('/').length % 2 === 1, 'Not a collection path'),
  mode: z.enum(importModes),
  documents: z
    .array(z.object({ id: pathSegment.optional(), fields: WireFieldsSchema }))
    .min(1)
    .max(IMPORT_BATCH),
});
export type ImportBatch = z.infer<typeof ImportBatchSchema>;

export interface ImportBatchResult {
  written: number;
  skipped: number;
  failures: { id: string; error: string }[];
}

// ---- administration ----------------------------------------------------------------------------------

export interface FirestoreIndex {
  name: string;
  id: string;
  collectionGroup: string;
  queryScope: 'COLLECTION' | 'COLLECTION_GROUP' | 'COLLECTION_RECURSIVE' | string;
  apiScope: string | null;
  state: 'creating' | 'ready' | 'needs_repair' | 'unknown';
  fields: z.infer<typeof IndexFieldSchema>[];
  density: string | null;
}

export const CreateIndexSchema = IndexDefinitionSchema;
export type CreateIndex = z.infer<typeof CreateIndexSchema>;

export interface FieldOverride {
  name: string;
  collectionGroup: string;
  fieldPath: string;
  /** Single-field indexes that differ from the database default; empty means exempted. */
  indexes: { queryScope: string; order: string | null; arrayConfig: string | null; state: string }[];
  /** True when the field uses the ancestor (default) index settings. */
  usesAncestorConfig: boolean;
  ttl: 'creating' | 'active' | 'needs_repair' | null;
}

export const SetFieldIndexesSchema = z.object({
  collectionGroup: pathSegment,
  fieldPath: z.string().min(1).max(1500),
  /** Null restores the database default; an empty array exempts the field. */
  indexes: z
    .array(
      z.object({
        queryScope: z.enum(['COLLECTION', 'COLLECTION_GROUP']),
        order: z.enum(['ASCENDING', 'DESCENDING']).optional(),
        arrayConfig: z.literal('CONTAINS').optional(),
      }),
    )
    .max(10)
    .nullable(),
});
export type SetFieldIndexes = z.infer<typeof SetFieldIndexesSchema>;

export const SetTtlSchema = z.object({
  collectionGroup: pathSegment,
  fieldPath: z.string().min(1).max(1500),
  enabled: z.boolean(),
});
export type SetTtl = z.infer<typeof SetTtlSchema>;

export const ExportDocumentsSchema = z.object({
  /** gs://bucket/prefix */
  outputUriPrefix: z.string().regex(/^gs:\/\/[a-z0-9._-]+(\/.*)?$/, 'A gs:// URI'),
  collectionIds: z.array(pathSegment).max(100).default([]),
  snapshotTime: z.string().max(40).optional(),
});
export type ExportDocuments = z.input<typeof ExportDocumentsSchema>;

export const ImportDocumentsSchema = z.object({
  inputUriPrefix: z.string().regex(/^gs:\/\/[a-z0-9._-]+(\/.*)?$/, 'A gs:// URI'),
  collectionIds: z.array(pathSegment).max(100).default([]),
});
export type ImportDocuments = z.input<typeof ImportDocumentsSchema>;

export const BulkDeleteSchema = z.object({
  collectionIds: z.array(pathSegment).min(1).max(100),
  /** The database id, typed (D-05: the most dangerous action). */
  confirm: z.string().min(1),
});
export type BulkDelete = z.infer<typeof BulkDeleteSchema>;

export interface FirestoreBackup {
  name: string;
  id: string;
  location: string;
  database: string;
  snapshotTime: string | null;
  expireTime: string | null;
  state: string;
  sizeBytes: string | null;
}

export interface BackupSchedule {
  name: string;
  id: string;
  recurrence: 'daily' | 'weekly';
  /** For weekly schedules, such as MONDAY. */
  day: string | null;
  retentionSeconds: number;
  createTime: string | null;
  updateTime: string | null;
}

export const SaveBackupScheduleSchema = z.object({
  recurrence: z.enum(['daily', 'weekly']),
  day: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']).optional(),
  /** Up to 14 weeks. */
  retentionDays: z.number().int().min(1).max(98),
});
export type SaveBackupSchedule = z.infer<typeof SaveBackupScheduleSchema>;

export const RestoreBackupSchema = z.object({
  backup: z.string().regex(/^projects\/[^/]+\/locations\/[^/]+\/backups\/[^/]+$/),
  targetId: DatabaseIdSchema,
});
export type RestoreBackup = z.infer<typeof RestoreBackupSchema>;

export interface FirestoreOperation {
  name: string;
  kind: string;
  state: string;
  startTime: string | null;
  endTime: string | null;
  progressDocuments: { completed: string | null; estimated: string | null } | null;
  collectionIds: string[];
  uri: string | null;
  error: string | null;
}

// ---- rules ----------------------------------------------------------------------------------------------

export interface Ruleset {
  name: string;
  id: string;
  createTime: string | null;
  source: string;
}

export interface RulesState {
  /** cloud.firestore or cloud.firestore/{database} (D-12). */
  releaseName: string;
  current: Ruleset | null;
  history: Omit<Ruleset, 'source'>[];
}

export const PublishRulesSchema = z.object({
  source: z
    .string()
    .min(1)
    .max(256 * 1024),
  /** The ruleset the editor started from; publishing fails when the release moved since. */
  baseRuleset: z.string().max(512).nullable(),
});
export type PublishRules = z.infer<typeof PublishRulesSchema>;

export interface RulesIssue {
  line: number | null;
  column: number | null;
  severity: string;
  description: string;
}

export const rulesMethods = ['get', 'list', 'create', 'update', 'delete'] as const;

export const RulesTestCaseSchema = z.object({
  path: z.string().min(1).max(6144),
  method: z.enum(rulesMethods),
  auth: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('user'), uid: z.string().min(1).max(128), claims: z.record(z.string(), z.unknown()).default({}) }),
  ]),
  /** Request data for create and update, as plain JSON. */
  data: z.record(z.string(), z.unknown()).optional(),
});
export type RulesTestCase = z.input<typeof RulesTestCaseSchema>;

export const TestRulesSchema = z.object({
  /** Source to test; omit to test the published rules. */
  source: z
    .string()
    .max(256 * 1024)
    .optional(),
  cases: z.array(RulesTestCaseSchema).min(1).max(20),
});
export type TestRules = z.input<typeof TestRulesSchema>;

export interface RulesTestResult {
  allowed: boolean;
  state: string;
  debugMessages: string[];
  errorPosition: { line: number; column: number } | null;
  evaluations: { expression: string; value: string; line: number | null; column: number | null }[];
}

// ---- live ------------------------------------------------------------------------------------------------

export const LIVE_DEFAULT_LIMIT = 100;
export const LIVE_MAX_LIMIT = 1000;

export const FirestoreListenParamsSchema = z.object({
  database: DatabaseIdSchema,
  query: QuerySpecSchema.refine((q) => q.limit !== undefined && q.limit <= LIVE_MAX_LIMIT, 'Live mode needs a limit of at most 1000'),
});
export type FirestoreListenParams = z.input<typeof FirestoreListenParamsSchema>;

export interface FirestoreListenUpdate {
  readTime: string | null;
  /** True for the first snapshot, which reads every matching document. */
  initial: boolean;
  changes: { type: 'added' | 'modified' | 'removed'; document: FirestoreDocument; oldIndex: number; newIndex: number }[];
  /** Reads billed by this update (D-10). */
  reads: number;
}

// ---- datastore mode ---------------------------------------------------------------------------------------

/** A Datastore key path element: kind with a numeric id or a name. */
export interface DatastoreKeyPart {
  kind: string;
  id: string | null;
  name: string | null;
}

export interface DatastoreKey {
  namespace: string;
  path: DatastoreKeyPart[];
}

export const DatastoreKeySchema = z.object({
  namespace: z.string().max(100).default(''),
  path: z
    .array(
      z.object({
        kind: z.string().min(1).max(1500),
        id: z
          .string()
          .regex(/^\d{1,19}$/)
          .nullable(),
        name: z.string().min(1).max(1500).nullable(),
      }),
    )
    .min(1)
    .max(100),
});

/** Datastore values reuse the wire types; keys travel as references (`$ref`) holding a key path. */
export interface DatastoreProperty {
  value: WireValue;
  excludeFromIndexes: boolean;
}

export interface DatastoreEntity {
  key: DatastoreKey;
  properties: Record<string, DatastoreProperty>;
}

export const DatastorePropertySchema = z.object({ value: WireValueSchema, excludeFromIndexes: z.boolean() });

export const SaveEntitySchema = z.object({
  key: DatastoreKeySchema,
  properties: z.record(z.string(), DatastorePropertySchema),
});
export type SaveEntity = z.input<typeof SaveEntitySchema>;

export const GqlQuerySchema = z.object({
  namespace: z.string().max(100).default(''),
  gql: z
    .string()
    .min(1)
    .max(64 * 1024),
  /** Cursor from a previous page. */
  cursor: z.string().max(4096).optional(),
});
export type GqlQuery = z.input<typeof GqlQuerySchema>;

export interface EntitiesPage {
  items: DatastoreEntity[];
  endCursor: string | null;
  moreResults: boolean;
}

export const DeleteEntitySchema = z.object({ key: DatastoreKeySchema, confirm: z.string().min(1) });
export type DeleteEntity = z.input<typeof DeleteEntitySchema>;
