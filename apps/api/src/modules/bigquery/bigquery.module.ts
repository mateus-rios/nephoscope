import { randomUUID } from 'node:crypto';
import {
  BQ_DOWNLOAD_MAX_ROWS,
  type BqDatasetSummary,
  type BqDatasetView,
  type BqDryRun,
  type BqDryRunResult,
  BqDryRunSchema,
  type BqExport,
  BqExportSchema,
  type BqField,
  type BqJobDetail,
  type BqJobListQuery,
  BqJobListQuerySchema,
  type BqJobSummary,
  type BqModelSummary,
  BqPreviewQuerySchema,
  type BqResultsPage,
  type BqRoutineSummary,
  type BqRun,
  BqRunSchema,
  type BqTableSummary,
  type BqTableView,
  bqErrorPosition,
  bqRow,
  type Confirm,
  ConfirmSchema,
  type CopyBqTable,
  CopyBqTableSchema,
  type CreateBqDataset,
  CreateBqDatasetSchema,
  type CreateBqTable,
  CreateBqTableSchema,
  type DeleteBqDataset,
  DeleteBqDatasetSchema,
  type ListResponse,
  type OperationAccepted,
  ProjectIdParamSchema,
  type UpdateBqDataset,
  UpdateBqDatasetSchema,
  type UpdateBqTable,
  UpdateBqTableSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Module, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { NEPHOSCOPE_CONFIG, type NephoscopeConfig } from '../../core/config/config.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { rest } from '../../core/gcp/rest.js';
import { RestOperations } from '../../core/gcp/rest-ops.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';
import {
  csvCell,
  mapDataset,
  mapDatasetSummary,
  mapField,
  mapJob,
  mapJobDetail,
  mapTable,
  mapTableSummary,
  queryParameters,
} from './bigquery.mapping.js';

// biome-ignore lint/suspicious/noExplicitAny: BigQuery REST resources are read field by field.
type Any = any;

const BQ = 'https://bigquery.googleapis.com/bigquery/v2/';
const enc = encodeURIComponent;

/** BigQuery through REST (SPEC-0008 D-01 to D-04, SPEC-0001 D-29). */
@Injectable()
export class BigQueryService {
  constructor(
    private readonly restOps: RestOperations,
    private readonly operations: OperationsService,
    @Inject(NEPHOSCOPE_CONFIG) private readonly config: NephoscopeConfig,
  ) {}

  private client(h: ProfileHandle) {
    return rest(h, BQ);
  }

  private tablePath(p: string, d: string, t: string) {
    return `projects/${enc(p)}/datasets/${enc(d)}/tables/${enc(t)}`;
  }

  private record(h: ProfileHandle, projectId: string, kind: string, name: string, displayName: string) {
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'bigquery',
      kind,
      resource: { name, displayName, href: `/p/${projectId}/bigquery` },
    });
  }

  // ---- Explorer ---------------------------------------------------------------------------

  async datasets(h: ProfileHandle, project: string): Promise<BqDatasetSummary[]> {
    const all = await this.client(h).all<Any>(`projects/${enc(project)}/datasets`, 'datasets', { maxResults: 1000 }, 5000);
    return all.map(mapDatasetSummary).sort((a, b) => a.datasetId.localeCompare(b.datasetId));
  }

  async dataset(h: ProfileHandle, project: string, dataset: string): Promise<BqDatasetView> {
    return mapDataset(await this.client(h).get<Any>(`projects/${enc(project)}/datasets/${enc(dataset)}`));
  }

  async createDataset(h: ProfileHandle, projectId: string, b: CreateBqDataset): Promise<BqDatasetView> {
    const d = await this.client(h).post<Any>(`projects/${enc(projectId)}/datasets`, {
      datasetReference: { projectId, datasetId: b.datasetId },
      location: b.location,
      description: b.description || undefined,
      defaultTableExpirationMs: b.defaultTableExpirationDays ? String(b.defaultTableExpirationDays * 86_400_000) : undefined,
      labels: b.labels,
    });
    this.record(h, projectId, 'bigquery.dataset.create', b.datasetId, `Create dataset ${b.datasetId}`);
    return mapDataset(d);
  }

  async updateDataset(h: ProfileHandle, projectId: string, project: string, dataset: string, b: UpdateBqDataset): Promise<BqDatasetView> {
    const d = await this.client(h).call<Any>(`projects/${enc(project)}/datasets/${enc(dataset)}`, {
      method: 'PATCH',
      headers: b.etag ? { 'If-Match': b.etag } : undefined,
      body: {
        description: b.description,
        labels: b.labels,
        defaultTableExpirationMs:
          b.defaultTableExpirationDays === undefined
            ? undefined
            : b.defaultTableExpirationDays === null
              ? null
              : String(b.defaultTableExpirationDays * 86_400_000),
      },
    });
    this.record(h, projectId, 'bigquery.dataset.update', dataset, `Update dataset ${dataset}`);
    return mapDataset(d);
  }

  /** A dataset with tables needs the number of tables typed as well (SPEC-0008 D-01). */
  async deleteDataset(h: ProfileHandle, projectId: string, project: string, dataset: string, b: DeleteBqDataset): Promise<void> {
    requireConfirmation(b.confirm, dataset);
    const tables = (await this.tables(h, project, dataset)).length;
    if (tables > 0 && b.tables !== tables) {
      throw ProblemException.of(
        'FAILED_PRECONDITION',
        `The dataset has ${tables} tables. Type the number of tables to delete them with it.`,
        {
          reason: 'TABLE_COUNT',
        },
      );
    }
    await this.client(h).delete(`projects/${enc(project)}/datasets/${enc(dataset)}`, tables > 0 ? { deleteContents: true } : undefined);
    this.record(h, projectId, 'bigquery.dataset.delete', dataset, `Delete dataset ${dataset}`);
  }

  async tables(h: ProfileHandle, project: string, dataset: string): Promise<BqTableSummary[]> {
    const all = await this.client(h).all<Any>(
      `projects/${enc(project)}/datasets/${enc(dataset)}/tables`,
      'tables',
      { maxResults: 1000 },
      20_000,
    );
    return all.map(mapTableSummary).sort((a, b) => a.tableId.localeCompare(b.tableId));
  }

  async routines(h: ProfileHandle, project: string, dataset: string): Promise<BqRoutineSummary[]> {
    const all = await this.client(h).all<Any>(`projects/${enc(project)}/datasets/${enc(dataset)}/routines`, 'routines', {}, 5000);
    return all.map((r) => ({
      routineId: String(r?.routineReference?.routineId ?? ''),
      type: String(r?.routineType ?? ''),
      language: r?.language ?? null,
    }));
  }

  async models(h: ProfileHandle, project: string, dataset: string): Promise<BqModelSummary[]> {
    const all = await this.client(h).all<Any>(`projects/${enc(project)}/datasets/${enc(dataset)}/models`, 'models', {}, 5000);
    return all.map((m) => ({ modelId: String(m?.modelReference?.modelId ?? ''), type: m?.modelType ?? null }));
  }

  async table(h: ProfileHandle, project: string, dataset: string, table: string): Promise<BqTableView> {
    return mapTable(await this.client(h).get<Any>(this.tablePath(project, dataset, table)));
  }

  async createTable(h: ProfileHandle, projectId: string, project: string, dataset: string, b: CreateBqTable): Promise<BqTableView> {
    let fields: unknown;
    try {
      const parsed = JSON.parse(b.schemaJson) as unknown;
      fields = Array.isArray(parsed) ? parsed : (parsed as { fields?: unknown })?.fields;
    } catch (err) {
      throw ProblemException.of('INVALID_ARGUMENT', `The schema is not valid JSON: ${(err as Error).message}`, {
        errors: [{ path: 'schemaJson', message: 'Not JSON' }],
      });
    }
    if (!Array.isArray(fields) || fields.length === 0)
      throw ProblemException.of('INVALID_ARGUMENT', 'The schema must be a non-empty array of fields.', {
        errors: [{ path: 'schemaJson', message: 'Not a field list' }],
      });
    const t = await this.client(h).post<Any>(`projects/${enc(project)}/datasets/${enc(dataset)}/tables`, {
      tableReference: { projectId: project, datasetId: dataset, tableId: b.tableId },
      schema: { fields },
      description: b.description || undefined,
      expirationTime: b.expirationDays ? String(Date.now() + b.expirationDays * 86_400_000) : undefined,
      labels: b.labels,
    });
    this.record(h, projectId, 'bigquery.table.create', b.tableId, `Create table ${b.tableId}`);
    return mapTable(t);
  }

  async updateTable(
    h: ProfileHandle,
    projectId: string,
    project: string,
    dataset: string,
    table: string,
    b: UpdateBqTable,
  ): Promise<BqTableView> {
    const t = await this.client(h).call<Any>(this.tablePath(project, dataset, table), {
      method: 'PATCH',
      headers: b.etag ? { 'If-Match': b.etag } : undefined,
      body: {
        description: b.description,
        labels: b.labels,
        expirationTime: b.expirationTime,
        view: b.viewQuery ? { query: b.viewQuery, useLegacySql: false } : undefined,
      },
    });
    this.record(
      h,
      projectId,
      b.viewQuery ? 'bigquery.view.update' : 'bigquery.table.update',
      table,
      `${b.viewQuery ? 'Update view' : 'Update table'} ${table}`,
    );
    return mapTable(t);
  }

  async deleteTable(h: ProfileHandle, projectId: string, project: string, dataset: string, table: string): Promise<void> {
    await this.client(h).delete(this.tablePath(project, dataset, table));
    this.record(h, projectId, 'bigquery.table.delete', table, `Delete table ${table}`);
  }

  /** `tabledata.list`: rows without running a query, so nothing is billed (SPEC-0008 D-01, T-05). */
  async preview(
    h: ProfileHandle,
    project: string,
    dataset: string,
    table: string,
    q: { pageToken?: string; maxResults: number },
  ): Promise<BqResultsPage> {
    const t = await this.client(h).get<Any>(this.tablePath(project, dataset, table), { fields: 'schema,numRows' });
    const schema = ((t?.schema?.fields ?? []) as Any[]).map(mapField);
    const data = await this.client(h).get<Any>(`${this.tablePath(project, dataset, table)}/data`, {
      maxResults: q.maxResults,
      pageToken: q.pageToken,
      'formatOptions.useInt64Timestamp': true,
    });
    return {
      schema,
      rows: ((data?.rows ?? []) as Any[]).map((r) => bqRow(schema, r)),
      totalRows: data?.totalRows ?? t?.numRows ?? null,
      pageToken: data?.pageToken ?? null,
      jobComplete: true,
    };
  }

  // ---- Jobs ---------------------------------------------------------------------------------

  private track(h: ProfileHandle, projectId: string, job: Any, kind: string, displayName: string): OperationAccepted {
    const ref = job?.jobReference ?? {};
    const operation = this.restOps.track(h, {
      projectId,
      product: 'bigquery',
      kind,
      resource: {
        name: String(ref.jobId ?? ''),
        displayName,
        href: `/p/${projectId}/bigquery?job=${enc(`${ref.location ?? ''}/${ref.jobId ?? ''}`)}`,
      },
      root: BQ,
      response: { ...job, kind: 'bigquery#job' },
      cancel: () => this.cancel(h, projectId, String(ref.location ?? ''), String(ref.jobId ?? '')),
    });
    return { operation };
  }

  private async insertJob(h: ProfileHandle, projectId: string, location: string | undefined, configuration: Any): Promise<Any> {
    return this.client(h).post<Any>(`projects/${enc(projectId)}/jobs`, {
      jobReference: { projectId, jobId: `nephoscope_${randomUUID().replaceAll('-', '_')}`, location },
      configuration: { ...configuration, labels: { client: 'nephoscope' } },
    });
  }

  /** Validates and prices a query without running it (SPEC-0008 D-02). Errors are part of the answer. */
  async dryRun(h: ProfileHandle, projectId: string, b: BqDryRun): Promise<BqDryRunResult> {
    try {
      const job = await this.client(h).post<Any>(`projects/${enc(projectId)}/jobs`, {
        jobReference: { projectId, location: b.location },
        configuration: {
          dryRun: true,
          query: {
            query: b.query,
            useLegacySql: false,
            parameterMode: b.params.length ? 'NAMED' : undefined,
            queryParameters: queryParameters(b.params),
          },
        },
      });
      const q = job?.statistics?.query ?? {};
      return {
        ok: true,
        totalBytesProcessed: q.totalBytesProcessed ?? job?.statistics?.totalBytesProcessed ?? '0',
        statementType: q.statementType ?? null,
        referencedTables: ((q.referencedTables ?? []) as Any[]).map((t) => `${t.projectId}.${t.datasetId}.${t.tableId}`),
        error: null,
      };
    } catch (err) {
      const status = (err as Any)?.response?.status;
      if (status !== 400 && status !== 403 && status !== 404) throw err;
      const message = toProblem(err).detail;
      return {
        ok: false,
        totalBytesProcessed: null,
        statementType: null,
        referencedTables: [],
        error: { message, ...bqErrorPosition(message) },
      };
    }
  }

  /**
   * Runs a query as a tracked, cancellable job with a ceiling on bytes billed (SPEC-0008 D-02,
   * D-04). A read-only profile may run only a SELECT without a destination table.
   */
  async run(
    h: ProfileHandle,
    projectId: string,
    b: BqRun,
  ): Promise<OperationAccepted & { job: { projectId: string; jobId: string; location: string } }> {
    if (this.config.readOnly || h.profile.readOnly) {
      const who = this.config.readOnly ? 'This Nephoscope instance is read-only' : `The profile "${h.profile.name}" is read-only`;
      if (b.destination) throw ProblemException.of('READ_ONLY', `${who}: only SELECT queries without a destination table can run.`);
      // Fail closed: a query the dry run cannot prove to be a plain SELECT does not run.
      const dry = await this.dryRun(h, projectId, b);
      if (!dry.ok)
        throw ProblemException.of('READ_ONLY', `${who}, and the query could not be checked: ${dry.error?.message ?? 'the dry run failed'}`);
      if (dry.statementType !== 'SELECT')
        throw ProblemException.of('READ_ONLY', `${who}: only SELECT queries without a destination table can run.`);
    }
    const job = await this.insertJob(h, projectId, b.location, {
      query: {
        query: b.query,
        useLegacySql: false,
        maximumBytesBilled: b.maximumBytesBilled,
        parameterMode: b.params.length ? 'NAMED' : undefined,
        queryParameters: queryParameters(b.params),
        destinationTable: b.destination ? { projectId, datasetId: b.destination.datasetId, tableId: b.destination.tableId } : undefined,
        writeDisposition: b.destination?.writeDisposition,
      },
    });
    const firstLine = b.query.trim().split('\n')[0]?.slice(0, 60) ?? '';
    const accepted = this.track(h, projectId, job, 'bigquery.query', `Query ${firstLine}`);
    const ref = job?.jobReference ?? {};
    return { ...accepted, job: { projectId: String(ref.projectId), jobId: String(ref.jobId), location: String(ref.location ?? '') } };
  }

  async jobs(h: ProfileHandle, projectId: string, q: BqJobListQuery): Promise<ListResponse<BqJobSummary>> {
    const query = { projection: 'full', maxResults: 50, stateFilter: q.state, pageToken: q.pageToken };
    let data: Any;
    try {
      data = await this.client(h).get<Any>(`projects/${enc(projectId)}/jobs`, { ...query, allUsers: true });
    } catch (err) {
      // Listing other users' jobs needs bigquery.jobs.listAll; fall back to the profile's own.
      if ((err as Any)?.response?.status !== 403) throw err;
      data = await this.client(h).get<Any>(`projects/${enc(projectId)}/jobs`, query);
    }
    const items = ((data?.jobs ?? []) as Any[]).map((j) => mapJob(j)).filter((j) => !q.principal || j.user === q.principal);
    return { items, nextPageToken: data?.nextPageToken ?? null };
  }

  async job(h: ProfileHandle, projectId: string, location: string, jobId: string): Promise<BqJobDetail> {
    return mapJobDetail(await this.client(h).get<Any>(`projects/${enc(projectId)}/jobs/${enc(jobId)}`, { location }));
  }

  async results(
    h: ProfileHandle,
    projectId: string,
    location: string,
    jobId: string,
    pageToken: string | undefined,
    maxResults: number,
  ): Promise<BqResultsPage> {
    const data = await this.client(h).get<Any>(`projects/${enc(projectId)}/queries/${enc(jobId)}`, {
      location,
      pageToken,
      maxResults,
      timeoutMs: 0,
      'formatOptions.useInt64Timestamp': true,
    });
    const schema: BqField[] = ((data?.schema?.fields ?? []) as Any[]).map(mapField);
    return {
      schema,
      rows: ((data?.rows ?? []) as Any[]).map((r) => bqRow(schema, r)),
      totalRows: data?.totalRows ?? null,
      pageToken: data?.pageToken ?? null,
      jobComplete: data?.jobComplete !== false,
    };
  }

  async cancel(h: ProfileHandle, projectId: string, location: string, jobId: string): Promise<void> {
    await this.client(h).post(`projects/${enc(projectId)}/jobs/${enc(jobId)}/cancel`, {}, { location });
  }

  /** Streams up to 100,000 result rows as CSV or JSON lines (SPEC-0008 D-03). */
  async download(
    h: ProfileHandle,
    projectId: string,
    location: string,
    jobId: string,
    format: 'csv' | 'json',
    res: Response,
  ): Promise<void> {
    const first = await this.results(h, projectId, location, jobId, undefined, 10_000);
    if (!first.jobComplete) throw ProblemException.of('FAILED_PRECONDITION', 'The job has not finished.');
    if (Number(first.totalRows ?? 0) > BQ_DOWNLOAD_MAX_ROWS) {
      throw ProblemException.of(
        'FAILED_PRECONDITION',
        `The results have ${first.totalRows} rows; downloads stop at ${BQ_DOWNLOAD_MAX_ROWS}. Export them to Cloud Storage instead.`,
        {
          reason: 'TOO_MANY_ROWS',
        },
      );
    }
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${jobId}.${format === 'csv' ? 'csv' : 'jsonl'}"`);
    res.setHeader('Cache-Control', 'no-store');
    const names = first.schema.map((f) => f.name);
    if (format === 'csv') res.write(`${names.map((n) => csvCell(n)).join(',')}\n`);
    let page: BqResultsPage | null = first;
    let written = 0;
    while (page && written < BQ_DOWNLOAD_MAX_ROWS) {
      for (const row of page.rows) {
        if (written >= BQ_DOWNLOAD_MAX_ROWS) break;
        res.write(
          format === 'csv'
            ? `${row.map(csvCell).join(',')}\n`
            : `${JSON.stringify(Object.fromEntries(names.map((n, i) => [n, row[i] ?? null])))}\n`,
        );
        written++;
      }
      page = page.pageToken ? await this.results(h, projectId, location, jobId, page.pageToken, 10_000) : null;
    }
    res.end();
  }

  /** Exports a query's results to Cloud Storage with an extract job (SPEC-0008 D-03). */
  async exportResults(h: ProfileHandle, projectId: string, location: string, jobId: string, b: BqExport): Promise<OperationAccepted> {
    const job = await this.job(h, projectId, location, jobId);
    if (!job.destination) throw ProblemException.of('FAILED_PRECONDITION', 'The job has no result table to export.');
    const extract = await this.insertJob(h, projectId, location, {
      extract: { sourceTable: job.destination, destinationUris: [b.uri], destinationFormat: b.format },
    });
    return this.track(h, projectId, extract, 'bigquery.export', `Export results to ${b.uri}`);
  }

  async copyTable(
    h: ProfileHandle,
    projectId: string,
    project: string,
    dataset: string,
    table: string,
    b: CopyBqTable,
  ): Promise<OperationAccepted> {
    const source = await this.client(h).get<Any>(this.tablePath(project, dataset, table), { fields: 'location' });
    const job = await this.insertJob(h, projectId, source?.location, {
      copy: {
        sourceTable: { projectId: project, datasetId: dataset, tableId: table },
        destinationTable: { projectId: b.projectId ?? projectId, datasetId: b.datasetId, tableId: b.tableId },
        writeDisposition: b.writeDisposition,
      },
    });
    return this.track(h, projectId, job, 'bigquery.copy', `Copy ${table} to ${b.datasetId}.${b.tableId}`);
  }
}

