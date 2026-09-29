import type { RunJobSummary, RunServiceSummary } from '@nephoscope/contracts';
import { PlusIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { Notes, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Input } from '../../design/Form';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { TabNav } from '../../design/TabNav';
import { Tooltip } from '../../design/Tooltip';
import { Chip, Mono, Timestamp } from '../../design/Values';
import { Facet, partialNote, RefreshControl, useFacet } from '../../kit/ListControls';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { useSchedulerJobs } from '../scheduler/api';
import { previewCron } from '../scheduler/cron';
import { useRunJobs, useRunServices, useServiceAccess } from './api';
import { ingressLabel, OutcomeGlyph, RunStatusGlyph, readOnlyReason, runRoutes, trafficSummary } from './common';
import { DeploySheet } from './DeploySheet';

const statusLabel = { ready: 'Ready', deploying: 'Deploying', failed: 'Failed', unknown: 'Unknown' } as const;

function ServicesTab({ projectId, onCreate }: { projectId: string; onCreate: () => void }) {
  const query = useRunServices(projectId);
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const location = useFacet('location');
  const status = useFacet('status');
  const all = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const unreachable = query.data?.pages[0]?.unreachable;
  const q = filter.trim().toLowerCase();
  const rows = all.filter(
    (s) =>
      (location === 'all' || s.location === location) &&
      (status === 'all' || s.status === status) &&
      (!q || s.id.includes(q) || Object.entries(s.labels).some(([k, v]) => `${k}=${v}`.includes(q))),
  );
  const access = useServiceAccess(
    projectId,
    rows.slice(0, 100).map((s) => s.name),
  );
  const accessByName = new Map((access.data ?? []).map((a) => [a.name, a.mode]));
  const routes = runRoutes(projectId);

  const columns: ResourceColumn<RunServiceSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      hideable: false,
      sortValue: (s) => s.id,
      cell: (s) => (
        <span className="flex min-w-0 items-center gap-2">
          <Link to={routes.service(s.location, s.id)} className="truncate font-medium text-ink" onClick={(e) => e.stopPropagation()}>
            {s.id}
          </Link>
          {s.isFunction ? <Chip>function</Chip> : null}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: '8rem',
      sortValue: (s) => s.status,
      cell: (s) => <RunStatusGlyph status={s.status} message={s.statusMessage} />,
    },
    { id: 'location', header: 'Location', width: '10rem', sortValue: (s) => s.location, cell: (s) => <Mono value={s.location} /> },
    {
      id: 'traffic',
      header: 'Traffic',
      width: '10rem',
      sortValue: (s) => trafficSummary(s.traffic),
      cell: (s) => <span className="text-ink-2">{trafficSummary(s.traffic)}</span>,
    },
    {
      id: 'auth',
      header: 'Authentication',
      width: '9rem',
      cell: (s) => {
        const mode = s.invokerIamDisabled ? 'invokerIamDisabled' : accessByName.get(s.name);
        if (mode === undefined) return <span className="text-ink-3">{access.isFetching ? 'Checking' : ''}</span>;
        if (mode === 'unknown') return <span className="text-ink-3">Unknown</span>;
        return mode === 'none' ? (
          <span className="text-ink-2">Required</span>
        ) : (
          <Tooltip content={mode === 'allUsers' ? 'allUsers has the invoker role' : 'The invoker check is off'}>
            <span className="text-warn-ink">Public</span>
          </Tooltip>
        );
      },
    },
    {
      id: 'ingress',
      header: 'Ingress',
      width: '8rem',
      defaultHidden: true,
      sortValue: (s) => s.ingress,
      cell: (s) => <span className="text-ink-2">{ingressLabel[s.ingress]}</span>,
    },
    { id: 'url', header: 'URL', defaultHidden: true, cell: (s) => (s.uri ? <Mono value={s.uri} copy /> : null) },
    {
      id: 'deployed',
      header: 'Last deployed',
      width: '8.5rem',
      sortValue: (s) => s.lastDeployTime ?? '',
      cell: (s) => <Timestamp iso={s.lastDeployTime} />,
    },
    {
      id: 'deployer',
      header: 'Deployed by',
      width: '14rem',
      sortValue: (s) => s.lastDeployer ?? '',
      cell: (s) => <span className="truncate text-ink-2">{s.lastDeployer}</span>,
    },
  ];

  return (
    <>
      <Notes notes={partialNote(unreachable)} />
      {query.isPending ? (
        <DelayedSkeleton />
      ) : query.error instanceof ApiError ? (
        <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />
      ) : (
        <ResourceTable
          tableId="run-services"
          label="Cloud Run services"
          rows={rows}
          columns={columns}
          getRowId={(s) => s.name}
          onOpen={(s) => void navigate({ to: routes.service(s.location, s.id) })}
          filtered={rows.length !== all.length}
          emptyTitle="No services yet"
          emptyText="A service runs a container image behind a URL and scales with its requests."
          emptyAction={
            <Button icon={PlusIcon} onClick={onCreate}>
              Create service
            </Button>
          }
          hasMore={query.hasNextPage}
          loadingMore={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
          toolbar={
            <div className="flex flex-wrap items-end gap-3">
              <Input
                data-filter-input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by name or label"
                aria-label="Filter services"
                className="w-64"
              />
              <Facet label="Location" param="location" rows={all} valueFor={(s) => s.location} />
              <Facet
                label="Status"
                param="status"
                rows={all}
                valueFor={(s) => s.status}
                labelOf={(v) => statusLabel[v as keyof typeof statusLabel] ?? v}
                className="w-36"
              />
              <span className="ml-auto">
                <RefreshControl onRefresh={() => void query.refetch()} refreshing={query.isRefetching} />
              </span>
            </div>
          }
        />
      )}
    </>
  );
}

function JobsTab({ projectId }: { projectId: string }) {
  const query = useRunJobs(projectId);
  // SPEC-0003 CA-09: the schedule comes from the Scheduler jobs that run each job.
  const scheduler = useSchedulerJobs(projectId);
  const scheduleOf = (name: string) =>
    (scheduler.data?.items ?? []).filter((s) => s.state === 'enabled' && s.target.kind === 'http' && s.target.uri.includes(`${name}:run`));
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const location = useFacet('location');
  const all = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const q = filter.trim().toLowerCase();
  const rows = all.filter((j) => (location === 'all' || j.location === location) && (!q || j.id.includes(q)));
  const routes = runRoutes(projectId);

  const columns: ResourceColumn<RunJobSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      hideable: false,
      sortValue: (j) => j.id,
      cell: (j) => (
        <Link to={routes.job(j.location, j.id)} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {j.id}
        </Link>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: '8rem',
      sortValue: (j) => j.status,
      cell: (j) => <RunStatusGlyph status={j.status} message={j.statusMessage} />,
    },
    { id: 'location', header: 'Location', width: '10rem', sortValue: (j) => j.location, cell: (j) => <Mono value={j.location} /> },
    {
      id: 'last',
      header: 'Last execution',
      width: '10rem',
      sortValue: (j) => j.lastExecution?.outcome ?? '',
      cell: (j) => (j.lastExecution ? <OutcomeGlyph outcome={j.lastExecution.outcome} /> : <span className="text-ink-3">Never run</span>),
    },
    {
      id: 'lastTime',
      header: 'Started',
      width: '8.5rem',
      sortValue: (j) => j.lastExecution?.createTime ?? '',
      cell: (j) => <Timestamp iso={j.lastExecution?.createTime} />,
    },
    {
      id: 'tasks',
      header: 'Tasks',
      width: '5rem',
      align: 'right',
      sortValue: (j) => j.taskCount ?? 0,
      cell: (j) => <span className="tnum">{j.taskCount ?? 1}</span>,
    },
    {
      id: 'executions',
      header: 'Executions',
      width: '6.5rem',
      align: 'right',
      sortValue: (j) => j.executionCount,
      cell: (j) => <span className="tnum">{j.executionCount}</span>,
    },
    {
      id: 'schedule',
      header: 'Schedule',
      width: '11rem',
      cell: (j) => {
        const schedules = scheduleOf(j.name);
        const [first] = schedules;
        if (!first) return <span className="text-ink-3">{scheduler.isPending ? '' : 'None'}</span>;
        return (
          <Tooltip content={`${previewCron(first.schedule, first.timeZone).description ?? first.schedule} (${first.timeZone})`}>
            <span className="font-mono text-[12px]">
              {first.schedule}
              {schedules.length > 1 ? <span className="text-ink-3"> +{schedules.length - 1}</span> : null}
            </span>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <>
      <Notes notes={partialNote(query.data?.pages[0]?.unreachable)} />
      {query.isPending ? (
        <DelayedSkeleton />
      ) : query.error instanceof ApiError ? (
        <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />
      ) : (
        <ResourceTable
          tableId="run-jobs"
          label="Cloud Run jobs"
          rows={rows}
          columns={columns}
          getRowId={(j) => j.name}
          onOpen={(j) => void navigate({ to: routes.job(j.location, j.id) })}
          filtered={rows.length !== all.length}
          emptyTitle="No jobs yet"
          emptyText="A job runs a container to completion, as one or more tasks. Create one with gcloud run jobs create."
          hasMore={query.hasNextPage}
          loadingMore={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
          toolbar={
            <div className="flex flex-wrap items-end gap-3">
              <Input
                data-filter-input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by name"
                aria-label="Filter jobs"
                className="w-64"
              />
              <Facet label="Location" param="location" rows={all} valueFor={(j) => j.location} />
              <span className="ml-auto">
                <RefreshControl onRefresh={() => void query.refetch()} refreshing={query.isRefetching} />
              </span>
            </div>
          }
        />
      )}
    </>
  );
}

/** Cloud Run: services and jobs of every region in one list each (SPEC-0003 D-01, CA-01, CA-09). */
export function RunPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<'services' | 'jobs'>('tab', 'services', ['services', 'jobs']);
  const [creating, setCreating] = useState(false);
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  useEffect(() => {
    document.title = 'Cloud Run · Nephoscope';
  }, []);
  return (
    <div className="pb-16">
      <TitleBlock
        title="Cloud Run"
        subtitle="Services and jobs in every region of this project."
        actions={
          <Button variant="commit" icon={PlusIcon} onClick={() => setCreating(true)} disabled={!!readOnly} disabledReason={readOnly}>
            Create service
          </Button>
        }
      />
      <TabNav
        label="Cloud Run resources"
        active={tab}
        onSelect={(k) => setTab(k as 'services' | 'jobs')}
        items={[
          { key: 'services', label: 'Services' },
          { key: 'jobs', label: 'Jobs' },
        ]}
      />
      <div className="pt-3">
        {tab === 'services' ? <ServicesTab projectId={projectId} onCreate={() => setCreating(true)} /> : <JobsTab projectId={projectId} />}
      </div>
      <DeploySheet projectId={projectId} open={creating} onOpenChange={setCreating} service={null} readOnlyReason={readOnly} />
    </div>
  );
}
