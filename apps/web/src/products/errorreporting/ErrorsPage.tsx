import {
  type ErrorEventView,
  type ErrorGroupView,
  type ErrorPeriod,
  type ErrorResolution,
  errorPeriods,
  errorResolutions,
  type ListResponse,
} from '@nephoscope/contracts';
import { DotsThreeIcon } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Legend, Section, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { Menu, MenuItem } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph, type StatusKind } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { FactList } from '../../kit/FactList';
import { LogsPanel } from '../../kit/LogsPanel';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api, qs } from '../../lib/api';
import { useTokenColors } from '../../lib/color';
import { useActiveProfile, useInstance } from '../../state/queries';
import { useSession } from '../../state/session';
import { readOnlyReason } from '../run/common';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/errorreporting`;

export const PERIOD_LABEL: Record<ErrorPeriod, string> = {
  PERIOD_1_HOUR: 'Last hour',
  PERIOD_6_HOURS: 'Last 6 hours',
  PERIOD_1_DAY: 'Last day',
  PERIOD_1_WEEK: 'Last 7 days',
  PERIOD_30_DAYS: 'Last 30 days',
};
const RESOLUTION: Record<ErrorResolution, { label: string; kind: StatusKind }> = {
  OPEN: { label: 'Open', kind: 'error' },
  ACKNOWLEDGED: { label: 'Acknowledged', kind: 'warn' },
  RESOLVED: { label: 'Resolved', kind: 'ok' },
  MUTED: { label: 'Muted', kind: 'paused' },
};

const firstLine = (m: string) => m.split('\n').find((l) => l.trim()) ?? m;

function ResolutionGlyph({ status }: { status: ErrorResolution }) {
  return <StatusGlyph kind={RESOLUTION[status].kind} label={RESOLUTION[status].label} />;
}

function Occurrences({ counts }: { counts: [number, number][] }) {
  const colors = useTokenColors(['ink-2', 'ink-3', 'rule', 'panel', 'ink', 'redline'] as const);
  const data = counts.map(([t, n]) => ({ t, n }));
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <figure className="m-0 px-6">
      <figcaption>
        <Legend>Occurrences</Legend>
      </figcaption>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid stroke={colors.rule} vertical={false} />
            <XAxis
              dataKey="t"
              tickFormatter={(t: number) => fmt.format(t)}
              stroke={colors['ink-3']}
              tick={{ fontSize: 11, fill: colors['ink-2'] }}
              minTickGap={50}
            />
            <YAxis width={36} allowDecimals={false} stroke={colors['ink-3']} tick={{ fontSize: 11, fill: colors['ink-2'] }} />
            <Tooltip
              isAnimationActive={false}
              cursor={{ fill: colors.rule }}
              contentStyle={{ background: colors.panel, border: `1px solid ${colors.rule}`, fontSize: 12, color: colors.ink }}
              labelFormatter={(t) => fmt.format(Number(t))}
              formatter={(v) => [String(v), 'Occurrences']}
            />
            <Bar dataKey="n" fill={colors.redline} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

function useSetResolution(projectId: string, groupId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (resolutionStatus: ErrorResolution) =>
      api<void>(`${base(projectId)}/groups/${enc(groupId)}`, { method: 'PUT', body: { resolutionStatus } }),
    onSuccess: (_r, s) => {
      void client.invalidateQueries({ queryKey: ['errors'] });
      toast.success(`Marked ${RESOLUTION[s].label.toLowerCase()}`);
    },
    onError: (err) => toast.error('Changing the state failed', { description: err instanceof ApiError ? err.problem.detail : String(err) }),
  });
}

/** One error group: stack trace, occurrences, events, logs and its state (SPEC-0005 D-11). */
export function ErrorGroupPage() {
  const { projectId, group } = useParams({ strict: false }) as { projectId: string; group: string };
  const profileId = useSession((s) => s.profileId);
  const [period, setPeriod] = useSearchState<ErrorPeriod>('period', 'PERIOD_1_WEEK', errorPeriods);
  const q = useQuery({
    queryKey: ['errors', profileId, projectId, group, period],
    queryFn: ({ signal }) => api<ErrorGroupView>(`${base(projectId)}/groups/${enc(group)}${qs({ period })}`, { signal }),
    enabled: !!profileId,
  });
  const events = useQuery({
    queryKey: ['errors', profileId, projectId, group, period, 'events'],
    queryFn: ({ signal }) => api<ErrorEventView[]>(`${base(projectId)}/groups/${enc(group)}/events${qs({ period })}`, { signal }),
    enabled: !!profileId,
  });
  const resolve = useSetResolution(projectId, group);
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  if (q.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (q.error instanceof ApiError || !q.data)
    return q.error instanceof ApiError ? <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} /> : null;
  const g = q.data;
  const sample = events.data?.[0]?.message ?? g.message;
  const eventColumns: ResourceColumn<ErrorEventView & { id: string }>[] = [
    {
      id: 'time',
      header: 'Time',
      width: '9rem',
      hideable: false,
      sortValue: (e) => e.eventTime ?? '',
      cell: (e) => <Timestamp iso={e.eventTime} />,
    },
    {
      id: 'service',
      header: 'Service',
      width: '10rem',
      cell: (e) => <Mono value={`${e.service ?? ''}${e.version ? ` ${e.version}` : ''}`} />,
    },
    {
      id: 'request',
      header: 'Request',
      cell: (e) =>
        e.httpRequest ? <Mono value={`${e.httpRequest.method ?? ''} ${e.httpRequest.status ?? ''} ${e.httpRequest.url ?? ''}`} /> : null,
    },
    { id: 'user', header: 'User', width: '10rem', defaultHidden: true, cell: (e) => <Mono value={e.user ?? ''} /> },
    { id: 'message', header: 'Message', cell: (e) => <Mono value={firstLine(e.message)} /> },
  ];
  return (
    <DetailLayout<'overview' | 'events' | 'logs'>
      crumbs={[{ label: 'Error Reporting', to: `/p/${projectId}/errorreporting` }, { label: g.groupId }]}
      title={firstLine(g.message).slice(0, 140) || g.groupId}
      status={<ResolutionGlyph status={g.resolutionStatus} />}
      actions={
        <Field label="State" className="w-44">
          <Select<ErrorResolution>
            value={g.resolutionStatus}
            onValueChange={(s) => resolve.mutate(s)}
            disabled={!!readOnly || resolve.isPending}
            options={errorResolutions.map((s) => ({ value: s, label: RESOLUTION[s].label }))}
          />
        </Field>
      }
      cells={[
        { label: 'Occurrences', value: <span className="tnum">{g.count}</span> },
        { label: 'Users affected', value: <span className="tnum">{g.affectedUsers}</span> },
        { label: 'First seen', value: <Timestamp iso={g.firstSeen} /> },
        { label: 'Last seen', value: <Timestamp iso={g.lastSeen} /> },
      ]}
      tabs={[
        { key: 'overview', label: 'Overview' },
        { key: 'events', label: 'Recent events' },
        { key: 'logs', label: 'Logs' },
      ]}
      defaultTab="overview"
    >
      {(tab) =>
        tab === 'events' ? (
          events.isPending ? (
            <DelayedSkeleton />
          ) : events.error instanceof ApiError ? (
            <ProblemState problem={events.error.problem} onRetry={() => void events.refetch()} />
          ) : (
            <div className="pt-3">
              <ResourceTable
                tableId="error-events"
                label="Recent events"
                rows={(events.data ?? []).map((e, i) => ({ ...e, id: `${e.eventTime}-${i}` }))}
                columns={eventColumns}
                getRowId={(e) => e.id}
                emptyTitle="No events in this period"
              />
            </div>
          )
        ) : tab === 'logs' ? (
          <LogsPanel
            projectId={projectId}
            filter={`severity>=ERROR AND "${firstLine(g.message).slice(0, 120).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`}
          />
        ) : (
          <>
            <div className="flex items-end gap-2 px-6 pt-4">
              <Field label="Period" className="w-44">
                <Select<ErrorPeriod>
                  value={period}
                  onValueChange={setPeriod}
                  options={errorPeriods.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
                />
              </Field>
            </div>
            <Section title="Occurrences">
              <Occurrences counts={g.timedCounts} />
            </Section>
            <Section title="Sample stack trace">
              {/* Error messages come from the project: shown as text only (SPEC-0001 D-22). */}
              <pre className="mx-6 my-0 max-h-[50vh] overflow-auto rounded-control bg-well p-3 font-mono text-[12px] whitespace-pre text-ink">
                {sample}
              </pre>
            </Section>
            <Section title="Seen in">
              <FactList
                facts={[
                  [
                    'Services',
                    g.services.length ? g.services.map((s) => `${s.service}${s.version ? ` (${s.version})` : ''}`).join(', ') : null,
                  ],
                  ['Tracking issues', g.trackingIssues.length ? g.trackingIssues.join(', ') : null],
                  ['Group id', <Mono key="g" value={g.groupId} copy />],
                ]}
              />
            </Section>
          </>
        )
      }
    </DetailLayout>
  );
}

