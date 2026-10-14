import {
  buildPromQL,
  type MetricDescriptorView,
  type PromAggregation,
  promAggregations,
  promMetricName,
  type SeriesQuery,
  type SeriesView,
} from '@nephoscope/contracts';
import { BookmarkSimpleIcon, PlayIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { CodeEditor } from '../../design/code/CodeEditor';
import { queryHints } from '../../design/code/hints';
import { Legend } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { Dialog, Menu, MenuGroupLabel, MenuItem, MenuSeparator } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { Chip } from '../../design/Values';
import { rangeStart, type TimeRange, timeRangeLabels, timeRanges } from '../../kit/timeRange';
import { seriesLabels, UPlotChart } from '../../kit/UPlotChart';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { useSaved, useSaveItem } from '../logging/api';
import { useMetricSearch, useSeries } from './api';

const WINDOWS = ['1m', '5m', '15m', '1h'] as const;
type Window = (typeof WINDOWS)[number];

const AGG_LABEL: Record<PromAggregation, string> = {
  sum: 'Sum',
  avg: 'Mean',
  max: 'Max',
  min: 'Min',
  count: 'Count',
  p50: '50th percentile',
  p95: '95th percentile',
  p99: '99th percentile',
};

function defaultAggregation(d: MetricDescriptorView): PromAggregation {
  if (d.valueType === 'DISTRIBUTION') return 'p95';
  return d.metricKind === 'GAUGE' ? 'avg' : 'sum';
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const compact = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });

/** Last value of every series, the table view of a chart (dataviz: a table view exists). */
export function SeriesTable({ series, tableId }: { series: SeriesView[]; tableId: string }) {
  const labels = seriesLabels(series);
  const rows = series.map((s, i) => ({
    id: String(i),
    label: labels[i] ?? '',
    last: [...s.points].reverse().find(([, v]) => v !== null)?.[1] ?? null,
    points: s.points.length,
  }));
  const columns: ResourceColumn<(typeof rows)[number]>[] = [
    {
      id: 'label',
      header: 'Series',
      hideable: false,
      sortValue: (r) => r.label,
      cell: (r) => <span className="truncate font-mono text-[12px]">{r.label}</span>,
    },
    {
      id: 'last',
      header: 'Last value',
      width: '10rem',
      align: 'right',
      sortValue: (r) => r.last ?? -Infinity,
      cell: (r) => <span className="tnum">{r.last === null ? '' : compact.format(r.last)}</span>,
    },
    {
      id: 'points',
      header: 'Points',
      width: '6rem',
      align: 'right',
      sortValue: (r) => r.points,
      cell: (r) => <span className="tnum">{r.points}</span>,
    },
  ];
  return <ResourceTable tableId={tableId} label="Series" rows={rows} columns={columns} getRowId={(r) => r.id} emptyTitle="No series" />;
}

