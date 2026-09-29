import type { PubSubMessage, PubSubSubscription } from '@nephoscope/contracts';
import {
  ArrowCounterClockwiseIcon,
  CameraIcon,
  EyeIcon,
  LinkBreakIcon,
  PencilSimpleIcon,
  ShieldCheckIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { type Note, Notes, Section } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { MenuItem } from '../../design/Overlays';
import { StatusGlyph } from '../../design/Status';
import { Mono } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { MetricsPanel } from '../../kit/MetricsPanel';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { duration } from '../../lib/format';
import { useProject } from '../../state/queries';
import {
  createSnapshot,
  deleteSubscription,
  detachSubscription,
  failed,
  grantDeadLetter,
  peek,
  pullAck,
  resend,
  seek,
  shortName,
  useInvalidatePubSub,
  useSnapshots,
  useSubscription,
  useSubscriptionRaw,
  useSubscriptions,
} from './api';
import { SubscriptionSheet } from './Forms';
import { MessageList } from './Messages';
import { deliveryLabel, useEmulated, usePubSubReadOnly } from './PubSubPage';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'messages', label: 'Messages' },
  { key: 'deadletter', label: 'Dead-lettered' },
  { key: 'seek', label: 'Seek and snapshots' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const warnedKey = (name: string) => `nephoscope.pubsub.peekWarned:${name}`;
const wasWarned = (name: string) => {
  try {
    return sessionStorage.getItem(warnedKey(name)) === '1';
  } catch {
    return false;
  }
};

/** Peek (D-04) and pull-and-acknowledge (CA-04) on one subscription. */
function PeekPanel({
  projectId,
  sub,
  readOnly,
  selectable,
  onSelection,
  selection,
}: {
  projectId: string;
  sub: PubSubSubscription;
  readOnly: string | null;
  selectable?: boolean;
  selection?: ReadonlySet<string>;
  onSelection?: (s: Set<string>) => void;
}) {
  const [max, setMax] = useState('10');
  const [messages, setMessages] = useState<PubSubMessage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [warned, setWarned] = useState(() => wasWarned(sub.name));
  const [acking, setAcking] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setMessages(await peek(projectId, sub.id, Number(max)));
    } catch (err) {
      failed('Peeking')(err);
    } finally {
      setBusy(false);
    }
  };
  const notes: Note[] = [
    {
      id: 'peek',
      tone: 'warn',
      text: (
        <>
          Peeking pulls up to {max} messages and gives them back at once. For that instant, other subscribers cannot receive them.
          {sub.deadLetter
            ? ` This subscription sends messages to dead letter after ${sub.deadLetter.maxDeliveryAttempts} delivery attempts, and every peek counts as one: messages near the limit can be dead-lettered.`
            : ' This subscription has no dead-letter policy, so peeking does not risk losing messages.'}
        </>
      ),
      action: warned ? undefined : (
        <Button
          size="sm"
          onClick={() => {
            try {
              sessionStorage.setItem(warnedKey(sub.name), '1');
            } catch {
              /* private windows */
            }
            setWarned(true);
          }}
        >
          I understand
        </Button>
      ),
    },
  ];
  return (
    <div className="flex flex-col">
      <Notes notes={notes} title="Before you peek" />
      <div className="flex flex-wrap items-end gap-3 px-6 pt-3">
        <Field label="Messages" className="w-32">
          <Select<string> value={max} onValueChange={setMax} options={['1', '10', '50', '100'].map((n) => ({ value: n, label: n }))} />
        </Field>
        <Button
          variant="commit"
          icon={EyeIcon}
          loading={busy}
          disabled={!warned}
          disabledReason={warned ? null : 'Read the note above first'}
          onClick={() => void run()}
        >
          Peek messages
        </Button>
        <Button
          variant="danger"
          onClick={() => setAcking(true)}
          disabled={!!readOnly || !warned}
          disabledReason={readOnly ?? (warned ? null : 'Read the note above first')}
        >
          Pull and acknowledge
        </Button>
      </div>
      {messages === null ? null : messages.length === 0 ? (
        <EmptyState title="No messages waiting">The subscription had nothing to deliver right now.</EmptyState>
      ) : (
        <div className="pt-3">
          <MessageList
            messages={messages}
            label="Peeked messages"
            selection={selectable ? selection : undefined}
            onSelectionChange={selectable ? onSelection : undefined}
          />
        </div>
      )}
      <ConfirmDestructive
        open={acking}
        onOpenChange={setAcking}
        title="Pull and acknowledge"
        consequence={`Up to ${max} messages are removed from ${sub.id}. The consumers of this subscription never receive them.`}
        expected={max}
        confirmLabel={`Acknowledge up to ${max} messages`}
        command={`gcloud pubsub subscriptions pull ${sub.id} --auto-ack --limit=${max} --project=${projectId}`}
        onConfirm={async (confirm) => {
          const got = await pullAck(projectId, sub.id, Number(max), confirm);
          setMessages(got);
          toast.success(`Acknowledged ${got.length} ${got.length === 1 ? 'message' : 'messages'}`);
        }}
      />
    </div>
  );
}

