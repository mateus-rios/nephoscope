import type { FirestoreDatabase } from '@nephoscope/contracts';
import { PlusIcon } from '@phosphor-icons/react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button } from '../../design/Button';
import { Notes, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { Stamp, StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { ApiError } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { useCreateDatabase, useDatabases } from './api';
import { databaseHref } from './paths';

const LOCATIONS = [
  'nam5',
  'eur3',
  'us-central1',
  'us-east1',
  'us-east4',
  'us-west1',
  'europe-west1',
  'europe-west2',
  'europe-west3',
  'southamerica-east1',
  'asia-northeast1',
  'asia-south1',
  'australia-southeast1',
];

function CreateDatabaseSheet({
  projectId,
  open,
  onOpenChange,
  readOnly,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnly: string | null;
}) {
  const [id, setId] = useState('');
  const [locationId, setLocationId] = useState('nam5');
  const [type, setType] = useState<'native' | 'datastore'>('native');
  const [edition, setEdition] = useState<'standard' | 'enterprise'>('standard');
  const [pitr, setPitr] = useState(true);
  const [protect, setProtect] = useState(true);
  const create = useCreateDatabase(projectId);
  useEffect(() => {
    if (open) {
      setId('');
      setType('native');
      setEdition('standard');
      setPitr(true);
      setProtect(true);
    }
  }, [open]);
  const idError =
    id === '(default)' || /^[a-z][a-z0-9-]{3,62}$/.test(id)
      ? null
      : 'Four to 63 lowercase letters, digits and hyphens, starting with a letter.';
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create database"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PlusIcon}
            loading={create.isPending}
            disabled={!!idError || !!readOnly || (edition === 'enterprise' && type === 'datastore')}
            disabledReason={
              readOnly ??
              idError ??
              (edition === 'enterprise' && type === 'datastore' ? 'The Enterprise edition has no Datastore mode' : null)
            }
            onClick={() =>
              create.mutate(
                { id, locationId, type, edition, pointInTimeRecovery: pitr, deleteProtection: protect },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            Create database
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Database id"
          required
          error={id ? (idError ?? undefined) : undefined}
          help="(default) is the database the client SDKs use unless told otherwise."
        >
          <Input mono value={id} onChange={(e) => setId(e.target.value)} autoFocus />
        </Field>
        <Field label="Location" help="Cannot be changed later. Multi-region locations (nam5, eur3) are the most available.">
          <Input mono value={locationId} onChange={(e) => setLocationId(e.target.value)} list="nephoscope-firestore-locations" />
        </Field>
        <datalist id="nephoscope-firestore-locations">
          {LOCATIONS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mode">
            <Select<'native' | 'datastore'>
              value={type}
              onValueChange={setType}
              options={[
                { value: 'native', label: 'Native mode' },
                { value: 'datastore', label: 'Datastore mode' },
              ]}
            />
          </Field>
          <Field label="Edition">
            <Select<'standard' | 'enterprise'>
              value={edition}
              onValueChange={setEdition}
              options={[
                { value: 'standard', label: 'Standard' },
                { value: 'enterprise', label: 'Enterprise' },
              ]}
            />
          </Field>
        </div>
        <Switch
          checked={pitr}
          onCheckedChange={setPitr}
          label="Point-in-time recovery"
          description="Read and clone the database as of any minute in the last 7 days."
        />
        <Switch
          checked={protect}
          onCheckedChange={setProtect}
          label="Delete protection"
          description="The database cannot be deleted until this is turned off."
        />
        <EquivalentCommand
          gcloud={`gcloud firestore databases create --database=${id || 'DATABASE'} --location=${locationId} --type=${type === 'native' ? 'firestore-native' : 'datastore-mode'} --edition=${edition}${pitr ? ' --enable-pitr' : ''}${protect ? ' --delete-protection' : ''} --project=${projectId}`}
        />
      </div>
    </Sheet>
  );
}

/** Firestore databases of the project (SPEC-0004 D-11, CA-04). */
export function FirestorePage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const query = useDatabases(projectId);
  const navigate = useNavigate();
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    document.title = 'Firestore · Nephoscope';
  }, []);
  const rows = query.data ?? [];
  const emulator = rows.some((d) => d.emulator);
  const columns: ResourceColumn<FirestoreDatabase>[] = [
    {
      id: 'id',
      header: 'Database',
      hideable: false,
      width: '14rem',
      sortValue: (d) => d.id,
      cell: (d) => <span className="font-mono text-[12px] font-medium text-ink">{d.id}</span>,
    },
    { id: 'mode', header: 'Mode', width: '9rem', sortValue: (d) => d.type, cell: (d) => (d.type === 'datastore' ? 'Datastore' : 'Native') },
    { id: 'edition', header: 'Edition', width: '8rem', cell: (d) => (d.edition === 'enterprise' ? 'Enterprise' : 'Standard') },
    {
      id: 'location',
      header: 'Location',
      width: '10rem',
      sortValue: (d) => d.locationId,
      cell: (d) => (d.locationId ? <Mono value={d.locationId} /> : null),
    },
    {
      id: 'pitr',
      header: 'Recovery',
      width: '9rem',
      cell: (d) =>
        d.emulator ? null : d.pointInTimeRecovery ? <StatusGlyph kind="ok" label="7 days" /> : <StatusGlyph kind="warn" label="Off" />,
    },
    { id: 'protect', header: 'Delete protection', width: '9rem', cell: (d) => (d.emulator ? null : d.deleteProtection ? 'On' : 'Off') },
    { id: 'created', header: 'Created', width: '9rem', sortValue: (d) => d.createTime, cell: (d) => <Timestamp iso={d.createTime} /> },
  ];
  return (
    <div className="pb-16">
      <TitleBlock
        title="Firestore"
        status={
          emulator ? (
            <Stamp tone="construct" title="FIRESTORE_EMULATOR_HOST is set">
              Emulator
            </Stamp>
          ) : undefined
        }
        subtitle="Databases in native and Datastore mode: data, queries, indexes, rules and backups."
        actions={
          <Button
            variant="commit"
            icon={PlusIcon}
            onClick={() => setCreating(true)}
            disabled={!!readOnly || emulator}
            disabledReason={readOnly ?? (emulator ? 'The emulator creates databases on first use' : null)}
          >
            Create database
          </Button>
        }
      />
      {emulator ? (
        <Notes
          notes={[
            {
              id: 'emulator',
              tone: 'info',
              text: 'Connected to the Firestore emulator. Data, queries, live mode and imports work; indexes, TTL, backups, rules and managed exports belong to real projects.',
            },
          ]}
        />
      ) : null}
      <div className="pt-3">
        {query.isPending ? (
          <DelayedSkeleton />
        ) : query.error instanceof ApiError ? (
          <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />
        ) : (
          <ResourceTable
            tableId="firestore-databases"
            label="Databases"
            rows={rows}
            columns={columns}
            getRowId={(d) => d.name}
            onOpen={(d) => void navigate({ to: databaseHref(projectId, d.id) as string })}
            emptyTitle="No databases"
            emptyText="Create the (default) database to start, or a named one."
          />
        )}
      </div>
      <CreateDatabaseSheet projectId={projectId} open={creating} onOpenChange={setCreating} readOnly={readOnly} />
    </div>
  );
}
