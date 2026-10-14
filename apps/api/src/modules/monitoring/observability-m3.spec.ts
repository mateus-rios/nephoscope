import { buildPromQL, promMetricName, traceIdOf } from '@nephoscope/contracts';
import { describe, expect, it } from 'vitest';
import { fakeHandle } from '../../testing/fake-handle.js';
import { mapGroupStats, summarizeTrace } from '../diagnostics/diagnostics.module.js';
import { LoggingService } from '../logging/logging.service.js';
import { csvField, destinationKind, logIdOf, mapBucket, mapMetric, mapSink, metricBody, requiredRole } from '../logging/logging-mapping.js';
import { MonitoringService } from './monitoring.module.js';
import { mapMql, mapPolicy, mapPrometheus, mapTimeSeries, mapUptime, policyFromForm, promStep } from './monitoring-mapping.js';

const ops = { recordInstant: () => ({}) } as never;

describe('PromQL (SPEC-0005 D-08)', () => {
  it('names Google metrics the way Cloud Monitoring PromQL expects', () => {
    expect(promMetricName('run.googleapis.com/request_count')).toBe('run_googleapis_com:request_count');
    expect(promMetricName('run.googleapis.com/container/cpu/utilizations')).toBe('run_googleapis_com:container_cpu_utilizations');
    expect(promMetricName('logging.googleapis.com/user/checkout_errors')).toBe('logging_googleapis_com:user_checkout_errors');
    expect(promMetricName('prometheus.googleapis.com/http_requests_total/counter')).toBe('http_requests_total');
  });

  it('builds T-11 from the picker: rate for counters, grouped', () => {
    expect(
      buildPromQL({
        metricType: 'run.googleapis.com/request_count',
        metricKind: 'DELTA',
        valueType: 'INT64',
        resourceType: 'cloud_run_revision',
        groupBy: ['response_code_class'],
        aggregation: 'sum',
        window: '5m',
      }),
    ).toBe('sum by (response_code_class) (rate(run_googleapis_com:request_count{monitored_resource="cloud_run_revision"}[5m]))');
  });

  it('uses histogram quantiles for distributions and plain selectors for gauges', () => {
    expect(
      buildPromQL({
        metricType: 'run.googleapis.com/request_latencies',
        metricKind: 'DELTA',
        valueType: 'DISTRIBUTION',
        groupBy: [],
        aggregation: 'p99',
        window: '5m',
      }),
    ).toBe('histogram_quantile(0.99, sum by (le) (rate(run_googleapis_com:request_latencies_bucket[5m])))');
    expect(
      buildPromQL({
        metricType: 'compute.googleapis.com/instance/cpu/utilization',
        metricKind: 'GAUGE',
        valueType: 'DOUBLE',
        groupBy: ['instance_name'],
        aggregation: 'max',
        window: '5m',
      }),
    ).toBe('max by (instance_name) (compute_googleapis_com:instance_cpu_utilization)');
  });

  it('keeps about 1,500 points per series, at least 15 s apart', () => {
    expect(promStep(0, 3_600_000)).toBe(15);
    expect(promStep(0, 30 * 86_400_000)).toBe(1728);
  });
});

describe('series mapping', () => {
  it('maps Prometheus matrices, REST time series and MQL data to chart series', () => {
    expect(
      mapPrometheus({
        data: {
          result: [
            {
              metric: { code: '200' },
              values: [
                [1700000000.5, '3'],
                [1700000060, 'NaN'],
              ],
            },
          ],
        },
      }),
    ).toEqual([
      {
        labels: { code: '200' },
        points: [
          [1700000000500, 3],
          [1700000060000, null],
        ],
      },
    ]);
    const ts = mapTimeSeries([
      {
        metric: { labels: { state: 'active' } },
        resource: { labels: { service_name: 'api' } },
        points: [
          { interval: { endTime: '2026-10-14T10:01:00Z' }, value: { int64Value: '7' } },
          { interval: { endTime: '2026-10-14T10:00:00Z' }, value: { doubleValue: 1.5 } },
        ],
      },
    ]);
    expect(ts[0]?.labels).toEqual({ 'resource.service_name': 'api', 'metric.state': 'active' });
    expect(ts[0]?.points.map(([, v]) => v)).toEqual([1.5, 7]);
    const mql = mapMql({
      timeSeriesDescriptor: { labelDescriptors: [{ key: 'resource.zone' }] },
      timeSeriesData: [
        {
          labelValues: [{ stringValue: 'us-a' }],
          pointData: [{ values: [{ doubleValue: 2 }], timeInterval: { endTime: '2026-10-14T10:00:00Z' } }],
        },
      ],
    });
    expect(mql).toEqual([{ labels: { 'resource.zone': 'us-a' }, points: [[Date.parse('2026-10-14T10:00:00Z'), 2]] }]);
  });
});

