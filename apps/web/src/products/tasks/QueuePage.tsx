import type { QueueTask } from '@nephoscope/contracts';
import { PauseIcon, PlayIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { MenuItem, Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { EquivalentCommand, sh } from '../../kit/EquivalentCommand';
import { KeyValueEditor } from '../../kit/KeyValueEditor';
import { LogsPanel } from '../../kit/LogsPanel';
import { MetricsPanel } from '../../kit/MetricsPanel';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import {
  deleteQueue,
  deleteTask,
  purgeQueue,
  queueLogFilter,
  useCreateTask,
  useQueue,
  useQueueAction,
  useQueueRaw,
  useQueueTasks,
  useRunTask,
  useSaveQueue,
} from './api';
import { QueueFields, type QueueForm, QueueStateGlyph, queueBody, queueForm } from './TasksPage';

const TABS = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'settings', label: 'Settings' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'logs', label: 'Logs' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

function CreateTaskSheet({
  projectId,
  location,
  queue,
  open,
  onOpenChange,
  readOnly,
}: {
  projectId: string;
  location: string;
  queue: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnly: string | null;
}) {
  const [url, setUrl] = useState('https://');
  const [method, setMethod] = useState<'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE'>('POST');
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([{ name: 'Content-Type', value: 'application/json' }]);
  const [body, setBody] = useState('{}');
  const [sa, setSa] = useState('');
  const create = useCreateTask(projectId, location, queue);
  useEffect(() => {
    if (open) setBody('{}');
  }, [open]);
  const urlOk = /^https?:\/\/.+/.test(url);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Create a task in ${queue}`}
      description="An HTTP task, dispatched as soon as the queue allows."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PlusIcon}
            loading={create.isPending}
            disabled={!urlOk || !!readOnly}
            disabledReason={readOnly ?? 'A full URL is required'}
            onClick={() =>
              create.mutate(
                {
                  url,
                  method,
                  headers: Object.fromEntries(headers.filter((h) => h.name.trim()).map((h) => [h.name.trim(), h.value])),
                  body: method === 'GET' ? '' : body,
                  serviceAccount: sa.trim() || undefined,
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            Create task
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <Field label="Method">
            <Select
              value={method}
              onValueChange={setMethod}
              options={(['POST', 'GET', 'PUT', 'PATCH', 'DELETE'] as const).map((m) => ({ value: m, label: m }))}
            />
          </Field>
          <Field label="URL" required error={urlOk ? undefined : 'A full URL, starting with https://.'}>
            <Input mono value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
        </div>
        <KeyValueEditor label="Headers" keyLabel="Header" rows={headers} onChange={setHeaders} />
        {method !== 'GET' ? <CodeEditor value={body} onChange={setBody} language="json" height={180} label="Task body" /> : null}
        <Field label="OIDC service account" help="Sends an OIDC token, for Cloud Run and functions URLs. Leave empty for none.">
          <Input mono value={sa} onChange={(e) => setSa(e.target.value)} />
        </Field>
        <EquivalentCommand
          gcloud={`gcloud tasks create-http-task --queue=${queue} --location=${location} --project=${projectId} --url=${sh(url)} --method=${method}${method !== 'GET' && body ? ` --body-content=${sh(body)}` : ''}${sa ? ` --oidc-service-account-email=${sa}` : ''}`}
        />
      </div>
    </Sheet>
  );
}

/** One Cloud Tasks queue (SPEC-0003 D-13, CA-27). */
export function QueuePage() {
  const { projectId, location, queue: id } = useParams({ strict: false }) as { projectId: string; location: string; queue: string };
  const query = useQueue(projectId, location, id);
  const tasks = useQueueTasks(projectId, location, id);
  const [tab] = useSearchState<Tab>(
    'tab',
    'tasks',
    TABS.map((t) => t.key),
  );
  const raw = useQueueRaw(projectId, location, id, tab === 'yaml');
  const action = useQueueAction(projectId, location, id);
  const save = useSaveQueue(projectId, location, id);
  const run = useRunTask(projectId, location, id);
  const [creating, setCreating] = useState(false);
  const [purging, setPurging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingTask, setDeletingTask] = useState<QueueTask | null>(null);
  const [form, setForm] = useState<QueueForm>(queueForm(null));
  const navigate = useNavigate();
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  const q = query.data;
  useEffect(() => {
    if (q) setForm(queueForm(q));
  }, [q]);

  if (query.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (query.error instanceof ApiError || !q)
    return query.error instanceof ApiError ? <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} /> : null;

  const columns: ResourceColumn<QueueTask>[] = [
    {
      id: 'id',
      header: 'Task',
      hideable: false,
      sortValue: (t) => t.id,
      cell: (t) => <span className="truncate font-mono text-[12px]">{t.id}</span>,
    },
    {
      id: 'target',
      header: 'Target',
      cell: (t) => <span className="truncate font-mono text-[12px] text-ink-2">{`${t.method} ${t.url}`}</span>,
    },
    {
      id: 'schedule',
      header: 'Scheduled',
      width: '8.5rem',
      sortValue: (t) => t.scheduleTime ?? '',
      cell: (t) => <Timestamp iso={t.scheduleTime} />,
    },
    {
      id: 'dispatches',
      header: 'Dispatches',
      width: '6.5rem',
      align: 'right',
      sortValue: (t) => t.dispatchCount,
      cell: (t) => <span className="tnum">{t.dispatchCount}</span>,
    },
    {
      id: 'last',
      header: 'Last attempt',
      width: '9rem',
      cell: (t) =>
        !t.lastAttempt ? (
          <span className="text-ink-3">Not yet</span>
        ) : !t.lastAttempt.status || t.lastAttempt.status.code === 0 ? (
          <StatusGlyph kind="ok" label="Succeeded" />
        ) : (
          <StatusGlyph kind="error" label={`Code ${t.lastAttempt.status.code}`} />
        ),
    },
    {
      id: 'actions',
      header: 'Actions',
      width: '12.5rem',
      hideable: false,
      cell: (t) => (
        <span className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={PlayIcon}
            disabled={!!readOnly}
            disabledReason={readOnly}
            onClick={() => run.mutate(t.id)}
          >
            Run now
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={TrashIcon}
            disabled={!!readOnly}
            disabledReason={readOnly}
            onClick={() => setDeletingTask(t)}
          >
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Cloud Tasks', to: `/p/${projectId}/tasks` }, { label: q.id }]}
        title={q.id}
        status={<QueueStateGlyph state={q.state} />}
        actions={
          <>
            {q.state === 'paused' ? (
              <Button disabled={!!readOnly} disabledReason={readOnly} onClick={() => action.mutate('resume')}>
                Resume
              </Button>
            ) : (
              <Button icon={PauseIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => action.mutate('pause')}>
                Pause
              </Button>
            )}
            <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setCreating(true)}>
              Create task
            </Button>
          </>
        }
        menu={
          <>
            <MenuItem onClick={() => setPurging(true)} className="text-redline-ink" disabled={!!readOnly}>
              Purge all tasks
            </MenuItem>
            <MenuItem onClick={() => setDeleting(true)} className="text-redline-ink" disabled={!!readOnly}>
              Delete queue
            </MenuItem>
          </>
        }
        cells={[
          { label: 'Location', value: <Mono value={q.location} />, mono: true },
          { label: 'Rate', value: `${q.maxDispatchesPerSecond ?? ''}/s, ${q.maxConcurrentDispatches ?? ''} at a time` },
          { label: 'Max attempts', value: q.maxAttempts === -1 ? 'Unlimited' : String(q.maxAttempts ?? '') },
          { label: 'Last purge', value: <Timestamp iso={q.purgeTime} /> },
        ]}
        tabs={TABS}
        defaultTab="tasks"
      >
        {(current) => {
          switch (current) {
            case 'tasks':
              return tasks.isPending ? (
                <DelayedSkeleton />
              ) : tasks.error instanceof ApiError ? (
                <ProblemState problem={tasks.error.problem} onRetry={() => void tasks.refetch()} />
              ) : (
                <div className="pt-3">
                  <ResourceTable
                    tableId="queue-tasks"
                    label="Tasks"
                    rows={tasks.data?.items ?? []}
                    columns={columns}
                    getRowId={(t) => t.id}
                    emptyTitle="The queue is empty"
                    emptyText="Tasks appear here until they succeed or run out of attempts."
                  />
                </div>
              );
            case 'settings':
              return (
                <Section title="Rate and retries">
                  <div className="flex max-w-xl flex-col gap-4 px-6">
                    <QueueFields f={form} set={(k, v) => setForm((p) => ({ ...p, [k]: v }))} />
                    <div>
                      <Button
                        disabled={!!readOnly}
                        disabledReason={readOnly}
                        loading={save.isPending}
                        onClick={() => save.mutate(queueBody(form))}
                      >
                        Save settings
                      </Button>
                    </div>
                  </div>
                </Section>
              );
            case 'metrics':
              return <MetricsPanel projectId={projectId} kind="tasks-queue" labels={{ queue_id: q.id }} />;
            case 'logs':
              return <LogsPanel projectId={projectId} filter={queueLogFilter(q.id)} />;
            case 'yaml':
              return (
                <RawView value={raw.data} fileName={q.id} loading={raw.isPending} error={raw.error} onRetry={() => void raw.refetch()} />
              );
          }
        }}
      </DetailLayout>
      <CreateTaskSheet
        projectId={projectId}
        location={q.location}
        queue={q.id}
        open={creating}
        onOpenChange={setCreating}
        readOnly={readOnly}
      />
      <ConfirmDestructive
        open={purging}
        onOpenChange={setPurging}
        title="Purge queue"
        consequence={`Every task in ${q.id} is deleted. Purged tasks cannot be recovered.`}
        expected={q.id}
        confirmLabel="Purge all tasks"
        command={`gcloud tasks queues purge ${q.id} --location=${q.location} --project=${projectId}`}
        onConfirm={async (confirm) => {
          await purgeQueue(projectId, q.location, q.id, confirm);
          toast(`Purged ${q.id}`);
          void tasks.refetch();
        }}
      />
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete queue"
        consequence={`The queue ${q.id} and its tasks are deleted. A queue with the same name cannot be created for 7 days.`}
        expected={q.id}
        confirmLabel="Delete queue"
        command={`gcloud tasks queues delete ${q.id} --location=${q.location} --project=${projectId}`}
        onConfirm={async (confirm) => {
          await deleteQueue(projectId, q.location, q.id, confirm);
          void navigate({ to: `/p/${projectId}/tasks` as string });
        }}
      />
      <ConfirmDestructive
        open={deletingTask !== null}
        onOpenChange={(o) => !o && setDeletingTask(null)}
        title="Delete task"
        consequence={`The task ${deletingTask?.id ?? ''} is removed from the queue and never dispatched again.`}
        expected={deletingTask?.id ?? ''}
        confirmLabel="Delete task"
        onConfirm={async (confirm) => {
          if (!deletingTask) return;
          await deleteTask(projectId, q.location, q.id, deletingTask.id, confirm);
          void tasks.refetch();
        }}
      />
    </>
  );
}
