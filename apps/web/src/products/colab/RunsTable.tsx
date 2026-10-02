import type { ColabExecution, ColabExecutionList } from '@nephoscope/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Notes } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { Mono, Timestamp } from '../../design/Values';
import { RefreshControl } from '../../kit/ListControls';
import { ApiError } from '../../lib/api';
import { colabHref } from './api';
import { JobStateGlyph, jobStateLabel, runDuration } from './common';

/** The runs of one notebook or schedule, among the newest executions of its region (SPEC-0010 D-03). */
export function RunsTable({
  projectId,
  query,
  location,
  empty,
}: {
  projectId: string;
  query: UseQueryResult<ColabExecutionList>;
  location: string;
  empty: string;
}) {
  const navigate = useNavigate();
  if (query.isPending) return <DelayedSkeleton />;
  if (query.error instanceof ApiError) return <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />;
  const rows = query.data?.items ?? [];
  const columns: ResourceColumn<ColabExecution>[] = [
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
    { id: 'id', header: 'ID', width: '12rem', defaultHidden: true, sortValue: (e) => e.id, cell: (e) => <Mono value={e.id} /> },
  ];
  return (
    <>
      <Notes
        notes={
          query.data?.truncated.length
            ? [
                {
                  id: 'scan',
                  tone: 'info',
                  text: `Runs among the newest 500 executions in ${location}. Older runs are on the Executions tab, region ${location}.`,
                },
              ]
            : []
        }
      />
      <div className="pt-3">
        <ResourceTable
          tableId="colab-runs"
          label="Runs"
          rows={rows}
          columns={columns}
          getRowId={(e) => e.name}
          onOpen={(e) => void navigate({ to: colabHref.execution(projectId, e.location, e.id) as string })}
          emptyTitle="No runs"
          emptyText={empty}
          toolbar={
            <div className="flex justify-end">
              <RefreshControl onRefresh={() => void query.refetch()} refreshing={query.isRefetching} />
            </div>
          }
        />
      </div>
    </>
  );
}
