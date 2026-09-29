import { type ReactNode, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { Button } from './Button';
import { Legend } from './Drafting';
import { Field, Input } from './Form';
import { Dialog } from './Overlays';

interface ConfirmDestructiveProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Verb and object, such as "Delete profile". */
  title: string;
  /** The consequence in one sentence. */
  consequence: ReactNode;
  /** What must be typed: the resource short name, or the item count (SPEC-0001 D-13). */
  expected: string;
  /** The danger button's label: the specific action ("Delete profile"), never "OK". */
  confirmLabel: string;
  onConfirm: (confirm: string) => Promise<unknown>;
  /** Equivalent command, when there is one (SPEC-0001 CA-65). */
  command?: string;
}

/** Typed confirmation for destructive actions (SPEC-0002 CA-24). */
export function ConfirmDestructive({
  open,
  onOpenChange,
  title,
  consequence,
  expected,
  confirmLabel,
  onConfirm,
  command,
}: ConfirmDestructiveProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setTyped('');
      setError(null);
    }
  }, [open]);
  const matches = typed.trim() === expected;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={title}
      width="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!matches}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(typed.trim());
                onOpenChange(false);
              } catch (err) {
                setError(err instanceof ApiError ? err.problem.detail : 'The action failed.');
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
      <div className="flex flex-col gap-4">
        <p className="m-0 text-dense text-ink">{consequence}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <Field label={`Type ${expected} to confirm`} error={error}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} mono autoFocus />
          </Field>
        </form>
        {command ? (
          <details className="text-meta text-ink-2">
            <summary className="cursor-pointer select-none">
              <Legend>Equivalent command</Legend>
            </summary>
            <pre className="mt-2 mb-0 overflow-x-auto rounded-control bg-well p-2 font-mono text-[11px] text-ink">{command}</pre>
          </details>
        ) : null}
      </div>
    </Dialog>
  );
}
