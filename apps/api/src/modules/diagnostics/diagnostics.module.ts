import {
  type Confirm,
  ConfirmSchema,
  type ErrorEventView,
  type ErrorGroupView,
  type ErrorListQuery,
  ErrorListQuerySchema,
  type ErrorResolution,
  errorResolutions,
  type ListResponse,
  ProjectIdParamSchema,
  TraceIdSchema,
  type TraceListQuery,
  TraceListQuerySchema,
  type TraceSpanView,
  type TraceSummary,
  type TraceView,
  UpdateErrorGroupSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { rest } from '../../core/gcp/rest.js';
import { OperationsService } from '../../core/operations/operations.service.js';

// biome-ignore lint/suspicious/noExplicitAny: REST resources are read field by field.
type Any = any;

const ERRORS = 'https://clouderrorreporting.googleapis.com/v1beta1/';
const TRACE = 'https://cloudtrace.googleapis.com/v1/';

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Buckets of the occurrence chart for each period (SPEC-0005 D-11). */
const TIMED_COUNT: Record<ErrorListQuery['period'], string> = {
  PERIOD_1_HOUR: '60s',
  PERIOD_6_HOURS: '600s',
  PERIOD_1_DAY: '3600s',
  PERIOD_1_WEEK: '21600s',
  PERIOD_30_DAYS: '86400s',
};

export function mapGroupStats(s: Any): ErrorGroupView {
  const g = s?.group ?? {};
  const status = String(g.resolutionStatus ?? 'OPEN');
  return {
    groupId: String(g.groupId ?? ''),
    name: String(g.name ?? ''),
    resolutionStatus: ((errorResolutions as readonly string[]).includes(status) ? status : 'OPEN') as ErrorResolution,
    message: String(s?.representative?.message ?? ''),
    count: Number(s?.count ?? 0),
    affectedUsers: Number(s?.affectedUsersCount ?? 0),
    firstSeen: str(s?.firstSeenTime),
    lastSeen: str(s?.lastSeenTime),
    services: Array.isArray(s?.affectedServices)
      ? s.affectedServices.map((x: Any) => ({ service: String(x?.service ?? ''), version: str(x?.version) }))
      : [],
    timedCounts: Array.isArray(s?.timedCounts)
      ? s.timedCounts
          .map((t: Any): [number, number] => [Date.parse(t?.startTime ?? ''), Number(t?.count ?? 0)])
          .filter(([t]: [number]) => Number.isFinite(t))
      : [],
    trackingIssues: Array.isArray(g.trackingIssues) ? g.trackingIssues.map((t: Any) => String(t?.url ?? '')).filter(Boolean) : [],
  };
}

export function mapEvent(e: Any): ErrorEventView {
  const http = e?.context?.httpRequest;
  const loc = e?.context?.reportLocation;
  return {
    eventTime: str(e?.eventTime),
    service: str(e?.serviceContext?.service),
    version: str(e?.serviceContext?.version),
    message: String(e?.message ?? ''),
    httpRequest: http
      ? {
          method: str(http.method),
          url: str(http.url),
          status: typeof http.responseStatusCode === 'number' ? http.responseStatusCode : null,
          userAgent: str(http.userAgent),
        }
      : null,
    user: str(e?.context?.user),
    reportLocation: loc
      ? {
          filePath: str(loc.filePath),
          lineNumber: typeof loc.lineNumber === 'number' ? loc.lineNumber : null,
          functionName: str(loc.functionName),
        }
      : null,
  };
}

function mapSpan(s: Any): TraceSpanView {
  return {
    spanId: String(s?.spanId ?? ''),
    parentSpanId: str(s?.parentSpanId) && s.parentSpanId !== '0' ? String(s.parentSpanId) : null,
    name: String(s?.name ?? ''),
    kind: str(s?.kind),
    start: str(s?.startTime),
    end: str(s?.endTime),
    labels: (s?.labels ?? {}) as Record<string, string>,
  };
}

export function summarizeTrace(t: Any): TraceSummary {
  const spans = ((t?.spans ?? []) as Any[]).map(mapSpan);
  const root = spans.find((s) => !s.parentSpanId) ?? spans[0];
  const start = root?.start ? Date.parse(root.start) : Number.NaN;
  const end = root?.end ? Date.parse(root.end) : Number.NaN;
  return {
    traceId: String(t?.traceId ?? ''),
    rootName: root?.name ?? '',
    start: root?.start ?? null,
    durationMs: Number.isFinite(start) && Number.isFinite(end) ? end - start : null,
    spanCount: spans.length,
  };
}

/** Error Reporting (v1beta1) and Cloud Trace reads (v1), SPEC-0005 D-11 and D-12. */
@Injectable()
export class DiagnosticsService {
  constructor(private readonly operations: OperationsService) {}

  async listGroups(h: ProfileHandle, projectId: string, q: ErrorListQuery): Promise<ListResponse<ErrorGroupView>> {
    const data = await rest(h, ERRORS).get<Any>(`projects/${projectId}/groupStats`, {
      'timeRange.period': q.period,
      timedCountDuration: TIMED_COUNT[q.period],
      order: 'LAST_SEEN_DESC',
      pageSize: 100,
      pageToken: q.pageToken,
      'serviceFilter.service': q.service,
    });
    return { items: ((data?.errorGroupStats ?? []) as Any[]).map(mapGroupStats), nextPageToken: data?.nextPageToken || null };
  }

  async getGroup(h: ProfileHandle, projectId: string, groupId: string, period: ErrorListQuery['period']): Promise<ErrorGroupView> {
    const data = await rest(h, ERRORS).get<Any>(`projects/${projectId}/groupStats`, {
      'timeRange.period': period,
      timedCountDuration: TIMED_COUNT[period],
      groupId,
      pageSize: 1,
    });
    const stats = data?.errorGroupStats?.[0];
    if (stats) return mapGroupStats(stats);
    // No occurrence in the period: the group still exists and keeps its state.
    const g = await rest(h, ERRORS).get<Any>(`projects/${projectId}/groups/${groupId}`);
    return mapGroupStats({ group: g, count: 0 });
  }

  async listEvents(h: ProfileHandle, projectId: string, groupId: string, period: ErrorListQuery['period']): Promise<ErrorEventView[]> {
    const data = await rest(h, ERRORS).get<Any>(`projects/${projectId}/events`, { groupId, 'timeRange.period': period, pageSize: 50 });
    return ((data?.errorEvents ?? []) as Any[]).map(mapEvent);
  }

  async setResolution(h: ProfileHandle, projectId: string, groupId: string, resolutionStatus: ErrorResolution): Promise<void> {
    const name = `projects/${projectId}/groups/${groupId}`;
    await rest(h, ERRORS).put(name, { name, groupId, resolutionStatus });
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'errorreporting',
      kind: 'errorreporting.group.update',
      resource: {
        name,
        displayName: `Mark error group ${resolutionStatus.toLowerCase()}`,
        href: `/p/${projectId}/errorreporting/${groupId}`,
      },
    });
  }

  async deleteEvents(h: ProfileHandle, projectId: string): Promise<void> {
    await rest(h, ERRORS).delete(`projects/${projectId}/events`);
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'errorreporting',
      kind: 'errorreporting.events.delete',
      resource: { name: `projects/${projectId}/events`, displayName: 'Delete all error events', href: `/p/${projectId}/errorreporting` },
    });
  }

  async listTraces(h: ProfileHandle, projectId: string, q: TraceListQuery): Promise<ListResponse<TraceSummary>> {
    const data = await rest(h, TRACE).get<Any>(`projects/${projectId}/traces`, {
      view: 'ROOTSPAN',
      startTime: q.since,
      endTime: q.until ?? new Date().toISOString(),
      filter: q.filter,
      orderBy: q.orderBy,
      pageSize: 200,
      pageToken: q.pageToken,
    });
    return { items: ((data?.traces ?? []) as Any[]).map(summarizeTrace), nextPageToken: data?.nextPageToken || null };
  }

  async getTrace(h: ProfileHandle, projectId: string, traceId: string): Promise<TraceView> {
    const t = await rest(h, TRACE).get<Any>(`projects/${projectId}/traces/${traceId}`);
    return { traceId: String(t?.traceId ?? traceId), spans: ((t?.spans ?? []) as Any[]).map(mapSpan) };
  }
}

