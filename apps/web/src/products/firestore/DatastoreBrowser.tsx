import type { DatastoreEntity, DatastoreKey, EntitiesPage } from '@nephoscope/contracts';
import { normalizeTimestamp, parseTypedValue, previewValue, printTypedValue, type WireValue } from '@nephoscope/contracts/firestore-value';
import { PencilSimpleIcon, PlayIcon, PlusIcon, TrashIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Legend } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { Dialog } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { deleteEntity, runGql, saveEntity, useEntities, useInvalidateData, useKinds, useNamespaces } from './api';
import type { DbContext } from './Documents';

/** Datastore mode (SPEC-0004 D-13, CA-20). Keys read as GQL literals, such as KEY(Task, 'name'). */

const quote = (s: string) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
export function keyText(key: DatastoreKey): string {
  return `KEY(${key.path.map((p) => `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.kind) ? p.kind : `\`${p.kind}\``}, ${p.id ?? quote(p.name ?? '')}`).join(', ')})`;
}
const keyId = (key: DatastoreKey) => {
  const last = key.path.at(-1);
  return last?.name ?? last?.id ?? '';
};

type PropType = 'string' | 'integer' | 'double' | 'boolean' | 'timestamp' | 'key' | 'blob' | 'geopoint' | 'array' | 'entity' | 'null';
const PROP_TYPES: { value: PropType; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'integer', label: 'Integer' },
  { value: 'double', label: 'Double' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'timestamp', label: 'Timestamp' },
  { value: 'key', label: 'Key' },
  { value: 'blob', label: 'Blob' },
  { value: 'geopoint', label: 'Geopoint' },
  { value: 'array', label: 'Array' },
  { value: 'entity', label: 'Embedded entity' },
  { value: 'null', label: 'Null' },
];

interface PropRow {
  id: number;
  name: string;
  type: PropType;
  text: string;
  exclude: boolean;
}

let rowId = 1;

function toRow(name: string, value: WireValue, exclude: boolean): PropRow {
  const base = { id: rowId++, name, exclude };
  switch (value.t) {
    case 'string':
      return { ...base, type: 'string', text: value.v };
    case 'integer':
      return { ...base, type: 'integer', text: value.v };
    case 'double':
      return { ...base, type: 'double', text: String(value.v) };
    case 'boolean':
      return { ...base, type: 'boolean', text: String(value.v) };
    case 'timestamp':
      return { ...base, type: 'timestamp', text: value.v };
    case 'reference':
      return { ...base, type: 'key', text: value.v };
    case 'bytes':
      return { ...base, type: 'blob', text: value.v };
    case 'geopoint':
      return { ...base, type: 'geopoint', text: `${value.v.latitude}, ${value.v.longitude}` };
    case 'array':
      return { ...base, type: 'array', text: printTypedValue(value) };
    case 'map':
      return { ...base, type: 'entity', text: printTypedValue(value) };
    default:
      return { ...base, type: 'null', text: '' };
  }
}

function fromRow(r: PropRow): WireValue | string {
  const t = r.text.trim();
  switch (r.type) {
    case 'string':
      return { t: 'string', v: r.text };
    case 'integer':
      return /^-?\d{1,19}$/.test(t) ? { t: 'integer', v: t } : 'A whole number.';
    case 'double': {
      const n = Number(t);
      return t && Number.isFinite(n)
        ? { t: 'double', v: n }
        : ['NaN', 'Infinity', '-Infinity'].includes(t)
          ? { t: 'double', v: t as 'NaN' }
          : 'A number.';
    }
    case 'boolean':
      return t === 'true' || t === 'false' ? { t: 'boolean', v: t === 'true' } : 'true or false.';
    case 'timestamp': {
      const ts = normalizeTimestamp(t);
      return ts ? { t: 'timestamp', v: ts } : 'An RFC 3339 time, such as 2026-09-28T12:00:00Z.';
    }
    case 'key':
      return /^KEY\s*\(.+\)$/is.test(t) ? { t: 'reference', v: t } : "A key such as KEY(Kind, 'name') or KEY(Kind, 123).";
    case 'blob':
      return /^[A-Za-z0-9+/]*={0,2}$/.test(t) ? { t: 'bytes', v: t } : 'Base64 text.';
    case 'geopoint': {
      const [lat, lng] = t.split(',').map((x) => Number(x.trim()));
      return lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? { t: 'geopoint', v: { latitude: lat, longitude: lng } }
        : 'Latitude, longitude.';
    }
    case 'array':
    case 'entity': {
      const p = parseTypedValue(t || (r.type === 'array' ? '[]' : '{}'));
      if (!p.ok) return p.error.message;
      if (r.type === 'array' && p.value.t !== 'array') return 'A JSON array.';
      if (r.type === 'entity' && p.value.t !== 'map') return 'A JSON object.';
      return p.value;
    }
    case 'null':
      return { t: 'null' };
  }
}

