import type { CloudFunction, SourceFile } from '@nephoscope/contracts';
import { DownloadSimpleIcon, FilePlusIcon, RocketIcon, TrashIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { CodeEditor, languageForPath } from '../../design/code/CodeEditor';
import { type Note, Notes } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input } from '../../design/Form';
import { Dialog } from '../../design/Overlays';
import { RevisionMark } from '../../design/Status';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { bytes } from '../../lib/format';
import { downloadSource, useFunctionSource, useRedeploySource } from './api';

interface SourceTabProps {
  projectId: string;
  fn: CloudFunction;
  readOnlyReason: string | null;
}

/** View every function's source; edit and redeploy gen2 source (SPEC-0003 D-09, CA-17). */
export function SourceTab({ projectId, fn, readOnlyReason }: SourceTabProps) {
  const query = useFunctionSource(projectId, fn.location, fn.id, true);
  const redeploy = useRedeploySource(projectId, fn.location, fn.id);
  const [selected, setSelected] = useSearchState<string>('file', '');
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [newPath, setNewPath] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const editable = fn.sourceEditable && !readOnlyReason;

  const files = useMemo<SourceFile[]>(() => {
    const base = (query.data?.files ?? []).filter((f) => !deleted.has(f.path));
    const extra = [...added].filter((p) => !base.some((f) => f.path === p)).map((path) => ({ path, size: 0, text: '', binary: false }));
    return [...base, ...extra].sort((a, b) => a.path.localeCompare(b.path));
  }, [query.data, deleted, added]);

  const current =
    files.find((f) => f.path === selected) ??
    files.find((f) => /(^|\/)(index|main)\.[a-z]+$/.test(f.path) && !f.binary) ??
    files.find((f) => !f.binary) ??
    null;
  const changedPaths = [...edits.keys()].filter((p) => !deleted.has(p));
  const dirty = changedPaths.length > 0 || deleted.size > 0;
  const contentOf = (f: SourceFile) => edits.get(f.path) ?? f.text ?? '';

  const notes: Note[] = [];
  if (fn.generation === 'gen1')
    notes.push({
      id: 'gen1',
      tone: 'info',
      text: 'First generation functions are read-only here. Redeploy them with gcloud functions deploy.',
    });
  else if (!fn.sourceEditable)
    notes.push({
      id: 'repo',
      tone: 'info',
      text: 'This function was deployed from a repository, not an uploaded archive, so its source is read-only here.',
    });
  if (query.data?.note) notes.push({ id: 'large', tone: 'info', text: query.data.note });

  if (query.isPending) return <DelayedSkeleton rows={10} />;
  if (query.error instanceof ApiError) return <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />;
  if (files.length === 0) return <EmptyState title="Empty archive">The source archive has no files.</EmptyState>;

  const addFile = () => {
    const path = newPath.trim().replace(/^\/+/, '');
    if (!path || path.split('/').includes('..') || files.some((f) => f.path === path)) {
      toast.error('Choose a new relative path, such as lib/util.js');
      return;
    }
    setAdded((prev) => new Set(prev).add(path));
    setEdits((prev) => new Map(prev).set(path, ''));
    setSelected(path);
    setNewPath('');
  };

  return (
    <div className="flex flex-col">
      <Notes notes={notes} />
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <span className="text-meta text-ink-3">
          {files.length} files, {bytes(query.data?.archiveBytes ?? 0)} archive
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Button
            icon={DownloadSimpleIcon}
            loading={downloading}
            onClick={() => {
              setDownloading(true);
              downloadSource(projectId, fn.location, fn.id)
                .catch((err) => toast.error('Download failed', { description: err instanceof ApiError ? err.problem.detail : String(err) }))
                .finally(() => setDownloading(false));
            }}
          >
            Download archive
          </Button>
          {fn.sourceEditable ? (
            <Button
              variant="commit"
              icon={RocketIcon}
              disabled={!dirty || !!readOnlyReason}
              disabledReason={readOnlyReason ?? 'Edit a file first'}
              onClick={() => setConfirming(true)}
            >
              Redeploy source
            </Button>
          ) : null}
        </span>
      </div>
      <div className="grid min-h-[60vh] grid-cols-[16rem_1fr] border-t border-rule">
        <nav aria-label="Source files" className="flex flex-col border-r border-rule">
          <ul className="m-0 flex-1 list-none overflow-y-auto p-0 py-1">
            {files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => setSelected(f.path)}
                  aria-current={current?.path === f.path ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-1 truncate px-3 py-1 text-left font-mono text-[12px]',
                    current?.path === f.path ? 'bg-construct-tint text-ink' : 'text-ink-2 hover:bg-hover',
                    f.binary && 'text-ink-3',
                  )}
                >
                  <span className="truncate">{f.path}</span>
                  {edits.has(f.path) ? <RevisionMark label={added.has(f.path) ? 'New' : 'Changed'} /> : null}
                </button>
              </li>
            ))}
          </ul>
          {editable ? (
            <form
              className="flex items-end gap-1 border-t border-rule p-2"
              onSubmit={(e) => {
                e.preventDefault();
                addFile();
              }}
            >
              <Field label="New file" className="flex-1">
                <Input mono value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="lib/util.js" />
              </Field>
              <IconButton icon={FilePlusIcon} label="Add file" type="submit" />
            </form>
          ) : null}
        </nav>
        <div className="flex min-w-0 flex-col gap-2 p-3">
          {current ? (
            <>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-ink">{current.path}</span>
                <span className="text-meta text-ink-3">{bytes(current.size)}</span>
                {editable && !current.binary ? (
                  <span className="ml-auto">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={TrashIcon}
                      onClick={() => {
                        if (added.has(current.path)) {
                          setAdded((prev) => {
                            const next = new Set(prev);
                            next.delete(current.path);
                            return next;
                          });
                        } else {
                          setDeleted((prev) => new Set(prev).add(current.path));
                        }
                        setEdits((prev) => {
                          const next = new Map(prev);
                          next.delete(current.path);
                          return next;
                        });
                        setSelected('');
                      }}
                    >
                      Delete file
                    </Button>
                  </span>
                ) : null}
              </div>
              {current.binary ? (
                <p className="m-0 text-dense text-ink-3">Binary file; download the archive to open it.</p>
              ) : current.text === null && !edits.has(current.path) ? (
                <p className="m-0 text-dense text-ink-3">This file is over 2 MiB; download the archive to open it.</p>
              ) : (
                <CodeEditor
                  key={current.path}
                  value={contentOf(current)}
                  language={languageForPath(current.path)}
                  readOnly={!editable}
                  path={`source/${current.path}`}
                  height="62vh"
                  label={`Source of ${current.path}`}
                  onChange={(v) =>
                    setEdits((prev) => {
                      const next = new Map(prev);
                      if (!added.has(current.path) && v === current.text) next.delete(current.path);
                      else next.set(current.path, v);
                      return next;
                    })
                  }
                />
              )}
            </>
          ) : (
            <p className="m-0 text-dense text-ink-3">Choose a file.</p>
          )}
        </div>
      </div>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Redeploy ${fn.id}`}
        description="Builds a new version from the current archive with these changes. The function keeps serving the current version until the build succeeds."
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button
              variant="commit"
              icon={RocketIcon}
              loading={redeploy.isPending}
              onClick={() =>
                redeploy.mutate(
                  { changed: changedPaths.map((path) => ({ path, content: edits.get(path) ?? '' })), deleted: [...deleted] },
                  {
                    onSuccess: () => {
                      setConfirming(false);
                      setEdits(new Map());
                      setDeleted(new Set());
                      setAdded(new Set());
                      void query.refetch();
                    },
                  },
                )
              }
            >
              Redeploy source
            </Button>
          </>
        }
      >
        <ul className="m-0 flex list-none flex-col gap-1 p-0 font-mono text-[12px]">
          {changedPaths.map((p) => (
            <li key={p} className="text-ink">
              {added.has(p) ? 'added' : 'changed'} {p}
            </li>
          ))}
          {[...deleted].map((p) => (
            <li key={p} className="text-redline-ink">
              deleted {p}
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