/** Metrics Explorer over PromQL (SPEC-0005 D-08, CA-08). */
export function MetricsExplorer({ projectId }: { projectId: string }) {
  const [range, setRange] = useSearchState<TimeRange>('range', '1h', timeRanges);
  const [applied, setApplied] = useSearchState<string>('promql', '');
  const [metricType, setMetricType] = useSearchState<string>('metric', '');
  const [search, setSearch] = useState(metricType);
  const [draft, setDraft] = useState(applied);
  const [descriptor, setDescriptor] = useState<MetricDescriptorView | null>(null);
  const [resourceType, setResourceType] = useState('');
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [aggregation, setAggregation] = useState<PromAggregation>('sum');
  const [win, setWin] = useState<Window>('5m');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [anchor, setAnchor] = useState(() => Date.now());
  const term = useDebounced(search, 300);
  const results = useMetricSearch(projectId, term);
  const saved = useSaved('chart', projectId);
  const save = useSaveItem('chart', projectId);

  useEffect(() => setDraft(applied), [applied]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query or range reads from now.
  useEffect(() => setAnchor(Date.now()), [applied, range]);
  useEffect(() => {
    queryHints.promql.metrics = (results.data ?? []).map((d) => promMetricName(d.type));
    queryHints.promql.labels = [...new Set((results.data ?? []).flatMap((d) => d.labels.map((l) => l.key)))];
  }, [results.data]);
  // A metric named in the URL (from a log-based metric) is picked once its descriptor arrives.
  useEffect(() => {
    if (!metricType || descriptor?.type === metricType) return;
    const d = results.data?.find((x) => x.type === metricType);
    if (d) pick(d, !applied);
  });

  function pick(d: MetricDescriptorView, run: boolean) {
    setDescriptor(d);
    setMetricType(d.type);
    const rt = d.resourceTypes[0] ?? '';
    const agg = defaultAggregation(d);
    setResourceType(rt);
    setGroupBy([]);
    setAggregation(agg);
    const q = buildPromQL({
      metricType: d.type,
      metricKind: d.metricKind,
      valueType: d.valueType,
      resourceType: rt || undefined,
      groupBy: [],
      aggregation: agg,
      window: win,
    });
    setDraft(q);
    if (run) setApplied(q);
  }

  function rebuild(next: Partial<{ resourceType: string; groupBy: string[]; aggregation: PromAggregation; win: Window }>) {
    if (!descriptor) return;
    const rt = next.resourceType ?? resourceType;
    const gb = next.groupBy ?? groupBy;
    const agg = next.aggregation ?? aggregation;
    const w = next.win ?? win;
    const q = buildPromQL({
      metricType: descriptor.type,
      metricKind: descriptor.metricKind,
      valueType: descriptor.valueType,
      resourceType: rt || undefined,
      groupBy: gb,
      aggregation: agg,
      window: w,
    });
    setDraft(q);
    setApplied(q);
  }

  const query: SeriesQuery | null = applied
    ? { kind: 'promql', query: applied, since: rangeStart(range, anchor), until: new Date(anchor).toISOString() }
    : null;
  const series = useSeries(projectId, query);
  const labelKeys = useMemo(() => descriptor?.labels.map((l) => l.key) ?? [], [descriptor]);

  return (
    <div className="grid md:grid-cols-[20rem_1fr]">
      <aside aria-label="Metric picker" className="flex flex-col gap-3 border-b border-rule px-6 py-4 md:border-r md:border-b-0 md:px-4">
        <Field label="Metric" help="Search by type or name, such as run request_count.">
          <Input data-filter-input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search metrics" />
        </Field>
        <div className="max-h-80 overflow-y-auto rounded-control border border-rule" role="listbox" aria-label="Metrics">
          {results.isPending ? (
            <DelayedSkeleton rows={4} className="p-2" />
          ) : results.error instanceof ApiError ? (
            <p className="m-0 p-2 text-meta text-redline-ink">{results.error.problem.detail}</p>
          ) : (results.data ?? []).length === 0 ? (
            <p className="m-0 p-2 text-meta text-ink-3">No metric matches.</p>
          ) : (
            (results.data ?? []).slice(0, 80).map((d) => (
              <button
                key={d.type}
                type="button"
                role="option"
                aria-selected={descriptor?.type === d.type}
                onClick={() => pick(d, true)}
                className="block w-full border-b border-rule px-2 py-1 text-left last:border-b-0 hover:bg-hover aria-selected:bg-construct-tint"
              >
                <span className="block truncate text-meta text-ink">{d.displayName}</span>
                <span className="block truncate font-mono text-[11px] text-ink-2">{d.type}</span>
              </button>
            ))
          )}
        </div>
        {descriptor ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-meta text-ink-2">{descriptor.description || descriptor.displayName}</p>
            {descriptor.resourceTypes.length > 1 ? (
              <Field label="Resource type">
                <Select<string>
                  value={resourceType}
                  onValueChange={(v) => {
                    setResourceType(v);
                    rebuild({ resourceType: v });
                  }}
                  options={descriptor.resourceTypes.map((t) => ({ value: t, label: t }))}
                />
              </Field>
            ) : null}
            <Field label="Aggregation">
              <Select<PromAggregation>
                value={aggregation}
                onValueChange={(v) => {
                  setAggregation(v);
                  rebuild({ aggregation: v });
                }}
                options={promAggregations
                  .filter((a) => descriptor.valueType === 'DISTRIBUTION' || !a.startsWith('p'))
                  .map((a) => ({ value: a, label: AGG_LABEL[a] }))}
              />
            </Field>
            {descriptor.metricKind !== 'GAUGE' || descriptor.valueType === 'DISTRIBUTION' ? (
              <Field label="Rate window">
                <Select<Window>
                  value={win}
                  onValueChange={(v) => {
                    setWin(v);
                    rebuild({ win: v });
                  }}
                  options={WINDOWS.map((w) => ({ value: w, label: w }))}
                />
              </Field>
            ) : null}
            {labelKeys.length > 0 ? (
              <div className="flex flex-col gap-1">
                <Legend>Group by</Legend>
                <div className="flex flex-wrap gap-1">
                  {labelKeys.map((k) => {
                    const on = groupBy.includes(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          const next = on ? groupBy.filter((g) => g !== k) : [...groupBy, k];
                          setGroupBy(next);
                          rebuild({ groupBy: next });
                        }}
                        className="rounded-pill border border-rule-strong px-2 py-0.5 font-mono text-[11px] text-ink-2 hover:bg-hover aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ink-inverse"
                      >
                        {k}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>
      <div className="flex min-w-0 flex-col gap-3 px-6 py-4">
        <CodeEditor
          value={draft}
          onChange={setDraft}
          language="promql"
          height={84}
          label="PromQL query"
          onRun={() => setApplied(draft.trim())}
        />
        <div className="flex flex-wrap items-end gap-2">
          <Button variant="commit" icon={PlayIcon} onClick={() => setApplied(draft.trim())} disabled={!draft.trim()}>
            Run query
          </Button>
          <Field label="Range" className="w-44">
            <Select<TimeRange>
              value={range}
              onValueChange={setRange}
              options={timeRanges.map((r) => ({ value: r, label: timeRangeLabels[r] }))}
            />
          </Field>
          <div role="radiogroup" aria-label="View" className="flex overflow-hidden rounded-control border border-rule-strong">
            {(['chart', 'table'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={
                  view === v
                    ? 'h-(--control-h) bg-ink px-3 text-meta text-ink-inverse'
                    : 'h-(--control-h) px-3 text-meta text-ink-2 hover:bg-hover'
                }
              >
                {v === 'chart' ? 'Chart' : 'Table'}
              </button>
            ))}
          </div>
          <span className="ml-auto">
            <Menu trigger={<Button icon={BookmarkSimpleIcon}>Saved charts</Button>} align="end">
              <MenuItem onClick={() => setSaving(true)} disabled={!applied}>
                Save this chart
              </MenuItem>
              <MenuSeparator />
              {(saved.data ?? []).length === 0 ? <MenuGroupLabel>No saved charts</MenuGroupLabel> : null}
              {(saved.data ?? []).map((s) => (
                <MenuItem key={s.id} onClick={() => setApplied(s.value)}>
                  {s.name}
                </MenuItem>
              ))}
            </Menu>
          </span>
        </div>
        {!applied ? (
          <EmptyState title="Pick a metric or write PromQL">
            Cloud Monitoring answers PromQL for every metric: {'run.googleapis.com/request_count'} is {'run_googleapis_com:request_count'}.
          </EmptyState>
        ) : series.isPending ? (
          <DelayedSkeleton rows={6} />
        ) : series.error instanceof ApiError ? (
          <ProblemState problem={series.error.problem} onRetry={() => void series.refetch()} />
        ) : (series.data?.series.length ?? 0) === 0 ? (
          <EmptyState title="No data">{series.data?.note ?? 'The query returned no series in this range.'}</EmptyState>
        ) : view === 'chart' ? (
          <div className="flex flex-col gap-1">
            <UPlotChart series={series.data?.series ?? []} label="Query result" height={320} />
            {applied.includes(':') ? (
              <span className="flex flex-wrap gap-1">
                <Chip mono>step {series.data?.stepSeconds ?? ''} s</Chip>
                <Chip mono>{series.data?.series.length} series</Chip>
              </span>
            ) : null}
          </div>
        ) : (
          <SeriesTable series={series.data?.series ?? []} tableId="metrics-explorer-series" />
        )}
      </div>
      <Dialog
        open={saving}
        onOpenChange={setSaving}
        title="Save chart"
        width="sm"
        footer={
          <>
            <Button onClick={() => setSaving(false)}>Cancel</Button>
            <Button
              variant="commit"
              disabled={!saveName.trim()}
              loading={save.isPending}
              onClick={() => save.mutate({ name: saveName.trim(), value: applied }, { onSuccess: () => setSaving(false) })}
            >
              Save chart
            </Button>
          </>
        }
      >
        <Field label="Name" help="Saved charts stay in this Nephoscope, per project.">
          <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} autoFocus />
        </Field>
      </Dialog>
    </div>
  );
}