/** Dead-lettered messages (D-06, CA-06). */
function DeadLetterPanel({ projectId, sub, readOnly }: { projectId: string; sub: PubSubSubscription; readOnly: string | null }) {
  const subs = useSubscriptions(projectId);
  const project = useProject(projectId);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [granting, setGranting] = useState(false);
  if (!sub.deadLetter)
    return (
      <EmptyState title="No dead-letter policy">
        Edit the subscription to forward messages to a dead-letter topic after too many delivery attempts.
      </EmptyState>
    );
  const dlq = sub.deadLetter.topic;
  const onDlq = (subs.data?.items ?? []).filter((s) => s.topic === dlq && !s.id.startsWith('nephoscope-watch-'));
  const number = project.data?.projectNumber ?? null;
  const agent = number
    ? `service-${number}@gcp-sa-pubsub.iam.gserviceaccount.com`
    : 'service-PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com';
  const doResend = async (confirm?: string) => {
    const from = onDlq[0];
    if (!from) return;
    const r = await resend(projectId, { from: from.name, to: sub.topic, messageIds: [...selection], ...(confirm ? { confirm } : {}) });
    toast.success(`Resent ${r.resent.length} ${r.resent.length === 1 ? 'message' : 'messages'} to ${shortName(sub.topic)}`, {
      description: r.notFound.length ? `${r.notFound.length} were no longer waiting on the dead-letter subscription.` : undefined,
    });
    setSelection(new Set());
  };
  return (
    <div className="flex flex-col">
      <Section
        title="Permissions"
        description="Dead lettering works only when the Pub/Sub service agent can publish to the dead-letter topic and subscribe to this subscription."
        actions={
          <Button
            icon={ShieldCheckIcon}
            loading={granting}
            disabled={!!readOnly || !number}
            disabledReason={readOnly ?? (number ? null : 'The project number is not known to this profile')}
            onClick={async () => {
              if (!number) return;
              setGranting(true);
              try {
                const r = await grantDeadLetter(projectId, sub.id, number);
                toast.success('Grants added', { description: r.member });
              } catch (err) {
                failed('Adding the grants')(err);
              } finally {
                setGranting(false);
              }
            }}
          >
            Add the grants
          </Button>
        }
      >
        <div className="px-6">
          <EquivalentCommand
            gcloud={`gcloud pubsub topics add-iam-policy-binding ${shortName(dlq)} --member=serviceAccount:${agent} --role=roles/pubsub.publisher --project=${projectId}\ngcloud pubsub subscriptions add-iam-policy-binding ${sub.id} --member=serviceAccount:${agent} --role=roles/pubsub.subscriber --project=${projectId}`}
          />
        </div>
      </Section>
      <Section title="Messages" description={`Messages that failed ${sub.deadLetter.maxDeliveryAttempts} times go to ${shortName(dlq)}.`}>
        {onDlq.length === 0 ? (
          <EmptyState
            title="Nothing keeps the dead-lettered messages"
            action={
              <Button onClick={() => setCreating(true)} disabled={!!readOnly}>
                Create a subscription on {shortName(dlq)}
              </Button>
            }
          >
            The dead-letter topic has no subscription, so messages sent there are lost. Create one to keep them for inspection and
            resending.
          </EmptyState>
        ) : (
          <>
            <p className="m-0 px-6 text-meta text-ink-2">
              Reading from{' '}
              <Link to={`/p/${projectId}/pubsub/subscriptions/${encodeURIComponent(onDlq[0]?.id ?? '')}` as string}>{onDlq[0]?.id}</Link>.
              Select messages to publish them again to <Mono value={shortName(sub.topic)} />; they are then acknowledged on the dead-letter
              subscription.
            </p>
            {onDlq[0] ? (
              <PeekPanel
                projectId={projectId}
                sub={onDlq[0]}
                readOnly={readOnly}
                selectable
                selection={selection}
                onSelection={setSelection}
              />
            ) : null}
            <div className="px-6 pt-3">
              <Button
                variant="commit"
                icon={ArrowCounterClockwiseIcon}
                disabled={selection.size === 0 || !!readOnly}
                disabledReason={readOnly ?? (selection.size === 0 ? 'Select messages first' : null)}
                onClick={() => (selection.size > 1 ? setConfirming(true) : void doResend().catch(failed('Resending')))}
              >
                Resend {selection.size || ''} to {shortName(sub.topic)}
              </Button>
            </div>
          </>
        )}
      </Section>
      <ConfirmDestructive
        open={confirming}
        onOpenChange={setConfirming}
        title="Resend messages"
        consequence={`${selection.size} messages are published again to ${shortName(sub.topic)} and every subscription of it receives them.`}
        expected={String(selection.size)}
        confirmLabel={`Resend ${selection.size} messages`}
        onConfirm={(confirm) => doResend(confirm)}
      />
      <SubscriptionSheet
        projectId={projectId}
        subscription={null}
        topic={dlq}
        open={creating}
        onOpenChange={setCreating}
        onDone={() => void subs.refetch()}
      />
    </div>
  );
}

