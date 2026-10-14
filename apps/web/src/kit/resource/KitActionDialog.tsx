import { fillKitTemplate, type KitAction, type KitField, type KitItem, readPath, validateKitValues } from '@nephoscope/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Dialog } from '../../design/Overlays';
import { ApiError } from '../../lib/api';
import { useOperations } from '../../state/operations';
import { useSession } from '../../state/session';
import { EquivalentCommand } from '../EquivalentCommand';
import { runKitAction } from './kitApi';

type Values = Record<string, string | boolean>;

function initialValues(fields: readonly KitField[], item: KitItem | null): Values {
  const out: Values = {};
  for (const f of fields) {
    // A password is never prefilled from the item.
    const from = f.from && item && f.kind !== 'password' ? readPath(item, f.from) : undefined;
    const v = from ?? f.initial;
    out[f.id] = f.kind === 'bool' ? v === true : v === undefined || v === null ? '' : String(v);
  }
  return out;
}

/** Values with passwords hidden, for the equivalent command. */
function masked(fields: readonly KitField[], values: Record<string, unknown>): Record<string, unknown> {
  const out = { ...values };
  for (const f of fields) if (f.kind === 'password' && out[f.id] !== undefined && out[f.id] !== '') out[f.id] = '********';
  return out;
}

interface KitActionDialogProps {
  projectId: string;
  collectionKey: string;
  action: KitAction | null;
  item: KitItem | null;
  /** Parent item path, for a create action of a child collection. */
  parent?: string;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}

/**
 * Runs a kit action (SPEC-0001 D-16): its fields, the consequence, the typed name when the action
 * destroys something (D-13), and the equivalent command (CA-65).
 */
export function KitActionDialog({ projectId, collectionKey, action, item, parent, onOpenChange, onDone }: KitActionDialogProps) {
  const fields = action?.fields ?? [];
  const [values, setValues] = useState<Values>({});
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  useEffect(() => {
    if (action) {
      setValues(initialValues(action.fields ?? [], item));
      setTyped('');
      setError(null);
      setTouched(false);
    }
  }, [action, item]);
  const checked = useMemo(() => validateKitValues(fields, values), [fields, values]);
  const errors = checked.ok ? {} : Object.fromEntries(checked.errors.map((e) => [e.path, e.message]));
  const id = item?._path.split('/').pop() ?? '';
  const confirmOk = !action?.confirm || typed.trim() === id;
  const command = action?.gcloud
    ? fillKitTemplate(action.gcloud, { project: projectId, item, values: masked(fields, checked.ok ? checked.values : values) })
    : null;

  async function run() {
    if (!action) return;
    setTouched(true);
    if (!checked.ok || !confirmOk) return;
    setBusy(true);
    setError(null);
    try {
      const { operation } = await runKitAction(projectId, collectionKey, action.id, {
        path: item?._path,
        parent: action.scope === 'collection' ? parent : undefined,
        confirm: action.confirm ? typed.trim() : undefined,
        values: checked.values,
      });
      useOperations.getState().upsert(operation);
      if (operation.family === 'instant') toast.success(`${action.label}: done`);
      else toast(`${action.label} started`, { description: 'Follow it in the operations tray.' });
      void client.invalidateQueries({ queryKey: ['kit', profileId, projectId, collectionKey] });
      onOpenChange(false);
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail : 'The action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={action !== null}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={action?.label ?? ''}
      width={fields.length > 2 ? 'md' : 'sm'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={action?.danger ? 'danger' : 'commit'}
            loading={busy}
            disabled={!confirmOk || (touched && !checked.ok)}
            disabledReason={!confirmOk ? `Type ${id} to confirm` : 'Fix the values above'}
            onClick={() => void run()}
          >
            {action?.label ?? ''}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <p className="m-0 text-dense text-ink">{action?.consequence}</p>
        {fields.map((f) => {
          const v = values[f.id];
          const set = (next: string | boolean) => setValues((p) => ({ ...p, [f.id]: next }));
          const err = touched ? errors[f.id] : undefined;
          if (f.kind === 'bool')
            return <Switch key={f.id} label={f.label} description={f.help} checked={v === true} onCheckedChange={set} />;
          return (
            <Field key={f.id} label={f.label} help={f.help} required={f.required} error={err}>
              {f.kind === 'enum' ? (
                <Select<string> value={String(v ?? '')} onValueChange={set} options={f.options ?? []} />
              ) : (
                <Input
                  mono={f.kind === 'text'}
                  type={f.kind === 'password' ? 'password' : undefined}
                  autoComplete={f.kind === 'password' ? 'new-password' : undefined}
                  value={String(v ?? '')}
                  inputMode={f.kind === 'int' ? 'numeric' : f.kind === 'number' ? 'decimal' : undefined}
                  onChange={(e) => set(e.target.value)}
                  onBlur={() => setTouched(true)}
                />
              )}
            </Field>
          );
        })}
        {action?.confirm ? (
          <Field label={`Type ${id} to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} mono />
          </Field>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 text-dense text-redline-ink">
            {error}
          </p>
        ) : null}
        {command ? <EquivalentCommand gcloud={command} /> : null}
      </form>
    </Dialog>
  );
}