function EntityEditor({
  ctx,
  namespace,
  kind,
  entity,
  open,
  onOpenChange,
}: {
  ctx: DbContext;
  namespace: string;
  kind: string;
  entity: DatastoreEntity | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [rows, setRows] = useState<PropRow[]>([]);
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidateData(ctx.projectId, ctx.databaseId);
  useEffect(() => {
    if (!open) return;
    setName('');
    setRows(
      entity
        ? Object.entries(entity.properties).map(([k, p]) => toRow(k, p.value, p.excludeFromIndexes))
        : [{ id: rowId++, name: '', type: 'string', text: '', exclude: false }],
    );
  }, [open, entity]);
  const converted = rows.map((r) => ({ r, v: fromRow(r) }));
  const dupes = new Set(rows.map((r) => r.name.trim()).filter((n, i, a) => n && a.indexOf(n) !== i));
  const invalid = converted.some(({ r, v }) => typeof v === 'string' || !r.name.trim() || dupes.has(r.name.trim()));
  const save = async () => {
    setBusy(true);
    try {
      const key: DatastoreKey = entity?.key ?? {
        namespace,
        path: [
          /^\d+$/.test(name.trim())
            ? { kind, id: name.trim(), name: null }
            : name.trim()
              ? { kind, id: null, name: name.trim() }
              : { kind, id: null, name: null },
        ],
      };
      const properties = Object.fromEntries(
        converted.map(({ r, v }) => [r.name.trim(), { value: v as WireValue, excludeFromIndexes: r.exclude }]),
      );
      const saved = await saveEntity(ctx.projectId, ctx.databaseId, { key, properties });
      toast.success(`Saved ${keyText(saved.key)}`);
      void invalidate();
      onOpenChange(false);
    } catch (err) {
      toast.error('Saving failed', { description: err instanceof ApiError ? err.problem.detail : String(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={entity ? `Edit ${keyText(entity.key)}` : `New ${kind} entity`}
      description={entity ? 'The whole entity is written: properties removed here are removed from it.' : undefined}
      width="xl"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={busy}
            disabled={invalid || !!ctx.readOnly}
            disabledReason={ctx.readOnly ?? (invalid ? 'Fix the marked properties' : null)}
            onClick={() => void save()}
          >
            Save entity
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {!entity ? (
          <Field label="Key name or numeric id" help="Leave empty for an id allocated by Datastore.">
            <Input mono value={name} onChange={(e) => setName(e.target.value)} placeholder="Allocated" />
          </Field>
        ) : null}
        <div className="grid grid-cols-[minmax(0,12rem)_9rem_minmax(0,1fr)_7rem_auto] items-center gap-2">
          <Legend>Property</Legend>
          <Legend>Type</Legend>
          <Legend>Value</Legend>
          <Legend>Not indexed</Legend>
          <span />
          {converted.map(({ r, v }) => (
            <div key={r.id} className="contents">
              <Input
                mono
                value={r.name}
                onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))}
                aria-label="Property name"
                aria-invalid={!r.name.trim() || dupes.has(r.name.trim()) || undefined}
              />
              <Select<PropType>
                value={r.type}
                onValueChange={(type) => setRows(rows.map((x) => (x.id === r.id ? { ...x, type } : x)))}
                options={PROP_TYPES}
                aria-label={`Type of ${r.name || 'property'}`}
              />
              <div className="flex flex-col gap-0.5">
                <Input
                  mono
                  value={r.text}
                  disabled={r.type === 'null'}
                  onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)))}
                  aria-label={`Value of ${r.name || 'property'}`}
                  aria-invalid={typeof v === 'string' || undefined}
                />
                {typeof v === 'string' ? <span className="text-meta text-redline-ink">{v}</span> : null}
              </div>
              <input
                type="checkbox"
                checked={r.exclude}
                onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, exclude: e.target.checked } : x)))}
                aria-label={`Exclude ${r.name || 'property'} from indexes`}
              />
              <IconButton
                icon={XIcon}
                label={`Remove ${r.name || 'property'}`}
                size="sm"
                onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
              />
            </div>
          ))}
        </div>
        <div>
          <Button
            size="sm"
            variant="ghost"
            icon={PlusIcon}
            onClick={() => setRows([...rows, { id: rowId++, name: '', type: 'string', text: '', exclude: false }])}
          >
            Property
          </Button>
        </div>
        <p className="m-0 text-meta text-ink-3">Strings over 1,500 bytes must be excluded from indexes.</p>
      </div>
    </Dialog>
  );
}

