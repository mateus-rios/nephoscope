import type { LogEntry, SeriesView, TraceSpanView } from '@nephoscope/contracts';
import { describe, expect, it } from 'vitest';
import { alignSeries, seriesLabels } from '../kit/series';
import { histogram } from './logging/Explorer';
import { grantCommand } from './logging/Router';
import { conditionQuery } from './monitoring/Alerts';
import { dashboardTiles, widgetQuery } from './monitoring/Dashboards';
import { latencyHistogram, spanTree } from './trace/TracePages';

const entry = (timestamp: string, severity: LogEntry['severity']): LogEntry => ({
  id: `${timestamp}${severity}`,
  timestamp,
  severity,
  logName: 'projects/demo/logs/app',
  resource: { type: 'global', labels: {} },
  summary: '',
  http: null,
  trace: null,
  raw: {},
});

describe('Logs Explorer histogram (SPEC-0005 D-04)', () => {
  it('counts loaded entries per bucket and severity band', () => {
    const from = Date.parse('2026-10-14T10:00:00Z');
    const rows = histogram(
      [
        entry('2026-10-14T10:00:30Z', 'ERROR'),
        entry('2026-10-14T10:00:40Z', 'WARNING'),
        entry('2026-10-14T10:09:00Z', 'INFO'),
        entry('2026-10-14T09:00:00Z', 'ERROR'),
      ],
      from,
      from + 600_000,
      10,
    );
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({ error: 1, warning: 1, other: 0 });
    expect(rows[9]).toMatchObject({ other: 1 });
    expect(rows.reduce((n, r) => n + r.error + r.warning + r.other, 0)).toBe(3);
  });
});

describe('sink grants (SPEC-0005 CA-06)', () => {
  it('writes the grant command for each destination', () => {
    const writer = 'serviceAccount:p123-456@gcp-sa-logging.iam.gserviceaccount.com';
    expect(
      grantCommand({
        destination: 'pubsub.googleapis.com/projects/demo/topics/audit',
        destinationKind: 'pubsub',
        writerIdentity: writer,
        requiredRole: 'roles/pubsub.publisher',
      }),
    ).toBe(`gcloud pubsub topics add-iam-policy-binding audit --project=demo --member=${writer} --role=roles/pubsub.publisher`);
    expect(
      grantCommand({
        destination: 'storage.googleapis.com/archive',
        destinationKind: 'storage',
        writerIdentity: writer,
        requiredRole: 'roles/storage.objectCreator',
      }),
    ).toContain('gs://archive');
    expect(grantCommand({ destination: 'x', destinationKind: 'storage', writerIdentity: null, requiredRole: null })).toBeNull();
  });
});

describe('dashboards (SPEC-0005 D-09)', () => {
  it('reads tiles of every layout in reading order', () => {
    const mosaic = dashboardTiles({
      mosaicLayout: {
        columns: 48,
        tiles: [
          { xPos: 24, yPos: 0, width: 24, height: 16, widget: { title: 'b' } },
          { xPos: 0, yPos: 0, width: 24, height: 16, widget: { title: 'a' } },
          { xPos: 0, yPos: 16, width: 48, height: 4, widget: { title: 'g', collapsibleGroup: {} } },
        ],
      },
    });
    expect(mosaic.map((t) => [t.widget.title, t.span])).toEqual([
      ['a', 6],
      ['b', 6],
      ['g', 12],
    ]);
    expect(dashboardTiles({ gridLayout: { columns: 3, widgets: [{}, {}, {}, {}] } }).map((t) => t.span)).toEqual([4, 4, 4, 4]);
    expect(new Set(mosaic.map((t) => t.id)).size).toBe(3);
  });

  it('turns widget queries into series queries, and leaves unknown ones out', () => {
    const r = { since: 's', until: 'u' };
    expect(widgetQuery({ prometheusQuery: 'up' }, r.since, r.until)).toEqual({ kind: 'promql', query: 'up', ...r });
    expect(widgetQuery({ timeSeriesQueryLanguage: 'fetch x' }, r.since, r.until)?.kind).toBe('mql');
    expect(
      widgetQuery({ timeSeriesFilter: { filter: 'metric.type="x"', aggregation: { perSeriesAligner: 'ALIGN_RATE' } } }, r.since, r.until),
    ).toMatchObject({
      kind: 'filter',
      aggregation: { perSeriesAligner: 'ALIGN_RATE' },
    });
    expect(widgetQuery({ timeSeriesFilterRatio: {} }, r.since, r.until)).toBeNull();
  });

  it('charts threshold conditions with their aggregation', () => {
    expect(
      conditionQuery(
        {
          name: 'c',
          displayName: 'c',
          kind: 'threshold',
          filter: 'f',
          query: null,
          comparison: null,
          threshold: 1,
          duration: null,
          aggregations: [{ alignmentPeriod: '60s' }],
        },
        's',
        'u',
      ),
    ).toMatchObject({ kind: 'filter', filter: 'f', aggregation: { alignmentPeriod: '60s' } });
    expect(
      conditionQuery(
        {
          name: 'c',
          displayName: 'c',
          kind: 'log',
          filter: 'f',
          query: null,
          comparison: null,
          threshold: null,
          duration: null,
          aggregations: [],
        },
        's',
        'u',
      ),
    ).toBeNull();
  });
});

describe('series helpers', () => {
  const series: SeriesView[] = [
    {
      labels: { code: '200', service: 'api' },
      points: [
        [1000, 1],
        [3000, 3],
      ],
    },
    { labels: { code: '500', service: 'api' }, points: [[2000, 2]] },
  ];
  it('labels series by what differs between them', () => {
    expect(seriesLabels(series)).toEqual(['200', '500']);
  });
  it('aligns series on one time axis with gaps', () => {
    expect(alignSeries(series)).toEqual([
      [1, 2, 3],
      [1, null, 3],
      [null, 2, null],
    ]);
  });
});

describe('trace (SPEC-0005 D-12)', () => {
  const span = (spanId: string, parentSpanId: string | null, start: string): TraceSpanView => ({
    spanId,
    parentSpanId,
    name: spanId,
    kind: null,
    start,
    end: start,
    labels: {},
  });
  it('orders spans as a tree, children by start', () => {
    const tree = spanTree([
      span('c2', 'r', '2026-10-14T10:00:02Z'),
      span('r', null, '2026-10-14T10:00:00Z'),
      span('c1', 'r', '2026-10-14T10:00:01Z'),
      span('g', 'c1', '2026-10-14T10:00:01.5Z'),
    ]);
    expect(tree.map((t) => [t.span.spanId, t.depth])).toEqual([
      ['r', 0],
      ['c1', 1],
      ['g', 2],
      ['c2', 1],
    ]);
  });
  it('buckets latencies on a doubling scale', () => {
    const h = latencyHistogram([
      { traceId: 'a', rootName: '', start: null, durationMs: 8, spanCount: 1 },
      { traceId: 'b', rootName: '', start: null, durationMs: 300, spanCount: 1 },
      { traceId: 'c', rootName: '', start: null, durationMs: 60_000, spanCount: 1 },
    ]);
    expect(h.reduce((n, b) => n + b.n, 0)).toBe(3);
    expect(h[0]?.n).toBe(1);
    expect(h.at(-1)?.n).toBe(1);
  });
});
