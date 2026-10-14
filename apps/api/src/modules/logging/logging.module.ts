import {
  type Confirm,
  ConfirmSchema,
  type CreateLogBucket,
  CreateLogBucketSchema,
  type CreateLogView,
  CreateLogViewSchema,
  type LogBucket,
  type LogBucketLink,
  type LogDownloadQuery,
  LogDownloadQuerySchema,
  type LogExclusionView,
  type LogMetric,
  type LogSink,
  type LogsCatalog,
  type LogView,
  ProjectIdParamSchema,
  type SaveExclusion,
  SaveExclusionSchema,
  type SaveLogMetric,
  SaveLogMetricSchema,
  type SaveSink,
  SaveSinkSchema,
  SinkIdSchema,
  type UpdateLogBucket,
  UpdateLogBucketSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ObservabilityModule } from '../observability/observability.module.js';
import { LoggingService } from './logging.service.js';

const p = { schema: ProjectIdParamSchema };
const loc = { schema: z.string().regex(/^[a-z0-9-]{1,64}$/) };
const bucketId = { schema: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) };
const sink = { schema: SinkIdSchema };
const metricId = { schema: z.string().regex(/^[A-Za-z0-9_.\-/]{1,100}$/) };
const BUCKET = 'projects/:projectId/locations/:location/buckets/:bucket';

