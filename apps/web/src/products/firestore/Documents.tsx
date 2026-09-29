import type { FirestoreDocument } from '@nephoscope/contracts';
import {
  diffFields,
  documentSize,
  type FieldChange,
  fieldPath,
  parseTypedJson,
  printTypedJson,
  printTypedValue,
  type WriteFields,
} from '@nephoscope/contracts/firestore-value';
import { CopySimpleIcon, FloppyDiskIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { CodeEditor, DiffEditor } from '../../design/code/CodeEditor';
import { Legend } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Dialog, Menu, MenuGroupLabel, MenuItem, MenuSeparator } from '../../design/Overlays';
import { Mono, Timestamp } from '../../design/Values';
import { ApiError } from '../../lib/api';
import { bytes } from '../../lib/format';
import { useOperations } from '../../state/operations';
import { createDocument, deleteDocument, documentsRoot, saveDocument, useCollections, useDocument, useInvalidateData } from './api';
import { type CodeLanguage, codeLanguages, documentCode } from './code';
import { FieldTree } from './FieldTree';
import { databaseHref, lastSegment, parentCollection, parseReference } from './paths';

export interface DbContext {
  projectId: string;
  databaseId: string;
  readOnly: string | null;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error('The clipboard is not available');
  }
}

/** Opens a reference in this database, or in its own database view (CA-07). */
export function useOpenReference(ctx: DbContext, openPath: (path: string) => void) {
  const navigate = useNavigate();
  return (name: string) => {
    const ref = parseReference(name);
    if (!ref) return;
    if (ref.projectId === ctx.projectId && ref.databaseId === ctx.databaseId) openPath(ref.path);
    else void navigate({ to: databaseHref(ref.projectId, ref.databaseId, 'data', { path: ref.path }) as string });
  };
}

// ---- editor -------------------------------------------------------------------------------------

interface EditorProps {
  ctx: DbContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing document, or creating one in `collection`. */
  document: FirestoreDocument | null;
  collection: string;
  onSaved: (doc: FirestoreDocument) => void;
}

function changeLabel(c: FieldChange): string {
  return c.kind === 'added' ? 'Added' : c.kind === 'removed' ? 'Removed' : 'Changed';
}

/**
 * Typed JSON editor with a review step (D-03, D-05, CA-09): the diff is shown before every save,
 * and the save carries the updateTime read with the document.
 */