const p = { schema: ProjectIdParamSchema };
const dsProject = { schema: z.string().regex(/^[a-z][-a-z0-9.:]{4,62}[a-z0-9]$/) };
const datasetId = { schema: z.string().regex(/^[A-Za-z0-9_]{1,1024}$/) };
const tableId = {
  schema: z
    .string()
    .min(1)
    .max(1024)
    .regex(/^[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}\p{Zs}$*]+$/u),
};
const loc = { schema: z.string().regex(/^[A-Za-z0-9-]{2,40}$/) };
const jobId = { schema: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/) };
const DS = 'projects/:dsProject/datasets/:dataset';
const TBL = `${DS}/tables/:table`;

@Controller('api/projects/:projectId/bigquery')
export class BigQueryController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly bq: BigQueryService,
  ) {}

  @Get('datasets')
  datasets(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: z.object({ project: dsProject.schema.optional() }) }) q: { project?: string },
  ) {
    return this.bq.datasets(this.profiles.get(profileId), q.project ?? projectId);
  }

  @Post('datasets')
  @Mutation({ product: 'bigquery', verb: 'dataset.create', resource: 'projects/:projectId' })
  createDataset(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateBqDatasetSchema }) b: CreateBqDataset,
  ) {
    return this.bq.createDataset(this.profiles.get(profileId), projectId, b);
  }

  @Get('datasets/:dsProject/:dataset')
  dataset(
    @ProfileId() profileId: string | undefined,
    @Param('dsProject', dsProject) project: string,
    @Param('dataset', datasetId) dataset: string,
  ) {
    return this.bq.dataset(this.profiles.get(profileId), project, dataset);
  }

  @Patch('datasets/:dsProject/:dataset')
  @Mutation({ product: 'bigquery', verb: 'dataset.update', resource: DS })
  updateDataset(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('dsProject', dsProject) project: string,
    @Param('dataset', datasetId) dataset: string,
    @Body({ schema: UpdateBqDatasetSchema }) b: UpdateBqDataset,
  ) {
    return this.bq.updateDataset(this.profiles.get(profileId), projectId, project, dataset, b);
  }

  @Delete('datasets/:dsProject/:dataset')
  @HttpCode(204)
  @Mutation({ product: 'bigquery', verb: 'dataset.delete', resource: DS })
  async deleteDataset(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('dsProject', dsProject) project: string,
    @Param('dataset', datasetId) dataset: string,
    @Body({ schema: DeleteBqDatasetSchema }) b: DeleteBqDataset,
  ): Promise<void> {
    await this.bq.deleteDataset(this.profiles.get(profileId), projectId, project, dataset, b);
  }

  @Get('datasets/:dsProject/:dataset/tables')
  tables(
    @ProfileId() profileId: string | undefined,
    @Param('dsProject', dsProject) project: string,
    @Param('dataset', datasetId) dataset: string,
  ) {
    return this.bq.tables(this.profiles.get(profileId), project, dataset);
  }

  @Get('datasets/:dsProject/:dataset/routines')
  routines(
    @ProfileId() profileId: string | undefined,
    @Param('dsProject', dsProject) project: string,
    @Param('dataset', datasetId) dataset: string,
  ) {
    return this.bq.routines(this.profiles.get(profileId), project, dataset);
  }

  @Get('datasets/:dsProject/:dataset/models')
  models(
    @ProfileId() profileId: string | undefined,
    @Param('dsProject', dsProject) project: string,
    @Param('dataset', datasetId) dataset: string,
  ) {
    return this.bq.models(this.profiles.get(profileId), project, dataset);
  }

  @Post('datasets/:dsProject/:dataset/tables')
  @Mutation({ product: 'bigquery', verb: 'table.create', resource: DS })
  createTable(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('dsProject', dsProject) project: string,
    @Param('dataset', datasetId) dataset: string,
    @Body({ schema: CreateBqTableSchema }) b: CreateBqTable,
  ) {
    return this.bq.createTable(this.profiles.get(profileId), projectId, project, dataset, b);
  }

  @Get('tables/:dsProject/:dataset/:table')
  table(
    @ProfileId() profileId: string | undefined,
    @Param('dsProject', dsProject) project: string,
    @Param('dataset', datasetId) dataset: string,
    @Param('table', tableId) table: string,
  ) {
    return this.bq.table(this.profiles.get(profileId), project, dataset, table);
  }

  @Get('tables/:dsProject/:dataset/:table/preview')
  preview(
    @ProfileId() profileId: string | undefined,
    @Param('dsProject', dsProject) project: string,
    @Param('dataset', datasetId) dataset: string,
    @Param('table', tableId) table: string,
    @Query({ schema: BqPreviewQuerySchema }) q: { pageToken?: string; maxResults: number },
  ) {
    return this.bq.preview(this.profiles.get(profileId), project, dataset, table, q);
  }

  @Patch('tables/:dsProject/:dataset/:table')
  @Mutation({ product: 'bigquery', verb: 'table.update', resource: TBL })
  updateTable(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('dsProject', dsProject) project: string,
    @Param('dataset', datasetId) dataset: string,
    @Param('table', tableId) table: string,
    @Body({ schema: UpdateBqTableSchema }) b: UpdateBqTable,
  ) {
    return this.bq.updateTable(this.profiles.get(profileId), projectId, project, dataset, table, b);
  }

  @Delete('tables/:dsProject/:dataset/:table')
  @HttpCode(204)
  @Mutation({ product: 'bigquery', verb: 'table.delete', resource: TBL })
  async deleteTable(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('dsProject', dsProject) project: string,
    @Param('dataset', datasetId) dataset: string,
    @Param('table', tableId) table: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, table);
    await this.bq.deleteTable(this.profiles.get(profileId), projectId, project, dataset, table);
  }

  @Post('tables/:dsProject/:dataset/:table/copy')
  @Mutation({ product: 'bigquery', verb: 'table.copy', resource: TBL })
  async copy(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('dsProject', dsProject) project: string,
    @Param('dataset', datasetId) dataset: string,
    @Param('table', tableId) table: string,
    @Body({ schema: CopyBqTableSchema }) b: CopyBqTable,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accepted = await this.bq.copyTable(this.profiles.get(profileId), projectId, project, dataset, table, b);
    res.status(accepted.operation.family === 'instant' ? 200 : 202);
    return accepted;
  }

  @Post('query/dryrun')
  @HttpCode(200)
  dryRun(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: BqDryRunSchema }) b: BqDryRun,
  ) {
    return this.bq.dryRun(this.profiles.get(profileId), projectId, b);
  }

  @Post('query/run')
  @Mutation({ product: 'bigquery', verb: 'query.run', resource: 'projects/:projectId', scope: 'query' })
  async run(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: BqRunSchema }) b: BqRun,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accepted = await this.bq.run(this.profiles.get(profileId), projectId, b);
    res.status(accepted.operation.family === 'instant' ? 200 : 202);
    return accepted;
  }

  @Get('jobs')
  jobs(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: BqJobListQuerySchema }) q: BqJobListQuery,
  ) {
    return this.bq.jobs(this.profiles.get(profileId), projectId, q);
  }

  @Get('jobs/:location/:job')
  job(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', jobId) job: string,
  ) {
    return this.bq.job(this.profiles.get(profileId), projectId, location, job);
  }

  @Get('jobs/:location/:job/results')
  results(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', jobId) job: string,
    @Query({ schema: BqPreviewQuerySchema }) q: { pageToken?: string; maxResults: number },
  ) {
    return this.bq.results(this.profiles.get(profileId), projectId, location, job, q.pageToken, q.maxResults);
  }

  @Post('jobs/:location/:job/cancel')
  @HttpCode(204)
  @Mutation({ product: 'bigquery', verb: 'job.cancel', resource: 'projects/:projectId/jobs/:job', scope: 'query' })
  async cancel(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', jobId) job: string,
  ): Promise<void> {
    await this.bq.cancel(this.profiles.get(profileId), projectId, location, job);
  }

  @Get('jobs/:location/:job/download')
  async download(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', jobId) job: string,
    @Query({ schema: z.object({ format: z.enum(['csv', 'json']).default('csv') }) }) q: { format: 'csv' | 'json' },
    @Res() res: Response,
  ): Promise<void> {
    await this.bq.download(this.profiles.get(profileId), projectId, location, job, q.format, res);
  }

  @Post('jobs/:location/:job/export')
  @Mutation({ product: 'bigquery', verb: 'results.export', resource: 'projects/:projectId/jobs/:job' })
  async exportResults(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', jobId) job: string,
    @Body({ schema: BqExportSchema }) b: BqExport,
    @Res({ passthrough: true }) res: Response,
  ) {
    const accepted = await this.bq.exportResults(this.profiles.get(profileId), projectId, location, job, b);
    res.status(accepted.operation.family === 'instant' ? 200 : 202);
    return accepted;
  }
}

/** BigQuery (SPEC-0008 M6.1). */
@Module({ controllers: [BigQueryController], providers: [BigQueryService] })
export class BigQueryModule {}