/** Seek and snapshots (D-07, CA-07). */
function SeekPanel({ projectId, sub, readOnly }: { projectId: string; sub: PubSubSubscription; readOnly: string | null }) {
  const snaps = useSnapshots(projectId);
  const mine = (snaps.data?.items ?? []).filter((s) => s.topic === sub.topic);
  const [snapshotId, setSnapshotId] = useState('');
  const [target, setTarget] = useState<{ kind: 'snapshot'; name: string } | { kind: 'time'; time: string } | null>(null);
  const [time, setTime] = useState('');
  const effect = !target
    ? ''
    : target.kind === 'snapshot'
      ? `Every message that was unacknowledged when snapshot ${shortName(target.name)} was taken is delivered again, and messages published since then stay available.`
      : new Date(target.time).getTime() >= Date.now() - 5000
        ? 'Every message waiting now is marked acknowledged: the subscription is purged, and consumers never receive them.'
        : `Messages published after ${new Date(target.time).toLocaleString()} and still retained are delivered again${sub.retainAcked ? '' : ' (acknowledged ones only if the subscription retains them, which it does not)'}.`;
  return (
    <div className="flex flex-col">
      <Section title="Snapshots of this topic">
        {snaps.error instanceof ApiError ? (
          <ProblemState problem={snaps.error.problem} onRetry={() => void snaps.refetch()} />
        ) : (
          <div className="flex flex-col gap-3 px-6">
            {mine.length === 0 ? <p className="m-0 text-meta text-ink-3">None yet.</p> : null}
            {mine.map((s) => (
              <div key={s.name} className="flex items-center gap-3 text-dense">
                <Mono value={s.id} />
                <span className="text-meta text-ink-3">expires {s.expireTime ? new Date(s.expireTime).toLocaleString() : ''}</span>
                <Button size="sm" onClick={() => setTarget({ kind: 'snapshot', name: s.name })} disabled={!!readOnly}>
                  Seek to it
                </Button>
              </div>
            ))}
            <div className="flex items-end gap-2">
              <Field label="New snapshot id" className="w-72">
                <Input mono value={snapshotId} onChange={(e) => setSnapshotId(e.target.value)} />
              </Field>
              <Button
                icon={CameraIcon}
                disabled={!snapshotId || !!readOnly}
                disabledReason={readOnly}
                onClick={async () => {
                  try {
                    await createSnapshot(projectId, snapshotId, sub.name);
                    toast.success(`Snapshot ${snapshotId} created`);
                    setSnapshotId('');
                    void snaps.refetch();
                  } catch (err) {
                    failed('Creating the snapshot')(err);
                  }
                }}
              >
                Take snapshot
              </Button>
            </div>
          </div>
        )}
      </Section>
      <Section title="Seek to a time">
        <div className="flex flex-wrap items-end gap-2 px-6">
          <Field label="Time" className="w-64">
            <Input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Button disabled={!time || !!readOnly} onClick={() => setTarget({ kind: 'time', time: new Date(time).toISOString() })}>
            Seek to this time
          </Button>
          <Button
            variant="danger"
            disabled={!!readOnly}
            disabledReason={readOnly}
            onClick={() => setTarget({ kind: 'time', time: new Date().toISOString() })}
          >
            Purge (seek to now)
          </Button>
        </div>
      </Section>
      {target ? (
        <ConfirmDestructive
          open
          onOpenChange={(o) => !o && setTarget(null)}
          title={
            target.kind === 'time' && new Date(target.time).getTime() >= Date.now() - 5000 ? 'Purge subscription' : 'Seek subscription'
          }
          consequence={effect}
          expected={sub.id}
          confirmLabel="Seek"
          command={`gcloud pubsub subscriptions seek ${sub.id} ${target.kind === 'snapshot' ? `--snapshot=${shortName(target.name)}` : `--time=${target.time}`} --project=${projectId}`}
          onConfirm={async (confirm) => {
            await seek(projectId, sub.id, target.kind === 'snapshot' ? { snapshot: target.name, confirm } : { time: target.time, confirm });
            toast.success('Seek done');
          }}
        />
      ) : null}
    </div>
  );
}

