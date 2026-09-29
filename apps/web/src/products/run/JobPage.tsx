import type { RunExecution } from '@nephoscope/contracts';
import { PencilSimpleIcon, PlayIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Legend, Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { MenuItem } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { Chip, Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { toLocation } from '../../kit/href';
import { LogsPanel } from '../../kit/LogsPanel';
import { MetricsPanel } from '../../kit/MetricsPanel';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { duration } from '../../lib/format';
import { useOperations } from '../../state/operations';
import { useActiveProfile, useInstance } from '../../state/queries';
import { JobSheet } from '../scheduler/JobSheet';
import { TriggersTab } from '../shared/TriggersTab';
import { deleteJob, useExecutions, useRunJob, useRunJobYaml } from './api';
import { OutcomeGlyph, RunStatusGlyph, readOnlyReason, runLogFilter, runRoutes } from './common';
import { ExecuteSheet, JobEditSheet } from './JobSheets';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'executions', label: 'Executions' },
  { key: 'triggers', label: 'Triggers' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'logs', label: 'Logs' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

function elapsed(e: RunExecution): string {
  if (!e.startTime) return '';
  const end = e.completionTime ? Date.parse(e.completionTime) : Date.now();
  return duration(end - Date.parse(e.startTime));
}

/** A Cloud Run job (SPEC-0003 CA-09 to CA-13). */
export function JobPage() {
  const { projectId, location, job: id } = useParams({ strict: false }) as { projectId: string; location: string; job: string };
  const query = useRunJob(projectId, location, id);
  const executions = useExecutions(projectId, location, id);
  const [tab] = useSearchState<Tab>(
    'tab',
    'overview',
    TABS.map((t) => t.key),
  );
  const yaml = useRunJobYaml(projectId, location, id, tab === 'yaml');
  const [executing, setExecuting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const navigate = useNavigate();
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  const routes = runRoutes(projectId);
  const executionList = useMemo(() => executions.data?.pages.flatMap((p) => p.items) ?? [], [executions.data]);

  const j = query.data;
  if (query.isPending) return <DelayedSkeleton rows={8} className="p-6" />;
  if (query.error instanceof ApiError || !j) {
    return query.error instanceof ApiError ? <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} /> : null;
  }
  const c = j.containers[0];

  const columns: ResourceColumn<RunExecution>[] = [
    {
      id: 'name',
      header: 'Execution',
      hideable: false,
      sortValue: (e) => e.createTime ?? '',
      cell: (e) => (
        <Link
          to={routes.execution(j.location, j.id, e.id)}
          className="font-mono text-[12px] text-ink"
          onClick={(ev) => ev.stopPropagation()}
        >
          {e.id}
        </Link>
      ),
    },
    { id: 'outcome', header: 'Status', width: '8rem', sortValue: (e) => e.outcome, cell: (e) => <OutcomeGlyph outcome={e.outcome} /> },
    {
      id: 'tasks',
      header: 'Tasks',
      width: '10rem',
      cell: (e) => <span className="tnum text-ink-2">{`${e.succeeded}/${e.taskCount} done${e.failed ? `, ${e.failed} failed` : ''}`}</span>,
    },
    {
      id: 'started',
      header: 'Started',
      width: '8.5rem',
      sortValue: (e) => e.startTime ?? e.createTime ?? '',
      cell: (e) => <Timestamp iso={e.startTime ?? e.createTime} />,
    },
    { id: 'duration', header: 'Duration', width: '6rem', cell: (e) => <span className="tnum text-ink-2">{elapsed(e)}</span> },
  ];

  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Cloud Run', to: routes.list }, { label: 'Jobs', to: `${routes.list}?tab=jobs` }, { label: j.id }]}
        title={j.id}
        status={<RunStatusGlyph status={j.status} message={j.statusMessage} />}
        actions={
          <>
            <Button icon={PencilSimpleIcon} onClick={() => setEditing(true)} disabled={!!readOnly} disabledReason={readOnly}>
              Edit
            </Button>
            <Button variant="commit" icon={PlayIcon} onClick={() => setExecuting(true)} disabled={!!readOnly} disabledReason={readOnly}>
              Execute
            </Button>
          </>
        }
        menu={
          <>
            <MenuItem onClick={() => setScheduling(true)} disabled={!!readOnly}>
              Schedule this job
            </MenuItem>
            <MenuItem onClick={() => setDeleting(true)} className="text-redline-ink" disabled={!!readOnly}>
              Delete job
            </MenuItem>
          </>
        }
        cells={[
          { label: 'Region', value: <Mono value={j.location} />, mono: true },
          { label: 'Tasks', value: `${j.taskCount}${j.parallelism ? `, ${j.parallelism} at a time` : ''}` },
          { label: 'Executions', value: String(j.executionCount) },
          { label: 'Updated', value: <Timestamp iso={j.updateTime} /> },
          { label: 'Updated by', value: j.lastModifier ?? '' },
        ]}
        tabs={TABS}
        defaultTab="overview"
      >
        {(current) => {
          switch (current) {
            case 'overview':
              return (
                <Section title="Configuration">
                  <dl className="m-0 grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-6 gap-y-1.5 px-6">
                    {(
                      [
                        ['Image', c ? <Mono value={c.image} copy /> : null],
                        ['Command', c?.command.length ? <Mono value={c.command.join(' ')} /> : null],
                        ['Arguments', c?.args.length ? <Mono value={c.args.join(' ')} /> : null],
                        ['CPU and memory', c ? `${c.cpu ?? 'default'} CPU, ${c.memory ?? 'default'}` : null],
                        ['Environment', c ? `${c.env.length} variables` : null],
                        ['Retries per task', j.maxRetries ?? 'default'],
                        ['Task timeout', j.timeoutSeconds !== null ? duration(j.timeoutSeconds * 1000) : null],
                        ['Service account', j.serviceAccount ? <Mono value={j.serviceAccount} copy /> : 'Compute Engine default'],
                        [
                          'Labels',
                          Object.keys(j.labels).length ? (
                            <span className="flex flex-wrap gap-1">
                              {Object.entries(j.labels).map(([k, v]) => (
                                <Chip key={k} mono>{`${k}=${v}`}</Chip>
                              ))}
                            </span>
                          ) : null,
                        ],
                      ] as [string, React.ReactNode][]
                    ).map(([k, v]) => (
                      <div key={k} className="contents">
                        <Legend as="dt">{k}</Legend>
                        <dd className="m-0 min-w-0 text-dense text-ink">{v ?? <span className="text-ink-3">None</span>}</dd>
                      </div>
                    ))}
                  </dl>
                </Section>
              );
            case 'executions':
              return executions.isPending ? (
                <DelayedSkeleton />
              ) : executions.error instanceof ApiError ? (
                <ProblemState problem={executions.error.problem} onRetry={() => void executions.refetch()} />
              ) : (
                <div className="pt-3">
                  <ResourceTable
                    tableId="run-executions"
                    label="Executions"
                    rows={executionList}
                    columns={columns}
                    getRowId={(e) => e.id}
                    onOpen={(e) => void navigate({ to: routes.execution(j.location, j.id, e.id) })}
                    emptyTitle="Never executed"
                    emptyText="Execute the job to create its first execution."
                    hasMore={executions.hasNextPage}
                    loadingMore={executions.isFetchingNextPage}
                    onLoadMore={() => void executions.fetchNextPage()}
                  />
                </div>
              );
            case 'triggers':
              return <TriggersTab projectId={projectId} match={{ kind: 'runJob', name: j.name }} />;
            case 'metrics':
              return <MetricsPanel projectId={projectId} kind="run-job" labels={{ job_name: j.id, location: j.location }} />;
            case 'logs':
              return <LogsPanel projectId={projectId} filter={runLogFilter.job(j.id, j.location)} />;
            case 'yaml':
              return (
                <RawView
                  value={yaml.data}
                  fileName={j.id}
                  loading={yaml.isPending}
                  error={yaml.error}
                  onRetry={() => void yaml.refetch()}
                />
              );
          }
        }}
      </DetailLayout>
      <ExecuteSheet projectId={projectId} job={j} open={executing} onOpenChange={setExecuting} readOnlyReason={readOnly} />
      <JobEditSheet projectId={projectId} job={j} open={editing} onOpenChange={setEditing} readOnlyReason={readOnly} />
      <JobSheet
        projectId={projectId}
        open={scheduling}
        onOpenChange={setScheduling}
        job={null}
        readOnlyReason={readOnly}
        prefill={{
          id: `${j.id}-schedule`,
          region: j.location,
          description: `Runs the Cloud Run job ${j.id}`,
          target: {
            kind: 'http',
            uri: `https://run.googleapis.com/v2/${j.name}:run`,
            method: 'POST',
            headers: {},
            body: '',
            auth: { kind: 'oauth', serviceAccount: j.serviceAccount ?? '', scope: 'https://www.googleapis.com/auth/cloud-platform' },
          },
        }}
      />
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete job"
        consequence={`The job ${j.id} and its execution history are deleted.`}
        expected={j.id}
        confirmLabel="Delete job"
        command={`gcloud run jobs delete ${j.id} --region=${j.location} --project=${projectId}`}
        onConfirm={async (confirm) => {
          const { operation } = await deleteJob(projectId, j.location, j.id, confirm);
          useOperations.getState().upsert(operation);
          void navigate(toLocation(`${routes.list}?tab=jobs`));
        }}
      />
    </>
  );
}
