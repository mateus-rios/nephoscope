import type { PubSubSchema, PubSubSnapshot, PubSubSubscription, PubSubTopic } from '@nephoscope/contracts';
import { PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Notes, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Input } from '../../design/Form';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { Stamp, StatusGlyph } from '../../design/Status';
import { TabNav } from '../../design/TabNav';
import { Mono, Timestamp } from '../../design/Values';
import { RefreshControl } from '../../kit/ListControls';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { duration } from '../../lib/format';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { deleteSnapshot, shortName, useSchemas, useSnapshots, useSubscriptions, useTopics } from './api';
import { SubscriptionSheet, TopicSheet } from './Forms';
import { SchemaSheet } from './SchemaPage';

const TABS = ['topics', 'subscriptions', 'snapshots', 'schemas'] as const;
type Tab = (typeof TABS)[number];

export const deliveryLabel: Record<PubSubSubscription['deliveryType'], string> = {
  pull: 'Pull',
  push: 'Push',
  bigquery: 'BigQuery',
  cloudStorage: 'Cloud Storage',
};

export function usePubSubReadOnly(): string | null {
  const instance = useInstance();
  const { profile } = useActiveProfile();
  return readOnlyReason(instance.data?.readOnly, profile?.readOnly);
}

export function useEmulated(): boolean {
  return !!useInstance().data?.emulators.pubsub;
}