function EntitiesTable({
  ctx,
  items,
  hasMore,
  loadingMore,
  onLoadMore,
  onEdit,
  onDelete,
}: {
  ctx: DbContext;
  items: DatastoreEntity[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onEdit: (e: DatastoreEntity) => void;
  onDelete: (e: DatastoreEntity) => void;
}) {
  const props = useMemo(() => [...new Set(items.flatMap((e) => Object.keys(e.properties)))].sort().slice(0, 30), [items]);
  const columns: ResourceColumn<DatastoreEntity>[] = [
    {
      id: 'key',
      header: 'Key',
      width: '16rem',
      hideable: false,
      sortValue: (e) => keyText(e.key),
      cell: (e) => <span className="font-mono text-[12px]">{keyText(e.key)}</span>,
    },
    ...props.map(
      (p): ResourceColumn<DatastoreEntity> => ({
        id: `p:${p}`,
        header: p,
        width: '11rem',
        sortValue: (e) => (e.properties[p] ? previewValue(e.properties[p].value) : null),
        cell: (e) => {
          const prop = e.properties[p];
          return prop ? (
            <span className={cn('font-mono text-[12px]', prop.excludeFromIndexes && 'text-ink-2')}>
              {previewValue(prop.value, undefined, 60)}
            </span>
          ) : null;
        },
      }),
    ),
    {
      id: 'actions',
      header: 'Actions',
      width: '6rem',
      hideable: false,
      cell: (e) => (
        <span className="flex gap-1">
          <IconButton
            icon={PencilSimpleIcon}
            label={`Edit ${keyText(e.key)}`}
            size="sm"
            onClick={() => onEdit(e)}
            disabled={!!ctx.readOnly}
          />
          <IconButton icon={TrashIcon} label={`Delete ${keyText(e.key)}`} size="sm" onClick={() => onDelete(e)} disabled={!!ctx.readOnly} />
        </span>
      ),
    },
  ];
  return (
    <ResourceTable
      tableId="datastore-entities"
      label="Entities"
      rows={items}
      columns={columns}
      getRowId={(e) => keyText(e.key)}
      onOpen={onEdit}
      emptyTitle="No entities"
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
    />
  );
}

export function DatastoreBrowser({ ctx }: { ctx: DbContext }) {
  const [namespace, setNamespace] = useSearchState<string>('ns', '');
  const [kind, setKind] = useSearchState<string>('kind', '');
  const [mode, setMode] = useSearchState<'browse' | 'gql'>('mode', 'browse', ['browse', 'gql']);
  const namespaces = useNamespaces(ctx.projectId, ctx.databaseId);
  const kinds = useKinds(ctx.projectId, ctx.databaseId, namespace);
  const entities = useEntities(ctx.projectId, ctx.databaseId, namespace, kind);
  const [gql, setGql] = useState('SELECT * FROM ');
  const [gqlPage, setGqlPage] = useState<EntitiesPage | null>(null);
  const [gqlError, setGqlError] = useState<ApiError | null>(null);
  const [gqlBusy, setGqlBusy] = useState(false);
  const [editing, setEditing] = useState<DatastoreEntity | 'new' | null>(null);
  const [deleting, setDeleting] = useState<DatastoreEntity | null>(null);
  const invalidate = useInvalidateData(ctx.projectId, ctx.databaseId);

  useEffect(() => {
    if (!kind && kinds.data?.[0]) setKind(kinds.data[0]);
  }, [kind, kinds.data, setKind]);

  const runQuery = async (cursor?: string) => {
    setGqlBusy(true);
    try {
      const page = await runGql(ctx.projectId, ctx.databaseId, namespace, gql, cursor);
      setGqlPage(cursor && gqlPage ? { ...page, items: [...gqlPage.items, ...page.items] } : page);
      setGqlError(null);
    } catch (err) {
      if (err instanceof ApiError) setGqlError(err);
    } finally {
      setGqlBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end gap-3 border-b border-rule px-6 py-3">
        <Field label="Namespace" className="w-56">
          <Select<string>
            value={namespace}
            onValueChange={(ns) => {
              setNamespace(ns);
              setKind('');
            }}
            options={(namespaces.data ?? ['']).map((n) => ({ value: n, label: n || '(default)' }))}
          />
        </Field>
        <Field label="View" className="w-44">
          <Select<'browse' | 'gql'>
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'browse', label: 'Browse kinds' },
              { value: 'gql', label: 'GQL query' },
            ]}
          />
        </Field>
      </div>
      {mode === 'gql' ? (
        <div className="flex flex-col">
          <div className="flex flex-col gap-2 px-6 py-3">
            <CodeEditor value={gql} onChange={setGql} language="sql" height={120} label="GQL query" />
            <div className="flex items-center gap-2">
              <Button variant="commit" icon={PlayIcon} loading={gqlBusy} onClick={() => void runQuery()}>
                Run query
              </Button>
              <span className="text-meta text-ink-3">
                Literals are allowed, such as WHERE done = false AND owner = KEY(User, &apos;ana&apos;).
              </span>
            </div>
          </div>
          {gqlError ? (
            <ProblemState problem={gqlError.problem} onRetry={() => void runQuery()} />
          ) : gqlPage ? (
            <EntitiesTable
              ctx={ctx}
              items={gqlPage.items}
              hasMore={!!gqlPage.endCursor}
              loadingMore={gqlBusy}
              onLoadMore={() => void runQuery(gqlPage.endCursor ?? undefined)}
              onEdit={(e) => setEditing(e)}
              onDelete={(e) => setDeleting(e)}
            />
          ) : null}
        </div>
      ) : (
        <div className="grid min-h-[28rem] grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)]">
          <section aria-label="Kinds" className="border-r border-rule">
            <div className="border-b border-rule px-4 py-2">
              <Legend>Kinds</Legend>
            </div>
            {kinds.isPending ? (
              <DelayedSkeleton rows={4} className="p-4" />
            ) : kinds.error instanceof ApiError ? (
              <ProblemState problem={kinds.error.problem} onRetry={() => void kinds.refetch()} />
            ) : (kinds.data ?? []).length === 0 ? (
              <p className="m-0 px-4 py-3 text-meta text-ink-3">No kinds in this namespace.</p>
            ) : (
              (kinds.data ?? []).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-current={k === kind ? 'true' : undefined}
                  onClick={() => setKind(k)}
                  className={cn(
                    'block w-full border-b border-rule px-4 py-1.5 text-left font-mono text-[12px] text-ink hover:bg-hover',
                    k === kind && 'bg-construct-tint font-medium',
                  )}
                >
                  {k}
                </button>
              ))
            )}
          </section>
          <section aria-label={kind ? `${kind} entities` : 'Entities'} className="flex min-w-0 flex-col">
            <div className="flex items-center justify-between border-b border-rule px-6 py-2">
              <Legend>{kind || 'Entities'}</Legend>
              <Button
                size="sm"
                variant="commit"
                icon={PlusIcon}
                onClick={() => setEditing('new')}
                disabled={!kind || !!ctx.readOnly}
                disabledReason={ctx.readOnly}
              >
                New entity
              </Button>
            </div>
            {!kind ? (
              <EmptyState title="Choose a kind">Entities of the kind appear here, 50 at a time.</EmptyState>
            ) : entities.isPending ? (
              <DelayedSkeleton />
            ) : entities.error instanceof ApiError ? (
              <ProblemState problem={entities.error.problem} onRetry={() => void entities.refetch()} />
            ) : (
              <EntitiesTable
                ctx={ctx}
                items={entities.data?.pages.flatMap((p) => p.items) ?? []}
                hasMore={entities.hasNextPage}
                loadingMore={entities.isFetchingNextPage}
                onLoadMore={() => void entities.fetchNextPage()}
                onEdit={(e) => setEditing(e)}
                onDelete={(e) => setDeleting(e)}
              />
            )}
          </section>
        </div>
      )}
      <EntityEditor
        ctx={ctx}
        namespace={namespace}
        kind={editing && editing !== 'new' ? (editing.key.path.at(-1)?.kind ?? kind) : kind}
        entity={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      {deleting ? (
        <ConfirmDestructive
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title="Delete entity"
          consequence={`${keyText(deleting.key)} is deleted. Datastore has no undo.`}
          expected={keyId(deleting.key)}
          confirmLabel="Delete entity"
          onConfirm={async (confirm) => {
            await deleteEntity(ctx.projectId, ctx.databaseId, deleting.key, confirm);
            toast.success('Entity deleted');
            void invalidate();
            if (gqlPage) setGqlPage({ ...gqlPage, items: gqlPage.items.filter((e) => keyText(e.key) !== keyText(deleting.key)) });
          }}
        />
      ) : null}
    </div>
  );
}
