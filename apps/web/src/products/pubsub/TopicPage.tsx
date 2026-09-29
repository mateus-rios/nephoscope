import type { PubSubMessage, PubSubWatchUpdate } from '@nephoscope/contracts';
import { BroadcastIcon, PaperPlaneTiltIcon, PencilSimpleIcon, PlusIcon, StopIcon, TrashIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Legend, type Note, Notes, Section } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input } from '../../design/Form';
import { MenuItem } from '../../design/Overlays';
import { Mono } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { MetricsPanel } from '../../kit/MetricsPanel';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { count, duration } from '../../lib/format';
import { live } from '../../lib/live';
import { useSession } from '../../state/session';
import {
  deleteTopic,
  shortName,
  topicPath,
  useInvalidatePubSub,
  useTopic,
  useTopicRaw,
  useTopicSnapshots,
  useTopicSubscriptions,
} from './api';
import { SubscriptionSheet, TopicSheet } from './Forms';
import { MessageList, PublishDialog } from './Messages';
import { useEmulated, usePubSubReadOnly } from './PubSubPage';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'watch', label: 'Watch' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];
const WATCH_KEEP = 500;

/** Watch a topic through a temporary subscription (SPEC-0006 D-05, CA-05). */
function WatchPanel({ projectId, topic, readOnly }: { projectId: string; topic: string; readOnly: string | null }) {
  const profileId = useSession((s) => s.profileId);
  const [filter, setFilter] = useState('');
  const [on, setOn] = useState(false);
  const [subscription, setSubscription] = useState<string | null>(null);
  const [messages, setMessages] = useState<PubSubMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!on || !profileId) return;
    setMessages([]);
    setSubscription(null);
    setError(null);
    return live.subscribe(
      'pubsub.watch',
      { profileId, projectId },
      { topic, filter },
      {
        data(payload) {
          const u = payload as PubSubWatchUpdate;
          if (u.subscription) setSubscription(u.subscription);
          if (u.messages.length > 0) setMessages((prev) => [...u.messages.reverse(), ...prev].slice(0, WATCH_KEEP));
        },
        error(problem) {
          setError(problem.detail);
          setOn(false);
        },
      },
    );
  }, [on, profileId, projectId, topic, filter]);
  const notes: Note[] = [];
  if (on)
    notes.push({
      id: 'sub',
      tone: 'info',
      text: subscription ? (
        <>
          Watching through <Mono value={shortName(subscription)} />. It is deleted when you stop or leave the page, and expires after 24
          hours unused. Only messages published from now on appear.
        </>
      ) : (
        'Creating a temporary subscription…'
      ),
    });
  if (error) notes.push({ id: 'err', tone: 'error', text: error });
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end gap-3 px-6 pt-3">
        <Field label="Filter" help='On attributes, such as attributes.type = "order".' className="w-96">
          <Input mono value={filter} onChange={(e) => setFilter(e.target.value)} disabled={on} />
        </Field>
        <Button
          variant={on ? undefined : 'commit'}
          icon={on ? StopIcon : BroadcastIcon}
          onClick={() => setOn((o) => !o)}
          disabled={!on && !!readOnly}
          disabledReason={readOnly ? 'Watching creates a subscription, which read-only mode does not allow' : null}
        >
          {on ? 'Stop watching' : 'Start watching'}
        </Button>
        {messages.length > 0 ? <span className="pb-1 text-meta text-ink-3">{count(messages.length, 'message')}, newest first</span> : null}
      </div>
      <Notes notes={notes} />
      {messages.length > 0 ? (
        <div className="pt-2">
          <MessageList messages={messages} label="Watched messages" />
        </div>
      ) : on ? (
        <EmptyState title="Waiting for messages">Publish to the topic and messages appear here within a couple of seconds.</EmptyState>
      ) : (
        <EmptyState title="Watch this topic">
          Nephoscope creates its own subscription to see every new message without taking any from the existing subscriptions.
        </EmptyState>
      )}
    </div>
  );
}

