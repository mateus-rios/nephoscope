import { z } from 'zod';

/** Pub/Sub (SPEC-0006 D-01 to D-08). */

export const PubSubIdSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(/^[A-Za-z][A-Za-z0-9\-_.~+%]*$/, 'Letters, digits and - _ . ~ + %, starting with a letter')
  .refine((s) => !s.toLowerCase().startsWith('goog'), 'Ids cannot start with "goog"');

export interface TopicSchemaSettings {
  schema: string;
  encoding: 'JSON' | 'BINARY';
  firstRevisionId: string | null;
  lastRevisionId: string | null;
}

export interface PubSubTopic {
  name: string;
  id: string;
  labels: Record<string, string>;
  kmsKeyName: string | null;
  messageRetentionSeconds: number | null;
  allowedPersistenceRegions: string[];
  schemaSettings: TopicSchemaSettings | null;
  /** Import topics (Kinesis, Cloud Storage, Azure, and so on) are read-only here (D-02). */
  ingestion: Record<string, unknown> | null;
  state: string | null;
}

export type DeliveryType = 'pull' | 'push' | 'bigquery' | 'cloudStorage';

export interface PushSettings {
  endpoint: string;
  serviceAccount: string | null;
  audience: string | null;
  /** Deliver the raw payload instead of the JSON envelope. */
  noWrapper: boolean;
  writeMetadata: boolean;
}

export interface BigQuerySettings {
  table: string;
  useTopicSchema: boolean;
  useTableSchema: boolean;
  writeMetadata: boolean;
  dropUnknownFields: boolean;
  serviceAccount: string | null;
}

export interface CloudStorageSettings {
  bucket: string;
  filenamePrefix: string;
  filenameSuffix: string;
  maxDurationSeconds: number | null;
  maxBytes: string | null;
  format: 'text' | 'avro';
  writeMetadata: boolean;
  serviceAccount: string | null;
}

export interface PubSubSubscription {
  name: string;
  id: string;
  topic: string;
  deliveryType: DeliveryType;
  push: PushSettings | null;
  bigquery: BigQuerySettings | null;
  cloudStorage: CloudStorageSettings | null;
  ackDeadlineSeconds: number;
  retentionSeconds: number | null;
  retainAcked: boolean;
  /** Null means the subscription never expires. */
  expirationSeconds: number | null;
  retry: { minimumBackoffSeconds: number | null; maximumBackoffSeconds: number | null } | null;
  deadLetter: { topic: string; maxDeliveryAttempts: number } | null;
  filter: string;
  exactlyOnce: boolean;
  ordering: boolean;
  detached: boolean;
  state: string | null;
  labels: Record<string, string>;
}

export interface PubSubSnapshot {
  name: string;
  id: string;
  topic: string;
  expireTime: string | null;
  labels: Record<string, string>;
}

export interface PubSubSchema {
  name: string;
  id: string;
  type: 'AVRO' | 'PROTOCOL_BUFFER' | string;
  definition: string;
  revisionId: string | null;
  revisionCreateTime: string | null;
}

export interface PubSubMessage {
  messageId: string;
  publishTime: string | null;
  /** Base64 of the raw bytes. */
  data: string;
  /** The bytes as text when they are valid UTF-8; shown as text only (CA-09). */
  text: string | null;
  attributes: Record<string, string>;
  orderingKey: string;
  /** Present on subscriptions with a dead-letter policy. */
  deliveryAttempt: number | null;
}

// ---- requests -----------------------------------------------------------------------------------

const labels = z.record(z.string().max(63), z.string().max(63)).default({});
const seconds = (min: number, max: number) => z.number().int().min(min).max(max);

export const TopicSettingsSchema = z.object({
  labels,
  kmsKeyName: z.string().max(512).optional(),
  /** 10 minutes to 31 days; omit for no retention on the topic. */
  messageRetentionSeconds: seconds(600, 31 * 86_400)
    .nullable()
    .default(null),
  allowedPersistenceRegions: z.array(z.string().min(2).max(40)).max(100).default([]),
  schemaSettings: z
    .object({
      schema: z.string().regex(/^projects\/[^/]+\/schemas\/[^/]+$/),
      encoding: z.enum(['JSON', 'BINARY']),
      firstRevisionId: z.string().max(64).optional(),
      lastRevisionId: z.string().max(64).optional(),
    })
    .nullable()
    .default(null),
});
export const CreateTopicSchema = TopicSettingsSchema.extend({ id: PubSubIdSchema });
export type CreateTopic = z.input<typeof CreateTopicSchema>;
export type TopicSettings = z.input<typeof TopicSettingsSchema>;

const pushSchema = z.object({
  endpoint: z.string().url().max(2048),
  serviceAccount: z.string().max(320).optional(),
  audience: z.string().max(2048).optional(),
  noWrapper: z.boolean().default(false),
  writeMetadata: z.boolean().default(false),
});
const bigquerySchema = z.object({
  table: z
    .string()
    .regex(/^[^:.]+[:.][^.]+\.[^.]+$/, 'project:dataset.table or project.dataset.table')
    .max(1024),
  useTopicSchema: z.boolean().default(false),
  useTableSchema: z.boolean().default(false),
  writeMetadata: z.boolean().default(false),
  dropUnknownFields: z.boolean().default(false),
  serviceAccount: z.string().max(320).optional(),
});
const storageSchema = z.object({
  bucket: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/),
  filenamePrefix: z.string().max(1024).default(''),
  filenameSuffix: z.string().max(1024).default(''),
  maxDurationSeconds: seconds(60, 600).optional(),
  maxBytes: z.string().regex(/^\d+$/).optional(),
  format: z.enum(['text', 'avro']).default('text'),
  writeMetadata: z.boolean().default(false),
  serviceAccount: z.string().max(320).optional(),
});

