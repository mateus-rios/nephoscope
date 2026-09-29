import type {
  BackupSchedule,
  CloneDatabase,
  CreateDatabase,
  CreateIndex,
  ExportDocuments,
  FieldOverride,
  FirestoreBackup,
  FirestoreIndex,
  FirestoreOperation,
  ImportDocuments,
  ListResponse,
  OperationSummary,
  RestoreBackup,
  SaveBackupSchedule,
  SetFieldIndexes,
  SetTtl,
  UpdateDatabase,
} from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { lroPoller, operationGetter } from '../../core/gcp/lro.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { ProblemException } from '../../core/problem/problem.js';
import { isoToProtoTimestamp } from './codec.js';
import { FirestoreClients } from './firestore-clients.js';
import { mapAdminOperation, mapBackup, mapField, mapIndex, mapSchedule } from './firestore-mapping.js';

// biome-ignore lint/suspicious/noExplicitAny: generated clients are loosely typed at this boundary.
type Any = any;

const METADATA_METHOD: Record<string, string> = {
  ExportDocumentsMetadata: 'exportDocuments',
  ImportDocumentsMetadata: 'importDocuments',
  BulkDeleteDocumentsMetadata: 'bulkDeleteDocuments',
  IndexOperationMetadata: 'createIndex',
  FieldOperationMetadata: 'updateField',
  CreateDatabaseMetadata: 'createDatabase',
  RestoreDatabaseMetadata: 'restoreDatabase',
  CloneDatabaseMetadata: 'cloneDatabase',
};

/** Firestore administration (SPEC-0004 D-11): every change is a Google operation, tracked in the tray. */
@Injectable()
export class FirestoreAdminService {
  constructor(
    private readonly fs: FirestoreClients,
    private readonly operations: OperationsService,
  ) {}

  private db(projectId: string, databaseId: string) {
    return `projects/${projectId}/databases/${databaseId}`;
  }

  private href(projectId: string, databaseId: string, page: string) {
    return `/p/${projectId}/firestore/${encodeURIComponent(databaseId)}/${page}`;
  }

  private track(
    admin: Any,
    h: ProfileHandle,
    projectId: string,
    kind: string,
    displayName: string,
    href: string | null,
    op: Any,
  ): OperationSummary {
    const name = String(op.name ?? op.latestResponse?.name ?? '');
    return this.operations.track({
      profileId: h.profile.id,
      projectId,
      product: 'firestore',
      kind,
      family: 'longrunning',
      resource: { name, displayName, href },
      googleName: name,
      poll: lroPoller(operationGetter(admin), name),
    });
  }

  // ---- databases ------------------------------------------------------------------------------

  async createDatabase(h: ProfileHandle, projectId: string, body: CreateDatabase): Promise<OperationSummary> {
    if (body.edition === 'enterprise' && body.type === 'datastore')
      throw ProblemException.of('INVALID_ARGUMENT', 'The Enterprise edition has no Datastore mode.');
    const admin = await this.fs.admin(h.profile.id, 'Creating databases');
    const [op] = await admin.createDatabase({
      parent: `projects/${projectId}`,
      databaseId: body.id,
      database: {
        locationId: body.locationId,
        type: body.type === 'datastore' ? 'DATASTORE_MODE' : 'FIRESTORE_NATIVE',
        databaseEdition: body.edition === 'enterprise' ? 'ENTERPRISE' : 'STANDARD',
        pointInTimeRecoveryEnablement: body.pointInTimeRecovery ? 'POINT_IN_TIME_RECOVERY_ENABLED' : 'POINT_IN_TIME_RECOVERY_DISABLED',
        deleteProtectionState: body.deleteProtection ? 'DELETE_PROTECTION_ENABLED' : 'DELETE_PROTECTION_DISABLED',
      },
    });
    return this.track(
      admin,
      h,
      projectId,
      'firestore.database.create',
      `Create database ${body.id}`,
      this.href(projectId, body.id, 'data'),
      op,
    );
  }