export function TopicPage() {
  const { projectId, topic: id } = useParams({ strict: false }) as { projectId: string; topic: string };
  const topic = useTopic(projectId, id);
  const subs = useTopicSubscriptions(projectId, id);
  const snaps = useTopicSnapshots(projectId, id);
  const [tab] = useSearchState<Tab>(
    'tab',
    'overview',
    TABS.map((x) => x.key),
  );
  const raw = useTopicRaw(projectId, id, tab === 'yaml');
  const readOnly = usePubSubReadOnly();
  const emulated = useEmulated();
  const navigate = useNavigate();
  const invalidate = useInvalidatePubSub(projectId);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (topic.isPending) return <DelayedSkeleton rows={8} className="p-6" />;
  if (topic.error instanceof ApiError || !topic.data)
    return topic.error instanceof ApiError ? <ProblemState problem={topic.error.problem} onRetry={() => void topic.refetch()} /> : null;
  const t = topic.data;
  const visibleSubs = (subs.data ?? []).filter((s) => !shortName(s).startsWith('nephoscope-watch-'));
  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Pub/Sub', to: `/p/${projectId}/pubsub` }, { label: t.id }]}
        title={t.id}
        actions={
          <Button
            variant="commit"
            icon={PaperPlaneTiltIcon}
            onClick={() => setPublishing(true)}
            disabled={!!readOnly}
            disabledReason={readOnly}
          >
            Publish message
          </Button>
        }
        menu={
          <>
            <MenuItem onClick={() => setEditing(true)} disabled={!!readOnly}>
              <PencilSimpleIcon size={14} aria-hidden /> Edit topic
            </MenuItem>
            <MenuItem onClick={() => setSubscribing(true)} disabled={!!readOnly}>
              <PlusIcon size={14} aria-hidden /> Create subscription
            </MenuItem>
            <MenuItem onClick={() => setDeleting(true)} disabled={!!readOnly}>
              <TrashIcon size={14} aria-hidden /> Delete topic
            </MenuItem>
          </>
        }
        cells={[
          { label: 'Subscriptions', value: String(visibleSubs.length) },
          { label: 'Retention', value: t.messageRetentionSeconds ? duration(t.messageRetentionSeconds * 1000) : 'None' },
          {
            label: 'Schema',
            value: t.schemaSettings ? `${shortName(t.schemaSettings.schema)} (${t.schemaSettings.encoding.toLowerCase()})` : 'None',
            mono: !!t.schemaSettings,
          },
          { label: 'Encryption', value: t.kmsKeyName ? 'Customer key' : 'Google managed' },
        ]}
        tabs={TABS}
        defaultTab="overview"
      >
        {(current) => {
          switch (current) {
            case 'overview':
              return (
                <>
                  <Section title="Subscriptions">
                    {visibleSubs.length === 0 ? (
                      <p className="m-0 px-6 text-meta text-ink-3">
                        No subscriptions: messages published now reach nobody
                        {t.messageRetentionSeconds ? ', but the topic keeps them for its retention period' : ''}.
                      </p>
                    ) : (
                      <ul className="m-0 list-none border-t border-rule p-0">
                        {visibleSubs.map((s) => (
                          <li key={s} className="border-b border-rule px-6 py-1.5">
                            <Link
                              to={`/p/${projectId}/pubsub/subscriptions/${encodeURIComponent(shortName(s))}` as string}
                              className="font-mono text-[12px]"
                            >
                              {shortName(s)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>
                  <Section title="Snapshots">
                    {(snaps.data ?? []).length === 0 ? (
                      <p className="m-0 px-6 text-meta text-ink-3">None.</p>
                    ) : (
                      <ul className="m-0 list-none p-0 px-6 font-mono text-[12px]">
                        {(snaps.data ?? []).map((s) => (
                          <li key={s}>{shortName(s)}</li>
                        ))}
                      </ul>
                    )}
                  </Section>
                  <Section title="Settings">
                    <dl className="m-0 grid max-w-3xl grid-cols-[12rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-6 text-dense">
                      <dt className="text-ink-3">Name</dt>
                      <dd className="m-0">
                        <Mono value={t.name} copy />
                      </dd>
                      <dt className="text-ink-3">Persistence regions</dt>
                      <dd className="m-0">
                        {t.allowedPersistenceRegions.length ? <Mono value={t.allowedPersistenceRegions.join(', ')} /> : 'Any'}
                      </dd>
                      <dt className="text-ink-3">Encryption key</dt>
                      <dd className="m-0">{t.kmsKeyName ? <Mono value={t.kmsKeyName} /> : 'Google managed'}</dd>
                      <dt className="text-ink-3">Labels</dt>
                      <dd className="m-0">
                        {Object.keys(t.labels).length ? (
                          <Mono
                            value={Object.entries(t.labels)
                              .map(([k, v]) => `${k}=${v}`)
                              .join(', ')}
                          />
                        ) : (
                          'None'
                        )}
                      </dd>
                    </dl>
                    {t.ingestion ? (
                      <div className="px-6 pt-3">
                        <Legend>Ingestion source</Legend>
                        <pre className="m-0 mt-1 overflow-auto rounded-control bg-well p-2 font-mono text-[11px] text-ink-2">
                          {JSON.stringify(t.ingestion, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                  </Section>
                </>
              );
            case 'watch':
              return <WatchPanel projectId={projectId} topic={topicPath(projectId, t.id)} readOnly={readOnly} />;
            case 'metrics':
              return emulated ? (
                <EmptyState title="No metrics from the emulator">Metrics come from Cloud Monitoring for real projects.</EmptyState>
              ) : (
                <MetricsPanel projectId={projectId} kind="pubsub-topic" labels={{ topic_id: t.id }} />
              );
            case 'yaml':
              return (
                <RawView
                  value={raw.data}
                  fileName={`topic-${t.id}`}
                  loading={raw.isPending}
                  error={raw.error}
                  onRetry={() => void raw.refetch()}
                />
              );
          }
        }}
      </DetailLayout>
      <PublishDialog projectId={projectId} topic={t.id} open={publishing} onOpenChange={setPublishing} readOnly={readOnly} />
      <TopicSheet projectId={projectId} topic={t} open={editing} onOpenChange={setEditing} />
      <SubscriptionSheet
        projectId={projectId}
        subscription={null}
        topic={t.name}
        open={subscribing}
        onOpenChange={setSubscribing}
        onDone={(s) => void navigate({ to: `/p/${projectId}/pubsub/subscriptions/${encodeURIComponent(s.id)}` as string })}
      />
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete topic"
        consequence={`The topic is deleted. Its ${visibleSubs.length} subscriptions stay but are detached: they receive nothing new.`}
        expected={t.id}
        confirmLabel="Delete topic"
        command={`gcloud pubsub topics delete ${t.id} --project=${projectId}`}
        onConfirm={async (confirm) => {
          await deleteTopic(projectId, t.id, confirm);
          toast.success(`Deleted ${t.id}`);
          void invalidate();
          void navigate({ to: `/p/${projectId}/pubsub` as string });
        }}
      />
    </>
  );
}
