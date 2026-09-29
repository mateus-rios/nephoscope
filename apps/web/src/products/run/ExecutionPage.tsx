import type { RunExecutionUpdate, RunTask } from '@nephoscope/contracts';
import { StopIcon, TrashIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { type Note, Notes } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { toLocation } from '../../kit/href';
import { LogsPanel } from '../../kit/LogsPanel';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { duration } from '../../lib/format';
import { live } from '../../lib/live';
import { useOperations } from '../../state/operations';
import { useActiveProfile, useInstance } from '../../state/queries';
import { useSession } from '../../state/session';
import { deleteExecution, runKeys, useCancelExecution, useExecution, useExecutionRaw } from './api';
import { OutcomeGlyph, readOnlyReason, runLogFilter, runRoutes } from './common';

const TABS = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'logs', label: 'Logs' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** One job execution, live until it ends (SPEC-0003 CA-11, CA-12). */
export function ExecutionPage() {
  const { projectId, location, job, execution } = useParams({ strict: false }) as {
    projectId: string;
    location: string;
    job: string;
    execution: string;
  };
  const profileId = useSession((s) => s.profileId);
  const { execQuery, tasksQuery } = useExecution(projectId, location, job, execution);
  const [tab] = useSearchState<Tab>(
    'tab',
    'tasks',
    TABS.map((t) => t.key),
  );
  const raw = useExecutionRaw(projectId, location, job, execution, tab === 'yaml');
  const cancel = useCancelExecution(projectId, location, job);
  const [deleting, setDeleting] = useSearchState<'0' | '1'>('delete', '0', ['0', '1']);
  const client = useQueryClient();
  const navigate = useNavigate();
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  const routes = runRoutes(projectId);
  const name = `projects/${projectId}/locations/${location}/jobs/${job}/executions/${execution}`;
  const done = execQuery.data?.completionTime != null;

  // Live updates until the execution ends (SPEC-0003 NFR-02).
  useEffect(() => {
    if (!profileId || done) return;
    const base = [...runKeys.job(profileId, projectId, location, job), 'execution', execution];
    return live.subscribe(
      'run.execution',
      { profileId, projectId },
      { name },
      {
        data(payload) {
          const update = payload as RunExecutionUpdate;
          client.setQueryData(base, update.execution);
          client.setQueryData([...base, 'tasks'], update.tasks);
        },
      },
    );
  }, [profileId, done, projectId, location, job, execution, name, client]);

  const e = execQuery.data;
  if (execQuery.isPending) return <DelayedSkeleton rows={8} className="p-6" />;
  if (execQuery.error instanceof ApiError || !e) {
    return execQuery.error instanceof ApiError ? (
      <ProblemState problem={execQuery.error.problem} onRetry={() => void execQuery.refetch()} />
    ) : null;
  }
  const running = e.outcome === 'running' || e.outcome === 'pending';
  const tookMs = e.startTime ? (e.completionTime ? Date.parse(e.completionTime) : Date.now()) - Date.parse(e.startTime) : null;

  const columns: ResourceColumn<RunTask>[] = [
    {
      id: 'index',
      header: 'Task',
      width: '5rem',
      hideable: false,
      sortValue: (t) => t.index,
      cell: (t) => <span className="tnum font-mono text-[12px]">{t.index}</span>,
    },
    { id: 'outcome', header: 'Status', width: '8rem', sortValue: (t) => t.outcome, cell: (t) => <OutcomeGlyph outcome={t.outcome} /> },
    {
      id: 'retries',
      header: 'Retries',
      width: '5rem',
      align: 'right',
      sortValue: (t) => t.retried,
      cell: (t) => <span className="tnum">{t.retried}</span>,
    },
    { id: 'exit', header: 'Exit code', width: '6rem', align: 'right', cell: (t) => <span className="tnum">{t.exitCode ?? ''}</span> },
    { id: 'message', header: 'Last attempt', cell: (t) => <span className="truncate text-ink-2">{t.lastAttemptMessage}</span> },
    {
      id: 'started',
      header: 'Started',
      width: '8.5rem',
      sortValue: (t) => t.startTime ?? '',
      cell: (t) => <Timestamp iso={t.startTime} />,
    },
    {
      id: 'duration',
      header: 'Duration',
      width: '6rem',
      cell: (t) =>
        t.startTime ? (
          <span className="tnum text-ink-2">
            {duration((t.completionTime ? Date.parse(t.completionTime) : Date.now()) - Date.parse(t.startTime))}
          </span>
        ) : null,
    },
  ];

  const notes: Note[] = [];
  if (running) notes.push({ id: 'live', tone: 'info', text: 'This page updates by itself until the execution ends.' });
  if (e.outcome === 'failed' && e.statusMessage) notes.push({ id: 'failed', tone: 'error', text: e.statusMessage });

  return (
    <>
      <DetailLayout<Tab>
        crumbs={[
          { label: 'Cloud Run', to: routes.list },
          { label: job, to: routes.job(location, job) },
          { label: 'Executions', to: `${routes.job(location, job)}?tab=executions` },
          { label: e.id },
        ]}
        title={e.id}
        status={<OutcomeGlyph outcome={e.outcome} />}
        actions={
          running ? (
            <Button
              icon={StopIcon}
              loading={cancel.isPending}
              disabled={!!readOnly}
              disabledReason={readOnly}
              onClick={() => cancel.mutate(e.id)}
            >
              Cancel execution
            </Button>
          ) : (
            <Button icon={TrashIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setDeleting('1')}>
              Delete execution
            </Button>
          )
        }
        cells={[
          { label: 'Job', value: <Mono value={job} />, mono: true },
          { label: 'Started', value: <Timestamp iso={e.startTime ?? e.createTime} /> },
          { label: 'Duration', value: tookMs !== null ? duration(tookMs) : '' },
          {
            label: 'Tasks',
            value: `${e.succeeded} succeeded, ${e.failed} failed, ${e.running} running${e.cancelled ? `, ${e.cancelled} cancelled` : ''} of ${e.taskCount}`,
            wide: true,
          },
          { label: 'Retries', value: String(e.retried) },
        ]}
        tabs={TABS}
        defaultTab="tasks"
      >
        {(current) => {
          switch (current) {
            case 'tasks':
              return (
                <>
                  <Notes notes={notes} />
                  {tasksQuery.isPending ? (
                    <DelayedSkeleton />
                  ) : tasksQuery.error instanceof ApiError ? (
                    <ProblemState problem={tasksQuery.error.problem} onRetry={() => void tasksQuery.refetch()} />
                  ) : (
                    <div className="pt-3">
                      <ResourceTable
                        tableId="run-tasks"
                        label="Tasks"
                        rows={tasksQuery.data ?? []}
                        columns={columns}
                        getRowId={(t) => String(t.index)}
                        emptyTitle="No tasks yet"
                        emptyText="Tasks appear as the execution starts them."
                      />
                    </div>
                  )}
                </>
              );
            case 'logs':
              return <LogsPanel projectId={projectId} filter={runLogFilter.execution(job, location, e.id)} />;
            case 'yaml':
              return (
                <RawView value={raw.data} fileName={e.id} loading={raw.isPending} error={raw.error} onRetry={() => void raw.refetch()} />
              );
          }
        }}
      </DetailLayout>
      <ConfirmDestructive
        open={deleting === '1'}
        onOpenChange={(o) => setDeleting(o ? '1' : '0')}
        title="Delete execution"
        consequence={`The execution ${e.id} and its task history are deleted. Its logs stay in Cloud Logging.`}
        expected={e.id}
        confirmLabel="Delete execution"
        command={`gcloud run jobs executions delete ${e.id} --region=${location} --project=${projectId}`}
        onConfirm={async (confirm) => {
          const { operation } = await deleteExecution(projectId, location, job, e.id, confirm);
          useOperations.getState().upsert(operation);
          void navigate(toLocation(`${routes.job(location, job)}?tab=executions`));
        }}
      />
    </>
  );
}
