import type { QueueState, SaveQueue, TaskQueue } from '@nephoscope/contracts';
import { PlusIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { Notes, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono } from '../../design/Values';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { Facet, partialNote, RefreshControl, useFacet } from '../../kit/ListControls';
import { ApiError } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { RUN_REGIONS } from '../run/DeploySheet';
import { useCreateQueue, useQueues } from './api';

export function QueueStateGlyph({ state }: { state: QueueState }) {
  if (state === 'running') return <StatusGlyph kind="ok" label="Running" />;
  if (state === 'paused') return <StatusGlyph kind="paused" label="Paused" />;
  if (state === 'disabled') return <StatusGlyph kind="paused" label="Disabled" />;
  return <StatusGlyph kind="unknown" label="Unknown" />;
}

/** Queue settings as form strings; empty means "keep Google's value". */
export interface QueueForm {
  rate: string;
  concurrency: string;
  attempts: string;
  minBackoff: string;
  maxBackoff: string;
}

export function queueForm(q: TaskQueue | null): QueueForm {
  return {
    rate: q?.maxDispatchesPerSecond?.toString() ?? '',
    concurrency: q?.maxConcurrentDispatches?.toString() ?? '',
    attempts: q?.maxAttempts?.toString() ?? '',
    minBackoff: q?.minBackoffSeconds?.toString() ?? '',
    maxBackoff: q?.maxBackoffSeconds?.toString() ?? '',
  };
}

export function queueBody(f: QueueForm): SaveQueue {
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  return {
    maxDispatchesPerSecond: num(f.rate),
    maxConcurrentDispatches: num(f.concurrency),
    maxAttempts: num(f.attempts),
    minBackoffSeconds: num(f.minBackoff),
    maxBackoffSeconds: num(f.maxBackoff),
  };
}

export function QueueFields({ f, set }: { f: QueueForm; set: (k: keyof QueueForm, v: string) => void }) {
  const numeric = (k: keyof QueueForm) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value.replace(/[^\d.-]/g, ''));
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Dispatches per second" help="Up to 500.">
        <Input mono value={f.rate} onChange={numeric('rate')} inputMode="decimal" />
      </Field>
      <Field label="Concurrent dispatches">
        <Input mono value={f.concurrency} onChange={numeric('concurrency')} inputMode="numeric" />
      </Field>
      <Field label="Max attempts" help="-1 retries without limit.">
        <Input mono value={f.attempts} onChange={numeric('attempts')} inputMode="numeric" />
      </Field>
      <div />
      <Field label="Min backoff (s)">
        <Input mono value={f.minBackoff} onChange={numeric('minBackoff')} inputMode="decimal" />
      </Field>
      <Field label="Max backoff (s)">
        <Input mono value={f.maxBackoff} onChange={numeric('maxBackoff')} inputMode="decimal" />
      </Field>
    </div>
  );
}

function CreateQueueSheet({
  projectId,
  open,
  onOpenChange,
  readOnly,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnly: string | null;
}) {
  const [id, setId] = useState('');
  const [region, setRegion] = useState('us-central1');
  const [f, setF] = useState<QueueForm>(queueForm(null));
  const create = useCreateQueue(projectId);
  const navigate = useNavigate();
  useEffect(() => {
    if (open) {
      setId('');
      setF(queueForm(null));
    }
  }, [open]);
  const idError = /^[A-Za-z0-9-]{1,100}$/.test(id) ? null : 'Letters, digits and hyphens.';
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create queue"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PlusIcon}
            loading={create.isPending}
            disabled={!!idError || !!readOnly}
            disabledReason={readOnly ?? idError}
            onClick={() =>
              create.mutate(
                { ...queueBody(f), id, region },
                {
                  onSuccess: (q) => {
                    onOpenChange(false);
                    void navigate({ to: `/p/${projectId}/tasks/${q.location}/${q.id}` as string });
                  },
                },
              )
            }
          >
            Create queue
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" required>
            <Input mono value={id} onChange={(e) => setId(e.target.value)} autoFocus />
          </Field>
          <Field label="Region" required>
            <Input mono value={region} onChange={(e) => setRegion(e.target.value)} list="nephoscope-tasks-regions" />
          </Field>
          <datalist id="nephoscope-tasks-regions">
            {RUN_REGIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
        <QueueFields f={f} set={(k, v) => setF((p) => ({ ...p, [k]: v }))} />
        <EquivalentCommand
          gcloud={`gcloud tasks queues create ${id || 'QUEUE'} --location=${region} --project=${projectId}${f.rate ? ` --max-dispatches-per-second=${f.rate}` : ''}${f.concurrency ? ` --max-concurrent-dispatches=${f.concurrency}` : ''}${f.attempts ? ` --max-attempts=${f.attempts}` : ''}`}
        />
      </div>
    </Sheet>
  );
}

