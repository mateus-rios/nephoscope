import type { StorageBucket, StorageCapabilities, StorageObject } from '@nephoscope/contracts';
import { FileIcon, FolderIcon, FolderPlusIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Switch } from '../../design/Form';
import { Dialog } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { RefreshControl } from '../../kit/ListControls';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { bytes, count } from '../../lib/format';
import { useOperations } from '../../state/operations';
import { baseName, createFolder, deleteObjects, failed, renameFolder, useObjects } from './api';
import { ObjectSheet, type ObjectTarget } from './ObjectSheet';
import { filesFromDrop, filesFromInput, UploadPanel, useUploads } from './Uploads';

type Row = { kind: 'folder'; id: string; name: string } | { kind: 'object'; id: string; name: string; o: StorageObject };

const FOLDER_NAME = /^[^/]+$/;

function Breadcrumb({ bucket, prefix, onPrefix }: { bucket: string; prefix: string; onPrefix: (p: string) => void }) {
  const parts = prefix.split('/').filter(Boolean);
  return (
    <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[12px]">
      <button type="button" className="rounded-control px-1 text-ink-2 hover:bg-hover hover:text-ink" onClick={() => onPrefix('')}>
        {bucket}
      </button>
      {parts.map((p, i) => {
        const to = `${parts.slice(0, i + 1).join('/')}/`;
        const last = i === parts.length - 1;
        return (
          <span key={to} className="flex items-center gap-1">
            <span className="text-ink-3" aria-hidden>
              /
            </span>
            {last ? (
              <span className="px-1 text-ink" aria-current="page">
                {p}
              </span>
            ) : (
              <button type="button" className="rounded-control px-1 text-ink-2 hover:bg-hover hover:text-ink" onClick={() => onPrefix(to)}>
                {p}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function FolderDialog({
  title,
  label,
  initial,
  help,
  confirmLabel,
  open,
  onOpenChange,
  onSubmit,
}: {
  title: string;
  label: string;
  initial: string;
  help: string;
  confirmLabel: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);
  const error = name && !FOLDER_NAME.test(name) ? 'One level only: no slashes.' : null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={FolderPlusIcon}
            loading={busy}
            disabled={!name.trim() || !!error || name === initial}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(name.trim());
                onOpenChange(false);
              } catch (err) {
                failed(title)(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={label} help={help} error={error ?? undefined}>
        <Input mono value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}

/** The object browser (SPEC-0006 D-11): one level at a time, 1,000 per page, streamed transfers. */
export function ObjectBrowser({
  projectId,
  bucket,
  capabilities,
  readOnly,
}: {
  projectId: string;
  bucket: StorageBucket;
  capabilities: StorageCapabilities | undefined;
  readOnly: string | null;
}) {
  const [prefix, setPrefixParam] = useSearchState<string>('prefix', '');
  const [versions, setVersions] = useSearchState<'true' | 'false'>('versions', 'false', ['true', 'false']);
  const [deleted, setDeleted] = useSearchState<'true' | 'false'>('deleted', 'false', ['true', 'false']);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<ObjectTarget | null>(null);
  const [dialog, setDialog] = useState<'folder' | 'delete' | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const setPrefix = (p: string) => {
    setPrefixParam(p);
    setSearch('');
    setDebounced('');
    setSelection(new Set());
  };

  const list = useObjects(
    projectId,
    bucket.name,
    { prefix: prefix + debounced, flat: false, versions: versions === 'true', softDeleted: deleted === 'true' },
    bucket.hierarchicalNamespace,
  );
  const uploads = useUploads(projectId, bucket.name, () => void list.refetch());

  const rows = useMemo<Row[]>(() => {
    const pages = list.data?.pages ?? [];
    const folders = pages.flatMap((p) => p.prefixes).map((f): Row => ({ kind: 'folder', id: `f:${f}`, name: f }));
    const objects = pages
      .flatMap((p) => p.items)
      .filter((o) => o.name !== prefix)
      .map((o): Row => ({ kind: 'object', id: `o:${o.name}#${o.generation}`, name: o.name, o }));
    return [...folders, ...objects];
  }, [list.data, prefix]);
  const selectedObjects = rows.filter((r): r is Extract<Row, { kind: 'object' }> => r.kind === 'object' && selection.has(r.id));
  const selectedFolders = rows.filter((r) => r.kind === 'folder' && selection.has(r.id)).length;

  const rel = (name: string) => (name.startsWith(prefix) ? name.slice(prefix.length) : name);
  const columns: ResourceColumn<Row>[] = [
    {
      id: 'name',
      header: 'Name',
      hideable: false,
      sortValue: (r) => (r.kind === 'folder' ? `0${r.name}` : `1${r.name}`),
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          {r.kind === 'folder' ? (
            <FolderIcon size={14} className="shrink-0 text-ink-3" aria-hidden />
          ) : (
            <FileIcon size={14} className="shrink-0 text-ink-3" aria-hidden />
          )}
          <span className={r.kind === 'folder' ? 'truncate font-medium text-ink' : 'truncate text-ink'} title={r.name}>
            {rel(r.name) || r.name}
          </span>
        </span>
      ),
    },
    {
      id: 'size',
      header: 'Size',
      width: '7rem',
      align: 'right',
      sortValue: (r) => (r.kind === 'object' ? Number(r.o.size) : -1),
      cell: (r) => (r.kind === 'object' ? <span className="tnum">{bytes(r.o.size)}</span> : null),
    },
    {
      id: 'type',
      header: 'Type',
      width: '11rem',
      cell: (r) => (r.kind === 'object' && r.o.contentType ? <Mono value={r.o.contentType} /> : null),
    },
    {
      id: 'class',
      header: 'Class',
      width: '7rem',
      defaultHidden: true,
      cell: (r) => (r.kind === 'object' ? (r.o.storageClass ?? '') : null),
    },
    {
      id: 'updated',
      header: 'Updated',
      width: '10rem',
      sortValue: (r) => (r.kind === 'object' ? r.o.updated : null),
      cell: (r) => (r.kind === 'object' ? <Timestamp iso={r.o.updated} /> : null),
    },
    {
      id: 'state',
      header: 'State',
      width: '9rem',
      cell: (r) =>
        r.kind === 'object' ? (
          r.o.softDeleteTime ? (
            <StatusGlyph kind="warn" label="Soft-deleted" />
          ) : r.o.timeDeleted ? (
            <StatusGlyph kind="paused" label="Noncurrent" />
          ) : r.o.temporaryHold || r.o.eventBasedHold ? (
            <StatusGlyph kind="pending" label="Held" />
          ) : null
        ) : bucket.hierarchicalNamespace && !readOnly ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setRenaming(r.name);
            }}
          >
            Rename
          </Button>
        ) : null,
    },
    {
      id: 'generation',
      header: 'Generation',
      width: '11rem',
      defaultHidden: versions !== 'true',
      cell: (r) => (r.kind === 'object' ? <Mono value={r.o.generation} /> : null),
    },
  ];

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (readOnly) {
      toast.error(readOnly);
      return;
    }
    const files = await filesFromDrop(e.dataTransfer.items);
    if (files.length) uploads.add(files, prefix);
  };

  const inputProps = { webkitdirectory: '', directory: '' } as Record<string, string>;
  const toolbar = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Breadcrumb bucket={bucket.name} prefix={prefix} onPrefix={setPrefix} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Input
          data-filter-input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Names starting with"
          aria-label="Filter by name prefix"
          className="w-64"
          mono
        />
        <Button icon={UploadSimpleIcon} onClick={() => filesInput.current?.click()} disabled={!!readOnly} disabledReason={readOnly}>
          Upload files
        </Button>
        <Button onClick={() => folderInput.current?.click()} disabled={!!readOnly} disabledReason={readOnly}>
          Upload folder
        </Button>
        <Button icon={FolderPlusIcon} onClick={() => setDialog('folder')} disabled={!!readOnly} disabledReason={readOnly}>
          Create folder
        </Button>
        {selection.size > 0 ? (
          <Button
            variant="ghost"
            icon={TrashIcon}
            onClick={() => setDialog('delete')}
            disabled={!!readOnly || selectedObjects.length === 0}
            disabledReason={readOnly ?? (selectedObjects.length === 0 ? 'Folders are deleted by deleting their objects' : null)}
          >
            Delete {count(selectedObjects.length, 'object')}
          </Button>
        ) : null}
        <span className="ml-auto flex items-center gap-4">
          <span className="w-52">
            <Switch checked={versions === 'true'} onCheckedChange={(v) => setVersions(v ? 'true' : 'false')} label="Noncurrent versions" />
          </span>
          <span className="w-44">
            <Switch
              checked={deleted === 'true'}
              onCheckedChange={(v) => setDeleted(v ? 'true' : 'false')}
              label="Soft-deleted only"
              disabled={!bucket.softDeleteSeconds && deleted !== 'true'}
            />
          </span>
          <RefreshControl onRefresh={() => void list.refetch()} refreshing={list.isRefetching && !list.isFetchingNextPage} />
        </span>
      </div>
      <input
        ref={filesInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          uploads.add(filesFromInput(e.target.files), prefix);
          e.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        {...inputProps}
        onChange={(e) => {
          uploads.add(filesFromInput(e.target.files), prefix);
          e.target.value = '';
        }}
      />
    </div>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the upload buttons do the same by keyboard.
    <div
      className="relative pt-3"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <UploadPanel uploads={uploads} />
      {dragging ? (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-dialog border-2 border-dashed border-construct bg-construct-tint text-dense font-medium text-construct-ink">
          Drop files or folders to upload to {prefix ? <span className="ml-1 font-mono">{prefix}</span> : ' the bucket root'}
        </div>
      ) : null}
      {list.isPending ? (
        <DelayedSkeleton />
      ) : list.error instanceof ApiError ? (
        <ProblemState problem={list.error.problem} onRetry={() => void list.refetch()} />
      ) : (
        <ResourceTable
          tableId="storage-objects"
          label={prefix ? `Objects in ${prefix}` : 'Objects'}
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          selectable
          selection={selection}
          onSelectionChange={setSelection}
          onOpen={(r) => (r.kind === 'folder' ? setPrefix(r.name) : setOpen({ name: r.o.name, generation: r.o.generation }))}
          filtered={!!debounced || deleted === 'true'}
          emptyTitle={prefix ? 'This folder is empty' : 'This bucket is empty'}
          emptyText="Drop files or folders here, or use Upload files."
          hasMore={!!list.hasNextPage}
          loadingMore={list.isFetchingNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          toolbar={toolbar}
        />
      )}
      <ObjectSheet
        projectId={projectId}
        bucket={bucket}
        target={open}
        capabilities={capabilities}
        readOnly={readOnly}
        onOpenChange={(o) => !o && setOpen(null)}
        onChanged={() => void list.refetch()}
      />
      <FolderDialog
        title="Create folder"
        label="Folder name"
        initial=""
        help={
          bucket.hierarchicalNamespace
            ? `Created in ${prefix || 'the bucket root'}.`
            : `A zero-byte "${prefix}name/" object marks the folder until files are added.`
        }
        confirmLabel="Create folder"
        open={dialog === 'folder'}
        onOpenChange={(o) => !o && setDialog(null)}
        onSubmit={async (name) => {
          await createFolder(projectId, bucket.name, `${prefix}${name}/`, bucket.hierarchicalNamespace);
          toast.success(`Created ${name}/`);
          void list.refetch();
        }}
      />
      <FolderDialog
        title="Rename folder"
        label="New name"
        initial={renaming ? baseName(renaming) : ''}
        help="The folder and everything in it are renamed in one operation."
        confirmLabel="Rename folder"
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        onSubmit={async (name) => {
          if (!renaming) return;
          const parent = renaming.replace(/[^/]+\/$/, '');
          const r = await renameFolder(projectId, bucket.name, renaming, `${parent}${name}/`);
          useOperations.getState().upsert(r.operation);
          toast(`Renaming ${baseName(renaming)}`, { description: 'Follow it in the operations tray.' });
        }}
      />
      <ConfirmDestructive
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={selectedObjects.length === 1 ? 'Delete object' : `Delete ${selectedObjects.length} objects`}
        consequence={
          <>
            {bucket.softDeleteSeconds
              ? 'Deleted objects stay restorable for the bucket’s soft delete period.'
              : bucket.versioning
                ? 'Live objects become noncurrent versions; selected noncurrent versions are deleted permanently.'
                : 'The objects are deleted permanently.'}
            {selectedFolders ? ` The ${count(selectedFolders, 'selected folder')} and their contents are not deleted.` : ''}
          </>
        }
        expected={selectedObjects.length === 1 && selectedObjects[0] ? baseName(selectedObjects[0].name) : String(selectedObjects.length)}
        confirmLabel={selectedObjects.length === 1 ? 'Delete object' : `Delete ${selectedObjects.length} objects`}
        command={`gcloud storage rm ${selectedObjects
          .slice(0, 3)
          .map((r) => `gs://${bucket.name}/${r.name}`)
          .join(' ')}${selectedObjects.length > 3 ? ' …' : ''}`}
        onConfirm={async (confirm) => {
          const r = await deleteObjects(
            projectId,
            bucket.name,
            selectedObjects.map((s) => (s.o.timeDeleted ? { name: s.name, generation: s.o.generation } : { name: s.name })),
            confirm,
          );
          if (r.failures.length)
            toast.error(`${count(r.failures.length, 'object')} not deleted`, {
              description: r.failures
                .slice(0, 3)
                .map((f) => `${baseName(f.name)}: ${f.error}`)
                .join('\n'),
              duration: 10_000,
            });
          if (r.deleted) toast.success(`Deleted ${count(r.deleted, 'object')}`);
          setSelection(new Set());
          void list.refetch();
        }}
      />
    </div>
  );
}