describe('alert policies (SPEC-0005 D-10)', () => {
  it('builds a threshold policy from the form (T-13)', () => {
    const p = policyFromForm({
      mode: 'threshold',
      displayName: 'High latency',
      source: {
        kind: 'metric',
        metricType: 'run.googleapis.com/request_latencies',
        resourceType: 'cloud_run_revision',
        aligner: 'ALIGN_PERCENTILE_99',
      },
      comparison: 'COMPARISON_GT',
      threshold: 800,
      durationSeconds: 300,
      alignmentSeconds: 60,
      channels: ['projects/demo/notificationChannels/1'],
    });
    expect(p.conditions[0].conditionThreshold).toEqual({
      filter: 'metric.type = "run.googleapis.com/request_latencies" AND resource.type = "cloud_run_revision"',
      comparison: 'COMPARISON_GT',
      thresholdValue: 800,
      duration: '300s',
      aggregations: [{ alignmentPeriod: '60s', perSeriesAligner: 'ALIGN_PERCENTILE_99' }],
      trigger: { count: 1 },
    });
    expect(p.notificationChannels).toEqual(['projects/demo/notificationChannels/1']);
  });

  it('maps every condition kind', () => {
    const v = mapPolicy({
      name: 'projects/demo/alertPolicies/42',
      displayName: 'p',
      enabled: false,
      conditions: [
        { name: 'c1', conditionThreshold: { filter: 'f', comparison: 'COMPARISON_LT', thresholdValue: 1, duration: '60s' } },
        { name: 'c2', conditionPrometheusQueryLanguage: { query: 'up == 0', duration: '0s' } },
        { name: 'c3', conditionMatchedLog: { filter: 'severity>=ERROR' } },
      ],
    });
    expect(v).toMatchObject({ id: '42', enabled: false });
    expect(v.conditions.map((c) => c.kind)).toEqual(['threshold', 'promql', 'log']);
  });

  it('turns a JSON policy into a create without a name', async () => {
    const { h, calls } = fakeHandle({ 'projects/demo/alertPolicies': { name: 'projects/demo/alertPolicies/9', displayName: 'From JSON' } });
    await new MonitoringService(ops).createPolicy(h, 'demo', {
      mode: 'json',
      json: '{"name":"x","displayName":"From JSON","conditions":[]}',
    });
    expect(calls[0]?.data).toEqual({ displayName: 'From JSON', conditions: [] });
  });

  it('reports Prometheus errors with their own message', async () => {
    const { h } = fakeHandle({});
    (h.auth.request as unknown as { mockRejectedValueOnce(e: unknown): void }).mockRejectedValueOnce({
      response: { status: 400, data: { status: 'error', errorType: 'bad_data', error: 'parse error at char 5' } },
    });
    await expect(
      new MonitoringService(ops).series(h, 'demo', { kind: 'promql', query: 'sum(', since: '2026-10-14T00:00:00Z' }),
    ).rejects.toMatchObject({
      problem: { code: 'INVALID_ARGUMENT', detail: 'parse error at char 5' },
    });
  });
});

describe('uptime checks', () => {
  it('reads protocol, target and pass rate', () => {
    const v = mapUptime(
      {
        name: 'projects/demo/uptimeCheckConfigs/home-1',
        displayName: 'Home',
        monitoredResource: { labels: { host: 'example.com' } },
        httpCheck: { useSsl: true, path: '/', port: 443 },
        period: '60s',
        timeout: '10s',
      },
      new Map([['home-1', 0.97]]),
    );
    expect(v).toMatchObject({ protocol: 'HTTPS', target: 'example.com', port: 443, periodSeconds: 60, passRate: 0.97 });
  });
});

