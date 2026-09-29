import type { StorageBucket } from '@nephoscope/contracts';
import { storageClasses } from '@nephoscope/contracts/storage-preview';
import { PlusIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { Legend, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { Stamp } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { KeyValueEditor, LABEL_KEY, labelRowsFrom, labelsFromRows } from '../../kit/KeyValueEditor';
import { RefreshControl } from '../../kit/ListControls';
import { ApiError } from '../../lib/api';
import { duration } from '../../lib/format';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { bucketHref, createBucket, failed, useBuckets, useInvalidateStorage } from './api';

export function useStorageReadOnly(): string | null {
  const instance = useInstance();
  const { profile } = useActiveProfile();
  return readOnlyReason(instance.data?.readOnly, profile?.readOnly);
}

export function useStorageEmulated(): boolean {
  return !!useInstance().data?.emulators.storage;
}

export const classLabel = (c: string) => c.charAt(0) + c.slice(1).toLowerCase();

/** Common locations; any other location id can be typed (D-10). */
const LOCATIONS = [
  'US',
  'EU',
  'ASIA',
  'NAM4',
  'EUR4',
  'ASIA1',
  'us-central1',
  'us-east1',
  'us-east4',
  'us-west1',
  'northamerica-northeast1',
  'southamerica-east1',
  'europe-west1',
  'europe-west2',
  'europe-west3',
  'europe-west4',
  'asia-east1',
  'asia-northeast1',
  'asia-south1',
  'asia-southeast1',
  'australia-southeast1',
];

const BUCKET_NAME = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;
export function bucketNameError(name: string): string | null {
  if (!name) return null;
  if (!BUCKET_NAME.test(name)) return '3 to 222 lowercase letters, digits, - _ and ., starting and ending with a letter or digit.';
  if (name.startsWith('goog') || name.includes('google')) return 'Names cannot start with "goog" or contain "google".';
  if (!name.includes('.') && name.length > 63) return 'Names without dots are at most 63 characters.';
  return null;
}

function CreateBucketSheet({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const invalidate = useInvalidateStorage(projectId);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('US');
  const [storageClass, setStorageClass] = useState<(typeof storageClasses)[number]>('STANDARD');
  const [autoclass, setAutoclass] = useState(false);
  const [hns, setHns] = useState(false);
  const [uniform, setUniform] = useState(true);
  const [pap, setPap] = useState(true);
  const [softDelete, setSoftDelete] = useState('7');
  const [versioning, setVersioning] = useState(false);
  const [retention, setRetention] = useState('');
  const [labels, setLabels] = useState(labelRowsFrom({}));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName('');
    setLocation('US');
    setStorageClass('STANDARD');
    setAutoclass(false);
    setHns(false);
    setUniform(true);
    setPap(true);
    setSoftDelete('7');
    setVersioning(false);
    setRetention('');
    setLabels(labelRowsFrom({}));
  }, [open]);
  const softDays = softDelete.trim() === '' ? 0 : Number(softDelete);
  const softError = softDays !== 0 && (softDays < 7 || softDays > 90) ? 'Off (0), or 7 to 90 days.' : null;
  const retentionDays = retention.trim() === '' ? null : Number(retention);
  const nameError = bucketNameError(name);
  // Hierarchical namespace needs uniform access and no versioning (D-10).
  const hnsConflict = hns && (!uniform || versioning) ? 'Hierarchical namespace needs uniform access and no versioning.' : null;
  const bad = !name || !!nameError || !location.trim() || !!softError || !!hnsConflict;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create bucket"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PlusIcon}
            loading={busy}
            disabled={bad}
            onClick={async () => {
              setBusy(true);
              try {
                const b = await createBucket(projectId, {
                  name,
                  location: location.trim(),
                  storageClass,
                  autoclass,
                  hierarchicalNamespace: hns,
                  uniformAccess: uniform,
                  publicAccessPrevention: pap,
                  softDeleteSeconds: softDays ? Math.round(softDays * 86_400) : null,
                  versioning,
                  ...(retentionDays ? { retentionSeconds: Math.round(retentionDays * 86_400) } : {}),
                  labels: labelsFromRows(labels),
                });
                toast.success(`Created ${b.name}`);
                void invalidate('buckets');
                onOpenChange(false);
                void navigate({ to: bucketHref(projectId, b.name) });
              } catch (err) {
                failed('Creating the bucket')(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create bucket
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required help="Globally unique across Cloud Storage, and public." error={nameError ?? undefined}>
          <Input mono value={name} onChange={(e) => setName(e.target.value.toLowerCase())} autoFocus />
        </Field>
        <Field
          label="Location"
          required
          help="A multi-region (US, EU, ASIA), a dual-region (NAM4, EUR4) or a region. It cannot change later."
        >
          <Input mono value={location} onChange={(e) => setLocation(e.target.value)} list="gcs-locations" />
        </Field>
        <datalist id="gcs-locations">
          {LOCATIONS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        <Switch
          checked={autoclass}
          onCheckedChange={setAutoclass}
          label="Autoclass"
          description="Moves each object to the class that fits how often it is read."
        />
        {!autoclass ? (
          <Field label="Default storage class">
            <Select
              value={storageClass}
              onValueChange={setStorageClass}
              options={storageClasses.map((c) => ({ value: c, label: classLabel(c) }))}
            />
          </Field>
        ) : null}
        <Legend>Access</Legend>
        <Switch
          checked={uniform}
          onCheckedChange={setUniform}
          label="Uniform access"
          description="Permissions come only from IAM, never from per-object ACLs."
        />
        <Switch
          checked={pap}
          onCheckedChange={setPap}
          label="Prevent public access"
          description="Nothing in this bucket can be shared with allUsers or allAuthenticatedUsers."
        />
        <Legend>Data protection</Legend>
        <Field
          label="Soft delete (days)"
          help="Deleted objects stay restorable for this long. 0 turns it off."
          error={softError ?? undefined}
        >
          <Input mono value={softDelete} onChange={(e) => setSoftDelete(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" />
        </Field>
        <Switch
          checked={versioning}
          onCheckedChange={setVersioning}
          label="Object versioning"
          description="Overwritten and deleted objects become noncurrent versions."
        />
        <Field label="Retention period (days)" help="Objects cannot be deleted or replaced until they are this old. Empty sets none.">
          <Input mono value={retention} onChange={(e) => setRetention(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" />
        </Field>
        <Switch
          checked={hns}
          onCheckedChange={setHns}
          label="Hierarchical namespace"
          description="Real folders with atomic renames. Only at creation."
        />
        {hnsConflict ? <p className="m-0 text-meta text-redline-ink">{hnsConflict}</p> : null}
        <KeyValueEditor
          label="Labels"
          rows={labels}
          onChange={setLabels}
          keyLabel="Label"
          keyPattern={LABEL_KEY}
          keyHint="Lowercase letters, digits, - and _."
        />
        <EquivalentCommand
          gcloud={`gcloud storage buckets create gs://${name || 'BUCKET'} --location=${location || 'LOCATION'}${autoclass ? ' --enable-autoclass' : ` --default-storage-class=${storageClass}`}${uniform ? ' --uniform-bucket-level-access' : ''}${pap ? ' --public-access-prevention' : ''}${softDays ? ` --soft-delete-duration=${softDays}d` : ' --clear-soft-delete'}${hns ? ' --enable-hierarchical-namespace' : ''}${retentionDays ? ` --retention-period=${retentionDays}d` : ''} --project=${projectId}`}
        />
      </div>
    </Sheet>
  );
}

/** Cloud Storage buckets (SPEC-0006 D-10). */
export function StoragePage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const buckets = useBuckets(projectId);
  const navigate = useNavigate();
  const readOnly = useStorageReadOnly();
  const emulated = useStorageEmulated();
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    document.title = 'Cloud Storage · Nephoscope';
  }, []);
  const q = filter.trim().toLowerCase();
  const columns: ResourceColumn<StorageBucket>[] = [
    {
      id: 'name',
      header: 'Bucket',
      hideable: false,
      sortValue: (b) => b.name,
      cell: (b) => (
        <Link to={bucketHref(projectId, b.name)} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {b.name}
        </Link>
      ),
    },
    {
      id: 'location',
      header: 'Location',
      width: '11rem',
      sortValue: (b) => b.location,
      cell: (b) => (
        <span>
          <Mono value={b.location.toLowerCase()} />
          {b.locationType ? <span className="text-ink-3"> · {b.locationType}</span> : null}
        </span>
      ),
    },
    {
      id: 'class',
      header: 'Class',
      width: '8rem',
      sortValue: (b) => (b.autoclass ? 'Autoclass' : b.storageClass),
      cell: (b) => (b.autoclass ? 'Autoclass' : classLabel(b.storageClass)),
    },
    { id: 'access', header: 'Access', width: '8rem', cell: (b) => (b.uniformAccess ? 'Uniform' : 'Fine-grained') },
    {
      id: 'public',
      header: 'Public access',
      width: '9rem',
      cell: (b) => (b.publicAccessPrevention === 'enforced' ? 'Prevented' : 'Not prevented'),
    },
    {
      id: 'protection',
      header: 'Protection',
      width: '14rem',
      cell: (b) =>
        [
          b.versioning ? 'Versioning' : null,
          b.softDeleteSeconds ? `Soft delete ${duration(b.softDeleteSeconds * 1000)}` : null,
          b.retention ? `Retention${b.retention.locked ? ' (locked)' : ''}` : null,
        ]
          .filter(Boolean)
          .join(', ') || 'None',
    },
    {
      id: 'hns',
      header: 'Folders',
      width: '7rem',
      defaultHidden: true,
      cell: (b) => (b.hierarchicalNamespace ? 'Hierarchical' : 'Prefixes'),
    },
    { id: 'created', header: 'Created', width: '10rem', sortValue: (b) => b.created, cell: (b) => <Timestamp iso={b.created} /> },
  ];
  const toolbar = (
    <div className="flex flex-wrap items-end gap-3">
      <Input
        data-filter-input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name"
        aria-label="Filter by name"
        className="w-64"
      />
      <span className="ml-auto">
        <RefreshControl onRefresh={() => void buckets.refetch()} refreshing={buckets.isRefetching} />
      </span>
    </div>
  );
  return (
    <div className="pb-16">
      <TitleBlock
        title="Cloud Storage"
        status={
          emulated ? (
            <Stamp tone="construct" title="STORAGE_EMULATOR_HOST is set">
              Emulator
            </Stamp>
          ) : undefined
        }
        subtitle="Buckets and the objects in them."
        actions={
          <Button variant="commit" icon={PlusIcon} onClick={() => setCreating(true)} disabled={!!readOnly} disabledReason={readOnly}>
            Create bucket
          </Button>
        }
      />
      <div className="pt-3">
        {buckets.isPending ? (
          <DelayedSkeleton />
        ) : buckets.error instanceof ApiError ? (
          <ProblemState problem={buckets.error.problem} onRetry={() => void buckets.refetch()} />
        ) : (
          <ResourceTable
            tableId="storage-buckets"
            label="Buckets"
            rows={(buckets.data?.items ?? []).filter((b) => !q || b.name.includes(q))}
            columns={columns}
            getRowId={(b) => b.name}
            onOpen={(b) => void navigate({ to: bucketHref(projectId, b.name) })}
            filtered={!!q}
            emptyTitle="No buckets"
            emptyText="A bucket holds objects: files of any size, addressed by name."
            toolbar={toolbar}
          />
        )}
      </div>
      <CreateBucketSheet projectId={projectId} open={creating} onOpenChange={setCreating} />
    </div>
  );
}
