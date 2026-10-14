import {
  type AlertPolicyView,
  type ChannelDescriptorView,
  type Confirm,
  ConfirmSchema,
  type CreateAlertPolicy,
  CreateAlertPolicySchema,
  type CreateChannel,
  CreateChannelSchema,
  type CreateUptimeCheck,
  CreateUptimeCheckSchema,
  type DashboardSummary,
  type MetricDescriptorView,
  MetricSearchSchema,
  type NotificationChannelView,
  ProjectIdParamSchema,
  type SaveDashboard,
  SaveDashboardSchema,
  type SeriesQuery,
  SeriesQuerySchema,
  type SeriesResult,
  type UptimeCheckView,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { rest } from '../../core/gcp/rest.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { ProblemException } from '../../core/problem/problem.js';
import {
  mapChannel,
  mapChannelDescriptor,
  mapDashboard,
  mapDescriptor,
  mapMql,
  mapPolicy,
  mapPrometheus,
  mapTimeSeries,
  mapUptime,
  policyFromForm,
  promStep,
} from './monitoring-mapping.js';

// biome-ignore lint/suspicious/noExplicitAny: Monitoring REST resources are read field by field.
type Any = any;

const V3 = 'https://monitoring.googleapis.com/v3/';
const V1 = 'https://monitoring.googleapis.com/v1/';
const DESCRIPTOR_TTL = 10 * 60 * 1000;

function rangeOf(q: { since: string; until?: string }): { sinceMs: number; untilMs: number } {
  const sinceMs = Date.parse(q.since);
  const untilMs = q.until ? Date.parse(q.until) : Date.now();
  if (!(sinceMs < untilMs)) throw ProblemException.of('INVALID_ARGUMENT', 'The start of the range must be before its end.');
  return { sinceMs, untilMs };
}

function parseJsonObject(text: string, what: string): Any {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw ProblemException.of('INVALID_ARGUMENT', `The ${what} is not valid JSON: ${(err as Error).message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw ProblemException.of('INVALID_ARGUMENT', `The ${what} must be a JSON object.`);
  return value;
}

/** Cloud Monitoring through REST (SPEC-0005 D-08 to D-10). */
@Injectable()
export class MonitoringService {
  private readonly descriptors = new Map<string, { at: number; value: Promise<MetricDescriptorView[]> }>();

  constructor(private readonly operations: OperationsService) {}

  private record(h: ProfileHandle, projectId: string, kind: string, name: string, displayName: string, href: string) {
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'monitoring',
      kind,
      resource: { name, displayName, href },
    });
  }

  private allDescriptors(h: ProfileHandle, projectId: string): Promise<MetricDescriptorView[]> {
    const key = `${h.profile.id}:${projectId}`;
    const hit = this.descriptors.get(key);
    if (hit && Date.now() - hit.at < DESCRIPTOR_TTL) return hit.value;
    const value = rest(h, V3)
      .all<Any>(`projects/${projectId}/metricDescriptors`, 'metricDescriptors', { pageSize: 1000 }, 20_000)
      .then((list) => list.map(mapDescriptor).sort((a, b) => a.type.localeCompare(b.type)));
    value.catch(() => this.descriptors.delete(key));
    this.descriptors.set(key, { at: Date.now(), value });
    return value;
  }

  /** Metric picker search over the project's metric descriptors (SPEC-0005 D-08). */
  async searchMetrics(h: ProfileHandle, projectId: string, q: string): Promise<MetricDescriptorView[]> {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const all = await this.allDescriptors(h, projectId);
    return all.filter((d) => words.every((w) => `${d.type} ${d.displayName}`.toLowerCase().includes(w))).slice(0, 200);
  }

  async series(h: ProfileHandle, projectId: string, q: SeriesQuery): Promise<SeriesResult> {
    const { sinceMs, untilMs } = rangeOf(q);
    if (q.kind === 'promql') {
      const step = promStep(sinceMs, untilMs);
      try {
        const data = await rest(h, V1).get<Any>(`projects/${projectId}/location/global/prometheus/api/v1/query_range`, {
          query: q.query,
          start: Math.floor(sinceMs / 1000),
          end: Math.ceil(untilMs / 1000),
          step: `${step}s`,
        });
        const series = mapPrometheus(data);
        return { series, stepSeconds: step, note: series.length === 0 ? 'The query returned no series in this range.' : undefined };
      } catch (err) {
        // The Prometheus API answers errors in its own shape: { status, errorType, error }.
        const body = (err as Any)?.response?.data;
        if (body && typeof body.error === 'string') throw ProblemException.of('INVALID_ARGUMENT', body.error);
        throw err;
      }
    }
    if (q.kind === 'mql') {
      // MQL carries its own range; the page's range applies when the query names none.
      const query = /\|\s*within\b/.test(q.query)
        ? q.query
        : `${q.query} | within ${Math.max(1, Math.round((untilMs - sinceMs) / 60_000))}m`;
      const data = await rest(h, V3).post<Any>(`projects/${projectId}/timeSeries:query`, { query });
      return { series: mapMql(data) };
    }
    const a = q.aggregation ?? {};
    const list = await rest(h, V3).all<Any>(
      `projects/${projectId}/timeSeries`,
      'timeSeries',
      {
        filter: q.filter,
        'interval.startTime': new Date(sinceMs).toISOString(),
        'interval.endTime': new Date(untilMs).toISOString(),
        'aggregation.alignmentPeriod': a.alignmentPeriod,
        'aggregation.perSeriesAligner': a.perSeriesAligner,
        'aggregation.crossSeriesReducer': a.crossSeriesReducer,
        'aggregation.groupByFields': a.groupByFields,
        view: 'FULL',
      },
      500,
    );
    return { series: mapTimeSeries(list) };
  }

  // ---- dashboards --------------------------------------------------------------------------------

  async listDashboards(h: ProfileHandle, projectId: string): Promise<DashboardSummary[]> {
    const items = await rest(h, V1).all<Any>(`projects/${projectId}/dashboards`, 'dashboards', { pageSize: 1000 });
    return items.map(mapDashboard).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  getDashboard(h: ProfileHandle, projectId: string, id: string): Promise<unknown> {
    return rest(h, V1).get(`projects/${projectId}/dashboards/${id}`);
  }

  async saveDashboard(h: ProfileHandle, projectId: string, id: string, body: SaveDashboard): Promise<unknown> {
    const dashboard = parseJsonObject(body.json, 'dashboard');
    const name = `projects/${projectId}/dashboards/${id}`;
    if (dashboard.name && dashboard.name !== name && !String(dashboard.name).endsWith(`/dashboards/${id}`)) {
      throw ProblemException.of('INVALID_ARGUMENT', 'The JSON names another dashboard.');
    }
    // The etag in the JSON makes a concurrent edit fail instead of overwriting it (SPEC-0005 D-09).
    const saved = await rest(h, V1).patch(name, { ...dashboard, name });
    this.record(
      h,
      projectId,
      'monitoring.dashboard.update',
      name,
      `Save dashboard ${dashboard.displayName ?? id}`,
      `/p/${projectId}/monitoring/dashboards/${id}`,
    );
    return saved;
  }

  async deleteDashboard(h: ProfileHandle, projectId: string, id: string): Promise<void> {
    await rest(h, V1).delete(`projects/${projectId}/dashboards/${id}`);
    this.record(h, projectId, 'monitoring.dashboard.delete', id, `Delete dashboard ${id}`, `/p/${projectId}/monitoring?tab=dashboards`);
  }

  // ---- alert policies --------------------------------------------------------------------------------

  async listPolicies(h: ProfileHandle, projectId: string): Promise<AlertPolicyView[]> {
    const items = await rest(h, V3).all<Any>(`projects/${projectId}/alertPolicies`, 'alertPolicies', { pageSize: 1000 });
    return items.map(mapPolicy).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async getPolicy(h: ProfileHandle, projectId: string, id: string): Promise<{ policy: AlertPolicyView; raw: unknown }> {
    const raw = await rest(h, V3).get<Any>(`projects/${projectId}/alertPolicies/${id}`);
    return { policy: mapPolicy(raw), raw };
  }

  async createPolicy(h: ProfileHandle, projectId: string, body: CreateAlertPolicy): Promise<AlertPolicyView> {
    const policy = body.mode === 'json' ? parseJsonObject(body.json, 'alert policy') : policyFromForm(body);
    delete policy.name;
    const created = await rest(h, V3).post<Any>(`projects/${projectId}/alertPolicies`, policy);
    const view = mapPolicy(created);
    this.record(
      h,
      projectId,
      'monitoring.policy.create',
      view.name,
      `Create alert policy ${view.displayName}`,
      `/p/${projectId}/monitoring/alerts/${view.id}`,
    );
    return view;
  }

  async setPolicyEnabled(h: ProfileHandle, projectId: string, id: string, enabled: boolean): Promise<AlertPolicyView> {
    const updated = await rest(h, V3).patch<Any>(`projects/${projectId}/alertPolicies/${id}`, { enabled }, { updateMask: 'enabled' });
    const view = mapPolicy(updated);
    this.record(
      h,
      projectId,
      `monitoring.policy.${enabled ? 'enable' : 'disable'}`,
      view.name,
      `${enabled ? 'Enable' : 'Disable'} alert policy ${view.displayName}`,
      `/p/${projectId}/monitoring/alerts/${id}`,
    );
    return view;
  }

  async deletePolicy(h: ProfileHandle, projectId: string, id: string): Promise<void> {
    await rest(h, V3).delete(`projects/${projectId}/alertPolicies/${id}`);
    this.record(h, projectId, 'monitoring.policy.delete', id, `Delete alert policy ${id}`, `/p/${projectId}/monitoring?tab=alerts`);
  }

  // ---- uptime checks ------------------------------------------------------------------------------------

  async listUptime(h: ProfileHandle, projectId: string): Promise<UptimeCheckView[]> {
    const client = rest(h, V3);
    const items = await client.all<Any>(`projects/${projectId}/uptimeCheckConfigs`, 'uptimeCheckConfigs', { pageSize: 100 });
    const rates = new Map<string, number>();
    if (items.length > 0) {
      // One grouped read gives the last hour's pass rate of every check (SPEC-0005 D-10).
      const end = new Date();
      const series = await client
        .all<Any>(
          `projects/${projectId}/timeSeries`,
          'timeSeries',
          {
            filter: 'metric.type = "monitoring.googleapis.com/uptime_check/check_passed"',
            'interval.startTime': new Date(end.getTime() - 3_600_000).toISOString(),
            'interval.endTime': end.toISOString(),
            'aggregation.alignmentPeriod': '3600s',
            'aggregation.perSeriesAligner': 'ALIGN_FRACTION_TRUE',
            'aggregation.crossSeriesReducer': 'REDUCE_MEAN',
            'aggregation.groupByFields': ['metric.label.check_id'],
          },
          500,
        )
        .catch(() => [] as Any[]);
      for (const s of series) {
        const id = s?.metric?.labels?.check_id;
        const v = s?.points?.[0]?.value?.doubleValue;
        if (typeof id === 'string' && typeof v === 'number') rates.set(id, v);
      }
    }
    return items.map((c) => mapUptime(c, rates)).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async createUptime(h: ProfileHandle, projectId: string, b: CreateUptimeCheck): Promise<UptimeCheckView> {
    const body: Any = {
      displayName: b.displayName,
      monitoredResource: { type: 'uptime_url', labels: { project_id: projectId, host: b.host } },
      period: `${b.periodSeconds}s`,
      timeout: `${b.timeoutSeconds}s`,
    };
    if (b.protocol === 'TCP') body.tcpCheck = { port: b.port ?? 80 };
    else
      body.httpCheck = {
        path: b.path || '/',
        port: b.port ?? (b.protocol === 'HTTPS' ? 443 : 80),
        useSsl: b.protocol === 'HTTPS',
        validateSsl: b.protocol === 'HTTPS',
      };
    const created = await rest(h, V3).post<Any>(`projects/${projectId}/uptimeCheckConfigs`, body);
    const view = mapUptime(created, new Map());
    this.record(
      h,
      projectId,
      'monitoring.uptime.create',
      view.name,
      `Create uptime check ${b.displayName}`,
      `/p/${projectId}/monitoring?tab=uptime`,
    );
    return view;
  }

  async deleteUptime(h: ProfileHandle, projectId: string, id: string): Promise<void> {
    await rest(h, V3).delete(`projects/${projectId}/uptimeCheckConfigs/${id}`);
    this.record(h, projectId, 'monitoring.uptime.delete', id, `Delete uptime check ${id}`, `/p/${projectId}/monitoring?tab=uptime`);
  }

  // ---- notification channels ------------------------------------------------------------------------------

  async listChannels(h: ProfileHandle, projectId: string): Promise<NotificationChannelView[]> {
    const items = await rest(h, V3).all<Any>(`projects/${projectId}/notificationChannels`, 'notificationChannels', { pageSize: 1000 });
    return items.map(mapChannel).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async channelDescriptors(h: ProfileHandle, projectId: string): Promise<ChannelDescriptorView[]> {
    const items = await rest(h, V3).all<Any>(`projects/${projectId}/notificationChannelDescriptors`, 'channelDescriptors', {
      pageSize: 100,
    });
    return items.map(mapChannelDescriptor).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async createChannel(h: ProfileHandle, projectId: string, b: CreateChannel): Promise<NotificationChannelView> {
    const created = await rest(h, V3).post<Any>(`projects/${projectId}/notificationChannels`, {
      type: b.type,
      displayName: b.displayName,
      labels: b.labels,
      enabled: true,
    });
    const view = mapChannel(created);
    this.record(
      h,
      projectId,
      'monitoring.channel.create',
      view.name,
      `Create channel ${b.displayName}`,
      `/p/${projectId}/monitoring?tab=channels`,
    );
    return view;
  }

  async verifyChannel(h: ProfileHandle, projectId: string, id: string): Promise<void> {
    await rest(h, V3).post(`projects/${projectId}/notificationChannels/${id}:sendVerificationCode`, {});
    this.record(
      h,
      projectId,
      'monitoring.channel.verify',
      id,
      `Send verification to channel ${id}`,
      `/p/${projectId}/monitoring?tab=channels`,
    );
  }

  async deleteChannel(h: ProfileHandle, projectId: string, id: string): Promise<void> {
    await rest(h, V3).delete(`projects/${projectId}/notificationChannels/${id}`);
    this.record(h, projectId, 'monitoring.channel.delete', id, `Delete channel ${id}`, `/p/${projectId}/monitoring?tab=channels`);
  }
}

const p = { schema: ProjectIdParamSchema };
const id = { schema: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/) };

@Controller('api/projects/:projectId/monitoring')
export class MonitoringController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly monitoring: MonitoringService,
  ) {}

  @Get('metric-descriptors')
  metrics(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: MetricSearchSchema }) q: { q: string },
  ): Promise<MetricDescriptorView[]> {
    return this.monitoring.searchMetrics(this.profiles.get(profileId), projectId, q.q);
  }

  /** Series for the Metrics Explorer and dashboard widgets; a read with a body, not a mutation. */
  @Post('series')
  @HttpCode(200)
  series(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: SeriesQuerySchema }) body: SeriesQuery,
  ): Promise<SeriesResult> {
    return this.monitoring.series(this.profiles.get(profileId), projectId, body);
  }

  @Get('dashboards')
  dashboards(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<DashboardSummary[]> {
    return this.monitoring.listDashboards(this.profiles.get(profileId), projectId);
  }

  @Get('dashboards/:id')
  dashboard(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string, @Param('id', id) dashboardId: string) {
    return this.monitoring.getDashboard(this.profiles.get(profileId), projectId, dashboardId);
  }

  @Put('dashboards/:id')
  @Mutation({ product: 'monitoring', verb: 'dashboard.update', resource: 'projects/:projectId/dashboards/:id' })
  saveDashboard(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('id', id) dashboardId: string,
    @Body({ schema: SaveDashboardSchema }) body: SaveDashboard,
  ) {
    return this.monitoring.saveDashboard(this.profiles.get(profileId), projectId, dashboardId, body);
  }

  @Delete('dashboards/:id')
  @HttpCode(204)
  @Mutation({ product: 'monitoring', verb: 'dashboard.delete', resource: 'projects/:projectId/dashboards/:id' })
  async deleteDashboard(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('id', id) dashboardId: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, dashboardId);
    await this.monitoring.deleteDashboard(this.profiles.get(profileId), projectId, dashboardId);
  }

  @Get('alert-policies')
  policies(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<AlertPolicyView[]> {
    return this.monitoring.listPolicies(this.profiles.get(profileId), projectId);
  }

  @Get('alert-policies/:id')
  policy(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string, @Param('id', id) policyId: string) {
    return this.monitoring.getPolicy(this.profiles.get(profileId), projectId, policyId);
  }

  @Post('alert-policies')
  @Mutation({ product: 'monitoring', verb: 'policy.create', resource: 'projects/:projectId/alertPolicies' })
  createPolicy(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateAlertPolicySchema }) body: CreateAlertPolicy,
  ): Promise<AlertPolicyView> {
    return this.monitoring.createPolicy(this.profiles.get(profileId), projectId, body);
  }

  @Patch('alert-policies/:id')
  @Mutation({ product: 'monitoring', verb: 'policy.update', resource: 'projects/:projectId/alertPolicies/:id' })
  setEnabled(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('id', id) policyId: string,
    @Body({ schema: z.object({ enabled: z.boolean() }) }) body: { enabled: boolean },
  ): Promise<AlertPolicyView> {
    return this.monitoring.setPolicyEnabled(this.profiles.get(profileId), projectId, policyId, body.enabled);
  }

  @Delete('alert-policies/:id')
  @HttpCode(204)
  @Mutation({ product: 'monitoring', verb: 'policy.delete', resource: 'projects/:projectId/alertPolicies/:id' })
  async deletePolicy(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('id', id) policyId: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, policyId);
    await this.monitoring.deletePolicy(this.profiles.get(profileId), projectId, policyId);
  }

  @Get('uptime-checks')
  uptime(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<UptimeCheckView[]> {
    return this.monitoring.listUptime(this.profiles.get(profileId), projectId);
  }

  @Post('uptime-checks')
  @Mutation({ product: 'monitoring', verb: 'uptime.create', resource: 'projects/:projectId/uptimeCheckConfigs' })
  createUptime(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateUptimeCheckSchema }) body: CreateUptimeCheck,
  ): Promise<UptimeCheckView> {
    return this.monitoring.createUptime(this.profiles.get(profileId), projectId, body);
  }

  @Delete('uptime-checks/:id')
  @HttpCode(204)
  @Mutation({ product: 'monitoring', verb: 'uptime.delete', resource: 'projects/:projectId/uptimeCheckConfigs/:id' })
  async deleteUptime(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('id', id) checkId: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, checkId);
    await this.monitoring.deleteUptime(this.profiles.get(profileId), projectId, checkId);
  }

  @Get('channels')
  channels(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<NotificationChannelView[]> {
    return this.monitoring.listChannels(this.profiles.get(profileId), projectId);
  }

  @Get('channel-descriptors')
  descriptors(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ChannelDescriptorView[]> {
    return this.monitoring.channelDescriptors(this.profiles.get(profileId), projectId);
  }

  @Post('channels')
  @Mutation({ product: 'monitoring', verb: 'channel.create', resource: 'projects/:projectId/notificationChannels' })
  createChannel(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateChannelSchema }) body: CreateChannel,
  ): Promise<NotificationChannelView> {
    return this.monitoring.createChannel(this.profiles.get(profileId), projectId, body);
  }

  @Post('channels/:id/verify')
  @HttpCode(204)
  @Mutation({ product: 'monitoring', verb: 'channel.verify', resource: 'projects/:projectId/notificationChannels/:id' })
  async verify(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('id', id) channelId: string,
  ): Promise<void> {
    await this.monitoring.verifyChannel(this.profiles.get(profileId), projectId, channelId);
  }

  @Delete('channels/:id')
  @HttpCode(204)
  @Mutation({ product: 'monitoring', verb: 'channel.delete', resource: 'projects/:projectId/notificationChannels/:id' })
  async deleteChannel(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('id', id) channelId: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, channelId);
    await this.monitoring.deleteChannel(this.profiles.get(profileId), projectId, channelId);
  }
}

/** Cloud Monitoring products (SPEC-0005 M3). */
@Module({ controllers: [MonitoringController], providers: [MonitoringService] })
export class MonitoringModule {}
