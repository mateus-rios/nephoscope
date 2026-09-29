import type { SchedulerJob, SchedulerState } from '@nephoscope/contracts';
import { PauseIcon, PlayIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Notes, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Input } from '../../design/Form';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Tooltip } from '../../design/Tooltip';
import { Mono, Timestamp } from '../../design/Values';
import { Facet, partialNote, RefreshControl, useFacet } from '../../kit/ListControls';
import { ApiError } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { targetSummary, useBulkScheduler, useSchedulerJobs } from './api';
import { previewCron } from './cron';
import { JobSheet } from './JobSheet';

export function SchedulerStateGlyph({ state }: { state: SchedulerState }) {
  if (state === 'enabled') return <StatusGlyph kind="ok" label="Enabled" />;
  if (state === 'paused') return <StatusGlyph kind="paused" label="Paused" />;
  if (state === 'update_failed') return <StatusGlyph kind="error" label="Update failed" />;
  if (state === 'disabled') return <StatusGlyph kind="paused" label="Disabled" />;
  return <StatusGlyph kind="unknown" label="Unknown" />;
}

/** The last attempt's result: gRPC code 0 is success. */
export function LastRunGlyph({ job }: { job: SchedulerJob }) {
  if (!job.lastAttemptTime) return <span className="text-ink-3">Never ran</span>;
  const s = job.lastAttemptStatus;
  if (!s || s.code === 0) return <StatusGlyph kind="ok" label="Succeeded" />;
  return (
    <Tooltip content={s.message ?? `Code ${s.code}`}>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focus target so keyboard users can read the tooltip. */}
      <span className="inline-flex" tabIndex={0}>
        <StatusGlyph kind="error" label="Failed" />
      </span>
    </Tooltip>
  );
}

