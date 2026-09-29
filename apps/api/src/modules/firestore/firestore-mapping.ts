import type {
  BackupSchedule,
  FieldOverride,
  FirestoreBackup,
  FirestoreDatabase,
  FirestoreIndex,
  FirestoreOperation,
  IndexField,
} from '@nephoscope/contracts';
import { durationToSeconds } from '../../core/gcp/proto.js';
import { protoTimestampToIso } from './codec.js';

/** Admin API messages to DTOs (SPEC-0004 D-11). Enums arrive as their names. */

// biome-ignore lint/suspicious/noExplicitAny: protobuf messages are loosely typed at this boundary.
type Proto = any;

const last = (name: string) => name.split('/').pop() ?? name;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function mapDatabase(d: Proto): FirestoreDatabase {
  return {
    name: String(d.name),
    id: last(String(d.name)),
    locationId: str(d.locationId),
    type: d.type === 'DATASTORE_MODE' ? 'datastore' : 'native',
    edition: d.databaseEdition === 'ENTERPRISE' ? 'enterprise' : 'standard',
    concurrencyMode: str(d.concurrencyMode),
    pointInTimeRecovery: d.pointInTimeRecoveryEnablement === 'POINT_IN_TIME_RECOVERY_ENABLED',
    deleteProtection: d.deleteProtectionState === 'DELETE_PROTECTION_ENABLED',
    createTime: protoTimestampToIso(d.createTime),
    earliestVersionTime: protoTimestampToIso(d.earliestVersionTime),
    versionRetentionSeconds: durationToSeconds(d.versionRetentionPeriod),
    emulator: false,
  };
}

function mapIndexField(f: Proto): IndexField {
  const out: IndexField = { fieldPath: String(f.fieldPath) };
  if (f.order === 'ASCENDING' || f.order === 'DESCENDING') out.order = f.order;
  if (f.arrayConfig === 'CONTAINS') out.arrayConfig = 'CONTAINS';
  if (f.vectorConfig?.dimension) out.vectorDimension = Number(f.vectorConfig.dimension);
  return out;
}

function indexState(s: unknown): FirestoreIndex['state'] {
  if (s === 'READY') return 'ready';
  if (s === 'CREATING') return 'creating';
  if (s === 'NEEDS_REPAIR') return 'needs_repair';
  return 'unknown';
}

export function mapIndex(i: Proto): FirestoreIndex {
  const name = String(i.name);
  return {
    name,
    id: last(name),
    collectionGroup: /\/collectionGroups\/([^/]+)\//.exec(name)?.[1] ?? '',
    queryScope: String(i.queryScope ?? 'COLLECTION'),
    apiScope: str(i.apiScope),
    state: indexState(i.state),
    // Firestore appends __name__ to every composite index; it is implied, so it is not shown.
    fields: (i.fields ?? []).map(mapIndexField).filter((f: IndexField) => f.fieldPath !== '__name__'),
    density: str(i.density),
  };
}

export function mapField(f: Proto): FieldOverride {
  const name = String(f.name);
  const ttl = f.ttlConfig?.state;
  return {
    name,
    collectionGroup: /\/collectionGroups\/([^/]+)\//.exec(name)?.[1] ?? '',
    fieldPath: last(name),
    indexes: (f.indexConfig?.indexes ?? []).map((i: Proto) => {
      const field = (i.fields ?? [])[0] ?? {};
      return {
        queryScope: String(i.queryScope ?? 'COLLECTION'),
        order: str(field.order),
        arrayConfig: str(field.arrayConfig),
        state: String(i.state ?? 'STATE_UNSPECIFIED'),
      };
    }),
    usesAncestorConfig: Boolean(f.indexConfig?.usesAncestorConfig),
    ttl: f.ttlConfig ? (ttl === 'ACTIVE' ? 'active' : ttl === 'NEEDS_REPAIR' ? 'needs_repair' : 'creating') : null,
  };
}

export function mapBackup(b: Proto): FirestoreBackup {
  const name = String(b.name);
  return {
    name,
    id: last(name),
    location: /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '',
    database: String(b.database ?? ''),
    snapshotTime: protoTimestampToIso(b.snapshotTime),
    expireTime: protoTimestampToIso(b.expireTime),
    state: String(b.state ?? 'STATE_UNSPECIFIED'),
    sizeBytes: b.stats?.sizeBytes !== undefined ? String(b.stats.sizeBytes) : null,
  };
}

export function mapSchedule(s: Proto): BackupSchedule {
  const name = String(s.name);
  return {
    name,
    id: last(name),
    recurrence: s.weeklyRecurrence ? 'weekly' : 'daily',
    day: str(s.weeklyRecurrence?.day),
    retentionSeconds: durationToSeconds(s.retention) ?? 0,
    createTime: protoTimestampToIso(s.createTime),
    updateTime: protoTimestampToIso(s.updateTime),
  };
}

const KIND_BY_TYPE: Record<string, string> = {
  ExportDocumentsMetadata: 'Export',
  ImportDocumentsMetadata: 'Import',
  BulkDeleteDocumentsMetadata: 'Bulk delete',
  IndexOperationMetadata: 'Index',
  FieldOperationMetadata: 'Field',
  CreateDatabaseMetadata: 'Create database',
  RestoreDatabaseMetadata: 'Restore',
  CloneDatabaseMetadata: 'Clone',
};

/** A google.longrunning operation of the admin API, with its metadata already decoded. */
export function mapAdminOperation(op: Proto, metadata: Proto | null): FirestoreOperation {
  const type =
    String(op.metadata?.type_url ?? op.metadata?.typeUrl ?? '')
      .split('.')
      .pop() ?? '';
  const progress = metadata?.progressDocuments;
  return {
    name: String(op.name),
    kind: KIND_BY_TYPE[type] ?? (type || 'Operation'),
    state: op.done ? (op.error ? 'FAILED' : 'SUCCESSFUL') : String(metadata?.operationState ?? 'PROCESSING'),
    startTime: protoTimestampToIso(metadata?.startTime),
    endTime: protoTimestampToIso(metadata?.endTime),
    progressDocuments: progress
      ? {
          completed: progress.completedWork !== undefined ? String(progress.completedWork) : null,
          estimated: progress.estimatedWork !== undefined ? String(progress.estimatedWork) : null,
        }
      : null,
    collectionIds: metadata?.collectionIds ?? [],
    uri: str(metadata?.outputUriPrefix) ?? str(metadata?.inputUriPrefix),
    error: op.error?.message ? String(op.error.message) : null,
  };
}
