import type {
  CreateLogBucket,
  CreateLogView,
  LogBucket,
  LogBucketLink,
  LogDownloadQuery,
  LogExclusionView,
  LogMetric,
  LogSink,
  LogsCatalog,
  LogView,
  SaveExclusion,
  SaveLogMetric,
  SaveSink,
  UpdateLogBucket,
} from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { rest } from '../../core/gcp/rest.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { ProblemException } from '../../core/problem/problem.js';
import { LogsService } from '../observability/logs.service.js';
import {
  csvField,
  logIdOf,
  mapBucket,
  mapExclusion,
  mapLink,
  mapMetric,
  mapSink,
  mapView,
  metricBody,
  sinkBody,
} from './logging-mapping.js';

// biome-ignore lint/suspicious/noExplicitAny: Logging REST resources are read field by field.
type Any = any;

export const LOGGING = 'https://logging.googleapis.com/v2/';
const CATALOG_TTL = 5 * 60 * 1000;
const DOWNLOAD_PAGE = 1000;

/** Log Router, buckets, views, log-based metrics and Logs Explorer helpers (SPEC-0005 D-04, D-05). */
@Injectable()
export class LoggingService {
  private readonly catalogs = new Map<string, { at: number; value: Promise<LogsCatalog> }>();

  constructor(
    private readonly logs: LogsService,
    private readonly operations: OperationsService,
  ) {}

  private record(h: ProfileHandle, projectId: string, kind: string, name: string, displayName: string, href: string) {
    this.operations.recordInstant({ profileId: h.profile.id, projectId, product: 'logging', kind, resource: { name, displayName, href } });
  }

  /** Log names and resource types for the query editor's completion (SPEC-0005 D-04). */
  catalog(h: ProfileHandle, projectId: string): Promise<LogsCatalog> {
    const key = `${h.profile.id}:${projectId}`;
    const hit = this.catalogs.get(key);
    if (hit && Date.now() - hit.at < CATALOG_TTL) return hit.value;
    const client = rest(h, LOGGING);
    const value = (async () => {
      const [names, types] = await Promise.all([
        client.all<string>(`projects/${projectId}/logs`, 'logNames', { pageSize: 1000 }, 5000).catch(() => [] as string[]),
        client.all<{ type?: string }>('monitoredResourceDescriptors', 'resourceDescriptors', { pageSize: 1000 }, 5000).catch(() => []),
      ]);
      return {
        logNames: [...new Set(names.map(logIdOf))].sort(),
        resourceTypes: [...new Set(types.map((t) => t.type).filter((t): t is string => !!t))].sort(),
      };
    })();
    value.catch(() => this.catalogs.delete(key));
    this.catalogs.set(key, { at: Date.now(), value });
    return value;
  }

  /**
   * Streams up to 10,000 entries as JSON or CSV (SPEC-0005 D-04). Pages are read one at a time
   * under the project's Logging budget, and the stream stops when the client goes away.
   */
  async download(
    h: ProfileHandle,
    projectId: string,
    q: LogDownloadQuery,
    write: (chunk: string) => boolean | Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    let pageToken: string | undefined;
    let sent = 0;
    if (q.format === 'csv') await write('timestamp,severity,logName,resourceType,summary,trace,insertId\n');
    else await write('[\n');
    do {
      const page = await this.logs.listWaiting(
        h,
        projectId,
        { filter: q.filter, since: q.since, until: q.until, pageSize: Math.min(DOWNLOAD_PAGE, q.limit - sent), pageToken },
        signal,
      );
      for (const e of page.entries) {
        if (sent >= q.limit) break;
        if (q.format === 'csv') {
          await write(
            `${[e.timestamp, e.severity, logIdOf(e.logName), e.resource.type, e.summary, e.trace, (e.raw as Any)?.insertId].map(csvField).join(',')}\n`,
          );
        } else {
          await write(`${sent > 0 ? ',\n' : ''}${JSON.stringify(e.raw)}`);
        }
        sent++;
      }
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken && sent < q.limit && !signal.aborted);
    if (q.format === 'json') await write('\n]\n');
  }

  // ---- sinks --------------------------------------------------------------------------------

  async listSinks(h: ProfileHandle, projectId: string): Promise<LogSink[]> {
    const items = await rest(h, LOGGING).all<Any>(`projects/${projectId}/sinks`, 'sinks', { pageSize: 200 });
    return items.map(mapSink).sort((a, b) => (a.builtIn ? 0 : 1) - (b.builtIn ? 0 : 1) || a.name.localeCompare(b.name));
  }

