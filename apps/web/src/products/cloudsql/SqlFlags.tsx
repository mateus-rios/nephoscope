import { readPath } from '@nephoscope/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { Dialog } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { runKitAction, useKitExtra } from '../../kit/resource/kitApi';
import { ApiError } from '../../lib/api';
import { useOperations } from '../../state/operations';
import { useSession } from '../../state/session';
import type { KitTabProps } from '../kit/tabs';

interface CatalogFlag {
  name: string;
  type?: string;
  appliesTo?: string[];
  requiresRestart?: boolean;
  allowedStringValues?: string[];
  minValue?: string;
  maxValue?: string;
}

interface Row {
  name: string;
  value: string;
  restart: boolean | null;
}

/** Database flags of a Cloud SQL instance, with the ones that restart it marked (SPEC-0008 D-05). */
export function SqlFlags({ projectId, collectionKey, path, item, readOnly }: KitTabProps) {
  const catalog = useKitExtra(projectId, collectionKey, path, 'flagcatalog', true);
  const version = String(item.databaseVersion ?? '');
  const flags = (readPath(item, 'settings.databaseFlags') ?? []) as { name: string; value?: string }[];
  const known = useMemo(() => {
    const all = (Array.isArray(catalog.data?.value) ? catalog.data.value : []) as CatalogFlag[];
    return new Map(all.filter((f) => !f.appliesTo || f.appliesTo.includes(version)).map((f) => [f.name, f]));
  }, [catalog.data, version]);
  const [editing, setEditing] = useState<{ name: string; value: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const rows: Row[] = flags.map((f) => ({ name: f.name, value: f.value ?? '', restart: known.get(f.name)?.requiresRestart ?? null }));
  const columns: ResourceColumn<Row>[] = [
    {
      id: 'name',
      header: 'Flag',
      hideable: false,
      sortValue: (r) => r.name,
      cell: (r) => <span className="font-mono text-[12px] text-ink">{r.name}</span>,
    },
    { id: 'value', header: 'Value', cell: (r) => <span className="font-mono text-[12px]">{r.value || '(on)'}</span> },
    { id: 'restart', header: 'Restarts instance', width: '9rem', cell: (r) => (r.restart === null ? 'Unknown' : r.restart ? 'Yes' : 'No') },
    {
      id: 'actions',
      header: 'Actions',
      width: '11rem',
      hideable: false,
      cell: (r) => (
        <span className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={!!readOnly}
            disabledReason={readOnly}
            onClick={() => setEditing({ name: r.name, value: r.value })}
          >
            Edit
          </Button>
          <Button size="sm" variant="ghost" disabled={!!readOnly} disabledReason={readOnly} onClick={() => setRemoving(r.name)}>
            Remove
          </Button>
        </span>
      ),
    },
  ];
  if (catalog.error instanceof ApiError) return <ProblemState problem={catalog.error.problem} onRetry={() => void catalog.refetch()} />;
  return (
    <div className="pt-3">
      {catalog.isPending ? (
        <DelayedSkeleton rows={4} />
      ) : (
        <ResourceTable
          tableId="cloudsql-flags"
          label="Database flags"
          rows={rows}
          columns={columns}
          getRowId={(r) => r.name}
          emptyTitle="No flags set"
          emptyText="The engine runs with its defaults."
          toolbar={
            <div className="flex justify-end">
              <Button variant="commit" disabled={!!readOnly} disabledReason={readOnly} onClick={() => setEditing({ name: '', value: '' })}>
                Set flag
              </Button>
            </div>
          }
        />
      )}
      <FlagDialog
        projectId={projectId}
        collectionKey={collectionKey}
        path={path}
        instance={String(item.name ?? '')}
        known={known}
        editing={editing}
        removing={removing}
        onClose={() => {
          setEditing(null);
          setRemoving(null);
        }}
      />
    </div>
  );
}

function FlagDialog({
  projectId,
  collectionKey,
  path,
  instance,
  known,
  editing,
  removing,
  onClose,
}: {
  projectId: string;
  collectionKey: string;
  path: string;
  instance: string;
  known: Map<string, CatalogFlag>;
  editing: { name: string; value: string } | null;
  removing: string | null;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  const open = editing !== null || removing !== null;
  const [seen, setSeen] = useState<typeof editing>(null);
  if (editing !== seen) {
    setSeen(editing);
    setName(editing?.name ?? '');
    setValue(editing?.value ?? '');
    setError(null);
  }
  const flag = known.get(removing ?? name);
  const restarts = flag?.requiresRestart === true;
  const options = [...known.keys()].sort().map((k) => ({ value: k, label: k }));

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const { operation } = await runKitAction(projectId, collectionKey, removing ? 'removeFlag' : 'setFlag', {
        path,
        values: removing ? { name: removing } : { name, ...(value ? { value } : {}) },
      });
      useOperations.getState().upsert(operation);
      toast(removing ? `Removing ${removing}` : `Setting ${name}`, { description: 'Follow it in the operations tray.' });
      void client.invalidateQueries({ queryKey: ['kit', profileId, projectId, collectionKey] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.detail : 'The change failed.');
    } finally {
      setBusy(false);
    }
  }

  const target = removing ?? name;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={removing ? `Remove ${removing}` : editing?.name ? `Edit ${editing.name}` : 'Set flag'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={restarts ? 'danger' : 'commit'}
            loading={busy}
            disabled={!target}
            disabledReason="Choose a flag"
            onClick={() => void run()}
          >
            {removing ? 'Remove flag' : 'Set flag'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!removing ? (
          <>
            <Field label="Flag">
              {editing?.name ? (
                <Input value={name} readOnly mono />
              ) : (
                <Select<string> value={name} onValueChange={setName} options={[{ value: '', label: 'Choose a flag' }, ...options]} />
              )}
            </Field>
            <Field
              label="Value"
              help={
                flag?.allowedStringValues?.length
                  ? `One of ${flag.allowedStringValues.join(', ')}.`
                  : flag?.minValue || flag?.maxValue
                    ? `Between ${flag.minValue ?? '…'} and ${flag.maxValue ?? '…'}.`
                    : flag?.type === 'NONE'
                      ? 'This flag takes no value.'
                      : undefined
              }
            >
              {flag?.allowedStringValues?.length ? (
                <Select<string>
                  value={value}
                  onValueChange={setValue}
                  options={flag.allowedStringValues.map((v) => ({ value: v, label: v }))}
                />
              ) : (
                <Input value={value} onChange={(e) => setValue(e.target.value)} mono disabled={flag?.type === 'NONE'} />
              )}
            </Field>
          </>
        ) : null}
        <p className="m-0 text-dense text-ink">
          {restarts
            ? `Changing ${target} restarts the instance; connections drop for about a minute.`
            : flag
              ? `${target} takes effect without a restart.`
              : 'Cloud SQL decides whether this change restarts the instance.'}
        </p>
        {error ? (
          <p role="alert" className="m-0 text-dense text-redline-ink">
            {error}
          </p>
        ) : null}
        <EquivalentCommand
          gcloud={`gcloud sql instances patch ${instance} --database-flags=${removing ? '…' : `${target || 'FLAG'}=${value || 'VALUE'}`} --project=${projectId}`}
        />
      </div>
    </Dialog>
  );
}