/** Cloud Tasks queues (SPEC-0003 D-13, CA-27). */
export function TasksPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const query = useQueues(projectId);
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const location = useFacet('location');
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  useEffect(() => {
    document.title = 'Cloud Tasks · Nephoscope';
  }, []);
  const all = query.data?.items ?? [];
  const q = filter.trim().toLowerCase();
  const rows = useMemo(
    () => all.filter((x) => (location === 'all' || x.location === location) && (!q || x.id.toLowerCase().includes(q))),
    [all, location, q],
  );
  const href = (x: TaskQueue): string => `/p/${projectId}/tasks/${x.location}/${x.id}`;
  const columns: ResourceColumn<TaskQueue>[] = [
    {
      id: 'name',
      header: 'Queue',
      hideable: false,
      sortValue: (x) => x.id,
      cell: (x) => (
        <Link to={href(x)} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {x.id}
        </Link>
      ),
    },
    { id: 'state', header: 'State', width: '8rem', sortValue: (x) => x.state, cell: (x) => <QueueStateGlyph state={x.state} /> },
    { id: 'location', header: 'Location', width: '10rem', sortValue: (x) => x.location, cell: (x) => <Mono value={x.location} /> },
    {
      id: 'rate',
      header: 'Rate',
      width: '8rem',
      align: 'right',
      sortValue: (x) => x.maxDispatchesPerSecond ?? 0,
      cell: (x) => <span className="tnum">{x.maxDispatchesPerSecond ?? ''}/s</span>,
    },
    {
      id: 'concurrency',
      header: 'Concurrency',
      width: '7rem',
      align: 'right',
      sortValue: (x) => x.maxConcurrentDispatches ?? 0,
      cell: (x) => <span className="tnum">{x.maxConcurrentDispatches ?? ''}</span>,
    },
    {
      id: 'attempts',
      header: 'Max attempts',
      width: '7rem',
      align: 'right',
      sortValue: (x) => x.maxAttempts ?? 0,
      cell: (x) => <span className="tnum">{x.maxAttempts === -1 ? 'Unlimited' : (x.maxAttempts ?? '')}</span>,
    },
  ];
  return (
    <div className="pb-16">
      <TitleBlock
        title="Cloud Tasks"
        subtitle="Queues that dispatch HTTP tasks at a controlled rate, with retries."
        actions={
          <Button variant="commit" icon={PlusIcon} onClick={() => setCreating(true)} disabled={!!readOnly} disabledReason={readOnly}>
            Create queue
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
            tableId="tasks-queues"
            label="Queues"
            rows={rows}
            columns={columns}
            getRowId={(x) => x.name}
            onOpen={(x) => void navigate({ to: href(x) })}
            filtered={rows.length !== all.length}
            emptyTitle="No queues"
            emptyText="A queue holds tasks and dispatches them to their URLs, retrying failures."
            toolbar={
              <div className="flex flex-wrap items-end gap-3">
                <Input
                  data-filter-input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name"
                  aria-label="Filter queues"
                  className="w-64"
                />
                <Facet label="Location" param="location" rows={all} valueFor={(x) => x.location} />
                <span className="ml-auto">
                  <RefreshControl onRefresh={() => void query.refetch()} refreshing={query.isRefetching} />
                </span>
              </div>
            }
          />
        )}
      </div>
      <CreateQueueSheet projectId={projectId} open={creating} onOpenChange={setCreating} readOnly={readOnly} />
    </div>
  );
}
