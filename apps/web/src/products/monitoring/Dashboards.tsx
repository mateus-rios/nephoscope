import type { DashboardSummary, SeriesQuery } from '@nephoscope/contracts';
import { CaretDownIcon, CaretRightIcon, FloppyDiskIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Legend } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Select } from '../../design/Form';
import { MenuItem } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { DetailLayout } from '../../kit/DetailLayout';
import { rangeStart, type TimeRange, timeRangeLabels, timeRanges } from '../../kit/timeRange';
import { UPlotChart } from '../../kit/UPlotChart';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { deleteDashboard, useDashboard, useDashboards, useSaveDashboard, useSeries } from './api';

// biome-ignore lint/suspicious/noExplicitAny: dashboard widgets are Google's JSON, read field by field.
type Any = any;

interface Tile {
  id: string;
  widget: Any;
  /** Columns out of 12. */
  span: number;
  y: number;
  height: number;
}

/** The widgets of any dashboard layout, in reading order (SPEC-0005 D-09). */
export function dashboardTiles(d: Any): Tile[] {
  return layoutTiles(d).map((t, i) => ({ ...t, id: `tile-${i}` }));
}

function layoutTiles(d: Any): Omit<Tile, 'id'>[] {
  if (d?.mosaicLayout) {
    const columns = Number(d.mosaicLayout.columns ?? 12) || 12;
    return ((d.mosaicLayout.tiles ?? []) as Any[])
      .map((t) => ({
        widget: t.widget ?? {},
        span: Math.max(3, Math.round(((t.width ?? columns) / columns) * 12)),
        y: t.yPos ?? 0,
        height: t.height ?? 4,
        x: t.xPos ?? 0,
      }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }
  if (d?.gridLayout) {
    const columns = Number(d.gridLayout.columns ?? 2) || 2;
    return ((d.gridLayout.widgets ?? []) as Any[]).map((w, i) => ({
      widget: w,
      span: Math.max(3, Math.round(12 / columns)),
      y: Math.floor(i / columns),
      height: 1,
    }));
  }
  if (d?.rowLayout) {
    return ((d.rowLayout.rows ?? []) as Any[]).flatMap((r, ri) => {
      const ws = (r.widgets ?? []) as Any[];
      return ws.map((w) => ({ widget: w, span: Math.max(3, Math.round(12 / Math.max(1, ws.length))), y: ri, height: 1 }));
    });
  }
  if (d?.columnLayout) {
    const cols = (d.columnLayout.columns ?? []) as Any[];
    return cols.flatMap((c) =>
      ((c.widgets ?? []) as Any[]).map((w, wi) => ({
        widget: w,
        span: Math.max(3, Math.round(12 / Math.max(1, cols.length))),
        y: wi,
        height: 1,
      })),
    );
  }
  return [];
}

/** The series query of a widget's `timeSeriesQuery`, or null when Nephoscope cannot run it. */
export function widgetQuery(q: Any, since: string, until: string): SeriesQuery | null {
  if (!q) return null;
  if (typeof q.prometheusQuery === 'string') return { kind: 'promql', query: q.prometheusQuery, since, until };
  if (typeof q.timeSeriesQueryLanguage === 'string') return { kind: 'mql', query: q.timeSeriesQueryLanguage, since, until };
  const f = q.timeSeriesFilter;
  if (f && typeof f.filter === 'string') {
    const a = f.aggregation ?? {};
    return {
      kind: 'filter',
      filter: f.filter,
      aggregation: {
        alignmentPeriod: a.alignmentPeriod,
        perSeriesAligner: a.perSeriesAligner,
        crossSeriesReducer: a.crossSeriesReducer,
        groupByFields: a.groupByFields,
      },
      since,
      until,
    };
  }
  return null;
}

function Raw({ value }: { value: unknown }) {
  return (
    <pre className="m-0 max-h-56 overflow-auto rounded-control bg-well p-2 font-mono text-[11px] text-ink">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function XyWidget({ projectId, widget, since, until }: { projectId: string; widget: Any; since: string; until: string }) {
  const sets = (widget.xyChart?.dataSets ?? []) as Any[];
  const queries = sets.map((s) => widgetQuery(s.timeSeriesQuery, since, until));
  const runnable = queries.filter((q): q is SeriesQuery => q !== null);
  // One request per data set; the first ones cover nearly every dashboard.
  const a = useSeries(projectId, runnable[0] ?? null);
  const b = useSeries(projectId, runnable[1] ?? null);
  const c = useSeries(projectId, runnable[2] ?? null);
  const results = [a, b, c].slice(0, runnable.length);
  const error = results.find((r) => r.error instanceof ApiError)?.error as ApiError | undefined;
  if (runnable.length === 0) return <Raw value={widget.xyChart} />;
  if (results.some((r) => r.isPending)) return <DelayedSkeleton rows={3} />;
  if (error) return <p className="m-0 text-meta text-redline-ink">{error.problem.detail}</p>;
  const series = results.flatMap((r) => r.data?.series ?? []);
  if (series.length === 0) return <p className="m-0 flex h-40 items-center text-dense text-ink-3">No data in this range.</p>;
  const threshold = widget.xyChart?.thresholds?.[0]?.value;
  return (
    <UPlotChart series={series} height={180} label={widget.title ?? 'Chart'} threshold={typeof threshold === 'number' ? threshold : null} />
  );
}

const big = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, notation: 'compact' });

function Scorecard({ projectId, widget, since, until }: { projectId: string; widget: Any; since: string; until: string }) {
  const q = widgetQuery(widget.scorecard?.timeSeriesQuery, since, until);
  const r = useSeries(projectId, q);
  if (!q) return <Raw value={widget.scorecard} />;
  if (r.isPending) return <DelayedSkeleton rows={1} />;
  if (r.error instanceof ApiError) return <p className="m-0 text-meta text-redline-ink">{r.error.problem.detail}</p>;
  const last = r.data?.series[0]?.points.filter(([, v]) => v !== null).at(-1)?.[1];
  return (
    <p className="tnum m-0 text-[32px] leading-tight font-semibold text-ink">
      {last === undefined || last === null ? 'No data' : big.format(last)}
    </p>
  );
}

function WidgetBody({ projectId, widget, since, until }: { projectId: string; widget: Any; since: string; until: string }) {
  if (widget.xyChart) return <XyWidget projectId={projectId} widget={widget} since={since} until={until} />;
  if (widget.scorecard) return <Scorecard projectId={projectId} widget={widget} since={since} until={until} />;
  // Dashboard text is markdown written by people; it is shown as text, never as markup (SPEC-0001 D-22).
  if (widget.text) return <p className="m-0 text-dense whitespace-pre-wrap text-ink-2">{String(widget.text.content ?? '')}</p>;
  return <Raw value={widget} />;
}

function DashboardView({ projectId, dashboard }: { projectId: string; dashboard: Any }) {
  const [range, setRange] = useSearchState<TimeRange>('range', '1d', timeRanges);
  const [anchor, setAnchor] = useState(() => Date.now());
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new range reads from now.
  useEffect(() => setAnchor(Date.now()), [range]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const tiles = useMemo(() => dashboardTiles(dashboard), [dashboard]);
  const since = rangeStart(range, anchor);
  const until = new Date(anchor).toISOString();
  // Tiles below a collapsed group, within its height, are hidden with it (mosaic layouts).
  const hidden = new Set<number>();
  tiles.forEach((t, i) => {
    if (t.widget.collapsibleGroup && collapsed.has(i)) {
      tiles.forEach((o, j) => {
        if (j !== i && o.y >= t.y && o.y < t.y + t.height) hidden.add(j);
      });
    }
  });
  return (
    <div className="flex flex-col gap-3 px-6 py-4">
      <div className="flex items-end gap-2">
        <Field label="Range" className="w-44">
          <Select<TimeRange>
            value={range}
            onValueChange={setRange}
            options={timeRanges.map((r) => ({ value: r, label: timeRangeLabels[r] }))}
          />
        </Field>
        <Button onClick={() => setAnchor(Date.now())}>Refresh</Button>
      </div>
      {tiles.length === 0 ? <p className="m-0 text-dense text-ink-3">This dashboard has no widgets.</p> : null}
      <div className="grid grid-cols-12 gap-3">
        {tiles.map((t, i) => {
          if (hidden.has(i)) return null;
          const title = t.widget.title ?? '';
          if (t.widget.collapsibleGroup) {
            const isCollapsed = collapsed.has(i);
            return (
              <button
                key={t.id}
                type="button"
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((p) => {
                    const n = new Set(p);
                    if (n.has(i)) n.delete(i);
                    else n.add(i);
                    return n;
                  })
                }
                className="col-span-12 flex items-center gap-2 border-b border-rule py-1 text-left text-section font-semibold text-ink"
              >
                {isCollapsed ? <CaretRightIcon size={14} aria-hidden /> : <CaretDownIcon size={14} aria-hidden />}
                {title || 'Group'}
              </button>
            );
          }
          return (
            <figure
              key={t.id}
              className="col-span-12 m-0 flex min-w-0 flex-col gap-2 border border-rule p-3 md:[grid-column:span_var(--span)/span_var(--span)]"
              style={{ '--span': Math.min(12, t.span) } as CSSProperties}
            >
              {title ? (
                <Legend as="p" className="m-0">
                  {title}
                </Legend>
              ) : null}
              <WidgetBody projectId={projectId} widget={t.widget} since={since} until={until} />
            </figure>
          );
        })}
      </div>
    </div>
  );
}

/** One dashboard: rendered widgets and its JSON, editable (SPEC-0005 D-09, CA-08). */
export function DashboardPage() {
  const { projectId, dashboard: id } = useParams({ strict: false }) as { projectId: string; dashboard: string };
  const query = useDashboard(projectId, id);
  const save = useSaveDashboard(projectId, id);
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  useEffect(() => {
    if (query.data) setText(JSON.stringify(query.data, null, 2));
  }, [query.data]);
  if (query.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (query.error instanceof ApiError || !query.data)
    return query.error instanceof ApiError ? <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} /> : null;
  const d = query.data;
  const title = String(d.displayName ?? id);
  const original = JSON.stringify(d, null, 2);
  let jsonError: string | null = null;
  try {
    JSON.parse(text);
  } catch (e) {
    jsonError = (e as Error).message;
  }
  return (
    <>
      <DetailLayout<'dashboard' | 'json'>
        crumbs={[{ label: 'Monitoring', to: `/p/${projectId}/monitoring?tab=dashboards` }, { label: title }]}
        title={title}
        menu={
          <MenuItem onClick={() => setDeleting(true)} disabled={!!readOnly} className="text-redline-ink">
            Delete dashboard
          </MenuItem>
        }
        tabs={[
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'json', label: 'JSON' },
        ]}
        defaultTab="dashboard"
      >
        {(tab) =>
          tab === 'dashboard' ? (
            <DashboardView projectId={projectId} dashboard={d} />
          ) : (
            <div className="flex flex-col gap-3 px-6 py-4">
              <p className="m-0 text-dense text-ink-2">
                Edit the dashboard as JSON. The etag in it makes the save fail if someone else saved first; reload to see their change.
              </p>
              <CodeEditor value={text} onChange={setText} language="json" height="60vh" label="Dashboard JSON" />
              <div className="flex items-center gap-2">
                <Button
                  variant="commit"
                  icon={FloppyDiskIcon}
                  loading={save.isPending}
                  disabled={!!readOnly || text === original || !!jsonError}
                  disabledReason={readOnly ?? jsonError ?? 'No changes'}
                  onClick={() => save.mutate(text)}
                >
                  Save dashboard
                </Button>
                <Button onClick={() => setText(original)} disabled={text === original}>
                  Discard changes
                </Button>
                {jsonError ? <span className="text-meta text-redline-ink">{jsonError}</span> : null}
              </div>
            </div>
          )
        }
      </DetailLayout>
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete dashboard"
        consequence={`The dashboard ${title} is deleted for everyone in the project.`}
        expected={id}
        confirmLabel="Delete dashboard"
        command={`gcloud monitoring dashboards delete ${id} --project=${projectId}`}
        onConfirm={async (c) => {
          await deleteDashboard(projectId, id, c);
          void navigate({ to: `/p/${projectId}/monitoring` as string, search: { tab: 'dashboards' } });
        }}
      />
    </>
  );
}

/** The dashboards of the project (SPEC-0005 D-09). */
export function Dashboards({ projectId }: { projectId: string }) {
  const q = useDashboards(projectId);
  const navigate = useNavigate();
  const href = (d: DashboardSummary) => `/p/${projectId}/monitoring/dashboards/${d.id}`;
  const columns: ResourceColumn<DashboardSummary>[] = [
    {
      id: 'name',
      header: 'Dashboard',
      hideable: false,
      sortValue: (d) => d.displayName,
      cell: (d) => (
        <Link to={href(d)} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {d.displayName}
        </Link>
      ),
    },
    { id: 'layout', header: 'Layout', width: '8rem', sortValue: (d) => d.layout, cell: (d) => d.layout },
    {
      id: 'widgets',
      header: 'Widgets',
      width: '7rem',
      align: 'right',
      sortValue: (d) => d.widgets,
      cell: (d) => <span className="tnum">{d.widgets}</span>,
    },
  ];
  return (
    <div className="pt-3">
      {q.isPending ? (
        <DelayedSkeleton />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : (
        <ResourceTable
          tableId="monitoring-dashboards"
          label="Dashboards"
          rows={q.data ?? []}
          columns={columns}
          getRowId={(d) => d.name}
          onOpen={(d) => void navigate({ to: href(d) })}
          emptyTitle="No custom dashboards"
          emptyText="Dashboards are created in the Google Cloud console or with gcloud monitoring dashboards create; Nephoscope shows and edits them."
        />
      )}
    </div>
  );
}