  async updateDatabase(h: ProfileHandle, projectId: string, databaseId: string, body: UpdateDatabase): Promise<OperationSummary> {
    const admin = await this.fs.admin(h.profile.id, 'Database settings');
    const database: Any = { name: this.db(projectId, databaseId) };
    const paths: string[] = [];
    if (body.pointInTimeRecovery !== undefined) {
      database.pointInTimeRecoveryEnablement = body.pointInTimeRecovery
        ? 'POINT_IN_TIME_RECOVERY_ENABLED'
        : 'POINT_IN_TIME_RECOVERY_DISABLED';
      paths.push('point_in_time_recovery_enablement');
    }
    if (body.deleteProtection !== undefined) {
      database.deleteProtectionState = body.deleteProtection ? 'DELETE_PROTECTION_ENABLED' : 'DELETE_PROTECTION_DISABLED';
      paths.push('delete_protection_state');
    }
    if (paths.length === 0) throw ProblemException.of('INVALID_ARGUMENT', 'Nothing to change.');
    const [op] = await admin.updateDatabase({ database, updateMask: { paths } });
    return this.track(
      admin,
      h,
      projectId,
      'firestore.database.update',
      `Update database ${databaseId}`,
      this.href(projectId, databaseId, 'settings'),
      op,
    );
  }

  async deleteDatabase(h: ProfileHandle, projectId: string, databaseId: string): Promise<OperationSummary> {
    const admin = await this.fs.admin(h.profile.id, 'Deleting databases');
    const [db] = await admin.getDatabase({ name: this.db(projectId, databaseId) });
    if (db.deleteProtectionState === 'DELETE_PROTECTION_ENABLED')
      throw ProblemException.of('FAILED_PRECONDITION', 'Delete protection is on for this database. Turn it off in the settings first.');
    const [op] = await admin.deleteDatabase({ name: this.db(projectId, databaseId) });
    return this.track(admin, h, projectId, 'firestore.database.delete', `Delete database ${databaseId}`, null, op);
  }

  async cloneDatabase(h: ProfileHandle, projectId: string, databaseId: string, body: CloneDatabase): Promise<OperationSummary> {
    const admin = await this.fs.admin(h.profile.id, 'Cloning databases');
    const [op] = await admin.cloneDatabase({
      parent: `projects/${projectId}`,
      databaseId: body.targetId,
      pitrSnapshot: { database: this.db(projectId, databaseId), snapshotTime: isoToProtoTimestamp(body.snapshotTime) },
    });
    return this.track(
      admin,
      h,
      projectId,
      'firestore.database.clone',
      `Clone ${databaseId} to ${body.targetId}`,
      this.href(projectId, body.targetId, 'data'),
      op,
    );
  }

  async restore(h: ProfileHandle, projectId: string, body: RestoreBackup): Promise<OperationSummary> {
    if (!body.backup.startsWith(`projects/${projectId}/`))
      throw ProblemException.of('INVALID_ARGUMENT', 'The backup belongs to another project.');
    const admin = await this.fs.admin(h.profile.id, 'Restoring backups');
    const [op] = await admin.restoreDatabase({ parent: `projects/${projectId}`, databaseId: body.targetId, backup: body.backup });
    return this.track(
      admin,
      h,
      projectId,
      'firestore.backup.restore',
      `Restore into ${body.targetId}`,
      this.href(projectId, body.targetId, 'data'),
      op,
    );
  }

  // ---- indexes and fields ---------------------------------------------------------------------

  async indexes(h: ProfileHandle, projectId: string, databaseId: string): Promise<FirestoreIndex[]> {
    const admin = await this.fs.admin(h.profile.id, 'Indexes');
    const [items] = await admin.listIndexes({ parent: `${this.db(projectId, databaseId)}/collectionGroups/-` });
    return (items as Any[]).map(mapIndex).sort((a, b) => a.collectionGroup.localeCompare(b.collectionGroup) || a.id.localeCompare(b.id));
  }