/** Error groups of the project (SPEC-0005 D-11, CA-09). */
export function ErrorsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const profileId = useSession((s) => s.profileId);
  const navigate = useNavigate();
  const [period, setPeriod] = useSearchState<ErrorPeriod>('period', 'PERIOD_1_DAY', errorPeriods);
  const [service, setService] = useSearchState<string>('service', '');
  const [draft, setDraft] = useState(service);
  const [filter, setFilter] = useState('');
  const [deleting, setDeleting] = useState(false);
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  useEffect(() => {
    document.title = 'Error Reporting · Nephoscope';
  }, []);
  const q = useQuery({
    queryKey: ['errors', profileId, projectId, period, service],
    queryFn: ({ signal }) =>
      api<ListResponse<ErrorGroupView>>(`${base(projectId)}/groups${qs({ period, service: service || undefined })}`, { signal }),
    enabled: !!profileId,
  });
  const term = filter.trim().toLowerCase();
  const rows = useMemo(() => (q.data?.items ?? []).filter((g) => !term || g.message.toLowerCase().includes(term)), [q.data, term]);
  const href = (g: ErrorGroupView) => `/p/${projectId}/errorreporting/${g.groupId}`;
  const columns: ResourceColumn<ErrorGroupView>[] = [
    {
      id: 'state',
      header: 'State',
      width: '9rem',
      sortValue: (g) => g.resolutionStatus,
      cell: (g) => <ResolutionGlyph status={g.resolutionStatus} />,
    },
    {
      id: 'error',
      header: 'Error',
      hideable: false,
      sortValue: (g) => g.message,
      cell: (g) => (
        <Link to={href(g)} className="truncate font-mono text-[12px] text-ink" onClick={(e) => e.stopPropagation()}>
          {firstLine(g.message)}
        </Link>
      ),
    },
    {
      id: 'count',
      header: 'Occurrences',
      width: '8rem',
      align: 'right',
      sortValue: (g) => g.count,
      cell: (g) => <span className="tnum">{g.count}</span>,
    },
    {
      id: 'users',
      header: 'Users',
      width: '6rem',
      align: 'right',
      sortValue: (g) => g.affectedUsers,
      cell: (g) => <span className="tnum">{g.affectedUsers}</span>,
    },
    { id: 'services', header: 'Services', width: '10rem', cell: (g) => <Mono value={g.services.map((s) => s.service).join(', ')} /> },
    { id: 'first', header: 'First seen', width: '9rem', sortValue: (g) => g.firstSeen ?? '', cell: (g) => <Timestamp iso={g.firstSeen} /> },
    { id: 'last', header: 'Last seen', width: '9rem', sortValue: (g) => g.lastSeen ?? '', cell: (g) => <Timestamp iso={g.lastSeen} /> },
  ];
  return (
    <div className="pb-16">
      <TitleBlock
        title="Error Reporting"
        subtitle="Errors from logs and reports, grouped by their stack trace."
        actions={
          <Menu align="end" trigger={<IconButton icon={DotsThreeIcon} label="More actions" />}>
            <MenuItem onClick={() => setDeleting(true)} disabled={!!readOnly} className="text-redline-ink">
              Delete all error events
            </MenuItem>
          </Menu>
        }
      />
      <div className="pt-3">
        {q.isPending ? (
          <DelayedSkeleton />
        ) : q.error instanceof ApiError ? (
          <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
        ) : (
          <ResourceTable
            tableId="error-groups"
            label="Error groups"
            rows={rows}
            columns={columns}
            getRowId={(g) => g.groupId}
            onOpen={(g) => void navigate({ to: href(g) })}
            filtered={rows.length !== (q.data?.items.length ?? 0)}
            emptyTitle="No errors in this period"
            emptyText="Error Reporting groups errors that services write to Cloud Logging with a stack trace, or report through its API."
            toolbar={
              <div className="flex flex-wrap items-end gap-3">
                <Input
                  data-filter-input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by message"
                  aria-label="Filter errors"
                  className="w-64"
                />
                <Field label="Period" className="w-44">
                  <Select<ErrorPeriod>
                    value={period}
                    onValueChange={setPeriod}
                    options={errorPeriods.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
                  />
                </Field>
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setService(draft.trim());
                  }}
                >
                  <Field label="Service" className="w-48">
                    <Input mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="All services" />
                  </Field>
                  <Button type="submit" disabled={draft.trim() === service}>
                    Apply
                  </Button>
                </form>
              </div>
            }
          />
        )}
      </div>
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete all error events"
        consequence="Every error event of the project is deleted. Groups and their states stay; their counts start over."
        expected={projectId}
        confirmLabel="Delete all error events"
        command={`gcloud beta error-reporting events delete --project=${projectId}`}
        onConfirm={async (c) => {
          await api<void>(`${base(projectId)}/events`, { method: 'DELETE', body: { confirm: c } });
          void q.refetch();
        }}
      />
    </div>
  );
}