export const SubscriptionSettingsSchema = z.object({
  deliveryType: z.enum(['pull', 'push', 'bigquery', 'cloudStorage']),
  push: pushSchema.optional(),
  bigquery: bigquerySchema.optional(),
  cloudStorage: storageSchema.optional(),
  ackDeadlineSeconds: seconds(10, 600).default(10),
  retentionSeconds: seconds(600, 31 * 86_400).default(7 * 86_400),
  retainAcked: z.boolean().default(false),
  /** Null never expires; otherwise at least one day. */
  expirationSeconds: seconds(86_400, 365 * 86_400)
    .nullable()
    .default(31 * 86_400),
  retry: z
    .object({ minimumBackoffSeconds: seconds(0, 600), maximumBackoffSeconds: seconds(0, 600) })
    .nullable()
    .default(null),
  deadLetter: z
    .object({ topic: z.string().regex(/^projects\/[^/]+\/topics\/[^/]+$/), maxDeliveryAttempts: seconds(5, 100) })
    .nullable()
    .default(null),
  labels,
});
export const CreateSubscriptionSchema = SubscriptionSettingsSchema.extend({
  id: PubSubIdSchema,
  topic: z.string().regex(/^projects\/[^/]+\/topics\/[^/]+$/),
  /** Cannot change after creation (D-03). */
  filter: z.string().max(256).default(''),
  exactlyOnce: z.boolean().default(false),
  ordering: z.boolean().default(false),
});
export type CreateSubscription = z.input<typeof CreateSubscriptionSchema>;
export type SubscriptionSettings = z.input<typeof SubscriptionSettingsSchema> & { exactlyOnce?: boolean };
export const UpdateSubscriptionSchema = SubscriptionSettingsSchema.extend({ exactlyOnce: z.boolean().default(false) });

export const PUBLISH_CONFIRM_THRESHOLD = 100;
export const PublishSchema = z.object({
  messages: z
    .array(
      z.object({
        /** Base64 of the payload. */
        data: z.string().max(14_000_000),
        attributes: z.record(z.string().min(1).max(256), z.string().max(1024)).default({}),
        orderingKey: z.string().max(1024).optional(),
      }),
    )
    .min(1)
    .max(1000),
  /** The message count, typed, above 100 messages (D-02). */
  confirm: z.string().optional(),
});
export type Publish = z.input<typeof PublishSchema>;

export const PEEK_MAX = 100;
export const PeekSchema = z.object({ max: z.number().int().min(1).max(PEEK_MAX).default(10) });
export const PullAckSchema = z.object({ max: z.number().int().min(1).max(PEEK_MAX), confirm: z.string().min(1) });

export const SeekSchema = z.union([
  z.object({ snapshot: z.string().regex(/^projects\/[^/]+\/snapshots\/[^/]+$/), confirm: z.string().min(1) }),
  z.object({ time: z.string().max(40), confirm: z.string().min(1) }),
]);
export type Seek = z.infer<typeof SeekSchema>;

export const CreateSnapshotSchema = z.object({
  id: PubSubIdSchema,
  subscription: z.string().regex(/^projects\/[^/]+\/subscriptions\/[^/]+$/),
});
export type CreateSnapshot = z.infer<typeof CreateSnapshotSchema>;

export const ResendSchema = z.object({
  /** A subscription on the dead-letter topic. */
  from: z.string().regex(/^projects\/[^/]+\/subscriptions\/[^/]+$/),
  /** The original topic to publish to again. */
  to: z.string().regex(/^projects\/[^/]+\/topics\/[^/]+$/),
  messageIds: z.array(z.string().min(1).max(64)).min(1).max(PEEK_MAX),
  confirm: z.string().optional(),
});
export type Resend = z.infer<typeof ResendSchema>;
export interface ResendResult {
  resent: string[];
  notFound: string[];
}

export const DeadLetterGrantsSchema = z.object({ projectNumber: z.string().regex(/^\d{1,20}$/) });

export const SchemaTypeSchema = z.enum(['AVRO', 'PROTOCOL_BUFFER']);
export const CreateSchemaSchema = z.object({ id: PubSubIdSchema, type: SchemaTypeSchema, definition: z.string().min(1).max(300_000) });
export type CreateSchema = z.infer<typeof CreateSchemaSchema>;
export const CommitSchemaSchema = z.object({ type: SchemaTypeSchema, definition: z.string().min(1).max(300_000) });
export const ValidateSchemaSchema = CommitSchemaSchema;
export const ValidateMessageSchema = z.object({
  encoding: z.enum(['JSON', 'BINARY']),
  data: z.string().max(14_000_000),
  revisionId: z.string().max(64).optional(),
});
export type ValidateMessage = z.infer<typeof ValidateMessageSchema>;

// ---- live ----------------------------------------------------------------------------------------

export const PubSubWatchParamsSchema = z.object({
  topic: z.string().regex(/^projects\/[^/]+\/topics\/[^/]+$/),
  filter: z.string().max(256).default(''),
});
export type PubSubWatchParams = z.input<typeof PubSubWatchParamsSchema>;

export interface PubSubWatchUpdate {
  /** The temporary subscription (D-05), announced in the first update. */
  subscription: string | null;
  messages: PubSubMessage[];
}