export function SubscriptionPage() {
  const { projectId, subscription: id } = useParams({ strict: false }) as { projectId: string; subscription: string };
  const q = useSubscription(projectId, id);
  const [tab] = useSearchState<Tab>(
    'tab',
    'overview',
    TABS.map((t) => t.key),
  );
  const raw = useSubscriptionRaw(projectId, id, tab === 'yaml');
  const readOnly = usePubSubReadOnly();
  const emulated = useEmulated();
  const navigate = useNavigate();
  const invalidate = useInvalidatePubSub(projectId);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<'delete' | 'detach' | null>(null);
  if (q.isPending) return <DelayedSkeleton rows={8} className="p-6" />;
  if (q.error instanceof ApiError || !q.data)
    return q.error instanceof ApiError ? <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} /> : null;
  const s = q.data;
  const facts: [string, React.ReactNode][] = [
    [
      'Topic',
      s.detached ? (
        <StatusGlyph kind="warn" label="Detached" />
      ) : (
        <Link to={`/p/${projectId}/pubsub/topics/${encodeURIComponent(shortName(s.topic))}` as string}>{shortName(s.topic)}</Link>
      ),
    ],
    ['Delivery', deliveryLabel[s.deliveryType]],
    ['Push endpoint', s.push ? <Mono value={s.push.endpoint} /> : null],
    [
      'Push identity',
      s.push?.serviceAccount ? (
        <Mono value={`${s.push.serviceAccount}${s.push.audience ? `, audience ${s.push.audience}` : ''}`} />
      ) : s.push ? (
        'No token'
      ) : null,
    ],
    ['BigQuery table', s.bigquery ? <Mono value={s.bigquery.table} /> : null],
    [
      'Bucket',
      s.cloudStorage ? (
        <Mono
          value={`gs://${s.cloudStorage.bucket}/${s.cloudStorage.filenamePrefix}…${s.cloudStorage.filenameSuffix} (${s.cloudStorage.format})`}
        />
      ) : null,
    ],
    ['Ack deadline', `${s.ackDeadlineSeconds} s`],
    [
      'Retention',
      `${s.retentionSeconds ? duration(s.retentionSeconds * 1000) : ''}${s.retainAcked ? ', including acknowledged messages' : ''}`,
    ],
    ['Expires', s.expirationSeconds ? `after ${duration(s.expirationSeconds * 1000)} inactive` : 'Never'],
    ['Retry', s.retry ? `backoff ${s.retry.minimumBackoffSeconds ?? 0} to ${s.retry.maximumBackoffSeconds ?? 0} s` : 'Immediately'],
    [
      'Dead letter',
      s.deadLetter ? <Mono value={`${shortName(s.deadLetter.topic)} after ${s.deadLetter.maxDeliveryAttempts} attempts`} /> : 'None',
    ],
    ['Filter', s.filter ? <Mono value={s.filter} /> : 'None'],
    ['Exactly once', s.exactlyOnce ? 'Yes' : 'No'],
    ['Ordering', s.ordering ? 'Yes' : 'No'],
  ];
  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Pub/Sub', to: `/p/${projectId}/pubsub?tab=subscriptions` }, { label: s.id }]}
        title={s.id}
        status={s.detached ? <StatusGlyph kind="warn" label="Detached" /> : undefined}
        actions={
          <Button icon={PencilSimpleIcon} onClick={() => setEditing(true)} disabled={!!readOnly} disabledReason={readOnly}>
            Edit subscription
          </Button>
        }
        menu={
          <>
            <MenuItem onClick={() => setDeleting('detach')} disabled={!!readOnly || s.detached}>
              <LinkBreakIcon size={14} aria-hidden /> Detach from topic
            </MenuItem>
            <MenuItem onClick={() => setDeleting('delete')} disabled={!!readOnly}>
              <TrashIcon size={14} aria-hidden /> Delete subscription
            </MenuItem>
          </>
        }
        cells={[
          { label: 'Topic', value: shortName(s.topic), mono: true },
          { label: 'Delivery', value: deliveryLabel[s.deliveryType] },
          { label: 'Ack deadline', value: `${s.ackDeadlineSeconds} s` },
          { label: 'Dead letter', value: s.deadLetter ? `after ${s.deadLetter.maxDeliveryAttempts}` : 'None' },
        ]}
        tabs={TABS}
        defaultTab="overview"
      >
        {(current) => {
          switch (current) {
            case 'overview':
              return (
                <Section title="Settings">
                  <dl className="m-0 grid max-w-3xl grid-cols-[10rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-6 text-dense">
                    {facts
                      .filter(([, v]) => v !== null)
                      .map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-ink-3">{k}</dt>
                          <dd className="m-0">{v}</dd>
                        </div>
                      ))}
                  </dl>
                </Section>
              );
            case 'messages':
              return s.deliveryType === 'pull' ? (
                <PeekPanel projectId={projectId} sub={s} readOnly={readOnly} />
              ) : (
                <EmptyState title={`${deliveryLabel[s.deliveryType]} subscription`}>
                  Messages are delivered by Pub/Sub itself; only pull subscriptions can be peeked. Watch the topic to see messages as they
                  arrive.
                </EmptyState>
              );
            case 'deadletter':
              return <DeadLetterPanel projectId={projectId} sub={s} readOnly={readOnly} />;
            case 'seek':
              return <SeekPanel projectId={projectId} sub={s} readOnly={readOnly} />;
            case 'metrics':
              return emulated ? (
                <EmptyState title="No metrics from the emulator">Metrics come from Cloud Monitoring for real projects.</EmptyState>
              ) : (
                <MetricsPanel projectId={projectId} kind="pubsub-subscription" labels={{ subscription_id: s.id }} />
              );
            case 'yaml':
              return (
                <RawView
                  value={raw.data}
                  fileName={`subscription-${s.id}`}
                  loading={raw.isPending}
                  error={raw.error}
                  onRetry={() => void raw.refetch()}
                />
              );
          }
        }}
      </DetailLayout>
      <SubscriptionSheet projectId={projectId} subscription={s} open={editing} onOpenChange={setEditing} />
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting === 'detach' ? 'Detach subscription' : 'Delete subscription'}
        consequence={
          deleting === 'detach'
            ? 'The subscription stops receiving messages from the topic, and its waiting messages are dropped. It cannot be attached again.'
            : 'The subscription and every message waiting in it are deleted. Consumers of it start failing.'
        }
        expected={s.id}
        confirmLabel={deleting === 'detach' ? 'Detach subscription' : 'Delete subscription'}
        onConfirm={async (confirm) => {
          if (deleting === 'detach') await detachSubscription(projectId, s.id, confirm);
          else await deleteSubscription(projectId, s.id, confirm);
          toast.success(deleting === 'detach' ? `Detached ${s.id}` : `Deleted ${s.id}`);
          void invalidate();
          if (deleting === 'delete') void navigate({ to: `/p/${projectId}/pubsub?tab=subscriptions` as string });
        }}
      />
    </>
  );
}