@Controller('api/projects/:projectId/logging')
export class LoggingController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly logging: LoggingService,
  ) {}

  @Get('catalog')
  catalog(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<LogsCatalog> {
    return this.logging.catalog(this.profiles.get(profileId), projectId);
  }

  /** Download of up to 10,000 entries (SPEC-0005 D-04). */
  @Get('download')
  async download(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: LogDownloadQuerySchema }) q: LogDownloadQuery,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const h = this.profiles.get(profileId);
    const abort = new AbortController();
    req.on('close', () => abort.abort());
    res.status(200);
    res.setHeader('Content-Type', q.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="logs-${projectId}.${q.format}"`);
    res.setHeader('Cache-Control', 'no-store');
    const write = (chunk: string): Promise<void> | boolean =>
      res.write(chunk) ? true : new Promise<void>((resolve) => res.once('drain', () => resolve()));
    try {
      await this.logging.download(h, projectId, q, write, abort.signal);
    } catch (err) {
      // Headers are out: the failure goes at the end of the file, where a reader notices it.
      if (!abort.signal.aborted) res.write(`\n# Download stopped: ${toProblem(err).detail}\n`);
    }
    res.end();
  }

  // ---- sinks ----------------------------------------------------------------------------------

  @Get('sinks')
  sinks(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<LogSink[]> {
    return this.logging.listSinks(this.profiles.get(profileId), projectId);
  }

  @Post('sinks')
  @Mutation({ product: 'logging', verb: 'sink.create', resource: 'projects/:projectId/sinks' })
  createSink(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: SaveSinkSchema }) body: SaveSink,
  ): Promise<LogSink> {
    return this.logging.createSink(this.profiles.get(profileId), projectId, body);
  }

  @Put('sinks/:sink')
  @Mutation({ product: 'logging', verb: 'sink.update', resource: 'projects/:projectId/sinks/:sink' })
  updateSink(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('sink', sink) id: string,
    @Body({ schema: SaveSinkSchema }) body: SaveSink,
  ): Promise<LogSink> {
    return this.logging.updateSink(this.profiles.get(profileId), projectId, id, body);
  }

  @Delete('sinks/:sink')
  @HttpCode(204)
  @Mutation({ product: 'logging', verb: 'sink.delete', resource: 'projects/:projectId/sinks/:sink' })
  async deleteSink(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('sink', sink) id: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, id);
    await this.logging.deleteSink(this.profiles.get(profileId), projectId, id);
  }

  // ---- exclusions -------------------------------------------------------------------------------

  @Get('exclusions')
  exclusions(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<LogExclusionView[]> {
    return this.logging.listExclusions(this.profiles.get(profileId), projectId);
  }

  @Post('exclusions')
  @Mutation({ product: 'logging', verb: 'exclusion.create', resource: 'projects/:projectId/exclusions' })
  createExclusion(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: SaveExclusionSchema }) body: SaveExclusion,
  ): Promise<LogExclusionView> {
    return this.logging.saveExclusion(this.profiles.get(profileId), projectId, body);
  }

  @Put('exclusions/:exclusion')
  @Mutation({ product: 'logging', verb: 'exclusion.update', resource: 'projects/:projectId/exclusions/:exclusion' })
  updateExclusion(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('exclusion', sink) id: string,
    @Body({ schema: SaveExclusionSchema }) body: SaveExclusion,
  ): Promise<LogExclusionView> {
    return this.logging.saveExclusion(this.profiles.get(profileId), projectId, body, id);
  }

  @Delete('exclusions/:exclusion')
  @HttpCode(204)
  @Mutation({ product: 'logging', verb: 'exclusion.delete', resource: 'projects/:projectId/exclusions/:exclusion' })
  async deleteExclusion(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('exclusion', sink) id: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, id);
    await this.logging.deleteExclusion(this.profiles.get(profileId), projectId, id);
  }

  // ---- buckets and views -----------------------------------------------------------------------------

  @Get('buckets')
  buckets(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<LogBucket[]> {
    return this.logging.listBuckets(this.profiles.get(profileId), projectId);
  }

  @Post('buckets')
  @Mutation({ product: 'logging', verb: 'bucket.create', resource: 'projects/:projectId/buckets' })
  createBucket(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateLogBucketSchema }) body: CreateLogBucket,
  ): Promise<LogBucket> {
    return this.logging.createBucket(this.profiles.get(profileId), projectId, body);
  }

  @Patch('buckets/:location/:bucket')
  @Mutation({ product: 'logging', verb: 'bucket.update', resource: BUCKET })
  updateBucket(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('bucket', bucketId) bucket: string,
    @Body({ schema: UpdateLogBucketSchema }) body: UpdateLogBucket,
  ): Promise<LogBucket> {
    return this.logging.updateBucket(this.profiles.get(profileId), projectId, location, bucket, body);
  }

  @Delete('buckets/:location/:bucket')
  @HttpCode(204)
  @Mutation({ product: 'logging', verb: 'bucket.delete', resource: BUCKET })
  async deleteBucket(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('bucket', bucketId) bucket: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, bucket);
    await this.logging.deleteBucket(this.profiles.get(profileId), projectId, location, bucket);
  }

  @Post('buckets/:location/:bucket/undelete')
  @HttpCode(204)
  @Mutation({ product: 'logging', verb: 'bucket.undelete', resource: BUCKET })
  async undeleteBucket(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('bucket', bucketId) bucket: string,
  ): Promise<void> {
    await this.logging.undeleteBucket(this.profiles.get(profileId), projectId, location, bucket);
  }

  @Get('buckets/:location/:bucket/views')
  views(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('bucket', bucketId) bucket: string,
  ): Promise<LogView[]> {
    return this.logging.listViews(this.profiles.get(profileId), projectId, location, bucket);
  }

  @Post('buckets/:location/:bucket/views')
  @Mutation({ product: 'logging', verb: 'view.create', resource: BUCKET })
  createView(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('bucket', bucketId) bucket: string,
    @Body({ schema: CreateLogViewSchema }) body: CreateLogView,
  ): Promise<LogView> {
    return this.logging.createView(this.profiles.get(profileId), projectId, location, bucket, body);
  }

  @Delete('buckets/:location/:bucket/views/:view')
  @HttpCode(204)
  @Mutation({ product: 'logging', verb: 'view.delete', resource: `${BUCKET}/views/:view` })
  async deleteView(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('bucket', bucketId) bucket: string,
    @Param('view', bucketId) view: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, view);
    await this.logging.deleteView(this.profiles.get(profileId), projectId, location, bucket, view);
  }

  @Get('buckets/:location/:bucket/links')
  links(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('bucket', bucketId) bucket: string,
  ): Promise<LogBucketLink[]> {
    return this.logging.listLinks(this.profiles.get(profileId), projectId, location, bucket);
  }

  // ---- log-based metrics ------------------------------------------------------------------------------

  @Get('metrics')
  metrics(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<LogMetric[]> {
    return this.logging.listMetrics(this.profiles.get(profileId), projectId);
  }

  @Post('metrics')
  @Mutation({ product: 'logging', verb: 'metric.create', resource: 'projects/:projectId/metrics' })
  createMetric(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: SaveLogMetricSchema }) body: SaveLogMetric,
  ): Promise<LogMetric> {
    return this.logging.createMetric(this.profiles.get(profileId), projectId, body);
  }

  @Put('metrics/:metric')
  @Mutation({ product: 'logging', verb: 'metric.update', resource: 'projects/:projectId/metrics/:metric' })
  updateMetric(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('metric', metricId) metric: string,
    @Body({ schema: SaveLogMetricSchema }) body: SaveLogMetric,
  ): Promise<LogMetric> {
    return this.logging.updateMetric(this.profiles.get(profileId), projectId, metric, body);
  }

  @Delete('metrics/:metric')
  @HttpCode(204)
  @Mutation({ product: 'logging', verb: 'metric.delete', resource: 'projects/:projectId/metrics/:metric' })
  async deleteMetric(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('metric', metricId) metric: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, metric.split('/').pop() ?? metric);
    await this.logging.deleteMetric(this.profiles.get(profileId), projectId, metric);
  }
}

/** Logs Explorer helpers and the Log Router (SPEC-0005 M3). */
@Module({ imports: [ObservabilityModule], controllers: [LoggingController], providers: [LoggingService], exports: [LoggingService] })
export class LoggingModule {}
