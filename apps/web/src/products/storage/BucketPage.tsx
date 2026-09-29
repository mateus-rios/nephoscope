import { TrashIcon } from '@phosphor-icons/react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Legend } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input } from '../../design/Form';
import { Dialog, MenuItem } from '../../design/Overlays';
import { Stamp } from '../../design/Status';
import { DetailLayout } from '../../kit/DetailLayout';
import { MetricsPanel } from '../../kit/MetricsPanel';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { duration } from '../../lib/format';
import { countObjects, deleteBucket, trackOperation, useBucket, useBucketRaw, useCapabilities, useInvalidateStorage } from './api';
import { BucketConfiguration, BucketPermissions } from './BucketSettings';
import { ObjectBrowser } from './ObjectBrowser';
import { classLabel, useStorageEmulated, useStorageReadOnly } from './StoragePage';

const TABS = [
  { key: 'objects', label: 'Objects' },
  { key: 'configuration', label: 'Configuration' },
  { key: 'permissions', label: 'Permissions' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/**
 * Deleting a bucket (D-10): the name always, and the object count too when it still holds objects;
 * the server empties it as a cancellable operation.
 */
function DeleteBucket({
  projectId,
  bucket,
  open,
  onOpenChange,
}: {
  projectId: string;
  bucket: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const invalidate = useInvalidateStorage(projectId);
  const [counted, setCounted] = useState<{ count: number; capped: boolean } | null>(null);
  const [counting, setCounting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typedName, setTypedName] = useState('');
  const [typedCount, setTypedCount] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setCounted(null);
    setError(null);
    setTypedName('');
    setTypedCount('');
    setCounting(true);
    countObjects(projectId, bucket)
      .then(setCounted)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.problem.detail : String(err)))
      .finally(() => setCounting(false));
  }, [open, projectId, bucket]);
  const done = (op: boolean) => {
    void invalidate('buckets');
    if (!op) toast.success(`Deleted ${bucket}`);
    void navigate({ to: `/p/${projectId}/storage` });
  };
  if (open && (counting || (error && !counted) || counted?.capped))
    return (
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="Delete bucket"
        width="sm"
        footer={<Button onClick={() => onOpenChange(false)}>Close</Button>}
      >
        {counting ? (
          <p className="m-0 text-dense text-ink-2">Counting the objects and versions in {bucket}…</p>
        ) : error ? (
          <p className="m-0 text-dense text-redline-ink">{error}</p>
        ) : (
          <p className="m-0 text-dense text-ink">
            {bucket} holds more than a million objects. Empty it with a lifecycle rule that deletes everything, then delete it here.
          </p>
        )}
      </Dialog>
    );
  const n = counted?.count ?? 0;
  if (n === 0)
    return (
      <ConfirmDestructive
        open={open && !!counted}
        onOpenChange={onOpenChange}
        title="Delete bucket"
        consequence={`The empty bucket ${bucket} is deleted. Its name becomes available to anyone.`}
        expected={bucket}
        confirmLabel="Delete bucket"
        command={`gcloud storage buckets delete gs://${bucket}`}
        onConfirm={async (confirm) => {
          const r = await deleteBucket(projectId, bucket, confirm);
          trackOperation(r);
          done(!!r.operation);
        }}
      />
    );
  const total = n.toLocaleString('en-US');
  const ready = typedName.trim() === bucket && typedCount.replaceAll(/[,.\s]/g, '') === String(n);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title="Delete bucket"
      width="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!ready}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await deleteBucket(projectId, bucket, typedName.trim(), typedCount);
                trackOperation(r);
                toast(`Emptying and deleting ${bucket}`, { description: 'Follow it in the operations tray; it can be cancelled there.' });
                onOpenChange(false);
                done(true);
              } catch (err) {
                setError(err instanceof ApiError ? err.problem.detail : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete bucket and {total} objects
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
        <p className="m-0 text-dense text-ink">
          {bucket} still holds {total} objects and versions. They are deleted first, then the bucket. Stopping the operation partway leaves
          the bucket with the rest.
        </p>
        <Field label={`Type ${bucket} to confirm`}>
          <Input value={typedName} onChange={(e) => setTypedName(e.target.value)} autoComplete="off" spellCheck={false} mono autoFocus />
        </Field>
        <Field label={`Type ${n} to confirm the objects`} error={error}>
          <Input value={typedCount} onChange={(e) => setTypedCount(e.target.value)} autoComplete="off" inputMode="numeric" mono />
        </Field>
        <details className="text-meta text-ink-2">
          <summary className="cursor-pointer select-none">
            <Legend>Equivalent command</Legend>
          </summary>
          <pre className="mt-2 mb-0 overflow-x-auto rounded-control bg-well p-2 font-mono text-[11px] text-ink">{`gcloud storage rm --recursive gs://${bucket}`}</pre>
        </details>
      </form>
    </Dialog>
  );
}