export function DocumentEditor({ ctx, open, onOpenChange, document, collection, onSaved }: EditorProps) {
  const root = documentsRoot(ctx.projectId, ctx.databaseId);
  const initial = useMemo(() => (document ? printTypedJson(document.fields, { documentsRoot: root }) : '{\n  \n}'), [document, root]);
  const [text, setText] = useState(initial);
  const [id, setId] = useState('');
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const invalidate = useInvalidateData(ctx.projectId, ctx.databaseId);

  useEffect(() => {
    if (open) {
      setText(initial);
      setId('');
      setStep('edit');
      setConflict(false);
    }
  }, [open, initial]);

  const parsed = useMemo(() => parseTypedJson(text, { documentsRoot: root, allowTransforms: true }), [text, root]);
  const changes = useMemo(() => (parsed.ok ? diffFields(document?.fields ?? {}, parsed.value) : []), [parsed, document]);
  const idError =
    id && (id.includes('/') || /^__.*__$/.test(id) || id === '.' || id === '..') ? 'No slashes, and not . or .. or __name__ forms.' : null;
  const markers = parsed.ok ? [] : [{ line: parsed.error.line, column: parsed.error.column, message: parsed.error.message }];

  const save = async (overwrite: boolean) => {
    if (!parsed.ok) return;
    setBusy(true);
    try {
      const saved = document
        ? await saveDocument(ctx.projectId, ctx.databaseId, document.path, {
            fields: parsed.value,
            mask: overwrite ? null : changes.map((c) => fieldPath(c.path)),
            updateTime: overwrite ? null : document.updateTime,
          })
        : await createDocument(ctx.projectId, ctx.databaseId, { collection, ...(id ? { id } : {}), fields: parsed.value });
      toast.success(document ? `Saved ${saved.id}` : `Created ${saved.id}`);
      void invalidate();
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.problem.reason === 'DOCUMENT_CHANGED') setConflict(true);
      else
        toast.error(document ? 'Saving failed' : 'Creating the document failed', {
          description: err instanceof ApiError ? err.problem.detail : String(err),
        });
    } finally {
      setBusy(false);
    }
  };

  const title = document ? `Edit ${document.id}` : `Add a document to ${collection}`;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={title}
      description={
        document ? (
          <Mono value={document.path} />
        ) : (
          'Typed JSON: 1 is an integer, 1.0 a double. Wrappers such as {"$timestamp": "…"} cover the other types.'
        )
      }
      width="xl"
      footer={
        step === 'edit' ? (
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="commit"
              disabled={!parsed.ok || !!idError || (document !== null && changes.length === 0) || !!ctx.readOnly}
              disabledReason={
                ctx.readOnly ?? (!parsed.ok ? 'Fix the marked line first' : document && changes.length === 0 ? 'Nothing changed' : idError)
              }
              onClick={() => setStep('review')}
            >
              Review changes
            </Button>
          </>
        ) : conflict ? (
          <>
            <Button onClick={() => setStep('edit')}>Back to editing</Button>
            <Button
              onClick={() => {
                void invalidate();
                onOpenChange(false);
              }}
            >
              Discard and reload
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void save(true)}>
              Overwrite their change
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setStep('edit')} disabled={busy}>
              Back to editing
            </Button>
            <Button variant="commit" icon={document ? FloppyDiskIcon : PlusIcon} loading={busy} onClick={() => void save(false)}>
              {document ? 'Save document' : 'Create document'}
            </Button>
          </>
        )
      }
    >
      {step === 'edit' ? (
        <div className="flex flex-col gap-3">
          {!document ? (
            <Field label="Document id" help="Leave empty for a generated 20-character id." error={idError ?? undefined}>
              <Input mono value={id} onChange={(e) => setId(e.target.value)} placeholder="Generated" />
            </Field>
          ) : null}
          <CodeEditor
            value={text}
            onChange={setText}
            language="json"
            height="52vh"
            markers={markers}
            label="Document fields as typed JSON"
          />
          {!parsed.ok ? (
            <p className="m-0 text-meta text-redline-ink">
              Line {parsed.error.line}, column {parsed.error.column}: {parsed.error.message}
            </p>
          ) : (
            <p className="m-0 text-meta text-ink-3">
              Transforms run on the server: {'{"$serverTimestamp": true}'}, {'{"$increment": 1}'}, {'{"$arrayUnion": [...]}'},{' '}
              {'{"$arrayRemove": [...]}'}, {'{"$maximum": n}'}, {'{"$minimum": n}'}.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {conflict ? (
            <p role="alert" className="m-0 text-dense text-redline-ink">
              Changed since you opened it. Someone else saved this document after you loaded it. Reload to see their change, or overwrite it
              with yours.
            </p>
          ) : null}
          <div>
            <Legend>
              {document
                ? `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`
                : `${Object.keys(parsed.ok ? parsed.value : {}).length} fields`}
            </Legend>
            {document ? (
              <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 font-mono text-[12px]">
                {changes.map((c) => (
                  <li key={fieldPath(c.path)} className="grid grid-cols-[5rem_minmax(0,14rem)_minmax(0,1fr)] gap-x-3">
                    <span className={c.kind === 'removed' ? 'text-redline-ink' : c.kind === 'added' ? 'text-ok-ink' : 'text-ink-2'}>
                      {changeLabel(c)}
                    </span>
                    <span className="truncate text-ink">{fieldPath(c.path)}</span>
                    <span className="truncate text-ink-2">
                      {c.before ? printTypedValue(c.before, { documentsRoot: root }) : ''}
                      {c.before && c.after ? ' → ' : ''}
                      {c.after ? printTypedValue(c.after, { documentsRoot: root }) : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <DiffEditor
            original={document ? printTypedJson(document.fields, { documentsRoot: root }) : ''}
            modified={parsed.ok ? printTypedJson(parsed.value as WriteFields, { documentsRoot: root }) : text}
            language="json"
            height="42vh"
            label="Changes to the document"
          />
          {document ? (
            <p className="m-0 text-meta text-ink-3">
              Only the changed fields are written, and only if the document still has the update time you read (
              <Mono value={document.updateTime ?? ''} />
              ).
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

// ---- delete ----------------------------------------------------------------------------------------

export function DeleteDocumentDialog({
  ctx,
  document,
  open,
  onOpenChange,
  onDeleted,
}: {
  ctx: DbContext;
  document: { path: string; id: string; missing?: boolean };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [recursive, setRecursive] = useState(!!document.missing);
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidateData(ctx.projectId, ctx.databaseId);
  useEffect(() => {
    if (open) {
      setTyped('');
      setRecursive(!!document.missing);
    }
  }, [open, document.missing]);
  const matches = typed.trim() === document.id;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title="Delete document"
      width="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={TrashIcon}
            disabled={!matches || !!ctx.readOnly}
            disabledReason={ctx.readOnly}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await deleteDocument(ctx.projectId, ctx.databaseId, document.path, typed.trim(), recursive);
                if (r.operation) useOperations.getState().upsert(r.operation);
                toast.success(recursive ? `Deleting ${document.id} and its subcollections` : `Deleted ${document.id}`, {
                  description: recursive ? 'Follow it in the operations tray.' : undefined,
                });
                void invalidate();
                onDeleted();
                onOpenChange(false);
              } catch (err) {
                toast.error('Delete failed', { description: err instanceof ApiError ? err.problem.detail : String(err) });
              } finally {
                setBusy(false);
              }
            }}
          >
            {recursive ? 'Delete with subcollections' : 'Delete document'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 text-dense text-ink">
          <Mono value={document.path} /> is removed. Firestore has no undo.
        </p>
        <Switch
          checked={recursive}
          onCheckedChange={setRecursive}
          label="Also delete every subcollection"
          description="Without this, subcollections stay and the path shows as a document with no fields."
        />
        <Field label={`Type ${document.id} to confirm`}>
          <Input mono value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
      </div>
    </Dialog>
  );
}

// ---- document panel --------------------------------------------------------------------------------

export function CopyMenu({ ctx, doc }: { ctx: DbContext; doc: FirestoreDocument }) {
  const root = documentsRoot(ctx.projectId, ctx.databaseId);
  return (
    <Menu
      trigger={
        <Button size="sm" icon={CopySimpleIcon}>
          Copy
        </Button>
      }
    >
      <MenuItem onClick={() => void copy(doc.path, 'Path')}>Path</MenuItem>
      <MenuItem onClick={() => void copy(doc.id, 'Id')}>Id</MenuItem>
      <MenuItem onClick={() => void copy(printTypedJson(doc.fields, { documentsRoot: root }), 'Typed JSON')}>Typed JSON</MenuItem>
      <MenuSeparator />
      <MenuGroupLabel>Code to read this document</MenuGroupLabel>
      {codeLanguages.map((l) => (
        <MenuItem
          key={l.value}
          onClick={() => void copy(documentCode(l.value as CodeLanguage, ctx.projectId, ctx.databaseId, doc.path), `${l.label} code`)}
        >
          {l.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

export function DocumentPanel({ ctx, path, openPath }: { ctx: DbContext; path: string; openPath: (path: string) => void }) {
  const doc = useDocument(ctx.projectId, ctx.databaseId, path);
  const subs = useCollections(ctx.projectId, ctx.databaseId, path);
  const [view, setView] = useState<'fields' | 'json'>('fields');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const root = documentsRoot(ctx.projectId, ctx.databaseId);
  const openReference = useOpenReference(ctx, openPath);
  const subcollections = subs.data?.pages.flatMap((p) => p.items) ?? [];
  const missing = doc.error instanceof ApiError && doc.error.problem.code === 'NOT_FOUND';

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-6 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-ink">{lastSegment(path)}</span>
        {doc.data ? (
          <>
            <Select<'fields' | 'json'>
              value={view}
              onValueChange={setView}
              aria-label="Document view"
              options={[
                { value: 'fields', label: 'Fields' },
                { value: 'json', label: 'Typed JSON' },
              ]}
              className="w-32"
            />
            <CopyMenu ctx={ctx} doc={doc.data} />
            <Button
              size="sm"
              icon={PencilSimpleIcon}
              onClick={() => setEditing(true)}
              disabled={!!ctx.readOnly}
              disabledReason={ctx.readOnly}
            >
              Edit
            </Button>
          </>
        ) : null}
        {doc.data || (missing && subcollections.length > 0) ? (
          <Button
            size="sm"
            variant="ghost"
            icon={TrashIcon}
            onClick={() => setDeleting(true)}
            disabled={!!ctx.readOnly}
            disabledReason={ctx.readOnly}
          >
            Delete
          </Button>
        ) : null}
      </div>
      {doc.isPending ? (
        <DelayedSkeleton rows={6} className="p-6" />
      ) : missing ? (
        <EmptyState title="No document">
          {subcollections.length > 0 ? 'Nothing is stored at this path, but it has subcollections.' : 'No document exists at this path.'}
        </EmptyState>
      ) : doc.error instanceof ApiError ? (
        <ProblemState problem={doc.error.problem} onRetry={() => void doc.refetch()} />
      ) : doc.data ? (
        <>
          <dl className="m-0 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-6 py-3 text-meta">
            <dt className="text-ink-3">Path</dt>
            <dd className="m-0">
              <Mono value={doc.data.path} copy />
            </dd>
            <dt className="text-ink-3">Created</dt>
            <dd className="m-0">
              <Timestamp iso={doc.data.createTime} />
            </dd>
            <dt className="text-ink-3">Updated</dt>
            <dd className="m-0">
              <Timestamp iso={doc.data.updateTime} />
            </dd>
            <dt className="text-ink-3">Size</dt>
            <dd className="m-0 tnum">About {bytes(documentSize(doc.data.path, doc.data.fields))} of the 1 MiB limit</dd>
          </dl>
          {view === 'fields' ? (
            <FieldTree fields={doc.data.fields} documentsRoot={root} onOpenReference={openReference} label={`Fields of ${doc.data.id}`} />
          ) : (
            <div className="px-6 pb-3">
              <CodeEditor
                value={printTypedJson(doc.data.fields, { documentsRoot: root })}
                language="json"
                readOnly
                height={420}
                label={`${doc.data.id} as typed JSON`}
              />
            </div>
          )}
        </>
      ) : null}
      <div className="px-6 pt-4 pb-2">
        <Legend>Subcollections</Legend>
      </div>
      {subs.isPending ? null : subcollections.length === 0 ? (
        <p className="m-0 px-6 text-meta text-ink-3">None.</p>
      ) : (
        <ul className="m-0 list-none border-t border-rule p-0">
          {subcollections.map((c) => (
            <li key={c}>
              <button
                type="button"
                className="w-full border-b border-rule px-6 py-1.5 text-left font-mono text-[12px] text-ink hover:bg-hover"
                onClick={() => openPath(`${path}/${c}`)}
              >
                {c}
              </button>
            </li>
          ))}
        </ul>
      )}
      {subs.hasNextPage ? (
        <div className="px-6 pt-2">
          <Button size="sm" onClick={() => void subs.fetchNextPage()} loading={subs.isFetchingNextPage}>
            Load more subcollections
          </Button>
        </div>
      ) : null}
      {doc.data ? (
        <DocumentEditor
          ctx={ctx}
          open={editing}
          onOpenChange={setEditing}
          document={doc.data}
          collection={parentCollection(path)}
          onSaved={() => void doc.refetch()}
        />
      ) : null}
      <DeleteDocumentDialog
        ctx={ctx}
        document={{ path, id: lastSegment(path), missing }}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => openPath(parentCollection(path))}
      />
    </div>
  );
}
