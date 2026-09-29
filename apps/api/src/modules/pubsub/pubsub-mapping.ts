import type {
  DeliveryType,
  PubSubMessage,
  PubSubSchema,
  PubSubSnapshot,
  PubSubSubscription,
  PubSubTopic,
  SubscriptionSettings,
  TopicSettings,
} from '@nephoscope/contracts';
import { durationToSeconds, rawJson, timestampToIso } from '../../core/gcp/proto.js';

/** Pub/Sub messages to DTOs and back (SPEC-0006 D-02, D-03). Enums arrive as names, longs as strings. */

// biome-ignore lint/suspicious/noExplicitAny: protobuf messages are loosely typed at this boundary.
type Proto = any;

const last = (name: string) => name.split('/').pop() ?? name;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const labelsOf = (l: unknown): Record<string, string> => (l && typeof l === 'object' ? { ...(l as Record<string, string>) } : {});
const secs = (n: number) => ({ seconds: n, nanos: 0 });

export function mapTopic(t: Proto): PubSubTopic {
  const schema = t.schemaSettings?.schema ? t.schemaSettings : null;
  const ingestion =
    t.ingestionDataSourceSettings && Object.values(t.ingestionDataSourceSettings).some((v) => v && typeof v === 'object')
      ? t.ingestionDataSourceSettings
      : null;
  return {
    name: String(t.name),
    id: last(String(t.name)),
    labels: labelsOf(t.labels),
    kmsKeyName: str(t.kmsKeyName),
    messageRetentionSeconds: durationToSeconds(t.messageRetentionDuration),
    allowedPersistenceRegions: t.messageStoragePolicy?.allowedPersistenceRegions ?? [],
    schemaSettings: schema
      ? {
          schema: String(schema.schema),
          encoding: schema.encoding === 'BINARY' ? 'BINARY' : 'JSON',
          firstRevisionId: str(schema.firstRevisionId),
          lastRevisionId: str(schema.lastRevisionId),
        }
      : null,
    ingestion: ingestion ? (rawJson(ingestion) as Record<string, unknown>) : null,
    state: str(t.state),
  };
}

export function topicToProto(name: string, s: TopicSettings): Proto {
  const t: Proto = { name, labels: s.labels ?? {} };
  if (s.kmsKeyName) t.kmsKeyName = s.kmsKeyName;
  if (s.messageRetentionSeconds) t.messageRetentionDuration = secs(s.messageRetentionSeconds);
  t.messageStoragePolicy = { allowedPersistenceRegions: s.allowedPersistenceRegions ?? [] };
  if (s.schemaSettings) {
    t.schemaSettings = {
      schema: s.schemaSettings.schema,
      encoding: s.schemaSettings.encoding,
      ...(s.schemaSettings.firstRevisionId ? { firstRevisionId: s.schemaSettings.firstRevisionId } : {}),
      ...(s.schemaSettings.lastRevisionId ? { lastRevisionId: s.schemaSettings.lastRevisionId } : {}),
    };
  }
  return t;
}

export const TOPIC_MASK = ['labels', 'message_retention_duration', 'message_storage_policy', 'schema_settings'];

function deliveryOf(s: Proto): DeliveryType {
  if (s.bigqueryConfig?.table) return 'bigquery';
  if (s.cloudStorageConfig?.bucket) return 'cloudStorage';
  if (s.pushConfig?.pushEndpoint) return 'push';
  return 'pull';
}

export function mapSubscription(s: Proto): PubSubSubscription {
  const delivery = deliveryOf(s);
  const push = s.pushConfig;
  const bq = s.bigqueryConfig;
  const gcs = s.cloudStorageConfig;
  const retry = s.retryPolicy && (s.retryPolicy.minimumBackoff || s.retryPolicy.maximumBackoff) ? s.retryPolicy : null;
  return {
    name: String(s.name),
    id: last(String(s.name)),
    topic: String(s.topic ?? ''),
    deliveryType: delivery,
    push:
      delivery === 'push'
        ? {
            endpoint: String(push.pushEndpoint),
            serviceAccount: str(push.oidcToken?.serviceAccountEmail),
            audience: str(push.oidcToken?.audience),
            noWrapper: !!push.noWrapper,
            writeMetadata: !!push.noWrapper?.writeMetadata,
          }
        : null,
    bigquery:
      delivery === 'bigquery'
        ? {
            table: String(bq.table),
            useTopicSchema: !!bq.useTopicSchema,
            useTableSchema: !!bq.useTableSchema,
            writeMetadata: !!bq.writeMetadata,
            dropUnknownFields: !!bq.dropUnknownFields,
            serviceAccount: str(bq.serviceAccountEmail),
          }
        : null,
    cloudStorage:
      delivery === 'cloudStorage'
        ? {
            bucket: String(gcs.bucket),
            filenamePrefix: String(gcs.filenamePrefix ?? ''),
            filenameSuffix: String(gcs.filenameSuffix ?? ''),
            maxDurationSeconds: durationToSeconds(gcs.maxDuration),
            maxBytes: gcs.maxBytes !== undefined && gcs.maxBytes !== null && String(gcs.maxBytes) !== '0' ? String(gcs.maxBytes) : null,
            format: gcs.avroConfig ? 'avro' : 'text',
            writeMetadata: !!gcs.avroConfig?.writeMetadata,
            serviceAccount: str(gcs.serviceAccountEmail),
          }
        : null,
    ackDeadlineSeconds: Number(s.ackDeadlineSeconds ?? 10),
    retentionSeconds: durationToSeconds(s.messageRetentionDuration),
    retainAcked: !!s.retainAckedMessages,
    expirationSeconds: durationToSeconds(s.expirationPolicy?.ttl),
    retry: retry
      ? { minimumBackoffSeconds: durationToSeconds(retry.minimumBackoff), maximumBackoffSeconds: durationToSeconds(retry.maximumBackoff) }
      : null,
    deadLetter: s.deadLetterPolicy?.deadLetterTopic
      ? { topic: String(s.deadLetterPolicy.deadLetterTopic), maxDeliveryAttempts: Number(s.deadLetterPolicy.maxDeliveryAttempts || 5) }
      : null,
    filter: String(s.filter ?? ''),
    exactlyOnce: !!s.enableExactlyOnceDelivery,
    ordering: !!s.enableMessageOrdering,
    detached: !!s.detached,
    state: str(s.state),
    labels: labelsOf(s.labels),
  };
}