  async createIndex(h: ProfileHandle, projectId: string, databaseId: string, body: CreateIndex): Promise<OperationSummary> {
    const admin = await this.fs.admin(h.profile.id, 'Indexes');
    const [op] = await admin.createIndex({
      parent: `${this.db(projectId, databaseId)}/collectionGroups/${body.collectionGroup}`,
      index: {
        queryScope: body.queryScope,
        fields: body.fields.map((f) =>
          f.vectorDimension
            ? { fieldPath: f.fieldPath, vectorConfig: { dimension: f.vectorDimension, flat: {} } }
            : f.arrayConfig
              ? { fieldPath: f.fieldPath, arrayConfig: f.arrayConfig }
              : { fieldPath: f.fieldPath, order: f.order ?? 'ASCENDING' },
        ),
      },
    });
    const summary = body.fields.map((f) => f.fieldPath).join(', ');
    return this.track(
      admin,
      h,
      projectId,
      'firestore.index.create',
      `Create index on ${body.collectionGroup} (${summary})`,
      this.href(projectId, databaseId, 'indexes'),
      op,
    );
  }

  async deleteIndex(h: ProfileHandle, projectId: string, databaseId: string, name: string): Promise<void> {
    if (!name.startsWith(`${this.db(projectId, databaseId)}/collectionGroups/`))
      throw ProblemException.of('INVALID_ARGUMENT', 'The index belongs to another database.');
    const admin = await this.fs.admin(h.profile.id, 'Indexes');
    await admin.deleteIndex({ name });
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'firestore',
      kind: 'firestore.index.delete',
      resource: { name, displayName: `Delete index ${name.split('/').pop()}`, href: this.href(projectId, databaseId, 'indexes') },
    });
  }

  /** Single-field overrides and TTL policies (CA-17, CA-18). */
  async fields(h: ProfileHandle, projectId: string, databaseId: string, kind: 'overrides' | 'ttl'): Promise<FieldOverride[]> {
    const admin = await this.fs.admin(h.profile.id, kind === 'ttl' ? 'TTL policies' : 'Single-field indexes');
    const [items] = await admin.listFields({
      parent: `${this.db(projectId, databaseId)}/collectionGroups/-`,
      filter: kind === 'ttl' ? 'ttlConfig:*' : 'indexConfig.usesAncestorConfig:false',
    });
    return (items as Any[])
      .map(mapField)
      .filter((f) => !(f.collectionGroup === '__default__' && f.fieldPath === '*' && kind === 'overrides' && f.indexes.length === 0))
      .sort((a, b) => a.collectionGroup.localeCompare(b.collectionGroup) || a.fieldPath.localeCompare(b.fieldPath));
  }

  private fieldName(projectId: string, databaseId: string, group: string, fieldPath: string) {
    return `${this.db(projectId, databaseId)}/collectionGroups/${group}/fields/${fieldPath}`;
  }

  async setFieldIndexes(h: ProfileHandle, projectId: string, databaseId: string, body: SetFieldIndexes): Promise<OperationSummary> {
    const admin = await this.fs.admin(h.profile.id, 'Single-field indexes');
    const field: Any = { name: this.fieldName(projectId, databaseId, body.collectionGroup, body.fieldPath) };
    // No indexConfig reverts to the database default; an empty list exempts the field.
    if (body.indexes !== null)
      field.indexConfig = {
        indexes: body.indexes.map((i) => ({
          queryScope: i.queryScope,
          fields: [
            i.arrayConfig
              ? { fieldPath: body.fieldPath, arrayConfig: i.arrayConfig }
              : { fieldPath: body.fieldPath, order: i.order ?? 'ASCENDING' },
          ],
        })),
      };
    const [op] = await admin.updateField({ field, updateMask: { paths: ['index_config'] } });
    const what = body.indexes === null ? 'Restore default indexes' : body.indexes.length === 0 ? 'Exempt' : 'Set indexes on';
    return this.track(
      admin,
      h,
      projectId,
      'firestore.field.indexes',
      `${what} ${body.collectionGroup}.${body.fieldPath}`,
      this.href(projectId, databaseId, 'indexes'),
      op,
    );
  }

  async setTtl(h: ProfileHandle, projectId: string, databaseId: string, body: SetTtl): Promise<OperationSummary> {
    const admin = await this.fs.admin(h.profile.id, 'TTL policies');
    const field: Any = { name: this.fieldName(projectId, databaseId, body.collectionGroup, body.fieldPath) };
    if (body.enabled) field.ttlConfig = {};
    const [op] = await admin.updateField({ field, updateMask: { paths: ['ttl_config'] } });
    return this.track(
      admin,
      h,
      projectId,
      'firestore.ttl.update',
      `${body.enabled ? 'Enable' : 'Disable'} TTL on ${body.collectionGroup}.${body.fieldPath}`,
      this.href(projectId, databaseId, 'ttl'),
      op,
    );
  }

  // ---- export, import, bulk delete -----------------------------------------------------------

  async exportDocuments(h: ProfileHandle, projectId: string, databaseId: string, body: ExportDocuments): Promise<OperationSummary> {
    const admin = await this.fs.admin(h.profile.id, 'Managed export');
    const [op] = await admin.exportDocuments({
      name: this.db(projectId, databaseId),
      collectionIds: body.collectionIds ?? [],
      outputUriPrefix: body.outputUriPrefix,
      ...(body.snapshotTime ? { snapshotTime: isoToProtoTimestamp(body.snapshotTime) } : {}),
    });
    return this.track(
      admin,
      h,
      projectId,
      'firestore.export',
      `Export ${databaseId} to ${body.outputUriPrefix}`,
      this.href(projectId, databaseId, 'transfer'),
      op,
    );
  }

  async importDocuments(h: ProfileHandle, projectId: string, databaseId: string, body: ImportDocuments): Promise<OperationSummary> {
    const admin = await this.fs.admin(h.profile.id, 'Managed import');
    const [op] = await admin.importDocuments({
      name: this.db(projectId, databaseId),
      collectionIds: body.collectionIds ?? [],
      inputUriPrefix: body.inputUriPrefix,
    });
    return this.track(
      admin,
      h,
      projectId,
      'firestore.import',
      `Import ${body.inputUriPrefix} into ${databaseId}`,
      this.href(projectId, databaseId, 'transfer'),
      op,
    );
  }

  async bulkDelete(h: ProfileHandle, projectId: string, databaseId: string, collectionIds: string[]): Promise<OperationSummary> {
    const admin = await this.fs.admin(h.profile.id, 'Bulk delete');
    const [op] = await admin.bulkDeleteDocuments({ name: this.db(projectId, databaseId), collectionIds });
    return this.track(
      admin,
      h,
      projectId,
      'firestore.bulkDelete',
      `Delete every ${collectionIds.join(', ')} document in ${databaseId}`,
      null,
      op,
    );
  }

  /** The database's admin operations, newest first, with their metadata decoded. */
  async adminOperations(h: ProfileHandle, projectId: string, databaseId: string): Promise<FirestoreOperation[]> {
    const admin = await this.fs.admin(h.profile.id, 'Operations');
    const [ops] = await admin.operationsClient.listOperations(
      { name: `${this.db(projectId, databaseId)}/operations`, filter: '' },
      { autoPaginate: false },
    );
    const out: FirestoreOperation[] = [];
    for (const op of (ops ?? []) as Any[]) {
      const type =
        String(op.metadata?.type_url ?? op.metadata?.typeUrl ?? '')
          .split('.')
          .pop() ?? '';
      let metadata: Any = null;
      try {
        const method = METADATA_METHOD[type];
        const decoder = method ? admin.descriptors?.longrunning?.[method]?.metadataDecoder : undefined;
        if (decoder && op.metadata?.value) metadata = decoder(op.metadata.value);
      } catch {
        metadata = null;
      }
      out.push(mapAdminOperation(op, metadata));
    }
    return out.sort((a, b) => (b.startTime ?? '').localeCompare(a.startTime ?? ''));
  }

  // ---- backups -----------------------------------------------------------------------------------

  async backups(h: ProfileHandle, projectId: string): Promise<ListResponse<FirestoreBackup>> {
    const admin = await this.fs.admin(h.profile.id, 'Backups');
    const [res] = await admin.listBackups({ parent: `projects/${projectId}/locations/-` });
    return {
      items: (res.backups ?? [])
        .map(mapBackup)
        .sort((a: FirestoreBackup, b: FirestoreBackup) => (b.snapshotTime ?? '').localeCompare(a.snapshotTime ?? '')),
      nextPageToken: null,
      unreachable: res.unreachable ?? [],
    };
  }

  async deleteBackup(h: ProfileHandle, projectId: string, name: string): Promise<void> {
    if (!name.startsWith(`projects/${projectId}/locations/`))
      throw ProblemException.of('INVALID_ARGUMENT', 'The backup belongs to another project.');
    const admin = await this.fs.admin(h.profile.id, 'Backups');
    await admin.deleteBackup({ name });
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'firestore',
      kind: 'firestore.backup.delete',
      resource: { name, displayName: `Delete backup ${name.split('/').pop()}`, href: null },
    });
  }

  async schedules(h: ProfileHandle, projectId: string, databaseId: string): Promise<BackupSchedule[]> {
    const admin = await this.fs.admin(h.profile.id, 'Backup schedules');
    const [res] = await admin.listBackupSchedules({ parent: this.db(projectId, databaseId) });
    return (res.backupSchedules ?? []).map(mapSchedule);
  }

  private scheduleMessage(body: SaveBackupSchedule): Any {
    return {
      retention: { seconds: body.retentionDays * 86_400, nanos: 0 },
      ...(body.recurrence === 'weekly' ? { weeklyRecurrence: { day: body.day ?? 'MONDAY' } } : { dailyRecurrence: {} }),
    };
  }

  async createSchedule(h: ProfileHandle, projectId: string, databaseId: string, body: SaveBackupSchedule): Promise<BackupSchedule> {
    if (body.recurrence === 'daily' && body.retentionDays > 7)
      throw ProblemException.of('INVALID_ARGUMENT', 'Daily backups can be kept for up to 7 days; weekly ones for up to 14 weeks.');
    const admin = await this.fs.admin(h.profile.id, 'Backup schedules');
    const [s] = await admin.createBackupSchedule({ parent: this.db(projectId, databaseId), backupSchedule: this.scheduleMessage(body) });
    this.recordSchedule(h, projectId, databaseId, 'create', String(s.name));
    return mapSchedule(s);
  }

  async updateSchedule(
    h: ProfileHandle,
    projectId: string,
    databaseId: string,
    name: string,
    body: SaveBackupSchedule,
  ): Promise<BackupSchedule> {
    if (!name.startsWith(`${this.db(projectId, databaseId)}/backupSchedules/`))
      throw ProblemException.of('INVALID_ARGUMENT', 'The schedule belongs to another database.');
    const admin = await this.fs.admin(h.profile.id, 'Backup schedules');
    // Recurrence cannot change after creation; only retention can.
    const [s] = await admin.updateBackupSchedule({
      backupSchedule: { name, retention: { seconds: body.retentionDays * 86_400, nanos: 0 } },
      updateMask: { paths: ['retention'] },
    });
    this.recordSchedule(h, projectId, databaseId, 'update', name);
    return mapSchedule(s);
  }

  async deleteSchedule(h: ProfileHandle, projectId: string, databaseId: string, name: string): Promise<void> {
    if (!name.startsWith(`${this.db(projectId, databaseId)}/backupSchedules/`))
      throw ProblemException.of('INVALID_ARGUMENT', 'The schedule belongs to another database.');
    const admin = await this.fs.admin(h.profile.id, 'Backup schedules');
    await admin.deleteBackupSchedule({ name });
    this.recordSchedule(h, projectId, databaseId, 'delete', name);
  }

  private recordSchedule(h: ProfileHandle, projectId: string, databaseId: string, verb: string, name: string) {
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'firestore',
      kind: `firestore.backupSchedule.${verb}`,
      resource: {
        name,
        displayName: `${verb[0]?.toUpperCase()}${verb.slice(1)} backup schedule`,
        href: this.href(projectId, databaseId, 'backups'),
      },
    });
  }
}
