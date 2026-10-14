import type { ListResponse, TraceSpanView, TraceSummary, TraceView } from '@nephoscope/contracts';
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '../../design/Button';
import { Legend, Section, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { LogsPanel } from '../../kit/LogsPanel';
import { rangeStart, type TimeRange, timeRangeLabels, timeRanges } from '../../kit/timeRange';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api, qs } from '../../lib/api';
import { useTokenColors } from '../../lib/color';
import { duration } from '../../lib/format';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
const ORDERS = ['start desc', 'duration desc', 'start'] as const;
type Order = (typeof ORDERS)[number];

/** Latency buckets of the listed traces, on a doubling scale (SPEC-0005 D-12). */
export function latencyHistogram(traces: TraceSummary[]): { label: string; n: number }[] {
  const edges = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, Number.POSITIVE_INFINITY];
  const out = edges.map((e, i) => ({ label: i === edges.length - 1 ? `> ${duration(edges[i - 1] as number)}` : `≤ ${duration(e)}`, n: 0 }));
  for (const t of traces) {
    if (t.durationMs === null) continue;
    const i = edges.findIndex((e) => (t.durationMs as number) <= e);
    const bucket = out[i];
    if (bucket) bucket.n++;
  }
  return out;
}

/** Spans in tree order with their depth, children after their parent sorted by start. */
export function spanTree(spans: TraceSpanView[]): { span: TraceSpanView; depth: number; hasChildren: boolean }[] {
  const ids = new Set(spans.map((s) => s.spanId));
  const children = new Map<string | null, TraceSpanView[]>();
  for (const s of spans) {
    const parent = s.parentSpanId && ids.has(s.parentSpanId) ? s.parentSpanId : null;
    children.set(parent, [...(children.get(parent) ?? []), s]);
  }
  for (const list of children.values()) list.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  const out: { span: TraceSpanView; depth: number; hasChildren: boolean }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const s of children.get(parent) ?? []) {
      out.push({ span: s, depth, hasChildren: (children.get(s.spanId) ?? []).length > 0 });
      walk(s.spanId, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function Waterfall({ spans }: { spans: TraceSpanView[] }) {
  const rows = useMemo(() => spanTree(spans), [spans]);
  const [open, setOpen] = useState<string | null>(null);
  const times = spans
    .flatMap((s) => [s.start ? Date.parse(s.start) : Number.NaN, s.end ? Date.parse(s.end) : Number.NaN])
    .filter(Number.isFinite);
  const t0 = Math.min(...times);
  const total = Math.max(1, Math.max(...times) - t0);
  return (
    <div className="text-dense">
      <div aria-hidden className="grid grid-cols-[minmax(14rem,2fr)_5rem_3fr] gap-3 border-b border-rule px-6 py-1">
        <Legend as="span">Span</Legend>
        <Legend as="span">Duration</Legend>
        <Legend as="span">Timeline</Legend>
      </div>
      <ol aria-label="Spans" className="m-0 list-none p-0">
        {rows.map(({ span, depth }) => {
          const start = span.start ? Date.parse(span.start) : t0;
          const end = span.end ? Date.parse(span.end) : start;
          const left = ((start - t0) / total) * 100;
          const width = Math.max(0.3, ((end - start) / total) * 100);
          const expanded = open === span.spanId;
          return (
            <li key={span.spanId} className="border-b border-rule">
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`${span.name}, ${duration(end - start)}`}
                onClick={() => setOpen(expanded ? null : span.spanId)}
                className="grid min-h-6 w-full grid-cols-[minmax(14rem,2fr)_5rem_3fr] items-center gap-3 px-6 py-0.5 text-left hover:bg-hover"
              >
                <span className="flex min-w-0 items-center gap-1" style={{ paddingLeft: `${depth * 12}px` }}>
                  {expanded ? (
                    <CaretDownIcon size={12} className="shrink-0 text-ink-3" aria-hidden />
                  ) : (
                    <CaretRightIcon size={12} className="shrink-0 text-ink-3" aria-hidden />
                  )}
                  <span className="truncate font-mono text-[12px] text-ink">{span.name}</span>
                </span>
                <span className="tnum text-right text-ink-2">{duration(end - start)}</span>
                <span className="relative h-3">
                  <span className="absolute inset-y-0 rounded-[2px] bg-construct-ink" style={{ left: `${left}%`, width: `${width}%` }} />
                </span>
              </button>
              {expanded ? (
                <div className="bg-well px-6 py-2">
                  <dl className="m-0 grid grid-cols-[minmax(12rem,auto)_1fr] gap-x-4 gap-y-0.5">
                    <Legend as="dt">Span id</Legend>
                    <dd className="m-0 font-mono text-[12px]">{span.spanId}</dd>
                    <Legend as="dt">Kind</Legend>
                    <dd className="m-0">{span.kind ?? 'Unspecified'}</dd>
                    {Object.entries(span.labels).map(([k, v]) => (
                      <Fragment key={k}>
                        <dt className="m-0 truncate font-mono text-[11px] text-ink-2">{k}</dt>
                        <dd className="m-0 font-mono text-[12px] break-all text-ink">{v}</dd>
                      </Fragment>
                    ))}
                  </dl>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One trace: its span waterfall and the logs written under it (SPEC-0005 D-12, CA-09). */
export function TraceViewPage() {
  const { projectId, traceId } = useParams({ strict: false }) as { projectId: string; traceId: string };
  const profileId = useSession((s) => s.profileId);
  const q = useQuery({
    queryKey: ['trace', profileId, projectId, traceId],
    queryFn: ({ signal }) => api<TraceView>(`/api/projects/${enc(projectId)}/trace/traces/${enc(traceId)}`, { signal }),
    enabled: !!profileId,
  });
  if (q.isPending) return <DelayedSkeleton rows={8} className="p-6" />;
  if (q.error instanceof ApiError || !q.data)
    return q.error instanceof ApiError ? <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} /> : null;
  const tree = spanTree(q.data.spans);
  const root = tree[0]?.span;
  const start = root?.start ? Date.parse(root.start) : Number.NaN;
  const end = root?.end ? Date.parse(root.end) : Number.NaN;
  return (
    <DetailLayout<'spans' | 'logs'>
      crumbs={[{ label: 'Trace', to: `/p/${projectId}/trace` }, { label: traceId.slice(0, 12) }]}
      title={root?.name ?? traceId}
      cells={[
        { label: 'Trace id', value: <Mono value={traceId} copy />, mono: true },
        { label: 'Duration', value: Number.isFinite(start) && Number.isFinite(end) ? duration(end - start) : '' },
        { label: 'Spans', value: String(q.data.spans.length) },
        { label: 'Started', value: <Timestamp iso={root?.start} /> },
      ]}
      tabs={[
        { key: 'spans', label: 'Spans' },
        { key: 'logs', label: 'Logs' },
      ]}
      defaultTab="spans"
    >
      {(tab) =>
        tab === 'logs' ? (
          <LogsPanel projectId={projectId} filter={`trace="projects/${projectId}/traces/${traceId}"`} />
        ) : (
          <div className="pt-3">
            <Waterfall spans={q.data.spans} />
          </div>
        )
      }
    </DetailLayout>
  );
}

/** Traces of the project with a latency histogram (SPEC-0005 D-12). */
export function TracePage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const profileId = useSession((s) => s.profileId);
  const navigate = useNavigate();
  const [range, setRange] = useSearchState<TimeRange>('range', '1h', timeRanges);
  const [order, setOrder] = useSearchState<Order>('order', 'start desc', ORDERS);
  const [filter, setFilter] = useSearchState<string>('filter', '');
  const [draft, setDraft] = useState(filter);
  const [anchor, setAnchor] = useState(() => Date.now());
  const colors = useTokenColors(['ink-2', 'ink-3', 'rule', 'panel', 'ink', 'construct-ink'] as const);
  useEffect(() => {
    document.title = 'Trace · Nephoscope';
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query reads from now.
  useEffect(() => setAnchor(Date.now()), [range, order, filter]);
  const q = useInfiniteQuery({
    queryKey: ['traces', profileId, projectId, range, order, filter, anchor],
    queryFn: ({ pageParam, signal }) =>
      api<ListResponse<TraceSummary>>(
        `/api/projects/${enc(projectId)}/trace/traces${qs({
          since: rangeStart(range, anchor),
          until: new Date(anchor).toISOString(),
          orderBy: order,
          filter: filter || undefined,
          pageToken: pageParam,
        })}`,
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId,
  });
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items), [q.data]);
  const histogram = useMemo(() => latencyHistogram(rows), [rows]);
  const href = (t: TraceSummary) => `/p/${projectId}/trace/${t.traceId}`;
  const columns: ResourceColumn<TraceSummary>[] = [
    {
      id: 'root',
      header: 'Root span',
      hideable: false,
      sortValue: (t) => t.rootName,
      cell: (t) => (
        <Link to={href(t)} className="truncate font-mono text-[12px] text-ink" onClick={(e) => e.stopPropagation()}>
          {t.rootName || t.traceId}
        </Link>
      ),
    },
    {
      id: 'latency',
      header: 'Latency',
      width: '7rem',
      align: 'right',
      sortValue: (t) => t.durationMs ?? 0,
      cell: (t) => <span className="tnum">{duration(t.durationMs)}</span>,
    },
    { id: 'start', header: 'Started', width: '9rem', sortValue: (t) => t.start ?? '', cell: (t) => <Timestamp iso={t.start} /> },
    { id: 'spans', header: 'Spans', width: '5rem', align: 'right', cell: (t) => <span className="tnum">{t.spanCount}</span> },
    { id: 'id', header: 'Trace id', width: '18rem', defaultHidden: true, cell: (t) => <Mono value={t.traceId} /> },
  ];
  return (
    <div className="pb-16">
      <TitleBlock title="Trace" subtitle="Requests followed across services, span by span." />
      <div className="flex flex-wrap items-end gap-3 px-6 pt-4">
        <Field label="Range" className="w-44">
          <Select<TimeRange>
            value={range}
            onValueChange={setRange}
            options={timeRanges.map((r) => ({ value: r, label: timeRangeLabels[r] }))}
          />
        </Field>
        <Field label="Order" className="w-44">
          <Select<Order>
            value={order}
            onValueChange={setOrder}
            options={[
              { value: 'start desc', label: 'Newest first' },
              { value: 'duration desc', label: 'Slowest first' },
              { value: 'start', label: 'Oldest first' },
            ]}
          />
        </Field>
        <form
          className="flex min-w-72 flex-1 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter(draft.trim());
          }}
        >
          <Field label="Filter" help="Trace filter syntax, such as root:/api latency:500ms." className="flex-1">
            <Input data-filter-input mono value={draft} onChange={(e) => setDraft(e.target.value)} />
          </Field>
          <Button type="submit" disabled={draft.trim() === filter}>
            Apply
          </Button>
        </form>
      </div>
      {rows.length > 0 ? (
        <Section title="Latency" description={`Of the ${rows.length} traces listed.`}>
          <div className="h-32 px-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histogram} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
                <CartesianGrid stroke={colors.rule} vertical={false} />
                <XAxis dataKey="label" stroke={colors['ink-3']} tick={{ fontSize: 11, fill: colors['ink-2'] }} interval={0} />
                <YAxis width={36} allowDecimals={false} stroke={colors['ink-3']} tick={{ fontSize: 11, fill: colors['ink-2'] }} />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ fill: colors.rule }}
                  contentStyle={{ background: colors.panel, border: `1px solid ${colors.rule}`, fontSize: 12, color: colors.ink }}
                  formatter={(v) => [String(v), 'Traces']}
                />
                <Bar dataKey="n" fill={colors['construct-ink']} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      ) : null}
      <div className="pt-3">
        {q.isPending ? (
          <DelayedSkeleton />
        ) : q.error instanceof ApiError ? (
          <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
        ) : (
          <ResourceTable
            tableId="traces"
            label="Traces"
            rows={rows}
            columns={columns}
            getRowId={(t) => t.traceId}
            onOpen={(t) => void navigate({ to: href(t) })}
            emptyTitle="No traces in this range"
            emptyText="Services send spans to Cloud Trace with OpenTelemetry or the Trace API; Cloud Run and App Engine add request spans by themselves."
            hasMore={q.hasNextPage}
            loadingMore={q.isFetchingNextPage}
            onLoadMore={() => void q.fetchNextPage()}
          />
        )}
      </div>
    </div>
  );
}