/** One bucket: objects, settings, permissions, metrics and the raw resource (SPEC-0006 D-10, D-11). */
export function BucketPage() {
  const { projectId, bucket: name } = useParams({ strict: false }) as { projectId: string; bucket: string };
  const bucket = useBucket(projectId, name);
  const [tab] = useSearchState<Tab>(
    'tab',
    'objects',
    TABS.map((t) => t.key),
  );
  const raw = useBucketRaw(projectId, name, tab === 'yaml');
  const capabilities = useCapabilities(projectId);
  const readOnly = useStorageReadOnly();
  const emulated = useStorageEmulated();
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    document.title = `${name} · Cloud Storage · Nephoscope`;
  }, [name]);

  if (bucket.isPending) return <DelayedSkeleton rows={8} className="p-6" />;
  if (bucket.error instanceof ApiError || !bucket.data)
    return bucket.error instanceof ApiError ? <ProblemState problem={bucket.error.problem} onRetry={() => void bucket.refetch()} /> : null;
  const b = bucket.data;
  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Cloud Storage', to: `/p/${projectId}/storage` }, { label: b.name }]}
        title={b.name}
        status={
          emulated ? (
            <Stamp tone="construct" title="STORAGE_EMULATOR_HOST is set">
              Emulator
            </Stamp>
          ) : undefined
        }
        menu={
          <MenuItem onClick={() => setDeleting(true)} disabled={!!readOnly}>
            <TrashIcon size={14} aria-hidden /> Delete bucket
          </MenuItem>
        }
        cells={[
          { label: 'Location', value: `${b.location.toLowerCase()}${b.locationType ? ` (${b.locationType})` : ''}`, mono: true },
          { label: 'Class', value: b.autoclass ? 'Autoclass' : classLabel(b.storageClass) },
          {
            label: 'Access',
            value: `${b.uniformAccess ? 'Uniform' : 'Fine-grained'}${b.publicAccessPrevention === 'enforced' ? ', not public' : ''}`,
          },
          {
            label: 'Protection',
            value:
              [
                b.versioning ? 'Versioning' : null,
                b.softDeleteSeconds ? `Soft delete ${duration(b.softDeleteSeconds * 1000)}` : null,
                b.retention ? `Retention ${duration(b.retention.periodSeconds * 1000)}${b.retention.locked ? ', locked' : ''}` : null,
              ]
                .filter(Boolean)
                .join(', ') || 'None',
          },
          { label: 'Folders', value: b.hierarchicalNamespace ? 'Hierarchical' : 'Prefixes' },
        ]}
        tabs={TABS}
        defaultTab="objects"
      >
        {(current) => {
          switch (current) {
            case 'objects':
              return <ObjectBrowser projectId={projectId} bucket={b} capabilities={capabilities.data} readOnly={readOnly} />;
            case 'configuration':
              return <BucketConfiguration projectId={projectId} bucket={b} readOnly={readOnly} emulated={emulated} />;
            case 'permissions':
              return emulated ? (
                <EmptyState title="No permissions on the emulator">
                  The storage emulator has no IAM; bucket policies exist only in real projects.
                </EmptyState>
              ) : (
                <BucketPermissions projectId={projectId} bucket={b} readOnly={readOnly} />
              );
            case 'metrics':
              return emulated ? (
                <EmptyState title="No metrics from the emulator">Metrics come from Cloud Monitoring for real projects.</EmptyState>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="m-0 px-6 pt-3 text-meta text-ink-3">
                    Stored bytes and object counts are sampled once a day; requests and traffic every minute.
                  </p>
                  <MetricsPanel projectId={projectId} kind="storage-bucket" labels={{ bucket_name: b.name }} />
                </div>
              );
            case 'yaml':
              return (
                <RawView
                  value={raw.data}
                  fileName={`bucket-${b.name}`}
                  loading={raw.isPending}
                  error={raw.error}
                  onRetry={() => void raw.refetch()}
                />
              );
          }
        }}
      </DetailLayout>
      <DeleteBucket projectId={projectId} bucket={b.name} open={deleting} onOpenChange={setDeleting} />
    </>
  );
}
