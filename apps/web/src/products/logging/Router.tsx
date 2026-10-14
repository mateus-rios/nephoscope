import type { LogExclusionView, LogSink, SinkDestinationKind } from '@nephoscope/contracts';
import { PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono } from '../../design/Values';
import { EquivalentCommand, sh } from '../../kit/EquivalentCommand';
import { ApiError } from '../../lib/api';
import { deleteExclusion, deleteSink, useExclusions, useSaveExclusion, useSaveSink, useSinks } from './api';

const KIND_LABEL: Record<SinkDestinationKind, string> = {
  storage: 'Cloud Storage bucket',
  bigquery: 'BigQuery dataset',
  pubsub: 'Pub/Sub topic',
  logbucket: 'Log bucket',
  project: 'Another project',
  other: 'Other',
};

const PREFIX: Record<Exclude<SinkDestinationKind, 'other'>, (p: string) => string> = {
  storage: () => 'storage.googleapis.com/',
  bigquery: (p) => `bigquery.googleapis.com/projects/${p}/datasets/`,
  pubsub: (p) => `pubsub.googleapis.com/projects/${p}/topics/`,
  logbucket: (p) => `logging.googleapis.com/projects/${p}/locations/global/buckets/`,
  project: () => 'logging.googleapis.com/projects/',
};

/** The command that grants a sink's writer identity its role on the destination (SPEC-0005 CA-06). */
export function grantCommand(sink: Pick<LogSink, 'destination' | 'destinationKind' | 'writerIdentity' | 'requiredRole'>): string | null {
  if (!sink.writerIdentity || !sink.requiredRole) return null;
  const member = sh(sink.writerIdentity);
  const role = sink.requiredRole;
  const d = sink.destination;
  switch (sink.destinationKind) {
    case 'storage':
      return `gcloud storage buckets add-iam-policy-binding gs://${d.replace('storage.googleapis.com/', '')} --member=${member} --role=${role}`;
    case 'pubsub': {
      const m = /projects\/([^/]+)\/topics\/(.+)$/.exec(d);
      return m ? `gcloud pubsub topics add-iam-policy-binding ${m[2]} --project=${m[1]} --member=${member} --role=${role}` : null;
    }
    case 'bigquery': {
      const m = /projects\/([^/]+)\/datasets\/(.+)$/.exec(d);
      return m ? `bq add-iam-policy-binding --member=${member} --role=${role} ${m[1]}:${m[2]}` : null;
    }
    case 'logbucket':
    case 'project': {
      const m = /projects\/([^/]+)/.exec(d);
      return m ? `gcloud projects add-iam-policy-binding ${m[1]} --member=${member} --role=${role}` : null;
    }
    default:
      return null;
  }
}

interface ExclusionRow {
  name: string;
  filter: string;
  disabled: boolean;
}