/** Cloud Scheduler jobs (SPEC-0003 CA-24, CA-26). */
export function SchedulerPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const query = useSchedulerJobs(projectId);
  const bulk = useBulkScheduler(projectId);
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const location = useFacet('location');
  const state = useFacet('state');
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  useEffect(() => {
    document.title = 'Cloud Scheduler · Nephoscope';
  }, []);
  const all = query.data?.items ?? [];
  const q = filter.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all.filter(
        (j) =>
          (location === 'all' || j.location === location) &&
          (state === 'all' || j.state === state) &&
          (!q || j.id.toLowerCase().includes(q) || targetSummary(j.target).toLowerCase().includes(q)),
      ),
    [all, location, state, q],
  );
  const href = (j: SchedulerJob): string => `/p/${projectId}/scheduler/${j.location}/${j.id}`;
  const names = [...selection];

  const columns: ResourceColumn<SchedulerJob>[] = [
    {
      id: 'name',
      header: 'Name',
      hideable: false,
      sortValue: (j) => j.id,
      cell: (j) => (
        <Link to={href(j)} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {j.id}
        </Link>
      ),
    },
    { id: 'state', header: 'State', width: '8rem', sortValue: (j) => j.state, cell: (j) => <SchedulerStateGlyph state={j.state} /> },
    {
      id: 'schedule',
      header: 'Schedule',
      width: '15rem',
      sortValue: (j) => j.schedule,
      cell: (j) => (
        <Tooltip content={previewCron(j.schedule, j.timeZone).description ?? j.schedule}>
          <span className="truncate">
            <span className="font-mono text-[12px]">{j.schedule}</span>
            <span className="ml-2 text-meta text-ink-3">{j.timeZone}</span>
          </span>
        </Tooltip>
      ),
    },
    {
      id: 'target',
      header: 'Target',
      sortValue: (j) => targetSummary(j.target),
      cell: (j) => <span className="truncate font-mono text-[12px] text-ink-2">{targetSummary(j.target)}</span>,
    },
    {
      id: 'last',
      header: 'Last run',
      width: '8rem',
      sortValue: (j) => j.lastAttemptStatus?.code ?? -1,
      cell: (j) => <LastRunGlyph job={j} />,
    },
    {
      id: 'lastTime',
      header: 'Last attempt',
      width: '8.5rem',
      sortValue: (j) => j.lastAttemptTime ?? '',
      cell: (j) => <Timestamp iso={j.lastAttemptTime} />,
    },
    {
      id: 'next',
      header: 'Next run',
      width: '8.5rem',
      sortValue: (j) => j.nextRunTime ?? '',
      cell: (j) => (j.state === 'enabled' ? <Timestamp iso={j.nextRunTime} /> : <span className="text-ink-3">Paused</span>),
    },
    {
      id: 'location',
      header: 'Location',
      width: '9rem',
      defaultHidden: true,
      sortValue: (j) => j.location,
      cell: (j) => <Mono value={j.location} />,
    },
  ];

  return (
    <div className="pb-16">
      <TitleBlock
        title="Cloud Scheduler"
        subtitle="Cron jobs that call HTTP targets, publish to Pub/Sub or call App Engine."
        actions={
          <Button variant="commit" icon={PlusIcon} onClick={() => setCreating(true)} disabled={!!readOnly} disabledReason={readOnly}>
            Create job
          </Button>
        }
      />
      <Notes notes={partialNote(query.data?.unreachable)} />
      <div className="pt-3">
        {query.isPending ? (
          <DelayedSkeleton />
        ) : query.error instanceof ApiError ? (
          <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />
        ) : (
          <ResourceTable
            tableId="scheduler"
            label="Scheduler jobs"
            rows={rows}
            columns={columns}
            getRowId={(j) => j.name}
            onOpen={(j) => void navigate({ to: href(j) })}
            selectable
            selection={selection}
            onSelectionChange={setSelection}
            filtered={rows.length !== all.length}
            emptyTitle="No Scheduler jobs"
            emptyText="A job calls its target on a cron schedule, such as a Cloud Run job or a workflow every night."
            emptyAction={
              <Button icon={PlusIcon} onClick={() => setCreating(true)}>
                Create job
              </Button>
            }
            toolbar={
              <div className="flex flex-wrap items-end gap-3">
                <Input
                  data-filter-input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name or target"
                  aria-label="Filter jobs"
                  className="w-64"
                />
                <Facet label="Location" param="location" rows={all} valueFor={(j) => j.location} />
                <Facet label="State" param="state" rows={all} valueFor={(j) => j.state} className="w-36" />
                {selection.size > 0 ? (
                  <span className="flex items-center gap-1 pb-0.5">
                    <span className="mr-1 text-meta text-ink-2">{selection.size} selected</span>
                    <Button
                      size="sm"
                      icon={PlayIcon}
                      disabled={!!readOnly}
                      disabledReason={readOnly}
                      loading={bulk.isPending}
                      onClick={() => bulk.mutate({ action: 'run', names })}
                    >
                      Run now
                    </Button>
                    <Button
                      size="sm"
                      icon={PauseIcon}
                      disabled={!!readOnly}
                      disabledReason={readOnly}
                      onClick={() => bulk.mutate({ action: 'pause', names })}
                    >
                      Pause
                    </Button>
                    <Button
                      size="sm"
                      disabled={!!readOnly}
                      disabledReason={readOnly}
                      onClick={() => bulk.mutate({ action: 'resume', names })}
                    >
                      Resume
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={TrashIcon}
                      disabled={!!readOnly}
                      disabledReason={readOnly}
                      onClick={() => setDeleting(true)}
                    >
                      Delete
                    </Button>
                  </span>
                ) : null}
                <span className="ml-auto">
                  <RefreshControl onRefresh={() => void query.refetch()} refreshing={query.isRefetching} />
                </span>
              </div>
            }
          />
        )}
      </div>
      <JobSheet projectId={projectId} open={creating} onOpenChange={setCreating} job={null} readOnlyReason={readOnly} />
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${selection.size} ${selection.size === 1 ? 'job' : 'jobs'}`}
        consequence="The selected jobs stop running and are deleted. Their targets are not changed."
        expected={String(selection.size)}
        confirmLabel={`Delete ${selection.size} ${selection.size === 1 ? 'job' : 'jobs'}`}
        onConfirm={async (confirm) => {
          await bulk.mutateAsync({ action: 'delete', names, confirm });
          setSelection(new Set());
        }}
      />
    </div>
  );
}
