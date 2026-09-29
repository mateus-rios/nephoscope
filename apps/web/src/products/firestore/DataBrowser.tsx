import type { FirestoreDocument } from '@nephoscope/contracts';
import { parseTypedValue, previewValue, printTypedValue, type WireValue } from '@nephoscope/contracts/firestore-value';
import { ArrowClockwiseIcon, CaretRightIcon, DotsThreeIcon, FolderPlusIcon, PlusIcon } from '@phosphor-icons/react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Legend } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { Dialog, Menu, MenuItem, Popover } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { Mono } from '../../design/Values';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useOperations } from '../../state/operations';
import { countCollection, deleteCollection, documentsRoot, saveDocument, useCollections, useDocuments, useInvalidateData } from './api';
import { type DbContext, DocumentEditor, DocumentPanel } from './Documents';
import { isDocumentPath, lastSegment, normalizePath, parentCollection, parentDocument, segmentsOf } from './paths';

type View = 'panels' | 'table';

/** Page sizes (D-15); the default is 50. */
const PAGE_SIZES = ['25', '50', '100', '250', '500'] as const;

function PathBar({ path, onGo }: { path: string; onGo: (path: string) => void }) {
  const [text, setText] = useState(path ? `/${path}` : '/');
  useEffect(() => setText(path ? `/${path}` : '/'), [path]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onGo(normalizePath(text));
  };
  const segments = segmentsOf(path);
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 flex-col gap-1">
      <Input
        mono
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Path"
        placeholder="/collection/document"
        data-filter-input
      />
      <nav aria-label="Path segments" className="flex flex-wrap items-center gap-0.5 font-mono text-[11px] text-ink-3">
        <button type="button" className="hover:text-ink" onClick={() => onGo('')}>
          root
        </button>
        {segments.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a segment is identified by its position in the path.
          <span key={`${i}:${s}`} className="flex items-center gap-0.5">
            <CaretRightIcon size={10} aria-hidden />
            <button
              type="button"
              className={cn('hover:text-ink', i === segments.length - 1 && 'text-ink')}
              onClick={() => onGo(segments.slice(0, i + 1).join('/'))}
            >
              {s}
            </button>
          </span>
        ))}
      </nav>
    </form>
  );
}

function ListButton({
  active,
  onClick,
  children,
  italic,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  italic?: boolean;
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 border-b border-rule px-4 py-1.5 text-left font-mono text-[12px] text-ink hover:bg-hover',
        active && 'bg-construct-tint font-medium',
        italic && 'text-ink-2 italic',
      )}
    >
      {children}
    </button>
  );
}