describe('Log Router (SPEC-0005 D-05)', () => {
  it('names the role a sink writer needs per destination (CA-06, T-07)', () => {
    expect(requiredRole(destinationKind('pubsub.googleapis.com/projects/demo/topics/audit'))).toBe('roles/pubsub.publisher');
    expect(requiredRole(destinationKind('storage.googleapis.com/archive'))).toBe('roles/storage.objectCreator');
    expect(requiredRole(destinationKind('bigquery.googleapis.com/projects/demo/datasets/logs'))).toBe('roles/bigquery.dataEditor');
    expect(destinationKind('logging.googleapis.com/projects/demo/locations/global/buckets/long')).toBe('logbucket');
    expect(destinationKind('logging.googleapis.com/projects/other')).toBe('project');
    const s = mapSink({ name: '_Required', destination: 'logging.googleapis.com/projects/demo/locations/global/buckets/_Required' });
    expect(s).toMatchObject({ builtIn: '_Required', writerIdentity: null, requiredRole: null });
  });

  it('refuses to change or delete the built-in sinks before calling Google', async () => {
    const { h, calls } = fakeHandle({});
    const svc = new LoggingService({} as never, ops);
    await expect(svc.deleteSink(h, 'demo', '_Default')).rejects.toMatchObject({ problem: { code: 'FAILED_PRECONDITION' } });
    await expect(
      svc.updateSink(h, 'demo', '_Required', {
        name: '_Required',
        destination: 'storage.googleapis.com/x',
        filter: '',
        disabled: false,
        exclusions: [],
      }),
    ).rejects.toMatchObject({ problem: { code: 'FAILED_PRECONDITION' } });
    expect(calls).toHaveLength(0);
  });

  it('creates sinks with a unique writer identity', async () => {
    const { h, calls } = fakeHandle({
      'projects/demo/sinks': {
        name: 'to-topic',
        destination: 'pubsub.googleapis.com/projects/demo/topics/t',
        writerIdentity: 'serviceAccount:sink@x.iam.gserviceaccount.com',
      },
    });
    const s = await new LoggingService({} as never, ops).createSink(h, 'demo', {
      name: 'to-topic',
      destination: 'pubsub.googleapis.com/projects/demo/topics/t',
      filter: 'severity>=ERROR',
      disabled: false,
      exclusions: [],
    });
    expect(calls[0]?.url).toContain('uniqueWriterIdentity=true');
    expect(s.requiredRole).toBe('roles/pubsub.publisher');
  });

  it('maps buckets and log-based metrics both ways', () => {
    expect(mapBucket({ name: 'projects/demo/locations/global/buckets/_Default', retentionDays: 30 })).toMatchObject({
      id: '_Default',
      builtIn: true,
      location: 'global',
    });
    const body = metricBody({
      name: 'latency',
      filter: 'f',
      kind: 'distribution',
      valueExtractor: 'EXTRACT(jsonPayload.ms)',
      labelExtractors: { route: 'EXTRACT(jsonPayload.route)' },
      disabled: false,
    });
    expect(body.metricDescriptor).toEqual({
      metricKind: 'DELTA',
      valueType: 'DISTRIBUTION',
      unit: '1',
      labels: [{ key: 'route', valueType: 'STRING' }],
    });
    expect(body.bucketOptions.exponentialBuckets.numFiniteBuckets).toBe(64);
    expect(mapMetric(body)).toMatchObject({ kind: 'distribution', metricType: 'logging.googleapis.com/user/latency' });
  });

  it('decodes log names and quotes CSV fields', () => {
    expect(logIdOf('projects/demo/logs/cloudaudit.googleapis.com%2Factivity')).toBe('cloudaudit.googleapis.com/activity');
    expect(csvField('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvField(null)).toBe('');
  });
});

describe('Error Reporting and Trace (SPEC-0005 D-11, D-12)', () => {
  it('maps group stats with their occurrence buckets', () => {
    const g = mapGroupStats({
      group: { groupId: 'abc', resolutionStatus: 'RESOLVED' },
      count: '12',
      representative: { message: 'TypeError: x is undefined\n    at f (app.js:1)' },
      timedCounts: [{ count: '3', startTime: '2026-10-14T10:00:00Z' }],
      affectedServices: [{ service: 'api', version: 'v2' }],
    });
    expect(g).toMatchObject({ groupId: 'abc', resolutionStatus: 'RESOLVED', count: 12, services: [{ service: 'api', version: 'v2' }] });
    expect(g.timedCounts).toEqual([[Date.parse('2026-10-14T10:00:00Z'), 3]]);
  });

  it('summarizes a trace from its root span, and reads trace ids from log entries', () => {
    const t = summarizeTrace({
      traceId: 'f00d',
      spans: [
        { spanId: '2', parentSpanId: '1', name: 'db', startTime: '2026-10-14T10:00:00.100Z', endTime: '2026-10-14T10:00:00.200Z' },
        { spanId: '1', name: '/checkout', startTime: '2026-10-14T10:00:00Z', endTime: '2026-10-14T10:00:00.250Z' },
      ],
    });
    expect(t).toEqual({ traceId: 'f00d', rootName: '/checkout', start: '2026-10-14T10:00:00Z', durationMs: 250, spanCount: 2 });
    expect(traceIdOf('projects/demo/traces/4bf92f3577b34da6a3ce929d0e0e4736')).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(traceIdOf('not a trace')).toBeNull();
  });
});
