import type { LogBucket, LogView } from '@nephoscope/contracts';
import { ArrowCounterClockwiseIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Section } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input, Switch } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { FactList } from '../../kit/FactList';
import { ApiError } from '../../lib/api';
import {
  deleteLogBucket,
  deleteLogView,
  undeleteLogBucket,
  useCreateLogBucket,
  useCreateLogView,
  useLogBuckets,
  useLogLinks,
  useLogViews,
  useUpdateLogBucket,
} from './api';

function BucketState({ b }: { b: LogBucket }) {
  if (b.lifecycleState === 'DELETE_REQUESTED') return <StatusGlyph kind="paused" label="Deleted, restorable" />;
  if (b.lifecycleState === 'UPDATING' || b.lifecycleState === 'CREATING') return <StatusGlyph kind="running" label="Updating" />;
  if (b.lifecycleState === 'FAILED') return <StatusGlyph kind="error" label="Failed" />;
  return <StatusGlyph kind="ok" label="Active" />;
}

function CreateBucketSheet({
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
  const [location, setLocation] = useState('global');
  const [days, setDays] = useState('30');
  const [analytics, setAnalytics] = useState(false);
  const [locked, setLocked] = useState(false);
  const create = useCreateLogBucket(projectId);
  useEffect(() => {
    if (open) {
      setId('');
      setDays('30');
      setAnalytics(false);
      setLocked(false);
    }
  }, [open]);
  const ok = /^[A-Za-z0-9_-]{1,100}$/.test(id) && /^[a-z0-9-]+$/.test(location) && Number(days) >= 1 && Number(days) <= 3650;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create log bucket"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={create.isPending}
            disabled={!!readOnly || !ok}
            disabledReason={readOnly ?? 'Fill in the name, location and retention'}
            onClick={() =>
              create.mutate(
                { id, location, retentionDays: Number(days), analyticsEnabled: analytics, locked },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            Create log bucket
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required>
          <Input mono value={id} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field label="Location" required help="global, or a region such as us-central1.">
          <Input mono value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label="Retention (days)" required help="From 1 to 3650.">
          <Input mono value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
        </Field>
        <Switch
          checked={analytics}
          onCheckedChange={setAnalytics}
          label="Upgrade for analytics"
          description="Lets a linked BigQuery dataset query the bucket with SQL."
        />
        <Switch
          checked={locked}
          onCheckedChange={setLocked}
          label="Lock retention"
          description="Locked retention can never be shortened, and the bucket cannot be deleted while it holds logs."
        />
        <EquivalentCommand
          gcloud={`gcloud logging buckets create ${id || 'BUCKET'} --location=${location} --retention-days=${days || '30'}${analytics ? ' --enable-analytics' : ''}${locked ? ' --locked' : ''} --project=${projectId}`}
        />
      </div>
    </Sheet>
  );
}

function BucketDetail({ projectId, bucket, readOnly }: { projectId: string; bucket: LogBucket; readOnly: string | null }) {
  const views = useLogViews(projectId, bucket);
  const links = useLogLinks(projectId, bucket);
  const update = useUpdateLogBucket(projectId, bucket);
  const createView = useCreateLogView(projectId, bucket);
  const [days, setDays] = useState(String(bucket.retentionDays ?? ''));
  const [viewId, setViewId] = useState('');
  const [viewFilter, setViewFilter] = useState('');
  const [deletingView, setDeletingView] = useState<LogView | null>(null);
  useEffect(() => setDays(String(bucket.retentionDays ?? '')), [bucket.retentionDays]);
  const editable = !bucket.builtIn || bucket.id === '_Default';
  return (
    <div className="flex flex-col gap-2 pb-4">
      <FactList
        facts={[
          ['Bucket', <Mono key="n" value={bucket.name} copy />],
          ['Retention', bucket.retentionDays ? `${bucket.retentionDays} days${bucket.locked ? ', locked' : ''}` : null],
          ['Analytics', bucket.analyticsEnabled ? 'Upgraded' : 'Not upgraded'],
          [
            'Linked datasets',
            bucket.analyticsEnabled
              ? links.data?.length
                ? links.data.map((l) => l.datasetId).join(', ')
                : 'None. Link a BigQuery dataset to query these logs with SQL.'
              : 'Upgrade the bucket for analytics to link a dataset.',
          ],
          ['Updated', <Timestamp key="u" iso={bucket.updateTime} />],
        ]}
      />
      {editable && !bucket.locked ? (
        <div className="flex items-end gap-2 px-6">
          <Field label="Retention (days)" className="w-40">
            <Input mono value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Button
            disabled={!!readOnly || days === String(bucket.retentionDays ?? '') || !days}
            disabledReason={readOnly}
            loading={update.isPending}
            onClick={() => update.mutate({ retentionDays: Number(days) })}
          >
            Save retention
          </Button>
        </div>
      ) : null}
      <h3 className="m-0 mt-3 px-6 text-dense font-semibold text-ink">Views</h3>
      {views.isPending ? (
        <DelayedSkeleton rows={2} />
      ) : views.error instanceof ApiError ? (
        <ProblemState problem={views.error.problem} onRetry={() => void views.refetch()} />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0 px-6">
          {(views.data ?? []).map((v) => (
            <li key={v.name} className="grid grid-cols-[12rem_1fr_auto] items-center gap-3 border-b border-rule py-1">
              <span className="truncate font-mono text-[12px] text-ink">{v.id}</span>
              {v.filter ? <Mono value={v.filter} /> : <span className="text-meta text-ink-3">Every entry</span>}
              {v.id.startsWith('_') ? (
                <span />
              ) : (
                <IconButton
                  icon={TrashIcon}
                  label={`Delete view ${v.id}`}
                  size="sm"
                  disabled={!!readOnly}
                  onClick={() => setDeletingView(v)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2 px-6"
        onSubmit={(e) => {
          e.preventDefault();
          createView.mutate({ id: viewId, filter: viewFilter }, { onSuccess: () => setViewId('') });
        }}
      >
        <Field label="New view" className="w-48">
          <Input mono value={viewId} onChange={(e) => setViewId(e.target.value)} placeholder="view-id" />
        </Field>
        <div className="min-w-72 flex-1">
          <Field label="View filter">
            <CodeEditor value={viewFilter} onChange={setViewFilter} language="lql" height={56} label="View filter" />
          </Field>
        </div>
        <Button
          type="submit"
          icon={PlusIcon}
          disabled={!!readOnly || !/^[A-Za-z0-9_-]{1,100}$/.test(viewId)}
          disabledReason={readOnly}
          loading={createView.isPending}
        >
          Create view
        </Button>
      </form>
      <ConfirmDestructive
        open={deletingView !== null}
        onOpenChange={(o) => !o && setDeletingView(null)}
        title="Delete log view"
        consequence="Principals granted access through this view lose it. The logs stay in the bucket."
        expected={deletingView?.id ?? ''}
        confirmLabel="Delete log view"
        onConfirm={async (c) => {
          if (deletingView) await deleteLogView(projectId, bucket, deletingView.id, c);
          void views.refetch();
        }}
      />
    </div>
  );
}

/** Log buckets and views (SPEC-0005 D-05). */
export function Storage({ projectId, readOnly }: { projectId: string; readOnly: string | null }) {
  const buckets = useLogBuckets(projectId);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LogBucket | null>(null);
  const list = buckets.data ?? [];
  const current = list.find((b) => b.name === selected) ?? null;
  const columns: ResourceColumn<LogBucket>[] = [
    {
      id: 'name',
      header: 'Bucket',
      hideable: false,
      sortValue: (b) => b.id,
      cell: (b) => <span className="font-medium text-ink">{b.id}</span>,
    },
    { id: 'state', header: 'State', width: '11rem', cell: (b) => <BucketState b={b} /> },
    { id: 'location', header: 'Location', width: '9rem', sortValue: (b) => b.location, cell: (b) => <Mono value={b.location} /> },
    {
      id: 'retention',
      header: 'Retention',
      width: '8rem',
      align: 'right',
      sortValue: (b) => b.retentionDays ?? 0,
      cell: (b) => <span className="tnum">{b.retentionDays ?? ''} d</span>,
    },
    { id: 'analytics', header: 'Analytics', width: '7rem', cell: (b) => (b.analyticsEnabled ? 'Yes' : 'No') },
    {
      id: 'actions',
      header: 'Actions',
      width: '6rem',
      hideable: false,
      cell: (b) =>
        b.builtIn ? null : b.lifecycleState === 'DELETE_REQUESTED' ? (
          <IconButton
            icon={ArrowCounterClockwiseIcon}
            label={`Restore ${b.id}`}
            size="sm"
            disabled={!!readOnly}
            onClick={() =>
              void undeleteLogBucket(projectId, b).then(() => {
                toast.success(`Restored ${b.id}`);
                void buckets.refetch();
              })
            }
          />
        ) : (
          <IconButton icon={TrashIcon} label={`Delete ${b.id}`} size="sm" disabled={!!readOnly} onClick={() => setDeleting(b)} />
        ),
    },
  ];
  return (
    <>
      <Section
        title="Log buckets"
        description="Buckets store log entries for their retention period. Select one for its views and settings."
        actions={
          <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setCreating(true)}>
            Create log bucket
          </Button>
        }
      >
        {buckets.isPending ? (
          <DelayedSkeleton />
        ) : buckets.error instanceof ApiError ? (
          <ProblemState problem={buckets.error.problem} onRetry={() => void buckets.refetch()} />
        ) : (
          <ResourceTable
            tableId="logging-buckets"
            label="Log buckets"
            rows={list}
            columns={columns}
            getRowId={(b) => b.name}
            onOpen={(b) => setSelected(b.name)}
            rowClassName={(b) => (b.name === selected ? 'bg-construct-tint' : undefined)}
            emptyTitle="No log buckets"
            emptyText="Every project has _Default and _Required. Create a bucket to keep some logs longer or apart."
          />
        )}
      </Section>
      {current ? (
        <Section title={`Bucket ${current.id}`}>
          <BucketDetail key={current.name} projectId={projectId} bucket={current} readOnly={readOnly} />
        </Section>
      ) : list.length > 0 ? (
        <EmptyState title="Select a bucket">Its views, retention and linked datasets appear here.</EmptyState>
      ) : null}
      <CreateBucketSheet projectId={projectId} open={creating} onOpenChange={setCreating} readOnly={readOnly} />
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete log bucket"
        consequence="The bucket is deleted after 7 days; until then it can be restored. Sinks that write to it start failing."
        expected={deleting?.id ?? ''}
        confirmLabel="Delete log bucket"
        command={
          deleting ? `gcloud logging buckets delete ${deleting.id} --location=${deleting.location} --project=${projectId}` : undefined
        }
        onConfirm={async (c) => {
          if (deleting) await deleteLogBucket(projectId, deleting, c);
          void buckets.refetch();
        }}
      />
    </>
  );
}