function CollectionsColumn({
  ctx,
  parent,
  selected,
  openPath,
  onStart,
}: {
  ctx: DbContext;
  parent: string;
  selected: string | null;
  openPath: (p: string) => void;
  onStart: () => void;
}) {
  const q = useCollections(ctx.projectId, ctx.databaseId, parent);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section aria-label="Collections" className="flex min-w-0 flex-col border-r border-rule">
      <div className="flex items-center justify-between gap-2 border-b border-rule px-4 py-2">
        <Legend>{parent ? `Collections of ${lastSegment(parent)}` : 'Root collections'}</Legend>
        <IconButton icon={FolderPlusIcon} label="Start a collection" size="sm" onClick={onStart} disabled={!!ctx.readOnly} />
      </div>
      {q.isPending ? (
        <DelayedSkeleton rows={5} className="p-4" />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <p className="m-0 px-4 py-3 text-meta text-ink-3">No collections.</p>
      ) : (
        <div className="min-h-0 overflow-y-auto">
          {items.map((c) => (
            <ListButton key={c} active={selected === c} onClick={() => openPath(parent ? `${parent}/${c}` : c)}>
              {c}
            </ListButton>
          ))}
          {q.hasNextPage ? (
            <div className="p-2">
              <Button size="sm" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function DocumentsColumn({
  ctx,
  collection,
  selected,
  pageSize,
  openPath,
  onAdd,
  onDeleteCollection,
}: {
  ctx: DbContext;
  collection: string;
  selected: string | null;
  pageSize: number;
  openPath: (p: string) => void;
  onAdd: () => void;
  onDeleteCollection: () => void;
}) {
  const q = useDocuments(ctx.projectId, ctx.databaseId, collection, pageSize);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section aria-label={`Documents in ${collection}`} className="flex min-w-0 flex-col border-r border-rule">
      <div className="flex items-center justify-between gap-2 border-b border-rule px-4 py-2">
        <Legend>{lastSegment(collection)}</Legend>
        <span className="flex items-center gap-1">
          <IconButton icon={PlusIcon} label="Add a document" size="sm" onClick={onAdd} disabled={!!ctx.readOnly} />
          <Menu trigger={<IconButton icon={DotsThreeIcon} label="Collection actions" size="sm" />} align="end">
            <MenuItem onClick={onDeleteCollection} disabled={!!ctx.readOnly}>
              Delete collection…
            </MenuItem>
          </Menu>
        </span>
      </div>
      {q.isPending ? (
        <DelayedSkeleton rows={8} className="p-4" />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <p className="m-0 px-4 py-3 text-meta text-ink-3">No documents.</p>
      ) : (
        <div className="min-h-0 overflow-y-auto">
          {items.map((d) => (
            <ListButton key={d.name} active={selected === d.id} italic={d.missing} onClick={() => openPath(d.path)}>
              <span className="min-w-0 flex-1 truncate">{d.id}</span>
              {d.missing ? <span className="not-italic text-[11px] text-ink-3">No document</span> : null}
            </ListButton>
          ))}
          {q.hasNextPage ? (
            <div className="p-2">
              <Button size="sm" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
                Load {pageSize} more
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Inline edit of a scalar cell (D-04): one field, saved with the updateTime precondition. */
function CellEditor({ ctx, doc, field, value }: { ctx: DbContext; doc: FirestoreDocument; field: string; value: WireValue | undefined }) {
  const root = documentsRoot(ctx.projectId, ctx.databaseId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidateData(ctx.projectId, ctx.databaseId);
  const parsed = parseTypedValue(text, { documentsRoot: root });
  const scalar = !value || !['map', 'array', 'special', 'vector'].includes(value.t);
  const shown = value ? previewValue(value, root, 60) : '';
  if (!scalar || ctx.readOnly) return <span className={cn('font-mono text-[12px]', !value && 'text-ink-3')}>{value ? shown : ''}</span>;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setText(value ? printTypedValue(value, { documentsRoot: root }) : '');
      }}
      label={`Edit ${field} of ${doc.id}`}
      trigger={
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="max-w-full truncate text-left font-mono text-[12px] text-ink hover:underline"
        >
          {value ? shown : <span className="text-ink-3">Set</span>}
        </button>
      }
    >
      <form
        className="flex w-80 flex-col gap-2 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!parsed.ok) return;
          setBusy(true);
          try {
            await saveDocument(ctx.projectId, ctx.databaseId, doc.path, {
              fields: { [field]: parsed.value },
              mask: [field],
              updateTime: doc.updateTime,
            });
            toast.success(`Saved ${field} of ${doc.id}`);
            void invalidate();
            setOpen(false);
          } catch (err) {
            toast.error('Saving failed', { description: err instanceof ApiError ? err.problem.detail : String(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label={field}
          help='Typed JSON: 3 is an integer, 3.0 a double, "3" a string.'
          error={parsed.ok || !text ? undefined : parsed.error.message}
        >
          <Input mono value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="commit" type="submit" loading={busy} disabled={!parsed.ok}>
            Save field
          </Button>
        </div>
      </form>
    </Popover>
  );
}

function TableView({
  ctx,
  collection,
  pageSize,
  openPath,
}: {
  ctx: DbContext;
  collection: string;
  pageSize: number;
  openPath: (p: string) => void;
}) {
  const q = useDocuments(ctx.projectId, ctx.databaseId, collection, pageSize);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const fieldNames = useMemo(() => {
    const names = new Set<string>();
    for (const d of rows) for (const k of Object.keys(d.fields)) names.add(k);
    return [...names].sort().slice(0, 40);
  }, [rows]);
  const columns: ResourceColumn<FirestoreDocument>[] = [
    {
      id: '__id',
      header: 'Id',
      hideable: false,
      width: '14rem',
      sortValue: (d) => d.id,
      cell: (d) => <span className={cn('font-mono text-[12px] text-ink', d.missing && 'italic text-ink-2')}>{d.id}</span>,
    },
    ...fieldNames.map(
      (f): ResourceColumn<FirestoreDocument> => ({
        id: `f:${f}`,
        header: f,
        width: '12rem',
        sortValue: (d) => {
          const v = d.fields[f];
          return !v ? null : v.t === 'integer' || v.t === 'double' ? Number(typeof v.v === 'number' ? v.v : v.v) : previewValue(v);
        },
        cell: (d) => (d.missing ? null : <CellEditor ctx={ctx} doc={d} field={f} value={d.fields[f]} />),
      }),
    ),
  ];
  if (q.isPending) return <DelayedSkeleton />;
  if (q.error instanceof ApiError) return <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />;
  return (
    <ResourceTable
      tableId={`firestore-table:${collection}`}
      label={`Documents in ${collection}`}
      rows={rows}
      columns={columns}
      getRowId={(d) => d.name}
      onOpen={(d) => openPath(d.path)}
      emptyTitle="No documents"
      hasMore={q.hasNextPage}
      loadingMore={q.isFetchingNextPage}
      onLoadMore={() => void q.fetchNextPage()}
    />
  );
}

function StartCollectionDialog({
  open,
  onOpenChange,
  parent,
  onNext,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  parent: string;
  onNext: (collection: string) => void;
}) {
  const [id, setId] = useState('');
  useEffect(() => {
    if (open) setId('');
  }, [open]);
  const error = id && (id.includes('/') || /^__.*__$/.test(id)) ? 'No slashes, and not a __reserved__ name.' : null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Start a collection"
      description={parent ? <Mono value={parent} /> : 'At the root of the database.'}
      width="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="commit" disabled={!id || !!error} onClick={() => onNext(parent ? `${parent}/${id}` : id)}>
            Add its first document
          </Button>
        </>
      }
    >
      <Field label="Collection id" help="A collection exists once it holds a document." error={error ?? undefined}>
        <Input mono value={id} onChange={(e) => setId(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}

function DeleteCollectionDialog({
  ctx,
  collection,
  open,
  onOpenChange,
  onDeleted,
}: {
  ctx: DbContext;
  collection: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDeleted: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setCount(null);
    setError(null);
    countCollection(ctx.projectId, ctx.databaseId, collection).then(
      (r) => setCount(r.count),
      (err: unknown) => setError(err instanceof ApiError ? err.problem.detail : String(err)),
    );
  }, [open, ctx.projectId, ctx.databaseId, collection]);
  if (open && count === null)
    return (
      <Dialog open={open} onOpenChange={onOpenChange} title="Delete collection" width="sm">
        <p className="m-0 text-dense text-ink-2">{error ?? 'Counting the documents…'}</p>
      </Dialog>
    );
  return (
    <ConfirmDestructive
      open={open}
      onOpenChange={onOpenChange}
      title="Delete collection"
      consequence={
        <>
          All {count?.toLocaleString('en-US')} documents in <Mono value={collection} /> are deleted, with every subcollection below them.
          This runs as an operation you can stop, and cannot be undone.
        </>
      }
      expected={String(count ?? '')}
      confirmLabel={`Delete ${count?.toLocaleString('en-US')} documents`}
      onConfirm={async (confirm) => {
        const r = await deleteCollection(ctx.projectId, ctx.databaseId, collection, confirm);
        useOperations.getState().upsert(r.operation);
        toast(`Deleting ${collection}`, { description: 'Follow it in the operations tray.' });
        onDeleted();
      }}
    />
  );
}

/** Browse and edit data (SPEC-0004 D-04, CA-04 to CA-11). */
export function DataBrowser({ ctx }: { ctx: DbContext }) {
  const [rawPath, setPath] = useSearchState<string>('path', '');
  const [view, setView] = useSearchState<View>('view', 'panels', ['panels', 'table']);
  const [size, setSize] = useSearchState<string>('pageSize', '50', PAGE_SIZES);
  const path = normalizePath(rawPath);
  const pageSize = Number(size);
  const isDoc = isDocumentPath(path);
  const collection = path === '' ? '' : isDoc ? parentCollection(path) : path;
  const parentDoc = collection === '' ? '' : parentDocument(collection);
  const docPath = isDoc ? path : null;
  const [adding, setAdding] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [deletingCollection, setDeletingCollection] = useState(false);
  const invalidate = useInvalidateData(ctx.projectId, ctx.databaseId);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-start gap-3 border-b border-rule px-6 py-3">
        <PathBar path={path} onGo={setPath} />
        <Select<View>
          value={view}
          onValueChange={setView}
          aria-label="View"
          options={[
            { value: 'panels', label: 'Panels' },
            { value: 'table', label: 'Table' },
          ]}
          className="w-28"
        />
        <Select<string>
          value={size}
          onValueChange={setSize}
          aria-label="Page size"
          options={PAGE_SIZES.map((n) => ({ value: n, label: `${n} per page` }))}
          className="w-36"
        />
        <Button icon={ArrowClockwiseIcon} onClick={() => void invalidate()}>
          Refresh
        </Button>
      </div>
      {view === 'table' && collection ? (
        <TableView
          ctx={ctx}
          collection={collection}
          pageSize={pageSize}
          openPath={(p) => {
            setView('panels');
            setPath(p);
          }}
        />
      ) : view === 'table' ? (
        <EmptyState title="Choose a collection">The table view shows one collection. Pick one in the panels or type its path.</EmptyState>
      ) : (
        <div className="grid min-h-[32rem] grid-cols-[minmax(12rem,16rem)_minmax(14rem,20rem)_minmax(0,1fr)]">
          <CollectionsColumn
            ctx={ctx}
            parent={parentDoc}
            selected={collection ? lastSegment(collection) : null}
            openPath={setPath}
            onStart={() => setStarting(true)}
          />
          {collection ? (
            <DocumentsColumn
              ctx={ctx}
              collection={collection}
              selected={docPath ? lastSegment(docPath) : null}
              pageSize={pageSize}
              openPath={setPath}
              onAdd={() => setAdding(collection)}
              onDeleteCollection={() => setDeletingCollection(true)}
            />
          ) : (
            <div className="border-r border-rule p-4 text-meta text-ink-3">Choose a collection.</div>
          )}
          {docPath ? (
            <DocumentPanel ctx={ctx} path={docPath} openPath={setPath} />
          ) : (
            <div className="p-6 text-meta text-ink-3">{collection ? 'Choose a document.' : ''}</div>
          )}
        </div>
      )}
      <DocumentEditor
        ctx={ctx}
        open={adding !== null}
        onOpenChange={(o) => !o && setAdding(null)}
        document={null}
        collection={adding ?? ''}
        onSaved={(d) => setPath(d.path)}
      />
      <StartCollectionDialog
        open={starting}
        onOpenChange={setStarting}
        parent={docPath ?? parentDoc}
        onNext={(c) => {
          setStarting(false);
          setAdding(c);
        }}
      />
      {collection ? (
        <DeleteCollectionDialog
          ctx={ctx}
          collection={collection}
          open={deletingCollection}
          onOpenChange={setDeletingCollection}
          onDeleted={() => setPath(parentDoc)}
        />
      ) : null}
    </div>
  );
}
