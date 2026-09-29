import type { MetricChart, MetricPresetKind, MetricsResponse, MetricUnit } from '@nephoscope/contracts';
import { ArrowClockwiseIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '../design/Button';
import { Legend, type Note, Notes } from '../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../design/Feedback';
import { Field, Select } from '../design/Form';
import { ApiError, api, qs } from '../lib/api';
import { useTokenColors } from '../lib/color';
import { bytes } from '../lib/format';
import { useSession } from '../state/session';
import { rangeStart, type TimeRange, timeRangeLabels, timeRanges } from './timeRange';
import { useSearchState } from './urlState';

const COLOR_TOKENS = ['ink', 'ink-2', 'ink-3', 'construct-ink', 'ok', 'warn', 'redline', 'rule', 'sheet', 'panel'] as const;
type ColorToken = (typeof COLOR_TOKENS)[number];

/** Series colors by meaning (SPEC-0002 D-20): states keep their color; everything else is ink. */
function colorFor(label: string, index: number): ColorToken {
  const l = label.toLowerCase();
  if (/^2xx$|^succeeded$|^success$|^ok$|^active$/.test(l)) return 'ok';
  if (/^4xx$|^retry/.test(l)) return 'warn';
  if (/^5xx$|^failed$|^failure$|^error|^crash|^timeout/.test(l)) return 'redline';
  if (l === 'p50') return 'ink-3';
  if (l === 'p95') return 'ink-2';
  if (l === 'p99') return 'ink';
  const neutral: ColorToken[] = ['ink', 'construct-ink', 'ink-2', 'ink-3'];
  return neutral[index % neutral.length] as ColorToken;
}

function formatValue(v: number | null | undefined, unit: MetricUnit): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  switch (unit) {
    case 'ratio':
      return `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
    case 'ms':
      return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v >= 10 ? Math.round(v) : v.toFixed(1)} ms`;
    case 's':
      return `${v.toFixed(v < 10 ? 2 : 0)} s`;
    case 'bytes':
      return bytes(v);
    case '1/s':
      return `${v >= 10 ? Math.round(v) : v.toFixed(2)}/s`;
    default:
      return v >= 10 ? String(Math.round(v)) : v.toFixed(2).replace(/\.?0+$/, '');
  }
}

const tickTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const tickDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function Chart({ chart, colors, spanMs }: { chart: MetricChart; colors: Record<ColorToken, string>; spanMs: number }) {
  const data = useMemo(() => {
    const byTime = new Map<number, Record<string, number | null>>();
    for (const s of chart.series) {
      for (const [t, v] of s.points) {
        const row = byTime.get(t) ?? { t };
        row[s.key] = v;
        byTime.set(t, row);
      }
    }
    return [...byTime.values()].sort((a, b) => (a.t as number) - (b.t as number));
  }, [chart]);
  const empty = chart.series.every((s) => s.points.length === 0);
  return (
    <figure className="m-0 flex flex-col gap-2 border-b border-rule px-6 py-4 md:border-r">
      <figcaption className="flex items-baseline justify-between gap-2">
        <Legend>{chart.title}</Legend>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-ink-2">
          {chart.series.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span className="inline-block h-0.5 w-3" style={{ backgroundColor: colors[colorFor(s.label, i)] }} aria-hidden />
              {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      {empty ? (
        <p className="m-0 flex h-44 items-center text-dense text-ink-3">No data in this range.</p>
      ) : (
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} syncId="nephoscope-metrics" margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={colors.rule} vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(t: number) => (spanMs > 2 * 86_400_000 ? tickDay.format(t) : tickTime.format(t))}
                stroke={colors['ink-3']}
                tick={{ fontSize: 11, fill: colors['ink-2'] }}
                minTickGap={40}
              />
              <YAxis
                width={56}
                tickFormatter={(v: number) => formatValue(v, chart.unit)}
                stroke={colors['ink-3']}
                tick={{ fontSize: 11, fill: colors['ink-2'] }}
              />
              <Tooltip
                isAnimationActive={false}
                contentStyle={{ background: colors.panel, border: `1px solid ${colors.rule}`, fontSize: 12, color: colors.ink }}
                labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
                formatter={(v, name) => [
                  formatValue(Number(v), chart.unit),
                  chart.series.find((s) => s.key === name)?.label ?? String(name),
                ]}
              />
              {chart.series.map((s, i) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.key}
                  type="monotone"
                  dot={false}
                  strokeWidth={1.5}
                  stroke={colors[colorFor(s.label, i)]}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}

interface MetricsPanelProps {
  projectId: string;
  kind: MetricPresetKind;
  labels: Record<string, string>;
}

/** Preset charts of a resource (SPEC-0005 D-07, CA-10). */
export function MetricsPanel({ projectId, kind, labels }: MetricsPanelProps) {
  const profileId = useSession((s) => s.profileId);
  const [range, setRange] = useSearchState<TimeRange>('range', '1h', timeRanges);
  const [anchor, setAnchor] = useState(() => Date.now());
  const colors = useTokenColors(COLOR_TOKENS);
  const labelsKey = JSON.stringify(labels);
  const query = useQuery({
    queryKey: ['metrics', profileId, projectId, kind, labelsKey, range, anchor],
    queryFn: ({ signal }) =>
      api<MetricsResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/metrics${qs({ kind, labels: labelsKey, since: rangeStart(range, anchor), until: new Date(anchor).toISOString() })}`,
        { signal },
      ),
    enabled: !!profileId,
    staleTime: 60_000,
  });

  const notes: Note[] = (query.data?.hidden ?? []).map((h) => ({ id: h.id, tone: 'unknown', text: `${h.title} is hidden: ${h.reason}` }));
  const spanMs = query.data ? Date.parse(query.data.until) - Date.parse(query.data.since) : 0;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end gap-3 px-6 py-3">
        <Field label="Range" className="w-44">
          <Select<TimeRange>
            value={range}
            onValueChange={setRange}
            options={timeRanges.map((r) => ({ value: r, label: timeRangeLabels[r] }))}
          />
        </Field>
        <Button icon={ArrowClockwiseIcon} onClick={() => setAnchor(Date.now())} loading={query.isFetching}>
          Refresh
        </Button>
        {query.data ? (
          <span className="pb-2 text-meta text-ink-3">
            Each point covers{' '}
            {query.data.alignmentSeconds >= 3600 ? `${query.data.alignmentSeconds / 3600} h` : `${query.data.alignmentSeconds / 60} min`}.
          </span>
        ) : null}
      </div>
      <Notes notes={notes} title="Notes" />
      {query.isPending ? (
        <DelayedSkeleton rows={6} />
      ) : query.error instanceof ApiError ? (
        <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />
      ) : (query.data?.charts.length ?? 0) === 0 ? (
        <EmptyState title="No metrics">This resource has not reported any of its preset metrics yet.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 border-t border-rule md:grid-cols-2">
          {query.data?.charts.map((c) => (
            <Chart key={c.id} chart={c} colors={colors} spanMs={spanMs} />
          ))}
        </div>
      )}
    </div>
  );
}