/** The settings that update can change (D-03); filter and ordering are fixed at creation. */
export function subscriptionToProto(name: string, s: SubscriptionSettings): Proto {
  const sub: Proto = {
    name,
    ackDeadlineSeconds: s.ackDeadlineSeconds ?? 10,
    messageRetentionDuration: secs(s.retentionSeconds ?? 7 * 86_400),
    retainAckedMessages: !!s.retainAcked,
    // An expiration policy without a ttl means the subscription never expires.
    expirationPolicy: s.expirationSeconds ? { ttl: secs(s.expirationSeconds) } : {},
    retryPolicy: s.retry
      ? { minimumBackoff: secs(s.retry.minimumBackoffSeconds), maximumBackoff: secs(s.retry.maximumBackoffSeconds) }
      : null,
    deadLetterPolicy: s.deadLetter ? { deadLetterTopic: s.deadLetter.topic, maxDeliveryAttempts: s.deadLetter.maxDeliveryAttempts } : null,
    labels: s.labels ?? {},
    enableExactlyOnceDelivery: !!s.exactlyOnce,
    pushConfig: {},
  };
  if (s.deliveryType === 'push' && s.push) {
    sub.pushConfig = {
      pushEndpoint: s.push.endpoint,
      ...(s.push.serviceAccount
        ? { oidcToken: { serviceAccountEmail: s.push.serviceAccount, ...(s.push.audience ? { audience: s.push.audience } : {}) } }
        : {}),
      ...(s.push.noWrapper ? { noWrapper: { writeMetadata: !!s.push.writeMetadata } } : {}),
    };
  } else if (s.deliveryType === 'bigquery' && s.bigquery) {
    sub.bigqueryConfig = {
      table: s.bigquery.table.replace(':', '.'),
      useTopicSchema: !!s.bigquery.useTopicSchema,
      useTableSchema: !!s.bigquery.useTableSchema,
      writeMetadata: !!s.bigquery.writeMetadata,
      dropUnknownFields: !!s.bigquery.dropUnknownFields,
      ...(s.bigquery.serviceAccount ? { serviceAccountEmail: s.bigquery.serviceAccount } : {}),
    };
  } else if (s.deliveryType === 'cloudStorage' && s.cloudStorage) {
    const c = s.cloudStorage;
    sub.cloudStorageConfig = {
      bucket: c.bucket,
      filenamePrefix: c.filenamePrefix ?? '',
      filenameSuffix: c.filenameSuffix ?? '',
      ...(c.maxDurationSeconds ? { maxDuration: secs(c.maxDurationSeconds) } : {}),
      ...(c.maxBytes ? { maxBytes: c.maxBytes } : {}),
      ...(c.format === 'avro' ? { avroConfig: { writeMetadata: !!c.writeMetadata } } : { textConfig: {} }),
      ...(c.serviceAccount ? { serviceAccountEmail: c.serviceAccount } : {}),
    };
  }
  return sub;
}

export const SUBSCRIPTION_MASK = [
  'ack_deadline_seconds',
  'message_retention_duration',
  'retain_acked_messages',
  'expiration_policy',
  'retry_policy',
  'dead_letter_policy',
  'labels',
  'enable_exactly_once_delivery',
  'push_config',
  'bigquery_config',
  'cloud_storage_config',
];

export function mapSnapshot(s: Proto): PubSubSnapshot {
  return {
    name: String(s.name),
    id: last(String(s.name)),
    topic: String(s.topic ?? ''),
    expireTime: timestampToIso(s.expireTime),
    labels: labelsOf(s.labels),
  };
}

export function mapSchema(s: Proto): PubSubSchema {
  return {
    name: String(s.name),
    id: last(String(s.name)).split('@')[0] ?? '',
    type: String(s.type ?? 'TYPE_UNSPECIFIED'),
    definition: String(s.definition ?? ''),
    revisionId: str(s.revisionId),
    revisionCreateTime: timestampToIso(s.revisionCreateTime),
  };
}

function utf8(bytes: Buffer): string | null {
  const text = bytes.toString('utf8');
  // Replacement characters mean the bytes were not valid UTF-8.
  return Buffer.from(text, 'utf8').equals(bytes) ? text : null;
}

/** A received message: data as base64 and, when it decodes, as text (CA-09 renders it as text). */
export function mapReceived(r: Proto): PubSubMessage {
  const m = r.message ?? r;
  const bytes = Buffer.from(m.data ?? []);
  return {
    messageId: String(m.messageId ?? m.id ?? ''),
    publishTime: timestampToIso(m.publishTime) ?? (m.publishTime instanceof Date ? m.publishTime.toISOString() : null),
    data: bytes.toString('base64'),
    text: utf8(bytes),
    attributes: labelsOf(m.attributes),
    orderingKey: String(m.orderingKey ?? ''),
    deliveryAttempt: r.deliveryAttempt ? Number(r.deliveryAttempt) : null,
  };
}