  async createSink(h: ProfileHandle, projectId: string, body: SaveSink): Promise<LogSink> {
    const s = await rest(h, LOGGING).post<Any>(`projects/${projectId}/sinks`, sinkBody(body), { uniqueWriterIdentity: true });
    this.record(h, projectId, 'logging.sink.create', s.name, `Create sink ${body.name}`, `/p/${projectId}/logging?tab=router`);
    return mapSink(s);
  }

  async updateSink(h: ProfileHandle, projectId: string, sink: string, body: SaveSink): Promise<LogSink> {
    if (sink === '_Required') throw ProblemException.of('FAILED_PRECONDITION', 'The _Required sink cannot be changed.');
    const s = await rest(h, LOGGING).put<Any>(
      `projects/${projectId}/sinks/${encodeURIComponent(sink)}`,
      sinkBody({ ...body, name: sink }),
      {
        uniqueWriterIdentity: true,
        updateMask: 'destination,filter,description,disabled,exclusions',
      },
    );
    this.record(h, projectId, 'logging.sink.update', s.name, `Update sink ${sink}`, `/p/${projectId}/logging?tab=router`);
    return mapSink(s);
  }

  async deleteSink(h: ProfileHandle, projectId: string, sink: string): Promise<void> {
    if (sink === '_Required' || sink === '_Default')
      throw ProblemException.of('FAILED_PRECONDITION', `The ${sink} sink cannot be deleted.`);
    await rest(h, LOGGING).delete(`projects/${projectId}/sinks/${encodeURIComponent(sink)}`);
    this.record(h, projectId, 'logging.sink.delete', sink, `Delete sink ${sink}`, `/p/${projectId}/logging?tab=router`);
  }

  // ---- exclusions ------------------------------------------------------------------------------

  async listExclusions(h: ProfileHandle, projectId: string): Promise<LogExclusionView[]> {
    const items = await rest(h, LOGGING).all<Any>(`projects/${projectId}/exclusions`, 'exclusions', { pageSize: 200 });
    return items.map(mapExclusion);
  }

  async saveExclusion(h: ProfileHandle, projectId: string, body: SaveExclusion, existing?: string): Promise<LogExclusionView> {
    const client = rest(h, LOGGING);
    const e = existing
      ? await client.patch<Any>(`projects/${projectId}/exclusions/${encodeURIComponent(existing)}`, body, {
          updateMask: 'filter,description,disabled',
        })
      : await client.post<Any>(`projects/${projectId}/exclusions`, body);
    this.record(
      h,
      projectId,
      `logging.exclusion.${existing ? 'update' : 'create'}`,
      e.name,
      `${existing ? 'Update' : 'Create'} exclusion ${body.name}`,
      `/p/${projectId}/logging?tab=router`,
    );
    return mapExclusion(e);
  }

  async deleteExclusion(h: ProfileHandle, projectId: string, id: string): Promise<void> {
    await rest(h, LOGGING).delete(`projects/${projectId}/exclusions/${encodeURIComponent(id)}`);
    this.record(h, projectId, 'logging.exclusion.delete', id, `Delete exclusion ${id}`, `/p/${projectId}/logging?tab=router`);
  }

  // ---- buckets and views ---------------------------------------------------------------------------

  async listBuckets(h: ProfileHandle, projectId: string): Promise<LogBucket[]> {
    const items = await rest(h, LOGGING).all<Any>(`projects/${projectId}/locations/-/buckets`, 'buckets', { pageSize: 200 });
    return items.map(mapBucket).sort((a, b) => (a.builtIn ? 0 : 1) - (b.builtIn ? 0 : 1) || a.id.localeCompare(b.id));
  }

  async createBucket(h: ProfileHandle, projectId: string, b: CreateLogBucket): Promise<LogBucket> {
    const bucket = await rest(h, LOGGING).post<Any>(
      `projects/${projectId}/locations/${b.location}/buckets`,
      { description: b.description ?? '', retentionDays: b.retentionDays, analyticsEnabled: b.analyticsEnabled, locked: b.locked },
      { bucketId: b.id },
    );
    this.record(h, projectId, 'logging.bucket.create', bucket.name, `Create log bucket ${b.id}`, `/p/${projectId}/logging?tab=storage`);
    return mapBucket(bucket);
  }

  private bucketName(projectId: string, location: string, bucket: string) {
    return `projects/${projectId}/locations/${location}/buckets/${bucket}`;
  }

