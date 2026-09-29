import type { MetricChart, MetricSeries, MetricsQuery, MetricsResponse } from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { sdk } from '../../core/gcp/sdk.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';
import { alignmentSeconds, type ChartPreset, METRIC_PRESETS, quoteFilterValue, unitScale } from './metric-presets.js';

interface PointLike {
  interval?: { endTime?: { seconds?: unknown; nanos?: number | null } | null } | null;
  value?: { int64Value?: unknown; doubleValue?: number | null; distributionValue?: { mean?: number | null } | null } | null;
}
interface SeriesLike {
  metric?: { labels?: Record<string, string> | null } | null;
  resource?: { labels?: Record<string, string> | null } | null;
  points?: PointLike[] | null;
  unit?: string | null;
}

function pointValue(p: PointLike): number | null {
  const v = p.value;
  if (!v) return null;
  if (typeof v.doubleValue === 'number') return v.doubleValue;
  if (v.int64Value !== undefined && v.int64Value !== null) return Number(String(v.int64Value));
  if (v.distributionValue && typeof v.distributionValue.mean === 'number') return v.distributionValue.mean;
  return null;
}

function pointTime(p: PointLike): number {
  const t = p.interval?.endTime;
  return Number(String(t?.seconds ?? 0)) * 1000 + Math.round((t?.nanos ?? 0) / 1e6);
}

const PERCENTILE_REDUCER = { 50: 'REDUCE_PERCENTILE_50', 95: 'REDUCE_PERCENTILE_95', 99: 'REDUCE_PERCENTILE_99' } as const;

/** One listTimeSeries request per line group of a chart. */
interface Request {
  key: string;
  label: string | null;
  aggregation: {
    alignmentPeriod: { seconds: number };
    perSeriesAligner: 'ALIGN_RATE' | 'ALIGN_DELTA' | 'ALIGN_MAX';
    crossSeriesReducer: 'REDUCE_SUM' | (typeof PERCENTILE_REDUCER)[keyof typeof PERCENTILE_REDUCER];
    groupByFields: string[];
  };
}

function requestsFor(chart: ChartPreset, period: number): Request[] {
  const alignmentPeriod = { seconds: period };
  const a = chart.aggregation;
  switch (a.kind) {
    case 'rate':
      return [
        {
          key: 'rate',
          label: null,
          aggregation: { alignmentPeriod, perSeriesAligner: 'ALIGN_RATE', crossSeriesReducer: 'REDUCE_SUM', groupByFields: a.groupBy },
        },
      ];
    case 'sum':
      return [
        {
          key: 'sum',
          label: null,
          aggregation: { alignmentPeriod, perSeriesAligner: 'ALIGN_DELTA', crossSeriesReducer: 'REDUCE_SUM', groupByFields: a.groupBy },
        },
      ];
    case 'max':
      return [
        {
          key: 'max',
          label: null,
          aggregation: { alignmentPeriod, perSeriesAligner: 'ALIGN_MAX', crossSeriesReducer: 'REDUCE_SUM', groupByFields: a.groupBy },
        },
      ];
    case 'percentiles':
      return a.percentiles.map((pct) => ({
        key: `p${pct}`,
        label: `p${pct}`,
        aggregation: { alignmentPeriod, perSeriesAligner: 'ALIGN_DELTA', crossSeriesReducer: PERCENTILE_REDUCER[pct], groupByFields: [] },
      }));
  }
}

function groupLabel(series: SeriesLike, groupBy: string[]): string {
  const values = groupBy.map((field) => {
    const name = field.replace(/^(metric|resource)\.labels?\./, '');
    return (field.startsWith('resource') ? series.resource?.labels?.[name] : series.metric?.labels?.[name]) ?? '';
  });
  return values.filter(Boolean).join(' · ') || 'All';
}

function isMissingMetric(err: unknown): boolean {
  const problem = toProblem(err);
  return (
    problem.code === 'NOT_FOUND' ||
    (problem.code === 'INVALID_ARGUMENT' && /cannot find metric|metric\.type|not a valid metric|unknown metric/i.test(problem.detail))
  );
}

/** Metrics tabs: preset charts aligned on the server (SPEC-0005 D-07, CA-10). */
@Injectable()
export class MetricsService {
  constructor(private readonly clients: GcpClientFactory) {}

  async presets(h: ProfileHandle, projectId: string, q: MetricsQuery): Promise<MetricsResponse> {
    const preset = METRIC_PRESETS[q.kind];
    for (const label of preset.labels) {
      if (!q.labels[label]) throw ProblemException.of('INVALID_ARGUMENT', `The ${q.kind} metrics need the resource label ${label}.`);
    }
    const untilMs = q.until ? Date.parse(q.until) : Date.now();
    const sinceMs = Date.parse(q.since);
    if (!(sinceMs < untilMs)) throw ProblemException.of('INVALID_ARGUMENT', 'The start of the range must be before its end.');
    const period = alignmentSeconds(sinceMs, untilMs);

    const { MetricServiceClient } = await sdk.monitoring();
    const client = this.clients.get(h.profile.id, 'monitoring.metrics', (auth) => new MetricServiceClient({ auth }));
    const interval = {
      startTime: { seconds: Math.floor(sinceMs / 1000) },
      endTime: { seconds: Math.ceil(untilMs / 1000) },
    };
    const resourceFilter = [
      `resource.type = ${quoteFilterValue(preset.resourceType)}`,
      ...preset.labels.map((l) => `resource.labels.${l} = ${quoteFilterValue(q.labels[l] as string)}`),
    ].join(' AND ');

    const charts: MetricChart[] = [];
    const hidden: MetricsResponse['hidden'] = [];
    await Promise.all(
      preset.charts.map(async (chart) => {
        const filter = `metric.type = ${quoteFilterValue(chart.metricType)} AND ${resourceFilter}`;
        try {
          const series: MetricSeries[] = [];
          for (const req of requestsFor(chart, period)) {
            const [items] = await client.listTimeSeries(
              { name: `projects/${projectId}`, filter, interval, aggregation: req.aggregation, view: 'FULL' as const },
              { autoPaginate: true },
            );
            for (const s of items as SeriesLike[]) {
              const scale = unitScale(s.unit, chart.unit);
              const groupBy = 'groupBy' in chart.aggregation ? chart.aggregation.groupBy : [];
              const label = req.label ?? groupLabel(s, groupBy);
              const points = (s.points ?? [])
                .map((pt): [number, number | null] => {
                  const v = pointValue(pt);
                  return [pointTime(pt), v === null ? null : v * scale];
                })
                .sort((a, b) => a[0] - b[0]);
              series.push({ key: `${req.key}:${label}`, label, points });
            }
          }
          charts.push({ id: chart.id, title: chart.title, unit: chart.unit, series });
        } catch (err) {
          if (isMissingMetric(err)) {
            hidden.push({ id: chart.id, title: chart.title, reason: `The metric ${chart.metricType} does not exist in this project.` });
            return;
          }
          const problem = toProblem(err);
          if (problem.code === 'API_DISABLED' || problem.code === 'PERMISSION_DENIED') throw err;
          hidden.push({ id: chart.id, title: chart.title, reason: problem.detail });
        }
      }),
    );
    const order = new Map(preset.charts.map((c, i) => [c.id, i]));
    charts.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return {
      charts,
      hidden,
      alignmentSeconds: period,
      since: new Date(sinceMs).toISOString(),
      until: new Date(untilMs).toISOString(),
    };
  }
}
