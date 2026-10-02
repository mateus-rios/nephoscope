import { COLAB_REGIONS, type ColabNotebookDetail, NOTEBOOK_MAX_BYTES } from '@nephoscope/contracts';
import { FileArrowUpIcon, PlusIcon } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { Button } from '../../design/Button';
import { Field, Input, Select } from '../../design/Form';
import { Dialog, Sheet } from '../../design/Overlays';
import { bytes } from '../../lib/format';
import { colabHref, useCreateNotebook, useRenameNotebook, useSaveNotebook } from './api';

interface PickedFile {
  name: string;
  size: number;
  text: string;
  error: string | null;
}

/** Reads a chosen .ipynb and checks it is JSON with cells before anything is sent. */
async function readNotebookFile(file: File): Promise<PickedFile> {
  if (file.size > NOTEBOOK_MAX_BYTES)
    return { name: file.name, size: file.size, text: '', error: `Notebooks up to ${bytes(NOTEBOOK_MAX_BYTES)}.` };
  const text = await file.text();
  try {
    const nb = JSON.parse(text) as { cells?: unknown };
    if (!Array.isArray(nb.cells))
      return { name: file.name, size: file.size, text, error: 'The file has no cells; it is not a Jupyter notebook.' };
  } catch {
    return { name: file.name, size: file.size, text, error: 'The file is not valid JSON.' };
  }
  return { name: file.name, size: file.size, text, error: null };
}

function FilePicker({
  label,
  picked,
  onPick,
  help,
}: {
  label: string;
  picked: PickedFile | null;
  onPick: (f: PickedFile | null) => void;
  help?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-dense font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type="file"
        accept=".ipynb,application/x-ipynb+json,application/json"
        className="text-dense text-ink-2 file:mr-3 file:rounded-control file:border file:border-rule-strong file:bg-sheet file:px-3 file:py-1 file:text-dense file:text-ink"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          onPick(file ? await readNotebookFile(file) : null);
        }}
      />
      {picked ? (
        <span className={picked.error ? 'text-meta text-redline-ink' : 'text-meta text-ink-3'}>
          {picked.error ?? `${picked.name}, ${bytes(picked.size)}`}
        </span>
      ) : help ? (
        <span className="text-meta text-ink-3">{help}</span>
      ) : null}
    </div>
  );
}

interface CreateNotebookSheetProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  region?: string;
  readOnlyReason: string | null;
}

/** A new notebook, empty or from an .ipynb file (SPEC-0010 D-04, CA-02). */
export function CreateNotebookSheet({ projectId, open, onOpenChange, region, readOnlyReason }: CreateNotebookSheetProps) {
  const [r, setR] = useState(region && region !== 'all' ? region : 'us-central1');
  const [name, setName] = useState('');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [touched, setTouched] = useState(false);
  const create = useCreateNotebook(projectId);
  const navigate = useNavigate();
  useEffect(() => {
    if (open) {
      setR(region && region !== 'all' ? region : 'us-central1');
      setName('');
      setFile(null);
      setTouched(false);
    }
  }, [open, region]);
  const error = !name.trim() ? 'A name for the notebook.' : null;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create notebook"
      description="Notebooks live in a region, stored as a Dataform repository with one .ipynb file."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PlusIcon}
            loading={create.isPending}
            disabled={!!readOnlyReason || !!file?.error}
            disabledReason={readOnlyReason ?? file?.error ?? null}
            onClick={() => {
              setTouched(true);
              if (error) return;
              create.mutate(
                { region: r, displayName: name.trim(), content: file?.text },
                {
                  onSuccess: (n) => {
                    onOpenChange(false);
                    void navigate({ to: colabHref.notebook(projectId, n.location, n.id) as string });
                  },
                },
              );
            }}
          >
            Create notebook
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FilePicker
          label="Notebook file"
          picked={file}
          onPick={(f) => {
            setFile(f);
            if (f && !name.trim()) setName(f.name);
          }}
          help="Optional. Without a file the notebook starts with one empty cell."
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" error={touched ? error : undefined} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled.ipynb" />
          </Field>
          <Field label="Region">
            <Select<string> value={r} onValueChange={setR} options={COLAB_REGIONS.map((x) => ({ value: x, label: x }))} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}

/** Uploads an .ipynb as the next version; refused if someone saved since this page loaded (SPEC-0010 D-05, CA-02). */
export function UploadVersionDialog({
  projectId,
  notebook,
  open,
  onOpenChange,
  readOnlyReason,
}: {
  projectId: string;
  notebook: ColabNotebookDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnlyReason: string | null;
}) {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [message, setMessage] = useState('');
  const save = useSaveNotebook(projectId, notebook.location, notebook.id);
  useEffect(() => {
    if (open) {
      setFile(null);
      setMessage('');
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Upload a new version"
      description={`Replaces ${notebook.path ?? 'the notebook file'} with the file you choose. Earlier versions stay in the history.`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={FileArrowUpIcon}
            loading={save.isPending}
            disabled={!!readOnlyReason || !file || !!file.error}
            disabledReason={readOnlyReason ?? (file?.error || (!file ? 'Choose a file first.' : null))}
            onClick={() =>
              file &&
              save.mutate(
                { content: file.text, message: message.trim(), baseCommitSha: notebook.head?.sha ?? null },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            Save version
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FilePicker label="Notebook file" picked={file} onPick={setFile} />
        <Field label="Description of the change">
          <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Update the date filter" />
        </Field>
        {notebook.head ? (
          <p className="m-0 text-meta text-ink-3">
            Based on version {notebook.head.sha.slice(0, 7)}. If someone saves before you, Nephoscope refuses the upload instead of
            overwriting.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

export function RenameNotebookDialog({
  projectId,
  notebook,
  open,
  onOpenChange,
  readOnlyReason,
}: {
  projectId: string;
  notebook: ColabNotebookDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnlyReason: string | null;
}) {
  const [name, setName] = useState(notebook.displayName);
  const rename = useRenameNotebook(projectId, notebook.location, notebook.id);
  useEffect(() => {
    if (open) setName(notebook.displayName);
  }, [open, notebook.displayName]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename notebook"
      width="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={rename.isPending}
            disabled={!!readOnlyReason || !name.trim() || name.trim() === notebook.displayName}
            disabledReason={readOnlyReason}
            onClick={() => rename.mutate(name.trim(), { onSuccess: () => onOpenChange(false) })}
          >
            Rename
          </Button>
        </>
      }
    >
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}
