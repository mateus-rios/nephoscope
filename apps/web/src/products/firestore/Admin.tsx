import type {
  BackupSchedule,
  FieldOverride,
  FirestoreBackup,
  FirestoreDatabase,
  FirestoreIndex,
  FirestoreOperation,
  ImportMode,
} from '@nephoscope/contracts';
import { parseTypedDocuments } from '@nephoscope/contracts/firestore-value';
import {
  ClockClockwiseIcon,
  CopyIcon,
  DownloadSimpleIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  UploadSimpleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Legend, type Note, Notes, Section } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Dialog, Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph, type StatusKind } from '../../design/Status';
import { TabNav } from '../../design/TabNav';
import { Mono, Timestamp } from '../../design/Values';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { MetricsPanel } from '../../kit/MetricsPanel';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { bytes, duration } from '../../lib/format';
import { useOperations } from '../../state/operations';
import {
  bulkDelete,
  deleteBackup,
  deleteDatabase,
  deleteIndex,
  deleteSchedule,
  importBatch,
  restoreBackup,
  useAdminOperations,
  useBackups,
  useCloneDatabase,
  useCreateIndex,
  useExportDocuments,
  useFields,
  useImportDocuments,
  useIndexes,
  useInvalidateData,
  useSaveSchedule,
  useSchedules,
  useSetFieldIndexes,
  useSetTtl,
  useUpdateDatabase,
} from './api';
import type { DbContext } from './Documents';

export interface AdminContext extends DbContext {
  database: FirestoreDatabase;
}

/** Admin features the emulator does not have (D-18). */
function EmulatorOnly({ feature }: { feature: string }) {
  return (
    <EmptyState title={`${feature} is not available in the emulator`}>
      The Firestore emulator only serves data. Connect a real project to manage {feature.toLowerCase()}.
    </EmptyState>
  );
}

const indexState = (s: FirestoreIndex['state']): { kind: StatusKind; label: string } =>
  s === 'ready'
    ? { kind: 'ok', label: 'Ready' }
    : s === 'creating'
      ? { kind: 'running', label: 'Building' }
      : s === 'needs_repair'
        ? { kind: 'error', label: 'Needs repair' }
        : { kind: 'unknown', label: 'Unknown' };

const fieldSummary = (f: FirestoreIndex['fields'][number]) =>
  `${f.fieldPath} ${f.arrayConfig ? 'array-contains' : f.vectorDimension ? `vector(${f.vectorDimension})` : f.order === 'DESCENDING' ? 'desc' : 'asc'}`;

// ---- indexes -------------------------------------------------------------------------------------------

type IndexMode = 'ASCENDING' | 'DESCENDING' | 'CONTAINS' | 'VECTOR';
let fieldKey = 1;

function CreateIndexSheet({ ctx, open, onOpenChange }: { ctx: AdminContext; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [group, setGroup] = useState('');
  const [scope, setScope] = useState<'COLLECTION' | 'COLLECTION_GROUP'>('COLLECTION');
  const [fields, setFields] = useState<{ key: number; path: string; mode: IndexMode; dim: string }[]>([]);
  const create = useCreateIndex(ctx.projectId, ctx.databaseId);
  useEffect(() => {
    if (open) {
      setGroup('');
      setScope('COLLECTION');
      setFields([
        { key: fieldKey++, path: '', mode: 'ASCENDING', dim: '' },
        { key: fieldKey++, path: '', mode: 'ASCENDING', dim: '' },
      ]);
    }
  }, [open]);
  const valid = group.trim() && fields.length >= 1 && fields.every((f) => f.path.trim() && (f.mode !== 'VECTOR' || Number(f.dim) > 0));
  const body = {
    collectionGroup: group.trim(),
    queryScope: scope,
    fields: fields.map((f) =>
      f.mode === 'CONTAINS'
        ? { fieldPath: f.path.trim(), arrayConfig: 'CONTAINS' as const }
        : f.mode === 'VECTOR'
          ? { fieldPath: f.path.trim(), vectorDimension: Number(f.dim) }
          : { fieldPath: f.path.trim(), order: f.mode },
    ),
  };
  const gcloudField = (f: (typeof fields)[number]) =>
    `--field-config=field-path=${f.path || 'FIELD'},${f.mode === 'CONTAINS' ? 'array-config=contains' : f.mode === 'VECTOR' ? `vector-config='{"dimension":"${f.dim || 'N'}","flat":"{}"}'` : `order=${f.mode.toLowerCase()}`}`;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create composite index"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PlusIcon}
            loading={create.isPending}
            disabled={!valid || !!ctx.readOnly}
            disabledReason={ctx.readOnly ?? (valid ? null : 'Name the collection group and every field')}
            onClick={() => create.mutate(body, { onSuccess: () => onOpenChange(false) })}
          >
            Create index
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Collection group" required>
            <Input mono value={group} onChange={(e) => setGroup(e.target.value)} placeholder="orders" />
          </Field>
          <Field label="Query scope">
            <Select<'COLLECTION' | 'COLLECTION_GROUP'>
              value={scope}
              onValueChange={setScope}
              options={[
                { value: 'COLLECTION', label: 'Collection' },
                { value: 'COLLECTION_GROUP', label: 'Collection group' },
              ]}
            />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <Legend>Fields, in order</Legend>
          {fields.map((f, i) => (
            <div key={f.key} className="grid grid-cols-[minmax(0,1fr)_10rem_5rem_auto] items-center gap-2">
              <Input
                mono
                value={f.path}
                onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))}
                aria-label={`Field ${i + 1}`}
              />
              <Select<IndexMode>
                value={f.mode}
                onValueChange={(mode) => setFields(fields.map((x, j) => (j === i ? { ...x, mode } : x)))}
                aria-label={`Mode of field ${i + 1}`}
                options={[
                  { value: 'ASCENDING', label: 'Ascending' },
                  { value: 'DESCENDING', label: 'Descending' },
                  { value: 'CONTAINS', label: 'Array contains' },
                  { value: 'VECTOR', label: 'Vector' },
                ]}
              />
              {f.mode === 'VECTOR' ? (
                <Input
                  mono
                  value={f.dim}
                  onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, dim: e.target.value.replace(/\D/g, '') } : x)))}
                  placeholder="Dims"
                  aria-label="Vector dimension"
                />
              ) : (
                <span />
              )}
              <IconButton
                icon={XIcon}
                label="Remove field"
                size="sm"
                onClick={() => setFields(fields.filter((_, j) => j !== i))}
                disabled={fields.length <= 1}
              />
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="ghost"
              icon={PlusIcon}
              onClick={() => setFields([...fields, { key: fieldKey++, path: '', mode: 'ASCENDING', dim: '' }])}
            >
              Field
            </Button>
          </div>
        </div>
        <EquivalentCommand
          gcloud={`gcloud firestore indexes composite create --collection-group=${group || 'GROUP'} --query-scope=${scope === 'COLLECTION' ? 'collection' : 'collection-group'} ${fields.map(gcloudField).join(' ')} --database=${ctx.databaseId} --project=${ctx.projectId}`}
        />
      </div>
    </Sheet>
  );
}

