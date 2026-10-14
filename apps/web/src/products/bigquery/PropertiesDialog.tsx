import { useEffect, useRef, useState } from 'react';
import { Button } from '../../design/Button';
import { Field, Input } from '../../design/Form';
import { Dialog } from '../../design/Overlays';
import { ApiError } from '../../lib/api';

const LABEL = /^[a-z][a-z0-9_-]{0,62}=[a-z0-9_-]{0,63}$/;

/** `k=v, k2=v2` as labels, or the first entry that is not a valid label. */
export function parseLabelText(text: string): { labels: Record<string, string> } | { error: string } {
  const labels: Record<string, string> = {};
  for (const raw of text.split(',')) {
    const pair = raw.trim();
    if (!pair) continue;
    if (!LABEL.test(pair)) return { error: `"${pair}" is not key=value with lowercase letters, digits, - and _.` };
    const i = pair.indexOf('=');
    labels[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return { labels };
}

export const labelText = (labels: Record<string, string>) =>
  Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

export interface PropertiesValues {
  description: string;
  labels: Record<string, string>;
  /** Days, or null for none. */
  expirationDays: number | null;
}

interface PropertiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  saveLabel: string;
  initial: { description: string; labels: Record<string, string>; expirationDays: string };
  expirationLabel: string;
  expirationHelp: string;
  onSave: (v: PropertiesValues) => Promise<unknown>;
}

/** Description, expiration and labels of a dataset or table (SPEC-0008 D-01). */
export function PropertiesDialog({
  open,
  onOpenChange,
  title,
  saveLabel,
  initial,
  expirationLabel,
  expirationHelp,
  onSave,
}: PropertiesDialogProps) {
  const [description, setDescription] = useState('');
  const [expiration, setExpiration] = useState('');
  const [labels, setLabels] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Callers build `initial` on every render; the form is reset only when the dialog opens.
  const initialRef = useRef(initial);
  initialRef.current = initial;
  useEffect(() => {
    if (!open) return;
    const i = initialRef.current;
    setDescription(i.description);
    setExpiration(i.expirationDays);
    setLabels(labelText(i.labels));
    setError(null);
  }, [open]);
  async function save() {
    const parsed = parseLabelText(labels);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    const days = expiration.trim() ? Number(expiration) : null;
    if (days !== null && (!Number.isInteger(days) || days < 1)) {
      setError('The expiration is a whole number of days, 1 or more, or empty.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({ description, labels: parsed.labels, expirationDays: days });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={title}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="commit" loading={busy} onClick={() => void save()}>
            {saveLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={expirationLabel} help={expirationHelp}>
          <Input value={expiration} onChange={(e) => setExpiration(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Labels" help="key=value pairs, comma-separated. Removing one removes the label.">
          <Input value={labels} onChange={(e) => setLabels(e.target.value)} mono />
        </Field>
        {error ? (
          <p role="alert" className="m-0 text-dense text-redline-ink">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
