import { XIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '../../design/Button';
import { Legend } from '../../design/Drafting';
import { bytes } from '../../lib/format';
import { UploadError, type UploadHandle, uploadFile } from './api';

export interface PickedFile {
  file: File;
  /** Path relative to the drop or the picked folder, with / separators. */
  path: string;
}

type Status = 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled' | 'exists' | 'skipped';

interface Task {
  id: number;
  name: string;
  file: File;
  loaded: number;
  status: Status;
  error: string | null;
  overwrite: boolean;
}

/** D-11: three files at a time. */
const CONCURRENCY = 3;

/** Every file under the dropped items, folders included. Entries must be taken during the drop event. */
export async function filesFromDrop(items: DataTransferItemList): Promise<PickedFile[]> {
  const entries = [...items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  const out: PickedFile[] = [];
  const walk = async (entry: FileSystemEntry, dir: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ file, path: `${dir}${entry.name}` });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, `${dir}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

export function filesFromInput(list: FileList | null): PickedFile[] {
  return [...(list ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/** The upload queue of one bucket: progress per file, cancel, and overwrite only when confirmed (D-11). */
export function useUploads(projectId: string, bucket: string, onUploaded: () => void) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const handles = useRef(new Map<number, UploadHandle>());
  const started = useRef(new Set<number>());
  const nextId = useRef(1);
  const uploaded = useRef(onUploaded);
  uploaded.current = onUploaded;

  const patch = useCallback((id: number, p: Partial<Task>) => setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t))), []);

  const add = useCallback((files: PickedFile[], prefix: string) => {
    setTasks((ts) => [
      ...ts,
      ...files.map((f) => ({
        id: nextId.current++,
        name: `${prefix}${f.path}`,
        file: f.file,
        loaded: 0,
        status: 'queued' as const,
        error: null,
        overwrite: false,
      })),
    ]);
  }, []);

  useEffect(() => {
    const active = tasks.filter((t) => t.status === 'uploading').length;
    const next = tasks.filter((t) => t.status === 'queued' && !started.current.has(t.id)).slice(0, Math.max(0, CONCURRENCY - active));
    for (const t of next) {
      started.current.add(t.id);
      patch(t.id, { status: 'uploading', loaded: 0, error: null });
      const h = uploadFile(projectId, bucket, t.name, t.file, t.overwrite, (loaded) => patch(t.id, { loaded }));
      handles.current.set(t.id, h);
      h.promise
        .then(() => {
          patch(t.id, { status: 'done', loaded: t.file.size });
          uploaded.current();
        })
        .catch((err: unknown) => {
          const e = err instanceof UploadError ? err : null;
          if (e?.problem?.reason === 'OBJECT_EXISTS') patch(t.id, { status: 'exists', error: null });
          else if (e?.message === 'Cancelled') patch(t.id, { status: 'cancelled' });
          else patch(t.id, { status: 'failed', error: e?.message ?? String(err) });
        })
        .finally(() => handles.current.delete(t.id));
    }
  }, [tasks, projectId, bucket, patch]);

  useEffect(() => {
    const current = handles.current;
    return () => {
      for (const h of current.values()) h.abort();
    };
  }, []);

  const cancel = (id: number) => {
    const h = handles.current.get(id);
    if (h) h.abort();
    else setTasks((ts) => ts.map((t) => (t.id === id && t.status === 'queued' ? { ...t, status: 'cancelled' } : t)));
  };
  const cancelAll = () => {
    setTasks((ts) => ts.map((t) => (t.status === 'queued' ? { ...t, status: 'cancelled' } : t)));
    for (const h of handles.current.values()) h.abort();
  };
  const overwriteExisting = () =>
    setTasks((ts) =>
      ts.map((t) => {
        if (t.status !== 'exists') return t;
        started.current.delete(t.id);
        return { ...t, status: 'queued', overwrite: true, loaded: 0 };
      }),
    );
  const skipExisting = () => setTasks((ts) => ts.map((t) => (t.status === 'exists' ? { ...t, status: 'skipped' } : t)));
  const retry = (id: number) => {
    started.current.delete(id);
    patch(id, { status: 'queued', loaded: 0, error: null });
  };
  const clear = () => setTasks((ts) => ts.filter((t) => t.status === 'queued' || t.status === 'uploading' || t.status === 'exists'));
  return { tasks, add, cancel, cancelAll, overwriteExisting, skipExisting, retry, clear };
}

const statusLabel: Record<Status, string> = {
  queued: 'Waiting',
  uploading: '',
  done: 'Uploaded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  exists: 'Already exists',
  skipped: 'Skipped',
};

export function UploadPanel({ uploads }: { uploads: ReturnType<typeof useUploads> }) {
  const { tasks } = uploads;
  if (tasks.length === 0) return null;
  const n = (s: Status) => tasks.filter((t) => t.status === s).length;
  const running = n('queued') + n('uploading');
  const exists = n('exists');
  const total = tasks.reduce((a, t) => a + t.file.size, 0);
  const loaded = tasks.reduce((a, t) => a + (t.status === 'done' ? t.file.size : t.loaded), 0);
  return (
    <section aria-label="Uploads" className="mx-6 mb-3 rounded-control border border-rule bg-panel">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-3 py-2">
        <Legend>Uploads</Legend>
        <span className="text-meta text-ink-2 tnum" aria-live="polite">
          {running > 0 ? `${running} left, ` : ''}
          {n('done')} of {tasks.length} uploaded
          {n('failed') ? `, ${n('failed')} failed` : ''} · {bytes(loaded)} of {bytes(total)}
        </span>
        <span className="ml-auto flex gap-2">
          {running > 0 ? (
            <Button size="sm" onClick={uploads.cancelAll}>
              Cancel all
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={uploads.clear}>
              Clear finished
            </Button>
          )}
        </span>
      </div>
      {exists > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-rule bg-warn-tint px-3 py-2 text-dense text-warn-ink">
          <span>
            {exists === 1 ? '1 object already exists.' : `${exists} objects already exist.`} Uploading replaces
            {exists === 1 ? ' it' : ' them'}.
          </span>
          <span className="ml-auto flex gap-2">
            <Button size="sm" onClick={uploads.skipExisting}>
              Skip {exists === 1 ? 'it' : 'them'}
            </Button>
            <Button size="sm" variant="danger" onClick={uploads.overwriteExisting}>
              Overwrite {exists === 1 ? '1 object' : `${exists} objects`}
            </Button>
          </span>
        </div>
      ) : null}
      <ul className="m-0 max-h-56 list-none overflow-y-auto p-0">
        {tasks.map((t) => {
          const pct = t.file.size ? Math.min(100, (t.loaded / t.file.size) * 100) : t.status === 'done' ? 100 : 0;
          return (
            <li
              key={t.id}
              className="grid grid-cols-[minmax(0,1fr)_8rem_6rem_4rem] items-center gap-3 border-b border-rule px-3 py-1 last:border-b-0"
            >
              <span className="truncate font-mono text-[12px]" title={t.name}>
                {t.name}
              </span>
              {t.status === 'uploading' ? (
                <span
                  className="block h-1.5 overflow-hidden rounded-pill bg-well"
                  role="progressbar"
                  aria-label={`Uploading ${t.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(pct)}
                >
                  <span className="block h-full bg-construct" style={{ width: `${pct}%` }} />
                </span>
              ) : (
                <span
                  className={t.status === 'failed' ? 'truncate text-meta text-redline-ink' : 'text-meta text-ink-3'}
                  title={t.error ?? undefined}
                >
                  {t.status === 'failed' && t.error ? t.error : statusLabel[t.status]}
                </span>
              )}
              <span className="text-right text-meta text-ink-3 tnum">{bytes(t.file.size)}</span>
              {t.status === 'queued' || t.status === 'uploading' ? (
                <IconButton icon={XIcon} size="sm" label={`Cancel ${t.name}`} onClick={() => uploads.cancel(t.id)} />
              ) : t.status === 'failed' ? (
                <Button size="sm" variant="ghost" onClick={() => uploads.retry(t.id)}>
                  Retry
                </Button>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