  async updateBucket(h: ProfileHandle, projectId: string, location: string, bucket: string, b: UpdateLogBucket): Promise<LogBucket> {
    if (bucket === '_Required') throw ProblemException.of('FAILED_PRECONDITION', 'The _Required bucket cannot be changed.');
    const mask = Object.entries(b)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    if (mask.length === 0) throw ProblemException.of('INVALID_ARGUMENT', 'Nothing to change.');
    const updated = await rest(h, LOGGING).patch<Any>(this.bucketName(projectId, location, bucket), b, { updateMask: mask.join(',') });
    this.record(h, projectId, 'logging.bucket.update', updated.name, `Update log bucket ${bucket}`, `/p/${projectId}/logging?tab=storage`);
    return mapBucket(updated);
  }

  async deleteBucket(h: ProfileHandle, projectId: string, location: string, bucket: string): Promise<void> {
    if (bucket === '_Required' || bucket === '_Default')
      throw ProblemException.of('FAILED_PRECONDITION', `The ${bucket} bucket cannot be deleted.`);
    await rest(h, LOGGING).delete(this.bucketName(projectId, location, bucket));
    this.record(h, projectId, 'logging.bucket.delete', bucket, `Delete log bucket ${bucket}`, `/p/${projectId}/logging?tab=storage`);
  }

  async undeleteBucket(h: ProfileHandle, projectId: string, location: string, bucket: string): Promise<void> {
    await rest(h, LOGGING).post(`${this.bucketName(projectId, location, bucket)}:undelete`, {});
    this.record(h, projectId, 'logging.bucket.undelete', bucket, `Restore log bucket ${bucket}`, `/p/${projectId}/logging?tab=storage`);
  }

  async listViews(h: ProfileHandle, projectId: string, location: string, bucket: string): Promise<LogView[]> {
    const items = await rest(h, LOGGING).all<Any>(`${this.bucketName(projectId, location, bucket)}/views`, 'views', { pageSize: 200 });
    return items.map(mapView);
  }

  async createView(h: ProfileHandle, projectId: string, location: string, bucket: string, v: CreateLogView): Promise<LogView> {
    const view = await rest(h, LOGGING).post<Any>(
      `${this.bucketName(projectId, location, bucket)}/views`,
      { description: v.description ?? '', filter: v.filter },
      { viewId: v.id },
    );
    this.record(h, projectId, 'logging.view.create', view.name, `Create log view ${v.id}`, `/p/${projectId}/logging?tab=storage`);
    return mapView(view);
  }

  async deleteView(h: ProfileHandle, projectId: string, location: string, bucket: string, view: string): Promise<void> {
    await rest(h, LOGGING).delete(`${this.bucketName(projectId, location, bucket)}/views/${view}`);
    this.record(h, projectId, 'logging.view.delete', view, `Delete log view ${view}`, `/p/${projectId}/logging?tab=storage`);
  }

  async listLinks(h: ProfileHandle, projectId: string, location: string, bucket: string): Promise<LogBucketLink[]> {
    const items = await rest(h, LOGGING).all<Any>(`${this.bucketName(projectId, location, bucket)}/links`, 'links', {});
    return items.map(mapLink);
  }

  // ---- log-based metrics --------------------------------------------------------------------------

  async listMetrics(h: ProfileHandle, projectId: string): Promise<LogMetric[]> {
    const items = await rest(h, LOGGING).all<Any>(`projects/${projectId}/metrics`, 'metrics', { pageSize: 200 });
    return items.map(mapMetric).sort((a, b) => a.name.localeCompare(b.name));
  }

  async createMetric(h: ProfileHandle, projectId: string, body: SaveLogMetric): Promise<LogMetric> {
    const m = await rest(h, LOGGING).post<Any>(`projects/${projectId}/metrics`, metricBody(body));
    this.record(
      h,
      projectId,
      'logging.metric.create',
      body.name,
      `Create log-based metric ${body.name}`,
      `/p/${projectId}/logging?tab=metrics`,
    );
    return mapMetric(m);
  }

  async updateMetric(h: ProfileHandle, projectId: string, metric: string, body: SaveLogMetric): Promise<LogMetric> {
    const m = await rest(h, LOGGING).put<Any>(
      `projects/${projectId}/metrics/${encodeURIComponent(metric)}`,
      metricBody({ ...body, name: metric }),
    );
    this.record(h, projectId, 'logging.metric.update', metric, `Update log-based metric ${metric}`, `/p/${projectId}/logging?tab=metrics`);
    return mapMetric(m);
  }

  async deleteMetric(h: ProfileHandle, projectId: string, metric: string): Promise<void> {
    await rest(h, LOGGING).delete(`projects/${projectId}/metrics/${encodeURIComponent(metric)}`);
    this.record(h, projectId, 'logging.metric.delete', metric, `Delete log-based metric ${metric}`, `/p/${projectId}/logging?tab=metrics`);
  }
}