const p = { schema: ProjectIdParamSchema };
const groupId = { schema: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/) };
const PeriodSchema = ErrorListQuerySchema.pick({ period: true });

@Controller('api/projects/:projectId')
export class DiagnosticsController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly diagnostics: DiagnosticsService,
  ) {}

  @Get('errorreporting/groups')
  groups(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: ErrorListQuerySchema }) q: ErrorListQuery,
  ): Promise<ListResponse<ErrorGroupView>> {
    return this.diagnostics.listGroups(this.profiles.get(profileId), projectId, q);
  }

  @Get('errorreporting/groups/:group')
  group(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('group', groupId) group: string,
    @Query({ schema: PeriodSchema }) q: { period: ErrorListQuery['period'] },
  ): Promise<ErrorGroupView> {
    return this.diagnostics.getGroup(this.profiles.get(profileId), projectId, group, q.period);
  }

  @Get('errorreporting/groups/:group/events')
  events(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('group', groupId) group: string,
    @Query({ schema: PeriodSchema }) q: { period: ErrorListQuery['period'] },
  ): Promise<ErrorEventView[]> {
    return this.diagnostics.listEvents(this.profiles.get(profileId), projectId, group, q.period);
  }

  @Put('errorreporting/groups/:group')
  @HttpCode(204)
  @Mutation({ product: 'errorreporting', verb: 'group.update', resource: 'projects/:projectId/groups/:group' })
  async resolve(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('group', groupId) group: string,
    @Body({ schema: UpdateErrorGroupSchema }) body: { resolutionStatus: ErrorResolution },
  ): Promise<void> {
    await this.diagnostics.setResolution(this.profiles.get(profileId), projectId, group, body.resolutionStatus);
  }

  /** Deletes every error event of the project; the typed value is the project id (SPEC-0005 D-11). */
  @Delete('errorreporting/events')
  @HttpCode(204)
  @Mutation({ product: 'errorreporting', verb: 'events.delete', resource: 'projects/:projectId/events' })
  async deleteEvents(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, projectId);
    await this.diagnostics.deleteEvents(this.profiles.get(profileId), projectId);
  }

  @Get('trace/traces')
  traces(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: TraceListQuerySchema }) q: TraceListQuery,
  ): Promise<ListResponse<TraceSummary>> {
    return this.diagnostics.listTraces(this.profiles.get(profileId), projectId, q);
  }

  @Get('trace/traces/:trace')
  trace(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('trace', { schema: TraceIdSchema }) traceId: string,
  ): Promise<TraceView> {
    return this.diagnostics.getTrace(this.profiles.get(profileId), projectId, traceId);
  }
}

/** Error Reporting and Cloud Trace (SPEC-0005 M3). */
@Module({ controllers: [DiagnosticsController], providers: [DiagnosticsService] })
export class DiagnosticsModule {}