function SinkSheet({
  projectId,
  sink,
  open,
  onOpenChange,
  readOnly,
}: {
  projectId: string;
  sink: LogSink | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnly: string | null;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Exclude<SinkDestinationKind, 'other'>>('storage');
  const [target, setTarget] = useState('');
  const [filter, setFilter] = useState('');
  const [description, setDescription] = useState('');
  const [disabled, setDisabled] = useState(false);
  const [exclusions, setExclusions] = useState<ExclusionRow[]>([]);
  const [result, setResult] = useState<LogSink | null>(null);
  const save = useSaveSink(projectId, sink?.name ?? null);
  useEffect(() => {
    if (!open) return;
    setResult(null);
    setName(sink?.name ?? '');
    const k = sink && sink.destinationKind !== 'other' ? sink.destinationKind : 'storage';
    setKind(k);
    setTarget(sink ? sink.destination.replace(PREFIX[k](projectId), '') : '');
    setFilter(sink?.filter ?? '');
    setDescription(sink?.description ?? '');
    setDisabled(sink?.disabled ?? false);
    setExclusions(sink?.exclusions.map((e) => ({ name: e.name, filter: e.filter, disabled: e.disabled })) ?? []);
  }, [open, sink, projectId]);
  const destination = `${PREFIX[kind](projectId)}${target.trim()}`;
  const nameError = /^[A-Za-z0-9_.-]{1,100}$/.test(name) ? null : 'Letters, digits, underscores, periods and hyphens.';
  const required = sink?.builtIn === '_Required';
  const grant = result ? grantCommand(result) : null;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={sink ? `Edit sink ${sink.name}` : 'Create sink'}
      description="A sink routes the entries that match its filter to a destination."
      footer={
        result ? (
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        ) : (
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="commit"
              loading={save.isPending}
              disabled={!!readOnly || !!nameError || !target.trim() || required}
              disabledReason={readOnly ?? (required ? 'The _Required sink cannot be changed' : (nameError ?? 'Name the destination'))}
              onClick={() =>
                save.mutate(
                  {
                    name,
                    destination,
                    filter,
                    description: description || undefined,
                    disabled,
                    exclusions: exclusions
                      .filter((e) => e.name && e.filter)
                      .map((e) => ({ name: e.name, filter: e.filter, disabled: e.disabled })),
                  },
                  { onSuccess: (s) => setResult(s) },
                )
              }
            >
              {sink ? 'Save sink' : 'Create sink'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <StatusGlyph kind="ok" label={`Sink ${result.name} saved`} />
          {result.writerIdentity ? (
            <>
              <p className="m-0 text-dense text-ink">
                The sink writes as <Mono value={result.writerIdentity} copy />. Grant it{' '}
                <code className="font-mono text-[12px]">{result.requiredRole}</code> on the destination, or nothing arrives there.
              </p>
              {grant ? <EquivalentCommand gcloud={grant} /> : null}
            </>
          ) : (
            <p className="m-0 text-dense text-ink-2">This destination needs no grant: the sink writes with the project's own identity.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Name" required error={name && nameError ? nameError : undefined}>
            <Input mono value={name} onChange={(e) => setName(e.target.value)} disabled={!!sink} />
          </Field>
          <div className="grid grid-cols-[12rem_1fr] gap-3">
            <Field label="Destination">
              <Select<Exclude<SinkDestinationKind, 'other'>>
                value={kind}
                onValueChange={setKind}
                options={(Object.keys(PREFIX) as Exclude<SinkDestinationKind, 'other'>[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              />
            </Field>
            <Field label={kind === 'project' ? 'Project id' : 'Name'} help={<span className="font-mono text-[11px]">{destination}</span>}>
              <Input mono value={target} onChange={(e) => setTarget(e.target.value)} />
            </Field>
          </div>
          <Field label="Inclusion filter (LQL)" help="Empty routes every entry.">
            <CodeEditor value={filter} onChange={setFilter} language="lql" height={100} label="Inclusion filter" />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Switch checked={disabled} onCheckedChange={setDisabled} label="Disabled" description="A disabled sink routes nothing." />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-dense font-medium text-ink">Exclusion filters</span>
              <Button size="sm" icon={PlusIcon} onClick={() => setExclusions((p) => [...p, { name: '', filter: '', disabled: false }])}>
                Add exclusion
              </Button>
            </div>
            {exclusions.map((e, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place and have no id yet.
              <div key={i} className="grid grid-cols-[10rem_1fr_auto] items-end gap-2">
                <Field label="Name">
                  <Input
                    mono
                    value={e.name}
                    onChange={(ev) => setExclusions((p) => p.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))}
                  />
                </Field>
                <Field label="Filter">
                  <Input
                    mono
                    value={e.filter}
                    onChange={(ev) => setExclusions((p) => p.map((x, j) => (j === i ? { ...x, filter: ev.target.value } : x)))}
                  />
                </Field>
                <IconButton icon={TrashIcon} label="Remove exclusion" onClick={() => setExclusions((p) => p.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
          <EquivalentCommand
            gcloud={`gcloud logging sinks ${sink ? 'update' : 'create'} ${name || 'SINK'} ${sh(destination)}${filter.trim() ? ` --log-filter=${sh(filter.trim())}` : ''} --project=${projectId}`}
          />
        </div>
      )}
    </Sheet>
  );
}

function ExclusionSheet({
  projectId,
  exclusion,
  open,
  onOpenChange,
  readOnly,
}: {
  projectId: string;
  exclusion: LogExclusionView | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnly: string | null;
}) {
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const [description, setDescription] = useState('');
  const [disabled, setDisabled] = useState(false);
  const save = useSaveExclusion(projectId, exclusion?.name.split('/').pop() ?? null);
  useEffect(() => {
    if (!open) return;
    setName(exclusion?.name.split('/').pop() ?? '');
    setFilter(exclusion?.filter ?? '');
    setDescription(exclusion?.description ?? '');
    setDisabled(exclusion?.disabled ?? false);
  }, [open, exclusion]);
  const ok = /^[A-Za-z0-9_.-]{1,100}$/.test(name) && filter.trim().length > 0;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={exclusion ? `Edit exclusion ${name}` : 'Create exclusion'}
      description="Entries that match an exclusion are dropped before any sink sees them, and are not billed."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={save.isPending}
            disabled={!!readOnly || !ok}
            disabledReason={readOnly ?? 'Name and filter are required'}
            onClick={() =>
              save.mutate({ name, filter, description: description || undefined, disabled }, { onSuccess: () => onOpenChange(false) })
            }
          >
            {exclusion ? 'Save exclusion' : 'Create exclusion'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required>
          <Input mono value={name} onChange={(e) => setName(e.target.value)} disabled={!!exclusion} />
        </Field>
        <Field label="Filter (LQL)" required>
          <CodeEditor value={filter} onChange={setFilter} language="lql" height={100} label="Exclusion filter" />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Switch checked={disabled} onCheckedChange={setDisabled} label="Disabled" />
      </div>
    </Sheet>
  );
}

/** Log Router: sinks and exclusions (SPEC-0005 D-05, CA-06). */
export function Router({ projectId, readOnly }: { projectId: string; readOnly: string | null }) {
  const sinks = useSinks(projectId);
  const exclusions = useExclusions(projectId);
  const [editing, setEditing] = useState<LogSink | null | 'new'>(null);
  const [deleting, setDeleting] = useState<LogSink | null>(null);
  const [editingEx, setEditingEx] = useState<LogExclusionView | null | 'new'>(null);
  const [deletingEx, setDeletingEx] = useState<LogExclusionView | null>(null);
  const sinkColumns: ResourceColumn<LogSink>[] = [
    {
      id: 'name',
      header: 'Sink',
      hideable: false,
      sortValue: (s) => s.name,
      cell: (s) => (
        <span className="flex items-center gap-2">
          <span className="truncate font-medium text-ink">{s.name}</span>
          {s.builtIn ? <span className="text-meta text-ink-3">Built in</span> : null}
        </span>
      ),
    },
    {
      id: 'state',
      header: 'State',
      width: '8rem',
      cell: (s) => (s.disabled ? <StatusGlyph kind="paused" label="Disabled" /> : <StatusGlyph kind="ok" label="Routing" />),
    },
    {
      id: 'kind',
      header: 'Destination type',
      width: '11rem',
      sortValue: (s) => s.destinationKind,
      cell: (s) => KIND_LABEL[s.destinationKind],
    },
    { id: 'destination', header: 'Destination', cell: (s) => <Mono value={s.destination} /> },
    {
      id: 'filter',
      header: 'Filter',
      cell: (s) => (s.filter ? <Mono value={s.filter} /> : <span className="text-ink-3">Every entry</span>),
    },
    {
      id: 'writer',
      header: 'Writer identity',
      defaultHidden: true,
      cell: (s) => (s.writerIdentity ? <Mono value={s.writerIdentity} /> : null),
    },
    {
      id: 'actions',
      header: 'Actions',
      width: '6rem',
      hideable: false,
      cell: (s) =>
        s.builtIn ? null : (
          <IconButton icon={TrashIcon} label={`Delete ${s.name}`} size="sm" disabled={!!readOnly} onClick={() => setDeleting(s)} />
        ),
    },
  ];
  const exColumns: ResourceColumn<LogExclusionView>[] = [
    {
      id: 'name',
      header: 'Exclusion',
      hideable: false,
      sortValue: (e) => e.name,
      cell: (e) => <span className="font-medium text-ink">{e.name.split('/').pop()}</span>,
    },
    {
      id: 'state',
      header: 'State',
      width: '8rem',
      cell: (e) => (e.disabled ? <StatusGlyph kind="paused" label="Disabled" /> : <StatusGlyph kind="ok" label="Excluding" />),
    },
    { id: 'filter', header: 'Filter', cell: (e) => <Mono value={e.filter} /> },
    {
      id: 'actions',
      header: 'Actions',
      width: '6rem',
      hideable: false,
      cell: (e) => (
        <IconButton icon={TrashIcon} label={`Delete ${e.name}`} size="sm" disabled={!!readOnly} onClick={() => setDeletingEx(e)} />
      ),
    },
  ];
  return (
    <>
      <Section
        title="Sinks"
        description="Where log entries go. _Required keeps audit logs and cannot be changed; _Default stores the rest."
        actions={
          <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setEditing('new')}>
            Create sink
          </Button>
        }
      >
        {sinks.isPending ? (
          <DelayedSkeleton />
        ) : sinks.error instanceof ApiError ? (
          <ProblemState problem={sinks.error.problem} onRetry={() => void sinks.refetch()} />
        ) : (
          <ResourceTable
            tableId="logging-sinks"
            label="Sinks"
            rows={sinks.data ?? []}
            columns={sinkColumns}
            getRowId={(s) => s.name}
            onOpen={(s) => setEditing(s)}
            emptyTitle="No sinks"
            emptyText="A sink routes log entries to Cloud Storage, BigQuery, Pub/Sub, a log bucket or another project."
          />
        )}
      </Section>
      <Section
        title="Exclusions"
        description="Project-level exclusions drop matching entries for every sink."
        actions={
          <Button icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setEditingEx('new')}>
            Create exclusion
          </Button>
        }
      >
        {exclusions.isPending ? (
          <DelayedSkeleton />
        ) : exclusions.error instanceof ApiError ? (
          <ProblemState problem={exclusions.error.problem} onRetry={() => void exclusions.refetch()} />
        ) : (
          <ResourceTable
            tableId="logging-exclusions"
            label="Exclusions"
            rows={exclusions.data ?? []}
            columns={exColumns}
            getRowId={(e) => e.name}
            onOpen={(e) => setEditingEx(e)}
            emptyTitle="No exclusions"
            emptyText="Exclusions drop noisy entries before they are stored or routed."
          />
        )}
      </Section>
      <SinkSheet
        projectId={projectId}
        sink={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        readOnly={readOnly}
      />
      <ExclusionSheet
        projectId={projectId}
        exclusion={editingEx === 'new' ? null : editingEx}
        open={editingEx !== null}
        onOpenChange={(o) => !o && setEditingEx(null)}
        readOnly={readOnly}
      />
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete sink"
        consequence={`Entries stop going to ${deleting?.destination ?? ''}. What was already routed stays there.`}
        expected={deleting?.name ?? ''}
        confirmLabel="Delete sink"
        command={`gcloud logging sinks delete ${deleting?.name ?? ''} --project=${projectId}`}
        onConfirm={async (c) => {
          if (deleting) await deleteSink(projectId, deleting.name, c);
          void sinks.refetch();
        }}
      />
      <ConfirmDestructive
        open={deletingEx !== null}
        onOpenChange={(o) => !o && setDeletingEx(null)}
        title="Delete exclusion"
        consequence="Entries that matched it are stored and routed again from now on."
        expected={deletingEx?.name.split('/').pop() ?? ''}
        confirmLabel="Delete exclusion"
        onConfirm={async (c) => {
          if (deletingEx) await deleteExclusion(projectId, deletingEx.name.split('/').pop() ?? '', c);
          void exclusions.refetch();
        }}
      />
    </>
  );
}
