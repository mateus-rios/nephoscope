import type { ColabExecution, ColabNotebook, ColabRuntime, ColabSchedule, ColabTemplate } from '@nephoscope/contracts';
import { CalendarPlusIcon, CpuIcon, NotebookIcon, PlayIcon, PlusIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { type Note, Notes, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Input } from '../../design/Form';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { TabNav } from '../../design/TabNav';
import { Mono, Timestamp } from '../../design/Values';
import { partialNote, RefreshControl } from '../../kit/ListControls';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { colabHref, shortName, useColabRegion, useExecutions, useNotebooks, useRuntimes, useSchedules, useTemplates } from './api';
import {
  JobStateGlyph,
  jobStateLabel,
  machineSummary,
  namesOf,
  RegionPicker,
  RuntimeStateGlyph,
  runDuration,
  ScheduleStateGlyph,
  SourceLink,
  TemplateLink,
  useColabReadOnly,
} from './common';
import { CreateNotebookSheet } from './NotebookSheets';
import { RunSheet, splitCron } from './RunSheet';
import { RuntimeSheet, TemplateSheet } from './TemplateSheets';

const TABS = ['notebooks', 'executions', 'schedules', 'runtimes', 'templates'] as const;
type Tab = (typeof TABS)[number];

const CREATE: Record<Tab, { label: string; icon: typeof PlusIcon }> = {
  notebooks: { label: 'Create notebook', icon: PlusIcon },
  executions: { label: 'Run notebook', icon: PlayIcon },
  schedules: { label: 'Schedule notebook', icon: CalendarPlusIcon },
  runtimes: { label: 'Create runtime', icon: CpuIcon },
  templates: { label: 'Create template', icon: PlusIcon },
};

/** Colab Enterprise (SPEC-0010 CA-01). */
export function ColabPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<Tab>('tab', 'notebooks', TABS);
  const [region] = useColabRegion();
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState<Tab | null>(null);
  const navigate = useNavigate();
  const readOnly = useColabReadOnly();
  useEffect(() => {
    document.title = 'Colab Enterprise · Nephoscope';
  }, []);

  // Each list is one call per region, so only the open tab and the names it shows load (SPEC-0010 D-03).
  const notebooks = useNotebooks(projectId, region, tab === 'notebooks' || tab === 'executions' || tab === 'schedules');
  const executions = useExecutions(projectId, region, tab === 'executions');
  const schedules = useSchedules(projectId, region, tab === 'schedules');
  const runtimes = useRuntimes(projectId, region, tab === 'runtimes');
  const templates = useTemplates(projectId, region, tab === 'templates' || tab === 'runtimes');
  const notebookNames = useMemo(() => namesOf(notebooks.data?.items), [notebooks.data]);
  const templateNames = useMemo(() => namesOf(templates.data?.items), [templates.data]);
  const scheduleNames = useMemo(() => namesOf(schedules.data?.items), [schedules.data]);

  const q = filter.trim().toLowerCase();
  const match = (...values: (string | null | undefined)[]) => !q || values.some((v) => v?.toLowerCase().includes(q));
  const showRegion = region === 'all';

  const toolbar = (refresh: () => void, refreshing: boolean, placeholder: string) => (
    <div className="flex flex-wrap items-end gap-3">
      <Input
        data-filter-input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-64"
      />
      <RegionPicker />
      <span className="ml-auto">
        <RefreshControl onRefresh={refresh} refreshing={refreshing} />
      </span>
    </div>
  );

  const state = (query: { isPending: boolean; error: unknown; refetch: () => unknown }, render: () => ReactNode) =>
    query.isPending ? (
      <DelayedSkeleton />
    ) : query.error instanceof ApiError ? (
      <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />
    ) : (
      render()
    );

  const regionColumn = <T extends { location: string }>(): ResourceColumn<T> => ({
    id: 'location',
    header: 'Region',
    width: '10rem',
    defaultHidden: !showRegion,
    sortValue: (r) => r.location,
    cell: (r) => <Mono value={r.location} />,
  });

  const notebookColumns: ResourceColumn<ColabNotebook>[] = [
    {
      id: 'name',
      header: 'Notebook',
      hideable: false,
      sortValue: (n) => n.displayName,
      cell: (n) => (
        <Link
          to={colabHref.notebook(projectId, n.location, n.id) as string}
          className="truncate font-medium text-ink"
          onClick={(e) => e.stopPropagation()}
        >
          {n.displayName}
        </Link>
      ),
    },
    regionColumn<ColabNotebook>(),
    {
      id: 'created',
      header: 'Created',
      width: '9rem',
      sortValue: (n) => n.createTime ?? '',
      cell: (n) => <Timestamp iso={n.createTime} />,
    },
    { id: 'id', header: 'Repository', width: '20rem', defaultHidden: true, sortValue: (n) => n.id, cell: (n) => <Mono value={n.id} /> },
  ];

  const executionColumns: ResourceColumn<ColabExecution>[] = [
    {
      id: 'name',
      header: 'Execution',
      hideable: false,
      sortValue: (e) => e.displayName,
      cell: (e) => (
        <Link
          to={colabHref.execution(projectId, e.location, e.id) as string}
          className="truncate font-medium text-ink"
          onClick={(ev) => ev.stopPropagation()}
        >
          {e.displayName || e.id}
        </Link>
      ),
    },
    {
      id: 'state',
      header: 'State',
      width: '9.5rem',
      sortValue: (e) => jobStateLabel(e.state),
      cell: (e) => <JobStateGlyph state={e.state} message={e.status?.message} />,
    },
    {
      id: 'notebook',
      header: 'Notebook',
      sortValue: (e) =>
        e.source.kind === 'notebook'
          ? (notebookNames.get(shortName(e.source.repository)) ?? '')
          : e.source.kind === 'gcs'
            ? e.source.uri
            : '',
      cell: (e) => <SourceLink projectId={projectId} source={e.source} names={notebookNames} />,
    },
    {
      id: 'started',
      header: 'Started',
      width: '9rem',
      sortValue: (e) => e.createTime ?? '',
      cell: (e) => <Timestamp iso={e.createTime} />,
    },
    {
      id: 'duration',
      header: 'Duration',
      width: '7rem',
      align: 'right',
      sortValue: (e) => (e.createTime ? Date.parse(e.updateTime ?? e.createTime) - Date.parse(e.createTime) : null),
      cell: (e) => <span className="tnum text-ink-2">{runDuration(e)}</span>,
    },
    {
      id: 'schedule',
      header: 'Schedule',
      width: '11rem',
      sortValue: (e) => (e.schedule ? shortName(e.schedule) : ''),
      cell: (e) =>
        e.schedule ? (
          <Link
            to={colabHref.schedule(projectId, e.location, shortName(e.schedule)) as string}
            className="truncate text-ink-2"
            onClick={(ev) => ev.stopPropagation()}
          >
            {scheduleNames.get(shortName(e.schedule)) ?? 'Scheduled'}
          </Link>
        ) : (
          <span className="text-ink-3">Manual</span>
        ),
    },
    regionColumn<ColabExecution>(),
    {
      id: 'identity',
      header: 'Run as',
      width: '14rem',
      defaultHidden: true,
      sortValue: (e) => e.identity.email ?? '',
      cell: (e) => <Mono value={e.identity.email ?? 'Unknown'} />,
    },
  ];

  const scheduleColumns: ResourceColumn<ColabSchedule>[] = [
    {
      id: 'name',
      header: 'Schedule',
      hideable: false,
      sortValue: (s) => s.displayName,
      cell: (s) => (
        <Link
          to={colabHref.schedule(projectId, s.location, s.id) as string}
          className="truncate font-medium text-ink"
          onClick={(e) => e.stopPropagation()}
        >
          {s.displayName}
        </Link>
      ),
    },
    { id: 'state', header: 'State', width: '8rem', sortValue: (s) => s.state, cell: (s) => <ScheduleStateGlyph state={s.state} /> },
    {
      id: 'cron',
      header: 'Cron',
      width: '15rem',
      sortValue: (s) => s.cron,
      cell: (s) => {
        const c = splitCron(s.cron);
        return (
          <span className="truncate">
            <span className="font-mono text-[12px]">{c.expression}</span>
            {c.zone ? <span className="ml-2 text-meta text-ink-3">{c.zone}</span> : null}
          </span>
        );
      },
    },
    {
      id: 'next',
      header: 'Next run',
      width: '9rem',
      sortValue: (s) => s.nextRunTime ?? '',
      cell: (s) =>
        s.state === 'active' ? (
          <Timestamp iso={s.nextRunTime} />
        ) : (
          <span className="text-ink-3">{s.state === 'paused' ? 'Paused' : 'None'}</span>
        ),
    },
    {
      id: 'runs',
      header: 'Runs',
      width: '7rem',
      align: 'right',
      sortValue: (s) => s.startedRunCount,
      cell: (s) => (
        <span className="tnum text-ink-2">
          {s.startedRunCount}
          {s.maxRunCount ? ` of ${s.maxRunCount}` : ''}
        </span>
      ),
    },
    {
      id: 'notebook',
      header: 'Notebook',
      sortValue: (s) => (s.job.source.kind === 'notebook' ? (notebookNames.get(shortName(s.job.source.repository)) ?? '') : ''),
      cell: (s) => <SourceLink projectId={projectId} source={s.job.source} names={notebookNames} />,
    },
    regionColumn<ColabSchedule>(),
  ];

  const runtimeColumns: ResourceColumn<ColabRuntime>[] = [
    {
      id: 'name',
      header: 'Runtime',
      hideable: false,
      sortValue: (r) => r.displayName,
      cell: (r) => (
        <Link
          to={colabHref.runtime(projectId, r.location, r.id) as string}
          className="truncate font-medium text-ink"
          onClick={(e) => e.stopPropagation()}
        >
          {r.displayName}
        </Link>
      ),
    },
    { id: 'state', header: 'State', width: '8.5rem', sortValue: (r) => r.state, cell: (r) => <RuntimeStateGlyph state={r.state} /> },
    {
      id: 'health',
      header: 'Health',
      width: '7.5rem',
      sortValue: (r) => r.health,
      cell: (r) =>
        r.health === 'healthy' ? (
          <StatusGlyph kind="ok" label="Healthy" />
        ) : r.health === 'unhealthy' ? (
          <StatusGlyph kind="error" label="Unhealthy" />
        ) : (
          <span className="text-ink-3">Unknown</span>
        ),
    },
    {
      id: 'machine',
      header: 'Machine',
      width: '14rem',
      sortValue: (r) => machineSummary(r.machine),
      cell: (r) => <Mono value={machineSummary(r.machine)} />,
    },
    {
      id: 'template',
      header: 'Template',
      width: '12rem',
      sortValue: (r) => (r.template ? (templateNames.get(shortName(r.template)) ?? shortName(r.template)) : ''),
      cell: (r) => <TemplateLink projectId={projectId} name={r.template} names={templateNames} />,
    },
    {
      id: 'user',
      header: 'User',
      width: '14rem',
      sortValue: (r) => r.runtimeUser ?? '',
      cell: (r) => <Mono value={r.runtimeUser ?? ''} />,
    },
    regionColumn<ColabRuntime>(),
    {
      id: 'expires',
      header: 'Expires',
      width: '9rem',
      defaultHidden: true,
      sortValue: (r) => r.expirationTime ?? '',
      cell: (r) => <Timestamp iso={r.expirationTime} />,
    },
  ];

  const templateColumns: ResourceColumn<ColabTemplate>[] = [
    {
      id: 'name',
      header: 'Template',
      hideable: false,
      sortValue: (t) => t.displayName,
      cell: (t) => (
        <Link
          to={colabHref.template(projectId, t.location, t.id) as string}
          className="truncate font-medium text-ink"
          onClick={(e) => e.stopPropagation()}
        >
          {t.displayName}
        </Link>
      ),
    },
    {
      id: 'machine',
      header: 'Machine',
      width: '16rem',
      sortValue: (t) => machineSummary(t.machine),
      cell: (t) => <Mono value={machineSummary(t.machine)} />,
    },
    {
      id: 'idle',
      header: 'Idle shutdown',
      width: '9rem',
      sortValue: (t) => (t.idleShutdown.disabled ? -1 : (t.idleShutdown.timeoutMinutes ?? 0)),
      cell: (t) => <span className="text-ink-2">{t.idleShutdown.disabled ? 'Off' : `${t.idleShutdown.timeoutMinutes ?? '?'} min`}</span>,
    },
    {
      id: 'type',
      header: 'Type',
      width: '8rem',
      sortValue: (t) => t.type,
      cell: (t) => (
        <span className="text-ink-2">{t.type === 'one_click' ? 'Default' : t.type === 'user_defined' ? 'Custom' : 'Unknown'}</span>
      ),
    },
    regionColumn<ColabTemplate>(),
    {
      id: 'created',
      header: 'Created',
      width: '9rem',
      sortValue: (t) => t.createTime ?? '',
      cell: (t) => <Timestamp iso={t.createTime} />,
    },
  ];

  const executionPages = executions.data?.pages ?? [];
  const executionRows = executionPages.flatMap((p) => p.items);
  const truncated = executionPages[0]?.truncated ?? [];

  const notes: Note[] = [];
  const unreachable =
    tab === 'notebooks'
      ? notebooks.data?.unreachable
      : tab === 'executions'
        ? executionPages[0]?.unreachable
        : tab === 'schedules'
          ? schedules.data?.unreachable
          : tab === 'runtimes'
            ? runtimes.data?.unreachable
            : templates.data?.unreachable;
  notes.push(...partialNote(unreachable));
  if (tab === 'executions' && truncated.length > 0) {
    notes.push({
      id: 'truncated',
      tone: 'info',
      text: `Showing the newest 100 executions of ${truncated.length === 1 ? truncated[0] : `${truncated.length} regions`}. Pick a region to page through all of them.`,
    });
  }

  const body = () => {
    switch (tab) {
      case 'notebooks': {
        const rows = (notebooks.data?.items ?? []).filter((n) => match(n.displayName, n.id));
        return state(notebooks, () => (
          <ResourceTable
            tableId="colab-notebooks"
            label="Notebooks"
            rows={rows}
            columns={notebookColumns}
            getRowId={(n) => n.name}
            onOpen={(n) => void navigate({ to: colabHref.notebook(projectId, n.location, n.id) as string })}
            filtered={!!q}
            emptyTitle="No notebooks"
            emptyText="Notebooks you create in Colab Enterprise or BigQuery Studio appear here, in the region where they were saved."
            emptyAction={
              <Button icon={NotebookIcon} onClick={() => setCreating('notebooks')}>
                Create notebook
              </Button>
            }
            toolbar={toolbar(() => void notebooks.refetch(), notebooks.isRefetching, 'Filter notebooks')}
          />
        ));
      }
      case 'executions': {
        const rows = executionRows.filter((e) =>
          match(
            e.displayName,
            e.id,
            e.source.kind === 'notebook' ? notebookNames.get(shortName(e.source.repository)) : null,
            jobStateLabel(e.state),
          ),
        );
        return state(executions, () => (
          <ResourceTable
            tableId="colab-executions"
            label="Executions"
            rows={rows}
            columns={executionColumns}
            getRowId={(e) => e.name}
            onOpen={(e) => void navigate({ to: colabHref.execution(projectId, e.location, e.id) as string })}
            filtered={!!q}
            emptyTitle="No executions"
            emptyText="Each run of a notebook, by hand or from a schedule, is an execution."
            emptyAction={
              <Button icon={PlayIcon} onClick={() => setCreating('executions')}>
                Run notebook
              </Button>
            }
            hasMore={region !== 'all' && !!executions.hasNextPage}
            loadingMore={executions.isFetchingNextPage}
            onLoadMore={() => void executions.fetchNextPage()}
            toolbar={toolbar(() => void executions.refetch(), executions.isRefetching, 'Filter executions')}
          />
        ));
      }
      case 'schedules': {
        const rows = (schedules.data?.items ?? []).filter((s) => match(s.displayName, s.id, s.cron));
        return state(schedules, () => (
          <ResourceTable
            tableId="colab-schedules"
            label="Schedules"
            rows={rows}
            columns={scheduleColumns}
            getRowId={(s) => s.name}
            onOpen={(s) => void navigate({ to: colabHref.schedule(projectId, s.location, s.id) as string })}
            filtered={!!q}
            emptyTitle="No notebook schedules"
            emptyText="A schedule runs a notebook on a cron expression, such as a report every weekday morning."
            emptyAction={
              <Button icon={CalendarPlusIcon} onClick={() => setCreating('schedules')}>
                Schedule notebook
              </Button>
            }
            toolbar={toolbar(() => void schedules.refetch(), schedules.isRefetching, 'Filter schedules')}
          />
        ));
      }
      case 'runtimes': {
        const rows = (runtimes.data?.items ?? []).filter((r) => match(r.displayName, r.id, r.runtimeUser, machineSummary(r.machine)));
        return state(runtimes, () => (
          <ResourceTable
            tableId="colab-runtimes"
            label="Runtimes"
            rows={rows}
            columns={runtimeColumns}
            getRowId={(r) => r.name}
            onOpen={(r) => void navigate({ to: colabHref.runtime(projectId, r.location, r.id) as string })}
            filtered={!!q}
            emptyTitle="No runtimes"
            emptyText="A runtime is the virtual machine a notebook runs on. It starts from a runtime template."
            emptyAction={
              <Button icon={CpuIcon} onClick={() => setCreating('runtimes')}>
                Create runtime
              </Button>
            }
            toolbar={toolbar(() => void runtimes.refetch(), runtimes.isRefetching, 'Filter runtimes')}
          />
        ));
      }
      case 'templates': {
        const rows = (templates.data?.items ?? []).filter((t) => match(t.displayName, t.id, machineSummary(t.machine)));
        return state(templates, () => (
          <ResourceTable
            tableId="colab-templates"
            label="Runtime templates"
            rows={rows}
            columns={templateColumns}
            getRowId={(t) => t.name}
            onOpen={(t) => void navigate({ to: colabHref.template(projectId, t.location, t.id) as string })}
            filtered={!!q}
            emptyTitle="No runtime templates"
            emptyText="A template fixes the machine, disk, network and software of the runtimes made from it."
            emptyAction={
              <Button icon={PlusIcon} onClick={() => setCreating('templates')}>
                Create template
              </Button>
            }
            toolbar={toolbar(() => void templates.refetch(), templates.isRefetching, 'Filter templates')}
          />
        ));
      }
    }
  };

  const create = CREATE[tab];
  const count = (data: { items: unknown[] } | undefined) => (data ? data.items.length : null);
  return (
    <div className="pb-16">
      <TitleBlock
        title="Colab Enterprise"
        subtitle="Notebooks, the runtimes they run on, and their executions and schedules."
        actions={
          <Button variant="commit" icon={create.icon} onClick={() => setCreating(tab)} disabled={!!readOnly} disabledReason={readOnly}>
            {create.label}
          </Button>
        }
      />
      <div className="px-6 pt-3">
        <TabNav
          label="Colab Enterprise resources"
          active={tab}
          onSelect={(k) => {
            setFilter('');
            setTab(k as Tab);
          }}
          items={[
            { key: 'notebooks', label: 'Notebooks', count: count(notebooks.data) },
            { key: 'executions', label: 'Executions', count: executions.data ? executionRows.length : null },
            { key: 'schedules', label: 'Schedules', count: count(schedules.data) },
            { key: 'runtimes', label: 'Runtimes', count: count(runtimes.data) },
            { key: 'templates', label: 'Runtime templates', count: count(templates.data) },
          ]}
        />
      </div>
      <Notes notes={notes} />
      <div className="pt-3">{body()}</div>
      <CreateNotebookSheet
        projectId={projectId}
        open={creating === 'notebooks'}
        onOpenChange={(o) => !o && setCreating(null)}
        region={region}
        readOnlyReason={readOnly}
      />
      <RunSheet
        projectId={projectId}
        mode="run"
        open={creating === 'executions'}
        onOpenChange={(o) => !o && setCreating(null)}
        region={region}
        readOnlyReason={readOnly}
      />
      <RunSheet
        projectId={projectId}
        mode="schedule"
        open={creating === 'schedules'}
        onOpenChange={(o) => !o && setCreating(null)}
        region={region}
        readOnlyReason={readOnly}
      />
      <RuntimeSheet
        projectId={projectId}
        open={creating === 'runtimes'}
        onOpenChange={(o) => !o && setCreating(null)}
        region={region}
        readOnlyReason={readOnly}
      />
      <TemplateSheet
        projectId={projectId}
        template={null}
        open={creating === 'templates'}
        onOpenChange={(o) => !o && setCreating(null)}
        region={region}
        readOnlyReason={readOnly}
      />
    </div>
  );
}