/** Pub/Sub (SPEC-0006 D-02 to D-08). */
export function PubSubPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<Tab>('tab', 'topics', TABS);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState<Tab | null>(null);
  const [deletingSnapshot, setDeletingSnapshot] = useState<PubSubSnapshot | null>(null);
  const topics = useTopics(projectId);
  const subscriptions = useSubscriptions(projectId);
  const snapshots = useSnapshots(projectId, tab === 'snapshots');
  const schemas = useSchemas(projectId, tab === 'schemas');
  const navigate = useNavigate();
  const readOnly = usePubSubReadOnly();
  const emulated = useEmulated();
  useEffect(() => {
    document.title = 'Pub/Sub · Nephoscope';
  }, []);
  const q = filter.trim().toLowerCase();
  const match = (id: string) => !q || id.toLowerCase().includes(q);
  const subsByTopic = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of subscriptions.data?.items ?? []) m.set(s.topic, (m.get(s.topic) ?? 0) + 1);
    return m;
  }, [subscriptions.data]);

  const topicColumns: ResourceColumn<PubSubTopic>[] = [
    {
      id: 'id',
      header: 'Topic',
      hideable: false,
      sortValue: (t) => t.id,
      cell: (t) => (
        <Link
          to={`/p/${projectId}/pubsub/topics/${encodeURIComponent(t.id)}` as string}
          className="font-medium text-ink"
          onClick={(e) => e.stopPropagation()}
        >
          {t.id}
        </Link>
      ),
    },
    {
      id: 'subs',
      header: 'Subscriptions',
      width: '8rem',
      align: 'right',
      sortValue: (t) => subsByTopic.get(t.name) ?? 0,
      cell: (t) => <span className="tnum">{subsByTopic.get(t.name) ?? 0}</span>,
    },
    {
      id: 'schema',
      header: 'Schema',
      width: '12rem',
      cell: (t) => (t.schemaSettings ? <Mono value={shortName(t.schemaSettings.schema)} /> : null),
    },
    {
      id: 'retention',
      header: 'Retention',
      width: '8rem',
      cell: (t) => (t.messageRetentionSeconds ? duration(t.messageRetentionSeconds * 1000) : ''),
    },
    { id: 'kms', header: 'Encryption', width: '9rem', cell: (t) => (t.kmsKeyName ? 'Customer key' : 'Google') },
    { id: 'ingestion', header: 'Source', width: '8rem', cell: (t) => (t.ingestion ? 'Import' : '') },
  ];
  const subColumns: ResourceColumn<PubSubSubscription>[] = [
    {
      id: 'id',
      header: 'Subscription',
      hideable: false,
      sortValue: (s) => s.id,
      cell: (s) => (
        <Link
          to={`/p/${projectId}/pubsub/subscriptions/${encodeURIComponent(s.id)}` as string}
          className="font-medium text-ink"
          onClick={(e) => e.stopPropagation()}
        >
          {s.id}
        </Link>
      ),
    },
    {
      id: 'topic',
      header: 'Topic',
      width: '14rem',
      sortValue: (s) => s.topic,
      cell: (s) => (s.detached ? <StatusGlyph kind="warn" label="Detached" /> : <Mono value={shortName(s.topic)} />),
    },
    { id: 'delivery', header: 'Delivery', width: '8rem', sortValue: (s) => s.deliveryType, cell: (s) => deliveryLabel[s.deliveryType] },
    {
      id: 'ack',
      header: 'Ack deadline',
      width: '7rem',
      align: 'right',
      cell: (s) => <span className="tnum">{s.ackDeadlineSeconds} s</span>,
    },
    {
      id: 'dlq',
      header: 'Dead letter',
      width: '12rem',
      cell: (s) => (s.deadLetter ? <Mono value={`${shortName(s.deadLetter.topic)} after ${s.deadLetter.maxDeliveryAttempts}`} /> : null),
    },
    {
      id: 'expires',
      header: 'Expires',
      width: '8rem',
      cell: (s) => (s.expirationSeconds ? `after ${duration(s.expirationSeconds * 1000)}` : 'Never'),
    },
  ];
  const snapshotColumns: ResourceColumn<PubSubSnapshot>[] = [
    { id: 'id', header: 'Snapshot', hideable: false, sortValue: (s) => s.id, cell: (s) => <span className="font-medium">{s.id}</span> },
    { id: 'topic', header: 'Topic', width: '14rem', cell: (s) => <Mono value={shortName(s.topic)} /> },
    { id: 'expires', header: 'Expires', width: '10rem', sortValue: (s) => s.expireTime, cell: (s) => <Timestamp iso={s.expireTime} /> },
    {
      id: 'actions',
      header: 'Actions',
      width: '6rem',
      hideable: false,
      cell: (s) => (
        <Button size="sm" variant="ghost" icon={TrashIcon} onClick={() => setDeletingSnapshot(s)} disabled={!!readOnly}>
          Delete
        </Button>
      ),
    },
  ];
  const schemaColumns: ResourceColumn<PubSubSchema>[] = [
    {
      id: 'id',
      header: 'Schema',
      hideable: false,
      sortValue: (s) => s.id,
      cell: (s) => (
        <Link
          to={`/p/${projectId}/pubsub/schemas/${encodeURIComponent(s.id)}` as string}
          className="font-medium text-ink"
          onClick={(e) => e.stopPropagation()}
        >
          {s.id}
        </Link>
      ),
    },
    { id: 'type', header: 'Type', width: '10rem', cell: (s) => (s.type === 'AVRO' ? 'Avro' : 'Protocol Buffers') },
    { id: 'revision', header: 'Revision', width: '10rem', cell: (s) => <Mono value={s.revisionId ?? ''} /> },
    {
      id: 'created',
      header: 'Revised',
      width: '10rem',
      sortValue: (s) => s.revisionCreateTime,
      cell: (s) => <Timestamp iso={s.revisionCreateTime} />,
    },
  ];

  const createLabel =
    tab === 'topics' ? 'Create topic' : tab === 'subscriptions' ? 'Create subscription' : tab === 'schemas' ? 'Create schema' : null;
  const refetch = () =>
    void (tab === 'topics' ? topics : tab === 'subscriptions' ? subscriptions : tab === 'snapshots' ? snapshots : schemas).refetch();
  const toolbar = (
    <div className="flex flex-wrap items-end gap-3">
      <Input
        data-filter-input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by id"
        aria-label="Filter by id"
        className="w-64"
      />
      <span className="ml-auto">
        <RefreshControl onRefresh={refetch} refreshing={topics.isRefetching || subscriptions.isRefetching} />
      </span>
    </div>
  );
  const body = () => {
    const q2 = tab === 'topics' ? topics : tab === 'subscriptions' ? subscriptions : tab === 'snapshots' ? snapshots : schemas;
    if (q2.isPending) return <DelayedSkeleton />;
    if (q2.error instanceof ApiError) {
      return <ProblemState problem={q2.error.problem} onRetry={refetch} />;
    }
    if (tab === 'topics')
      return (
        <ResourceTable
          tableId="pubsub-topics"
          label="Topics"
          rows={(topics.data?.items ?? []).filter((t) => match(t.id))}
          columns={topicColumns}
          getRowId={(t) => t.name}
          onOpen={(t) => void navigate({ to: `/p/${projectId}/pubsub/topics/${encodeURIComponent(t.id)}` as string })}
          filtered={!!q}
          emptyTitle="No topics"
          emptyText="A topic receives messages; subscriptions deliver them."
          toolbar={toolbar}
        />
      );
    if (tab === 'subscriptions')
      return (
        <ResourceTable
          tableId="pubsub-subscriptions"
          label="Subscriptions"
          rows={(subscriptions.data?.items ?? []).filter((s) => match(s.id) && !s.id.startsWith('nephoscope-watch-'))}
          columns={subColumns}
          getRowId={(s) => s.name}
          onOpen={(s) => void navigate({ to: `/p/${projectId}/pubsub/subscriptions/${encodeURIComponent(s.id)}` as string })}
          filtered={!!q}
          emptyTitle="No subscriptions"
          toolbar={toolbar}
        />
      );
    if (tab === 'snapshots')
      return (
        <ResourceTable
          tableId="pubsub-snapshots"
          label="Snapshots"
          rows={(snapshots.data?.items ?? []).filter((s) => match(s.id))}
          columns={snapshotColumns}
          getRowId={(s) => s.name}
          filtered={!!q}
          emptyTitle="No snapshots"
          emptyText="Create one from a subscription to seek back to it later."
          toolbar={toolbar}
        />
      );
    return (
      <ResourceTable
        tableId="pubsub-schemas"
        label="Schemas"
        rows={(schemas.data?.items ?? []).filter((s) => match(s.id))}
        columns={schemaColumns}
        getRowId={(s) => s.name}
        onOpen={(s) => void navigate({ to: `/p/${projectId}/pubsub/schemas/${encodeURIComponent(s.id)}` as string })}
        filtered={!!q}
        emptyTitle="No schemas"
        toolbar={toolbar}
      />
    );
  };
  const watchers = (subscriptions.data?.items ?? []).filter((s) => s.id.startsWith('nephoscope-watch-')).length;
  return (
    <div className="pb-16">
      <TitleBlock
        title="Pub/Sub"
        status={
          emulated ? (
            <Stamp tone="construct" title="PUBSUB_EMULATOR_HOST is set">
              Emulator
            </Stamp>
          ) : undefined
        }
        subtitle="Topics, subscriptions, snapshots and schemas."
        actions={
          createLabel ? (
            <Button variant="commit" icon={PlusIcon} onClick={() => setCreating(tab)} disabled={!!readOnly} disabledReason={readOnly}>
              {createLabel}
            </Button>
          ) : undefined
        }
      />
      <div className="px-6 pt-3">
        <TabNav
          label="Pub/Sub resources"
          active={tab}
          onSelect={(k) => setTab(k as Tab)}
          items={[
            { key: 'topics', label: 'Topics', count: topics.data?.items.length ?? null },
            { key: 'subscriptions', label: 'Subscriptions', count: subscriptions.data ? subscriptions.data.items.length - watchers : null },
            { key: 'snapshots', label: 'Snapshots' },
            { key: 'schemas', label: 'Schemas' },
          ]}
        />
      </div>
      {watchers > 0 && tab === 'subscriptions' ? (
        <Notes
          notes={[
            {
              id: 'watch',
              tone: 'info',
              text: `${watchers} temporary nephoscope-watch subscriptions are hidden. Each is deleted when its watch closes, or after 24 hours unused.`,
            },
          ]}
        />
      ) : null}
      <div className="pt-3">{body()}</div>
      <TopicSheet
        projectId={projectId}
        topic={null}
        open={creating === 'topics'}
        onOpenChange={(o) => !o && setCreating(null)}
        onDone={(t) => void navigate({ to: `/p/${projectId}/pubsub/topics/${encodeURIComponent(t.id)}` as string })}
      />
      <SubscriptionSheet
        projectId={projectId}
        subscription={null}
        open={creating === 'subscriptions'}
        onOpenChange={(o) => !o && setCreating(null)}
        onDone={(s) => void navigate({ to: `/p/${projectId}/pubsub/subscriptions/${encodeURIComponent(s.id)}` as string })}
      />
      <SchemaSheet projectId={projectId} open={creating === 'schemas'} onOpenChange={(o) => !o && setCreating(null)} />
      {deletingSnapshot ? (
        <ConfirmDestructive
          open
          onOpenChange={(o) => !o && setDeletingSnapshot(null)}
          title="Delete snapshot"
          consequence="Subscriptions can no longer seek back to it."
          expected={deletingSnapshot.id}
          confirmLabel="Delete snapshot"
          onConfirm={async (confirm) => {
            await deleteSnapshot(projectId, deletingSnapshot.id, confirm);
            toast.success('Snapshot deleted');
            void snapshots.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
