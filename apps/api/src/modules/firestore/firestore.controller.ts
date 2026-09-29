import {
  type AggregationResult,
  type BackupSchedule,
  type BulkDelete,
  BulkDeleteSchema,
  type CloneDatabase,
  CloneDatabaseSchema,
  type CollectionIdsPage,
  type Confirm,
  ConfirmSchema,
  type CreateDatabase,
  CreateDatabaseSchema,
  type CreateDocument,
  CreateDocumentSchema,
  type CreateIndex,
  CreateIndexSchema,
  DatabaseIdSchema,
  type DeleteCollection,
  DeleteCollectionSchema,
  type DeleteDocument,
  DeleteDocumentSchema,
  DocumentPathSchema,
  type DocumentsPage,
  type ExportDocuments,
  ExportDocumentsSchema,
  type FieldOverride,
  type FirestoreBackup,
  type FirestoreDatabase,
  type FirestoreDocument,
  type FirestoreIndex,
  type FirestoreOperation,
  type ImportBatch,
  type ImportBatchResult,
  ImportBatchSchema,
  type ImportDocuments,
  ImportDocumentsSchema,
  ListCollectionsQuerySchema,
  ListDocumentsQuerySchema,
  type ListResponse,
  type OperationAccepted,
  ProjectIdParamSchema,
  type PublishRules,
  PublishRulesSchema,
  type QueryResult,
  RestoreBackupSchema,
  type Ruleset,
  type RulesIssue,
  type RulesState,
  type RulesTestResult,
  type RunAggregation,
  RunAggregationSchema,
  type RunQuery,
  RunQuerySchema,
  type SaveBackupSchedule,
  SaveBackupScheduleSchema,
  type SaveDocument,
  SaveDocumentSchema,
  type SetFieldIndexes,
  SetFieldIndexesSchema,
  type SetTtl,
  SetTtlSchema,
  type TestRules,
  TestRulesSchema,
  type UpdateDatabase,
  UpdateDatabaseSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { FirestoreAdminService } from './firestore-admin.service.js';
import { FirestoreDataService } from './firestore-data.service.js';
import { FirestoreRulesService } from './firestore-rules.service.js';

const p = { schema: ProjectIdParamSchema };
const d = { schema: DatabaseIdSchema };
const pathQuery = { schema: z.object({ path: DocumentPathSchema.refine((x) => x !== '', 'A document path is required') }) };
const nameBody = z.object({ name: z.string().min(1).max(1024) });
const DB = 'projects/:projectId/databases/:database';

/** Firestore (SPEC-0004). Document paths travel in `?path=` since they contain slashes. */
@Controller('api/projects/:projectId/firestore')
export class FirestoreController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly data: FirestoreDataService,
    private readonly admin: FirestoreAdminService,
    private readonly rules: FirestoreRulesService,
  ) {}

  // ---- databases ------------------------------------------------------------------------------

  @Get('databases')
  databases(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<FirestoreDatabase[]> {
    return this.data.databases(this.profiles.get(profileId), projectId);
  }

  @Post('databases')
  @Mutation({ product: 'firestore', verb: 'database.create', resource: 'projects/:projectId/databases' })
  async createDatabase(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateDatabaseSchema }) body: CreateDatabase,
  ): Promise<OperationAccepted> {
    return { operation: await this.admin.createDatabase(this.profiles.get(profileId), projectId, body) };
  }

  @Patch('databases/:database')
  @Mutation({ product: 'firestore', verb: 'database.update', resource: DB })
  async updateDatabase(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: UpdateDatabaseSchema }) body: UpdateDatabase,
  ): Promise<OperationAccepted> {
    return { operation: await this.admin.updateDatabase(this.profiles.get(profileId), projectId, database, body) };
  }

  @Delete('databases/:database')
  @Mutation({ product: 'firestore', verb: 'database.delete', resource: DB })
  async deleteDatabase(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<OperationAccepted> {
    requireConfirmation(body.confirm, database);
    return { operation: await this.admin.deleteDatabase(this.profiles.get(profileId), projectId, database) };
  }

  @Post('databases/:database/clone')
  @Mutation({ product: 'firestore', verb: 'database.clone', resource: DB })
  async clone(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: CloneDatabaseSchema }) body: CloneDatabase,
  ): Promise<OperationAccepted> {
    return { operation: await this.admin.cloneDatabase(this.profiles.get(profileId), projectId, database, body) };
  }

  // ---- data ---------------------------------------------------------------------------------------

  @Get('databases/:database/collections')
  collections(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Query({ schema: ListCollectionsQuerySchema }) q: z.infer<typeof ListCollectionsQuerySchema>,
  ): Promise<CollectionIdsPage> {
    return this.data.collections(this.profiles.get(profileId), projectId, database, q);
  }

  @Get('databases/:database/documents')
  documents(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Query({ schema: ListDocumentsQuerySchema }) q: z.infer<typeof ListDocumentsQuerySchema>,
  ): Promise<DocumentsPage> {
    return this.data.documents(this.profiles.get(profileId), projectId, database, q);
  }

  @Get('databases/:database/document')
  document(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Query(pathQuery) q: { path: string },
  ): Promise<FirestoreDocument> {
    return this.data.get(this.profiles.get(profileId), projectId, database, q.path);
  }

  @Post('databases/:database/documents')
  @Mutation({ product: 'firestore', verb: 'document.create', resource: DB })
  create(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: CreateDocumentSchema }) body: CreateDocument,
  ): Promise<FirestoreDocument> {
    return this.data.create(this.profiles.get(profileId), projectId, database, body);
  }

  @Put('databases/:database/document')
  @Mutation({ product: 'firestore', verb: 'document.update', resource: DB })
  save(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Query(pathQuery) q: { path: string },
    @Body({ schema: SaveDocumentSchema }) body: SaveDocument,
  ): Promise<FirestoreDocument> {
    return this.data.save(this.profiles.get(profileId), projectId, database, q.path, body);
  }

  @Delete('databases/:database/document')
  @Mutation({ product: 'firestore', verb: 'document.delete', resource: DB })
  async remove(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Query(pathQuery) q: { path: string },
    @Body({ schema: DeleteDocumentSchema }) body: DeleteDocument,
  ): Promise<OperationAccepted | { operation: null }> {
    requireConfirmation(body.confirm, q.path.split('/').pop() ?? '');
    const h = this.profiles.get(profileId);
    if (body.recursive) return { operation: this.data.recursiveDelete(h, projectId, database, { document: q.path }, null) };
    await this.data.remove(h, projectId, database, q.path);
    return { operation: null };
  }

  /** Documents in a collection, for the typed confirmation of a collection delete (D-05). */
  @Get('databases/:database/count')
  async count(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Query({ schema: z.object({ collection: DocumentPathSchema }) }) q: { collection: string },
  ): Promise<{ count: number }> {
    return { count: await this.data.count(this.profiles.get(profileId), projectId, database, q.collection) };
  }

  @Post('databases/:database/delete-collection')
  @HttpCode(202)
  @Mutation({ product: 'firestore', verb: 'collection.delete', resource: DB })
  async deleteCollection(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: DeleteCollectionSchema }) body: DeleteCollection,
  ): Promise<OperationAccepted> {
    const h = this.profiles.get(profileId);
    const count = await this.data.count(h, projectId, database, body.collection);
    requireConfirmation(body.confirm.replaceAll(/[,.\s]/g, ''), String(count));
    return { operation: this.data.recursiveDelete(h, projectId, database, { collection: body.collection }, count) };
  }

  @Post('databases/:database/query')
  @HttpCode(200)
  query(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: RunQuerySchema }) body: RunQuery & z.infer<typeof RunQuerySchema>,
  ): Promise<QueryResult> {
    return this.data.query(this.profiles.get(profileId), projectId, database, body.query, body.explain);
  }

  @Post('databases/:database/aggregate')
  @HttpCode(200)
  aggregate(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: RunAggregationSchema }) body: RunAggregation & z.infer<typeof RunAggregationSchema>,
  ): Promise<AggregationResult> {
    return this.data.aggregate(this.profiles.get(profileId), projectId, database, body.query, body.aggregations, body.explain);
  }

  @Post('databases/:database/import-batch')
  @HttpCode(200)
  @Mutation({ product: 'firestore', verb: 'documents.import', resource: DB })
  importBatch(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: ImportBatchSchema }) body: ImportBatch,
  ): Promise<ImportBatchResult> {
    return this.data.importBatch(this.profiles.get(profileId), projectId, database, body);
  }

  // ---- indexes, fields, TTL -----------------------------------------------------------------------

  @Get('databases/:database/indexes')
  indexes(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
  ): Promise<FirestoreIndex[]> {
    return this.admin.indexes(this.profiles.get(profileId), projectId, database);
  }

  @Post('databases/:database/indexes')
  @Mutation({ product: 'firestore', verb: 'index.create', resource: DB })
  async createIndex(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: CreateIndexSchema }) body: CreateIndex,
  ): Promise<OperationAccepted> {
    return { operation: await this.admin.createIndex(this.profiles.get(profileId), projectId, database, body) };
  }

  @Post('databases/:database/indexes/delete')
  @HttpCode(204)
  @Mutation({ product: 'firestore', verb: 'index.delete', resource: DB })
  async deleteIndex(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: nameBody }) body: { name: string },
  ): Promise<void> {
    await this.admin.deleteIndex(this.profiles.get(profileId), projectId, database, body.name);
  }

  @Get('databases/:database/fields')
  fields(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Query({ schema: z.object({ kind: z.enum(['overrides', 'ttl']) }) }) q: { kind: 'overrides' | 'ttl' },
  ): Promise<FieldOverride[]> {
    return this.admin.fields(this.profiles.get(profileId), projectId, database, q.kind);
  }

  @Put('databases/:database/fields/indexes')
  @Mutation({ product: 'firestore', verb: 'field.indexes', resource: DB })
  async setFieldIndexes(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: SetFieldIndexesSchema }) body: SetFieldIndexes,
  ): Promise<OperationAccepted> {
    return { operation: await this.admin.setFieldIndexes(this.profiles.get(profileId), projectId, database, body) };
  }

  @Put('databases/:database/fields/ttl')
  @Mutation({ product: 'firestore', verb: 'field.ttl', resource: DB })
  async setTtl(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: SetTtlSchema }) body: SetTtl,
  ): Promise<OperationAccepted> {
    return { operation: await this.admin.setTtl(this.profiles.get(profileId), projectId, database, body) };
  }

  // ---- export, import, bulk delete, operations -------------------------------------------------------

  @Post('databases/:database/export')
  @Mutation({ product: 'firestore', verb: 'database.export', resource: DB })
  async exportDocuments(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: ExportDocumentsSchema }) body: ExportDocuments,
  ): Promise<OperationAccepted> {
    return { operation: await this.admin.exportDocuments(this.profiles.get(profileId), projectId, database, body) };
  }

  @Post('databases/:database/import')
  @Mutation({ product: 'firestore', verb: 'database.import', resource: DB })
  async importDocuments(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: ImportDocumentsSchema }) body: ImportDocuments,
  ): Promise<OperationAccepted> {
    return { operation: await this.admin.importDocuments(this.profiles.get(profileId), projectId, database, body) };
  }

  @Post('databases/:database/bulk-delete')
  @Mutation({ product: 'firestore', verb: 'documents.bulkDelete', resource: DB })
  async bulkDelete(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: BulkDeleteSchema }) body: BulkDelete,
  ): Promise<OperationAccepted> {
    requireConfirmation(body.confirm, database);
    return { operation: await this.admin.bulkDelete(this.profiles.get(profileId), projectId, database, body.collectionIds) };
  }

  @Get('databases/:database/operations')
  operations(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
  ): Promise<FirestoreOperation[]> {
    return this.admin.adminOperations(this.profiles.get(profileId), projectId, database);
  }

  // ---- backups -------------------------------------------------------------------------------------

  @Get('backups')
  backups(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ListResponse<FirestoreBackup>> {
    return this.admin.backups(this.profiles.get(profileId), projectId);
  }

  @Post('backups/delete')
  @HttpCode(204)
  @Mutation({ product: 'firestore', verb: 'backup.delete', resource: 'projects/:projectId/backups' })
  async deleteBackup(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: nameBody.extend({ confirm: z.string().min(1) }) }) body: { name: string; confirm: string },
  ): Promise<void> {
    requireConfirmation(body.confirm, body.name.split('/').pop() ?? '');
    await this.admin.deleteBackup(this.profiles.get(profileId), projectId, body.name);
  }

  @Post('restore')
  @Mutation({ product: 'firestore', verb: 'backup.restore', resource: 'projects/:projectId/databases' })
  async restore(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: RestoreBackupSchema.extend({ confirm: z.string().min(1) }) }) body: z.infer<typeof RestoreBackupSchema> & {
      confirm: string;
    },
  ): Promise<OperationAccepted> {
    requireConfirmation(body.confirm, body.targetId);
    return { operation: await this.admin.restore(this.profiles.get(profileId), projectId, body) };
  }

  @Get('databases/:database/backup-schedules')
  schedules(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
  ): Promise<BackupSchedule[]> {
    return this.admin.schedules(this.profiles.get(profileId), projectId, database);
  }

  @Post('databases/:database/backup-schedules')
  @Mutation({ product: 'firestore', verb: 'backupSchedule.create', resource: DB })
  createSchedule(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: SaveBackupScheduleSchema }) body: SaveBackupSchedule,
  ): Promise<BackupSchedule> {
    return this.admin.createSchedule(this.profiles.get(profileId), projectId, database, body);
  }

  @Put('databases/:database/backup-schedules/:schedule')
  @Mutation({ product: 'firestore', verb: 'backupSchedule.update', resource: DB })
  updateSchedule(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Param('schedule', { schema: z.string().min(1).max(100) }) schedule: string,
    @Body({ schema: SaveBackupScheduleSchema }) body: SaveBackupSchedule,
  ): Promise<BackupSchedule> {
    return this.admin.updateSchedule(
      this.profiles.get(profileId),
      projectId,
      database,
      `projects/${projectId}/databases/${database}/backupSchedules/${schedule}`,
      body,
    );
  }

  @Delete('databases/:database/backup-schedules/:schedule')
  @HttpCode(204)
  @Mutation({ product: 'firestore', verb: 'backupSchedule.delete', resource: DB })
  async deleteSchedule(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Param('schedule', { schema: z.string().min(1).max(100) }) schedule: string,
  ): Promise<void> {
    await this.admin.deleteSchedule(
      this.profiles.get(profileId),
      projectId,
      database,
      `projects/${projectId}/databases/${database}/backupSchedules/${schedule}`,
    );
  }

  // ---- rules --------------------------------------------------------------------------------------------

  @Get('databases/:database/rules')
  rulesState(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
  ): Promise<RulesState> {
    return this.rules.state(this.profiles.get(profileId), projectId, database);
  }

  @Get('rulesets/:ruleset')
  ruleset(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('ruleset', { schema: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/) }) ruleset: string,
  ): Promise<Ruleset> {
    return this.rules.ruleset(this.profiles.get(profileId), projectId, ruleset);
  }

  @Post('rules/validate')
  @HttpCode(200)
  validateRules(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({
      schema: z.object({
        source: z
          .string()
          .min(1)
          .max(256 * 1024),
      }),
    })
    body: { source: string },
  ): Promise<RulesIssue[]> {
    return this.rules.validate(this.profiles.get(profileId), projectId, body.source);
  }

  @Post('databases/:database/rules')
  @Mutation({ product: 'firestore', verb: 'rules.publish', resource: DB })
  publishRules(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: PublishRulesSchema }) body: PublishRules,
  ): Promise<{ ruleset: Ruleset; issues: RulesIssue[] }> {
    return this.rules.publish(this.profiles.get(profileId), projectId, database, body);
  }

  @Post('databases/:database/rules/test')
  @HttpCode(200)
  testRules(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('database', d) database: string,
    @Body({ schema: TestRulesSchema }) body: TestRules & z.infer<typeof TestRulesSchema>,
  ): Promise<{ issues: RulesIssue[]; results: RulesTestResult[] }> {
    return this.rules.test(this.profiles.get(profileId), projectId, database, body);
  }
}