function SingleFieldDialog({
  ctx,
  target,
  onOpenChange,
}: {
  ctx: AdminContext;
  target: { group: string; field: string; current: FieldOverride | null } | null;
  onOpenChange: (o: boolean) => void;
}) {
  const set = useSetFieldIndexes(ctx.projectId, ctx.databaseId);
  const [group, setGroup] = useState('');
  const [field, setField] = useState('');
  const [modes, setModes] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!target) return;
    setGroup(target.group);
    setField(target.field);
    const m: Record<string, boolean> = {};
    for (const i of target.current?.indexes ?? []) m[`${i.queryScope}:${i.arrayConfig ?? i.order}`] = true;
    setModes(m);
  }, [target]);
  const KINDS = ['ASCENDING', 'DESCENDING', 'CONTAINS'] as const;
  const SCOPES = ['COLLECTION', 'COLLECTION_GROUP'] as const;
  const indexes = SCOPES.flatMap((scope) =>
    KINDS.filter((k) => modes[`${scope}:${k}`]).map((k) =>
      k === 'CONTAINS' ? { queryScope: scope, arrayConfig: 'CONTAINS' as const } : { queryScope: scope, order: k },
    ),
  );
  const save = (value: typeof indexes | null) =>
    set.mutate({ collectionGroup: group.trim(), fieldPath: field.trim(), indexes: value }, { onSuccess: () => onOpenChange(false) });
  return (
    <Dialog
      open={target !== null}
      onOpenChange={onOpenChange}
      title="Single-field indexes"
      width="md"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          {target?.current ? <Button onClick={() => save(null)}>Restore the default</Button> : null}
          <Button onClick={() => save([])} disabled={!group || !field}>
            Exempt the field
          </Button>
          <Button
            variant="commit"
            loading={set.isPending}
            disabled={!group || !field || !!ctx.readOnly}
            disabledReason={ctx.readOnly}
            onClick={() => save(indexes)}
          >
            Save indexes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Collection group">
            <Input mono value={group} onChange={(e) => setGroup(e.target.value)} disabled={!!target?.current} />
          </Field>
          <Field label="Field path">
            <Input mono value={field} onChange={(e) => setField(e.target.value)} disabled={!!target?.current} />
          </Field>
        </div>
        <table className="border-collapse text-dense">
          <thead>
            <tr>
              <th className="legend py-1 pr-4 text-left">Index</th>
              <th className="legend py-1 pr-4 text-left">Collection</th>
              <th className="legend py-1 text-left">Collection group</th>
            </tr>
          </thead>
          <tbody>
            {KINDS.map((k) => (
              <tr key={k} className="border-t border-rule">
                <td className="py-1 pr-4">{k === 'CONTAINS' ? 'Array contains' : k === 'ASCENDING' ? 'Ascending' : 'Descending'}</td>
                {SCOPES.map((s) => (
                  <td key={s} className="py-1 pr-4">
                    <input
                      type="checkbox"
                      aria-label={`${k} for ${s === 'COLLECTION' ? 'collection' : 'collection group'} queries`}
                      checked={!!modes[`${s}:${k}`]}
                      onChange={(e) => setModes({ ...modes, [`${s}:${k}`]: e.target.checked })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="m-0 text-meta text-ink-3">
          Exempting a field turns off its automatic indexes: queries that filter or order on it alone stop working, and writes get cheaper.
        </p>
      </div>
    </Dialog>
  );
}

export function IndexesTab({ ctx }: { ctx: AdminContext }) {
  const [view, setView] = useSearchState<'composite' | 'single'>('indexes', 'composite', ['composite', 'single']);
  const indexes = useIndexes(ctx.projectId, ctx.databaseId);
  const overrides = useFields(ctx.projectId, ctx.databaseId, 'overrides');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FirestoreIndex | null>(null);
  const [editing, setEditing] = useState<{ group: string; field: string; current: FieldOverride | null } | null>(null);
  if (ctx.database.emulator) return <EmulatorOnly feature="Indexes" />;
  const columns: ResourceColumn<FirestoreIndex>[] = [
    {
      id: 'group',
      header: 'Collection group',
      width: '12rem',
      hideable: false,
      sortValue: (i) => i.collectionGroup,
      cell: (i) => <span className="font-mono text-[12px]">{i.collectionGroup}</span>,
    },
    { id: 'fields', header: 'Fields', cell: (i) => <span className="font-mono text-[12px]">{i.fields.map(fieldSummary).join(', ')}</span> },
    {
      id: 'scope',
      header: 'Scope',
      width: '9rem',
      sortValue: (i) => i.queryScope,
      cell: (i) => (i.queryScope === 'COLLECTION_GROUP' ? 'Collection group' : 'Collection'),
    },
    { id: 'state', header: 'State', width: '9rem', sortValue: (i) => i.state, cell: (i) => <StatusGlyph {...indexState(i.state)} /> },
    {
      id: 'actions',
      header: 'Actions',
      width: '6rem',
      hideable: false,
      cell: (i) => (
        <Button
          size="sm"
          variant="ghost"
          icon={TrashIcon}
          onClick={() => setDeleting(i)}
          disabled={!!ctx.readOnly}
          disabledReason={ctx.readOnly}
        >
          Delete
        </Button>
      ),
    },
  ];
  const overrideColumns: ResourceColumn<FieldOverride>[] = [
    {
      id: 'group',
      header: 'Collection group',
      width: '12rem',
      hideable: false,
      sortValue: (f) => f.collectionGroup,
      cell: (f) => (
        <span className="font-mono text-[12px]">{f.collectionGroup === '__default__' ? 'Database default' : f.collectionGroup}</span>
      ),
    },
    {
      id: 'field',
      header: 'Field',
      width: '12rem',
      sortValue: (f) => f.fieldPath,
      cell: (f) => <span className="font-mono text-[12px]">{f.fieldPath}</span>,
    },
    {
      id: 'indexes',
      header: 'Indexes',
      cell: (f) =>
        f.indexes.length === 0 ? (
          <span className="text-ink-2">Exempted</span>
        ) : (
          <span className="text-meta">
            {f.indexes
              .map(
                (i) =>
                  `${i.arrayConfig ? 'array-contains' : (i.order ?? '').toLowerCase()} (${i.queryScope === 'COLLECTION' ? 'collection' : 'group'})`,
              )
              .join(', ')}
          </span>
        ),
    },
    {
      id: 'actions',
      header: 'Actions',
      width: '6rem',
      hideable: false,
      cell: (f) => (
        <Button
          size="sm"
          variant="ghost"
          icon={PencilSimpleIcon}
          onClick={() => setEditing({ group: f.collectionGroup, field: f.fieldPath, current: f })}
          disabled={!!ctx.readOnly}
        >
          Edit
        </Button>
      ),
    },
  ];
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-4 px-6 pt-3">
        <TabNav
          label="Index kinds"
          active={view}
          onSelect={(k) => setView(k as 'composite' | 'single')}
          items={[
            { key: 'composite', label: 'Composite', count: indexes.data?.length ?? null },
            { key: 'single', label: 'Single-field overrides', count: overrides.data?.length ?? null },
          ]}
        />
        {view === 'composite' ? (
          <Button
            variant="commit"
            icon={PlusIcon}
            onClick={() => setCreating(true)}
            disabled={!!ctx.readOnly}
            disabledReason={ctx.readOnly}
          >
            Create index
          </Button>
        ) : (
          <Button
            variant="commit"
            icon={PlusIcon}
            onClick={() => setEditing({ group: '', field: '', current: null })}
            disabled={!!ctx.readOnly}
            disabledReason={ctx.readOnly}
          >
            Add override
          </Button>
        )}
      </div>
      <div className="pt-3">
        {view === 'composite' ? (
          indexes.isPending ? (
            <DelayedSkeleton />
          ) : indexes.error instanceof ApiError ? (
            <ProblemState problem={indexes.error.problem} onRetry={() => void indexes.refetch()} />
          ) : (
            <ResourceTable
              tableId="firestore-indexes"
              label="Composite indexes"
              rows={indexes.data ?? []}
              columns={columns}
              getRowId={(i) => i.name}
              emptyTitle="No composite indexes"
              emptyText="Queries that filter or order on several fields need one. Nephoscope offers to create it when a query fails for lack of an index."
            />
          )
        ) : overrides.isPending ? (
          <DelayedSkeleton />
        ) : overrides.error instanceof ApiError ? (
          <ProblemState problem={overrides.error.problem} onRetry={() => void overrides.refetch()} />
        ) : (
          <ResourceTable
            tableId="firestore-overrides"
            label="Single-field overrides"
            rows={overrides.data ?? []}
            columns={overrideColumns}
            getRowId={(f) => f.name}
            emptyTitle="No overrides"
            emptyText="Every field uses the database's automatic single-field indexes."
          />
        )}
      </div>
      <CreateIndexSheet ctx={ctx} open={creating} onOpenChange={setCreating} />
      <SingleFieldDialog ctx={ctx} target={editing} onOpenChange={(o) => !o && setEditing(null)} />
      {deleting ? (
        <ConfirmDestructive
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title="Delete index"
          consequence={
            <>
              Queries that need the index on <Mono value={deleting.collectionGroup} /> ({deleting.fields.map(fieldSummary).join(', ')}) fail
              until it is created again.
            </>
          }
          expected={deleting.id}
          confirmLabel="Delete index"
          onConfirm={async () => {
            await deleteIndex(ctx.projectId, ctx.databaseId, deleting.name);
            toast.success('Index deleted');
            void indexes.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

// ---- TTL ---------------------------------------------------------------------------------------------------

export function TtlTab({ ctx }: { ctx: AdminContext }) {
  const q = useFields(ctx.projectId, ctx.databaseId, 'ttl');
  const setTtl = useSetTtl(ctx.projectId, ctx.databaseId);
  const [adding, setAdding] = useState(false);
  const [group, setGroup] = useState('');
  const [field, setField] = useState('');
  if (ctx.database.emulator) return <EmulatorOnly feature="TTL policies" />;
  const columns: ResourceColumn<FieldOverride>[] = [
    {
      id: 'group',
      header: 'Collection group',
      width: '14rem',
      hideable: false,
      sortValue: (f) => f.collectionGroup,
      cell: (f) => <span className="font-mono text-[12px]">{f.collectionGroup}</span>,
    },
    {
      id: 'field',
      header: 'Timestamp field',
      sortValue: (f) => f.fieldPath,
      cell: (f) => <span className="font-mono text-[12px]">{f.fieldPath}</span>,
    },
    {
      id: 'state',
      header: 'State',
      width: '10rem',
      cell: (f) =>
        f.ttl === 'active' ? (
          <StatusGlyph kind="ok" label="Active" />
        ) : f.ttl === 'creating' ? (
          <StatusGlyph kind="running" label="Turning on" />
        ) : (
          <StatusGlyph kind="error" label="Needs repair" />
        ),
    },
    {
      id: 'actions',
      header: 'Actions',
      width: '7rem',
      hideable: false,
      cell: (f) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setTtl.mutate({ collectionGroup: f.collectionGroup, fieldPath: f.fieldPath, enabled: false })}
          disabled={!!ctx.readOnly}
          disabledReason={ctx.readOnly}
        >
          Turn off
        </Button>
      ),
    },
  ];
  return (
    <div className="flex flex-col">
      <Notes
        notes={[
          {
            id: 'ttl',
            tone: 'warn',
            text: 'Documents are deleted some time after the timestamp in the field passes, usually within 24 hours. Deletions cannot be undone and do not run delete triggers in order.',
          },
        ]}
      />
      <div className="flex justify-end px-6 pt-3">
        <Button variant="commit" icon={PlusIcon} onClick={() => setAdding(true)} disabled={!!ctx.readOnly} disabledReason={ctx.readOnly}>
          Add TTL policy
        </Button>
      </div>
      <div className="pt-3">
        {q.isPending ? (
          <DelayedSkeleton />
        ) : q.error instanceof ApiError ? (
          <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
        ) : (
          <ResourceTable
            tableId="firestore-ttl"
            label="TTL policies"
            rows={q.data ?? []}
            columns={columns}
            getRowId={(f) => f.name}
            emptyTitle="No TTL policies"
            emptyText="A policy deletes documents after the time stored in one of their timestamp fields."
          />
        )}
      </div>
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Add TTL policy"
        width="sm"
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              variant="commit"
              loading={setTtl.isPending}
              disabled={!group.trim() || !field.trim()}
              onClick={() =>
                setTtl.mutate(
                  { collectionGroup: group.trim(), fieldPath: field.trim(), enabled: true },
                  { onSuccess: () => setAdding(false) },
                )
              }
            >
              Turn on TTL
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Collection group">
            <Input mono value={group} onChange={(e) => setGroup(e.target.value)} placeholder="sessions" />
          </Field>
          <Field label="Timestamp field" help="Documents whose field holds a past timestamp are deleted. Other values are ignored.">
            <Input mono value={field} onChange={(e) => setField(e.target.value)} placeholder="expiresAt" />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

// ---- transfer: browser import, managed export and import, bulk delete ----------------------------------------------

function BrowserImport({ ctx }: { ctx: AdminContext }) {
  const [collection, setCollection] = useState('');
  const [mode, setMode] = useState<ImportMode>('skip');
  const [file, setFile] = useState<{ name: string; docs: { id?: string; fields: Record<string, never> }[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    written: number;
    skipped: number;
    failures: { id: string; error: string }[];
    running: boolean;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const stop = useRef(false);
  const invalidate = useInvalidateData(ctx.projectId, ctx.databaseId);

  const start = async () => {
    if (!file) return;
    stop.current = false;
    const state = { done: 0, written: 0, skipped: 0, failures: [] as { id: string; error: string }[], running: true };
    setProgress({ ...state });
    for (let i = 0; i < file.docs.length; i += 500) {
      if (stop.current) break;
      const batch = file.docs.slice(i, i + 500);
      try {
        const r = await importBatch(ctx.projectId, ctx.databaseId, { collection: collection.trim(), mode, documents: batch });
        state.written += r.written;
        state.skipped += r.skipped;
        state.failures.push(...r.failures);
      } catch (err) {
        state.failures.push(
          ...batch.map((d) => ({ id: d.id ?? '(generated)', error: err instanceof ApiError ? err.problem.detail : String(err) })),
        );
      }
      state.done = Math.min(file.docs.length, i + batch.length);
      setProgress({ ...state });
    }
    state.running = false;
    setProgress({ ...state });
    void invalidate();
  };

  return (
    <Section
      title="Import documents"
      description="A typed JSON array or NDJSON file, as Nephoscope exports them. A $id key names each document; without it the id is generated."
    >
      <div className="flex flex-col gap-3 px-6">
        <div className="grid max-w-3xl grid-cols-[minmax(0,1fr)_12rem] gap-3">
          <Field label="Into collection">
            <Input mono value={collection} onChange={(e) => setCollection(e.target.value)} placeholder="users" />
          </Field>
          <Field label="Existing documents">
            <Select<ImportMode>
              value={mode}
              onValueChange={setMode}
              options={[
                { value: 'skip', label: 'Skip them' },
                { value: 'overwrite', label: 'Overwrite them' },
                { value: 'merge', label: 'Merge fields' },
              ]}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-dense">
            <span className="sr-only">File to import</span>
            <input
              type="file"
              accept=".json,.ndjson,.jsonl,application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const r = parseTypedDocuments(await f.text(), {
                  documentsRoot: `projects/${ctx.projectId}/databases/${ctx.databaseId}/documents`,
                });
                if (!r.ok) {
                  setFile(null);
                  setParseError(`Document ${r.error.document}, line ${r.error.line}: ${r.error.message}`);
                } else {
                  setParseError(null);
                  setFile({ name: f.name, docs: r.documents as never });
                  setProgress(null);
                }
              }}
            />
          </label>
          {file ? (
            <span className="text-meta text-ink-2">
              {file.docs.length.toLocaleString('en-US')} documents in {file.name}
            </span>
          ) : null}
        </div>
        {parseError ? <p className="m-0 text-meta text-redline-ink">{parseError}</p> : null}
        <div className="flex items-center gap-2">
          <Button
            variant="commit"
            icon={UploadSimpleIcon}
            disabled={
              !file || !collection.trim() || collection.split('/').filter(Boolean).length % 2 !== 1 || progress?.running || !!ctx.readOnly
            }
            disabledReason={ctx.readOnly ?? (!file ? 'Choose a file' : 'Enter a collection path')}
            onClick={() => (file && file.docs.length > 1000 ? setConfirming(true) : void start())}
          >
            Import {file ? file.docs.length.toLocaleString('en-US') : ''} documents
          </Button>
          {progress?.running ? (
            <Button
              onClick={() => {
                stop.current = true;
              }}
            >
              Stop after this batch
            </Button>
          ) : null}
        </div>
        {progress ? (
          <div className="flex flex-col gap-1 text-dense">
            <progress max={file?.docs.length ?? 1} value={progress.done} className="h-1.5 w-full max-w-xl" aria-label="Import progress" />
            <span className="tnum text-ink-2">
              {progress.done.toLocaleString('en-US')} of {file?.docs.length.toLocaleString('en-US')} sent:{' '}
              {progress.written.toLocaleString('en-US')} written, {progress.skipped.toLocaleString('en-US')} skipped,{' '}
              {progress.failures.length.toLocaleString('en-US')} failed{progress.running ? '' : '.'}
            </span>
            {progress.failures.length > 0 ? (
              <ul className="m-0 max-h-40 list-none overflow-auto p-0 font-mono text-[11px] text-redline-ink">
                {progress.failures.slice(0, 200).map((f) => (
                  <li key={`${f.id}:${f.error}`}>
                    {f.id}: {f.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      <ConfirmDestructive
        open={confirming}
        onOpenChange={setConfirming}
        title="Import documents"
        consequence={`This writes ${file?.docs.length.toLocaleString('en-US')} documents, each billed as a write.`}
        expected={String(file?.docs.length ?? '')}
        confirmLabel="Import them"
        onConfirm={async () => {
          setConfirming(false);
          void start();
        }}
      />
    </Section>
  );
}

function opState(o: FirestoreOperation): { kind: StatusKind; label: string } {
  if (o.error) return { kind: 'error', label: 'Failed' };
  if (o.state === 'SUCCESSFUL') return { kind: 'ok', label: 'Done' };
  if (o.state === 'CANCELLED' || o.state === 'CANCELLING') return { kind: 'paused', label: 'Cancelled' };
  return { kind: 'running', label: 'Running' };
}

export function TransferTab({ ctx }: { ctx: AdminContext }) {
  const exportDocs = useExportDocuments(ctx.projectId, ctx.databaseId);
  const importDocs = useImportDocuments(ctx.projectId, ctx.databaseId);
  const ops = useAdminOperations(ctx.projectId, ctx.databaseId);
  const [outUri, setOutUri] = useState('');
  const [outIds, setOutIds] = useState('');
  const [inUri, setInUri] = useState('');
  const [inIds, setInIds] = useState('');
  const [bulkIds, setBulkIds] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const ids = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const gs = /^gs:\/\/[a-z0-9._-]+(\/.*)?$/;
  const opColumns: ResourceColumn<FirestoreOperation>[] = [
    { id: 'kind', header: 'Operation', width: '9rem', hideable: false, cell: (o) => o.kind },
    { id: 'state', header: 'State', width: '8rem', cell: (o) => <StatusGlyph {...opState(o)} /> },
    { id: 'started', header: 'Started', width: '9rem', sortValue: (o) => o.startTime, cell: (o) => <Timestamp iso={o.startTime} /> },
    {
      id: 'progress',
      header: 'Documents',
      width: '9rem',
      align: 'right',
      cell: (o) =>
        o.progressDocuments ? (
          <span className="tnum">
            {o.progressDocuments.completed ?? 0} of {o.progressDocuments.estimated ?? '?'}
          </span>
        ) : null,
    },
    {
      id: 'detail',
      header: 'Detail',
      cell: (o) => <span className="font-mono text-[12px] text-ink-2">{o.error ?? o.uri ?? o.collectionIds.join(', ')}</span>,
    },
  ];
  return (
    <div className="flex flex-col">
      <BrowserImport ctx={ctx} />
      {ctx.database.emulator ? (
        <Section title="Managed export and import">
          <p className="m-0 px-6 text-meta text-ink-3">
            Not available in the emulator. Use the browser import above, or the emulator's own export on shutdown.
          </p>
        </Section>
      ) : (
        <>
          <Section
            title="Managed export"
            description="Copies documents to Cloud Storage; billed as reads. The bucket must be in a location the database can write to."
          >
            <div className="grid max-w-3xl grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3 px-6">
              <Field label="Destination" error={outUri && !gs.test(outUri) ? 'A gs:// URI' : undefined}>
                <Input mono value={outUri} onChange={(e) => setOutUri(e.target.value)} placeholder="gs://bucket/exports/2026-09-28" />
              </Field>
              <Field label="Collection ids" help="Empty exports everything.">
                <Input mono value={outIds} onChange={(e) => setOutIds(e.target.value)} placeholder="users, orders" />
              </Field>
              <Button
                icon={DownloadSimpleIcon}
                loading={exportDocs.isPending}
                disabled={!gs.test(outUri) || !!ctx.readOnly}
                disabledReason={ctx.readOnly}
                onClick={() =>
                  exportDocs.mutate({ outputUriPrefix: outUri, collectionIds: ids(outIds) }, { onSuccess: () => void ops.refetch() })
                }
              >
                Export
              </Button>
            </div>
          </Section>
          <Section
            title="Managed import"
            description="Writes the documents of an export folder into this database, overwriting documents with the same path."
          >
            <div className="grid max-w-3xl grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3 px-6">
              <Field label="Export folder" error={inUri && !gs.test(inUri) ? 'A gs:// URI' : undefined}>
                <Input mono value={inUri} onChange={(e) => setInUri(e.target.value)} placeholder="gs://bucket/exports/2026-09-28" />
              </Field>
              <Field label="Collection ids" help="Empty imports everything in the export.">
                <Input mono value={inIds} onChange={(e) => setInIds(e.target.value)} />
              </Field>
              <Button
                icon={UploadSimpleIcon}
                loading={importDocs.isPending}
                disabled={!gs.test(inUri) || !!ctx.readOnly}
                disabledReason={ctx.readOnly}
                onClick={() =>
                  importDocs.mutate({ inputUriPrefix: inUri, collectionIds: ids(inIds) }, { onSuccess: () => void ops.refetch() })
                }
              >
                Import
              </Button>
            </div>
          </Section>
          <Section title="Operations" description="Exports, imports, index builds and bulk deletes of this database.">
            {ops.isPending ? (
              <DelayedSkeleton />
            ) : ops.error instanceof ApiError ? (
              <ProblemState problem={ops.error.problem} onRetry={() => void ops.refetch()} />
            ) : (
              <ResourceTable
                tableId="firestore-admin-ops"
                label="Database operations"
                rows={ops.data ?? []}
                columns={opColumns}
                getRowId={(o) => o.name}
                emptyTitle="No operations"
              />
            )}
          </Section>
          <Section
            title="Bulk delete"
            description="Deletes every document of the given collection ids, at any depth, across the whole database. This is the most destructive action in Firestore."
          >
            <div className="grid max-w-3xl grid-cols-[minmax(0,1fr)_auto] items-end gap-3 px-6">
              <Field label="Collection ids">
                <Input mono value={bulkIds} onChange={(e) => setBulkIds(e.target.value)} placeholder="sessions, logs" />
              </Field>
              <Button
                variant="danger"
                icon={TrashIcon}
                disabled={ids(bulkIds).length === 0 || !!ctx.readOnly}
                disabledReason={ctx.readOnly}
                onClick={() => setBulkOpen(true)}
              >
                Delete every document
              </Button>
            </div>
          </Section>
          <ConfirmDestructive
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            title="Bulk delete"
            consequence={
              <>
                Every document in every collection named{' '}
                {ids(bulkIds)
                  .map((i) => `"${i}"`)
                  .join(', ')}
                , at any depth of <Mono value={ctx.databaseId} />, is deleted.
                {ctx.database.pointInTimeRecovery
                  ? ' Point-in-time recovery is on, so the last 7 days can still be read and cloned.'
                  : ' Point-in-time recovery is off: nothing can bring these documents back.'}
              </>
            }
            expected={ctx.databaseId}
            confirmLabel="Delete every document"
            onConfirm={async (confirm) => {
              const r = await bulkDelete(ctx.projectId, ctx.databaseId, ids(bulkIds), confirm);
              useOperations.getState().upsert(r.operation);
              toast('Bulk delete started', { description: 'Follow it in the operations tray.' });
            }}
          />
        </>
      )}
    </div>
  );
}

// ---- backups -------------------------------------------------------------------------------------------------------

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

function ScheduleDialog({
  ctx,
  target,
  onOpenChange,
}: {
  ctx: AdminContext;
  target: BackupSchedule | 'new' | null;
  onOpenChange: (o: boolean) => void;
}) {
  const save = useSaveSchedule(ctx.projectId, ctx.databaseId);
  const [recurrence, setRecurrence] = useState<'daily' | 'weekly'>('daily');
  const [day, setDay] = useState<(typeof DAYS)[number]>('MONDAY');
  const [days, setDays] = useState('7');
  useEffect(() => {
    if (!target) return;
    if (target === 'new') {
      setRecurrence('daily');
      setDay('MONDAY');
      setDays('7');
    } else {
      setRecurrence(target.recurrence);
      setDay((target.day as (typeof DAYS)[number]) ?? 'MONDAY');
      setDays(String(Math.round(target.retentionSeconds / 86_400)));
    }
  }, [target]);
  const max = recurrence === 'daily' ? 7 : 98;
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= max;
  return (
    <Dialog
      open={target !== null}
      onOpenChange={onOpenChange}
      title={target === 'new' ? 'Create backup schedule' : 'Edit backup schedule'}
      width="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={save.isPending}
            disabled={!valid || !!ctx.readOnly}
            disabledReason={ctx.readOnly}
            onClick={() =>
              save.mutate(
                {
                  id: target && target !== 'new' ? target.id : null,
                  body: { recurrence, ...(recurrence === 'weekly' ? { day } : {}), retentionDays: n },
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            Save schedule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Recurrence">
          <Select<'daily' | 'weekly'>
            value={recurrence}
            onValueChange={setRecurrence}
            disabled={target !== 'new'}
            options={[
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
            ]}
          />
        </Field>
        {recurrence === 'weekly' ? (
          <Field label="Day">
            <Select<(typeof DAYS)[number]>
              value={day}
              onValueChange={setDay}
              disabled={target !== 'new'}
              options={DAYS.map((d) => ({ value: d, label: d.charAt(0) + d.slice(1).toLowerCase() }))}
            />
          </Field>
        ) : null}
        <Field
          label="Keep each backup for (days)"
          error={valid ? undefined : `1 to ${max} days`}
          help={recurrence === 'daily' ? 'Daily backups are kept up to 7 days.' : 'Weekly backups are kept up to 14 weeks.'}
        >
          <Input mono value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
    </Dialog>
  );
}

export function BackupsTab({ ctx }: { ctx: AdminContext }) {
  const schedules = useSchedules(ctx.projectId, ctx.databaseId);
  const backups = useBackups(ctx.projectId);
  const [editing, setEditing] = useState<BackupSchedule | 'new' | null>(null);
  const [deletingSchedule, setDeletingSchedule] = useState<BackupSchedule | null>(null);
  const [restoring, setRestoring] = useState<FirestoreBackup | null>(null);
  const [target, setTarget] = useState('');
  const [deleting, setDeleting] = useState<FirestoreBackup | null>(null);
  if (ctx.database.emulator) return <EmulatorOnly feature="Backups" />;
  const mine = (backups.data?.items ?? []).filter((b) => b.database.endsWith(`/databases/${ctx.databaseId}`));
  const scheduleColumns: ResourceColumn<BackupSchedule>[] = [
    {
      id: 'recurrence',
      header: 'Recurrence',
      width: '12rem',
      hideable: false,
      cell: (s) => (s.recurrence === 'daily' ? 'Daily' : `Weekly on ${(s.day ?? '').toLowerCase()}`),
    },
    { id: 'retention', header: 'Kept for', width: '9rem', cell: (s) => duration(s.retentionSeconds * 1000) },
    { id: 'updated', header: 'Updated', cell: (s) => <Timestamp iso={s.updateTime ?? s.createTime} /> },
    {
      id: 'actions',
      header: 'Actions',
      width: '10rem',
      hideable: false,
      cell: (s) => (
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" icon={PencilSimpleIcon} onClick={() => setEditing(s)} disabled={!!ctx.readOnly}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" icon={TrashIcon} onClick={() => setDeletingSchedule(s)} disabled={!!ctx.readOnly}>
            Delete
          </Button>
        </span>
      ),
    },
  ];
  const backupColumns: ResourceColumn<FirestoreBackup>[] = [
    {
      id: 'snapshot',
      header: 'Snapshot',
      width: '11rem',
      hideable: false,
      sortValue: (b) => b.snapshotTime,
      cell: (b) => <Timestamp iso={b.snapshotTime} />,
    },
    { id: 'location', header: 'Location', width: '9rem', cell: (b) => <Mono value={b.location} /> },
    {
      id: 'state',
      header: 'State',
      width: '8rem',
      cell: (b) => (b.state === 'READY' ? <StatusGlyph kind="ok" label="Ready" /> : <StatusGlyph kind="running" label="Creating" />),
    },
    {
      id: 'size',
      header: 'Size',
      width: '7rem',
      align: 'right',
      cell: (b) => <span className="tnum">{b.sizeBytes ? bytes(Number(b.sizeBytes)) : ''}</span>,
    },
    { id: 'expires', header: 'Expires', width: '9rem', cell: (b) => <Timestamp iso={b.expireTime} /> },
    {
      id: 'actions',
      header: 'Actions',
      width: '11rem',
      hideable: false,
      cell: (b) => (
        <span className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={ClockClockwiseIcon}
            disabled={b.state !== 'READY' || !!ctx.readOnly}
            onClick={() => {
              setTarget('');
              setRestoring(b);
            }}
          >
            Restore
          </Button>
          <IconButton icon={TrashIcon} label="Delete backup" size="sm" onClick={() => setDeleting(b)} disabled={!!ctx.readOnly} />
        </span>
      ),
    },
  ];
  return (
    <div className="flex flex-col">
      <Section
        title="Schedules"
        actions={
          <Button
            variant="commit"
            icon={PlusIcon}
            onClick={() => setEditing('new')}
            disabled={!!ctx.readOnly}
            disabledReason={ctx.readOnly}
          >
            Create schedule
          </Button>
        }
      >
        {schedules.isPending ? (
          <DelayedSkeleton rows={2} />
        ) : schedules.error instanceof ApiError ? (
          <ProblemState problem={schedules.error.problem} onRetry={() => void schedules.refetch()} />
        ) : (
          <ResourceTable
            tableId="firestore-schedules"
            label="Backup schedules"
            rows={schedules.data ?? []}
            columns={scheduleColumns}
            getRowId={(s) => s.name}
            emptyTitle="No backup schedules"
            emptyText="A database can have one daily and one weekly schedule."
          />
        )}
      </Section>
      <Section title="Backups" description="Restoring creates a new database; it never overwrites one.">
        {backups.isPending ? (
          <DelayedSkeleton />
        ) : backups.error instanceof ApiError ? (
          <ProblemState problem={backups.error.problem} onRetry={() => void backups.refetch()} />
        ) : (
          <ResourceTable
            tableId="firestore-backups"
            label="Backups"
            rows={mine}
            columns={backupColumns}
            getRowId={(b) => b.name}
            emptyTitle="No backups"
          />
        )}
      </Section>
      <ScheduleDialog ctx={ctx} target={editing} onOpenChange={(o) => !o && setEditing(null)} />
      {deletingSchedule ? (
        <Dialog
          open
          onOpenChange={(o) => !o && setDeletingSchedule(null)}
          title="Delete backup schedule"
          width="sm"
          footer={
            <>
              <Button onClick={() => setDeletingSchedule(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  try {
                    await deleteSchedule(ctx.projectId, ctx.databaseId, deletingSchedule.id);
                    toast.success('Schedule deleted');
                    void schedules.refetch();
                    setDeletingSchedule(null);
                  } catch (err) {
                    toast.error('Delete failed', { description: err instanceof ApiError ? err.problem.detail : String(err) });
                  }
                }}
              >
                Delete schedule
              </Button>
            </>
          }
        >
          <p className="m-0 text-dense">No new backups are made. Existing backups stay until they expire.</p>
        </Dialog>
      ) : null}
      {restoring ? (
        <ConfirmDestructive
          open
          onOpenChange={(o) => !o && setRestoring(null)}
          title="Restore backup"
          consequence={
            <div className="flex flex-col gap-3">
              <span>
                A new database is created from the backup of <Timestamp iso={restoring.snapshotTime} />. It takes a while and is billed like
                any database.
              </span>
              <Field label="New database id">
                <Input mono value={target} onChange={(e) => setTarget(e.target.value)} placeholder="restored-db" />
              </Field>
            </div>
          }
          expected={target || ' '}
          confirmLabel="Restore into a new database"
          onConfirm={async (confirm) => {
            const r = await restoreBackup(ctx.projectId, restoring.name, target, confirm);
            useOperations.getState().upsert(r.operation);
            toast(`Restoring into ${target}`, { description: 'Follow it in the operations tray.' });
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDestructive
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title="Delete backup"
          consequence={
            <>
              The backup of <Timestamp iso={deleting.snapshotTime} /> is deleted and cannot be restored.
            </>
          }
          expected={deleting.id}
          confirmLabel="Delete backup"
          onConfirm={async (confirm) => {
            await deleteBackup(ctx.projectId, deleting.name, confirm);
            toast.success('Backup deleted');
            void backups.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

// ---- settings -----------------------------------------------------------------------------------------------------

export function SettingsTab({ ctx }: { ctx: AdminContext }) {
  const db = ctx.database;
  const update = useUpdateDatabase(ctx.projectId, ctx.databaseId);
  const clone = useCloneDatabase(ctx.projectId, ctx.databaseId);
  const navigate = useNavigate();
  const [cloning, setCloning] = useState(false);
  const [cloneId, setCloneId] = useState('');
  const [cloneTime, setCloneTime] = useState('');
  const [deleting, setDeleting] = useState(false);
  if (db.emulator) return <EmulatorOnly feature="Database settings" />;
  const notes: Note[] = [];
  if (!db.pointInTimeRecovery)
    notes.push({
      id: 'pitr',
      tone: 'warn',
      text: 'Point-in-time recovery is off: deleted or overwritten data cannot be read back or cloned.',
    });
  return (
    <div className="flex flex-col">
      <Notes notes={notes} />
      <Section title="Database">
        <dl className="m-0 grid max-w-2xl grid-cols-[12rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-6 text-dense">
          <dt className="text-ink-3">Name</dt>
          <dd className="m-0">
            <Mono value={db.name} copy />
          </dd>
          <dt className="text-ink-3">Mode</dt>
          <dd className="m-0">{db.type === 'datastore' ? 'Datastore mode' : 'Native mode'}</dd>
          <dt className="text-ink-3">Edition</dt>
          <dd className="m-0">{db.edition === 'enterprise' ? 'Enterprise' : 'Standard'}</dd>
          <dt className="text-ink-3">Location</dt>
          <dd className="m-0 font-mono text-[12px]">{db.locationId}</dd>
          <dt className="text-ink-3">Concurrency</dt>
          <dd className="m-0">{(db.concurrencyMode ?? '').replaceAll('_', ' ').toLowerCase()}</dd>
          <dt className="text-ink-3">Created</dt>
          <dd className="m-0">
            <Timestamp iso={db.createTime} />
          </dd>
          <dt className="text-ink-3">Readable back to</dt>
          <dd className="m-0">{db.earliestVersionTime ? <Timestamp iso={db.earliestVersionTime} /> : ''}</dd>
        </dl>
      </Section>
      <Section title="Protection">
        <div className="flex max-w-2xl flex-col gap-4 px-6">
          <Switch
            checked={db.pointInTimeRecovery}
            onCheckedChange={(v) => update.mutate({ pointInTimeRecovery: v })}
            disabled={!!ctx.readOnly || update.isPending}
            label="Point-in-time recovery"
            description="Keeps 7 days of versions to read at a past time and to clone from. Billed as storage."
          />
          <Switch
            checked={db.deleteProtection}
            onCheckedChange={(v) => update.mutate({ deleteProtection: v })}
            disabled={!!ctx.readOnly || update.isPending}
            label="Delete protection"
            description="Refuses to delete the database until this is turned off."
          />
        </div>
      </Section>
      <Section title="Clone" description="Creates a new database from this one at a moment within the recovery window.">
        <div className="px-6">
          <Button
            icon={CopyIcon}
            onClick={() => setCloning(true)}
            disabled={!!ctx.readOnly || !db.pointInTimeRecovery}
            disabledReason={ctx.readOnly ?? (db.pointInTimeRecovery ? null : 'Turn on point-in-time recovery to clone')}
          >
            Clone database
          </Button>
        </div>
      </Section>
      <Section title="Delete">
        <div className="px-6">
          <Button
            variant="danger"
            icon={TrashIcon}
            onClick={() => setDeleting(true)}
            disabled={!!ctx.readOnly || db.deleteProtection}
            disabledReason={ctx.readOnly ?? (db.deleteProtection ? 'Delete protection is on' : null)}
          >
            Delete database
          </Button>
        </div>
      </Section>
      <Dialog
        open={cloning}
        onOpenChange={setCloning}
        title="Clone database"
        width="sm"
        footer={
          <>
            <Button onClick={() => setCloning(false)}>Cancel</Button>
            <Button
              variant="commit"
              loading={clone.isPending}
              disabled={!/^[a-z][a-z0-9-]{3,62}$/.test(cloneId) || !cloneTime}
              onClick={() =>
                clone.mutate(
                  { targetId: cloneId, snapshotTime: new Date(cloneTime).toISOString().replace(/:\d\d\.\d{3}Z$/, ':00Z') },
                  { onSuccess: () => setCloning(false) },
                )
              }
            >
              Clone
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="New database id">
            <Input
              mono
              value={cloneId}
              onChange={(e) => setCloneId(e.target.value)}
              placeholder={`${ctx.databaseId === '(default)' ? 'default' : ctx.databaseId}-clone`}
            />
          </Field>
          <Field label="As of" help="A whole minute within the last 7 days.">
            <Input type="datetime-local" value={cloneTime} onChange={(e) => setCloneTime(e.target.value)} />
          </Field>
        </div>
      </Dialog>
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete database"
        consequence={
          <>
            <Mono value={ctx.databaseId} /> and every document in it are deleted. The id cannot be reused for a while.
          </>
        }
        expected={ctx.databaseId}
        confirmLabel="Delete database"
        onConfirm={async (confirm) => {
          const r = await deleteDatabase(ctx.projectId, ctx.databaseId, confirm);
          useOperations.getState().upsert(r.operation);
          toast(`Deleting ${ctx.databaseId}`, { description: 'Follow it in the operations tray.' });
          void navigate({ to: `/p/${ctx.projectId}/firestore` as string });
        }}
      />
    </div>
  );
}

export function UsageTab({ ctx }: { ctx: AdminContext }) {
  if (ctx.database.emulator) return <EmulatorOnly feature="Usage metrics" />;
  return <MetricsPanel projectId={ctx.projectId} kind="firestore-database" labels={{ database_id: ctx.databaseId }} />;
}
