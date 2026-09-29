import type { DeliveryType, PubSubSubscription, PubSubTopic } from '@nephoscope/contracts';
import { FloppyDiskIcon, PlusIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Button } from '../../design/Button';
import { Legend } from '../../design/Drafting';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { EquivalentCommand, sh } from '../../kit/EquivalentCommand';
import { KeyValueEditor, LABEL_KEY, labelRowsFrom, labelsFromRows } from '../../kit/KeyValueEditor';
import { useCreateSubscription, useCreateTopic, useSchemas, useTopics, useUpdateSubscription, useUpdateTopic } from './api';

const ID = /^[A-Za-z][A-Za-z0-9\-_.~+%]{2,254}$/;
const idError = (id: string) =>
  !id
    ? null
    : ID.test(id) && !id.toLowerCase().startsWith('goog')
      ? null
      : '3 to 255 letters, digits and - _ . ~ + %, starting with a letter, not "goog".';
const num = (s: string) => (s.trim() === '' ? null : Number(s));
const days = (sec: number | null | undefined) => (sec ? String(Math.round((sec / 86_400) * 100) / 100) : '');

// ---- topic --------------------------------------------------------------------------------------

export function TopicSheet({
  projectId,
  topic,
  open,
  onOpenChange,
  onDone,
}: {
  projectId: string;
  topic: PubSubTopic | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: (t: PubSubTopic) => void;
}) {
  const [id, setId] = useState('');
  const [retention, setRetention] = useState('');
  const [regions, setRegions] = useState('');
  const [kms, setKms] = useState('');
  const [schema, setSchema] = useState('');
  const [encoding, setEncoding] = useState<'JSON' | 'BINARY'>('JSON');
  const [labels, setLabels] = useState(labelRowsFrom({}));
  const schemas = useSchemas(projectId, open);
  const create = useCreateTopic(projectId);
  const update = useUpdateTopic(projectId, topic?.id ?? '');
  useEffect(() => {
    if (!open) return;
    setId('');
    setRetention(days(topic?.messageRetentionSeconds));
    setRegions(topic?.allowedPersistenceRegions.join(', ') ?? '');
    setKms(topic?.kmsKeyName ?? '');
    setSchema(topic?.schemaSettings?.schema ?? '');
    setEncoding(topic?.schemaSettings?.encoding ?? 'JSON');
    setLabels(labelRowsFrom(topic?.labels ?? {}));
  }, [open, topic]);
  const retentionDays = num(retention);
  const retentionError =
    retentionDays !== null && (!(retentionDays >= 10 / 1440) || retentionDays > 31) ? '10 minutes (0.007 days) to 31 days.' : null;
  const settings = {
    labels: labelsFromRows(labels),
    ...(kms.trim() ? { kmsKeyName: kms.trim() } : {}),
    messageRetentionSeconds: retentionDays ? Math.round(retentionDays * 86_400) : null,
    allowedPersistenceRegions: regions
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean),
    schemaSettings: schema ? { schema, encoding } : null,
  };
  const bad = (!topic && (!id || !!idError(id))) || !!retentionError;
  const finish = (t: PubSubTopic) => {
    onOpenChange(false);
    onDone?.(t);
  };
  const busy = create.isPending || update.isPending;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={topic ? `Edit ${topic.id}` : 'Create topic'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={topic ? FloppyDiskIcon : PlusIcon}
            loading={busy}
            disabled={bad}
            onClick={() =>
              topic
                ? update.mutate(settings, { onSuccess: (t) => finish(t) })
                : create.mutate({ id, ...settings }, { onSuccess: (t) => finish(t) })
            }
          >
            {topic ? 'Save topic' : 'Create topic'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!topic ? (
          <Field label="Topic id" required error={idError(id) ?? undefined}>
            <Input mono value={id} onChange={(e) => setId(e.target.value)} autoFocus />
          </Field>
        ) : null}
        <Field
          label="Message retention (days)"
          help="Keeps messages on the topic so subscriptions can seek back before they were created. Empty keeps none."
          error={retentionError ?? undefined}
        >
          <Input mono value={retention} onChange={(e) => setRetention(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" />
        </Field>
        <Field label="Schema">
          <Select<string>
            value={schema}
            onValueChange={setSchema}
            options={[{ value: '', label: 'No schema' }, ...(schemas.data?.items ?? []).map((s) => ({ value: s.name, label: s.id }))]}
          />
        </Field>
        {schema ? (
          <Field label="Message encoding">
            <Select<'JSON' | 'BINARY'>
              value={encoding}
              onValueChange={setEncoding}
              options={[
                { value: 'JSON', label: 'JSON' },
                { value: 'BINARY', label: 'Binary' },
              ]}
            />
          </Field>
        ) : null}
        <Field label="Allowed persistence regions" help="Comma separated; empty allows any region.">
          <Input mono value={regions} onChange={(e) => setRegions(e.target.value)} placeholder="us-central1, us-east1" />
        </Field>
        <Field
          label="Encryption key"
          help={topic?.kmsKeyName ? 'A key can be changed but not removed.' : 'Customer-managed key; empty uses Google’s.'}
        >
          <Input mono value={kms} onChange={(e) => setKms(e.target.value)} placeholder="projects/…/locations/…/keyRings/…/cryptoKeys/…" />
        </Field>
        <KeyValueEditor
          label="Labels"
          rows={labels}
          onChange={setLabels}
          keyLabel="Label"
          keyPattern={LABEL_KEY}
          keyHint="Lowercase letters, digits, - and _."
        />
        {topic?.ingestion ? (
          <p className="m-0 text-meta text-ink-3">
            This is an import topic; its ingestion source is shown on the topic page and cannot be edited here.
          </p>
        ) : null}
        {!topic ? (
          <EquivalentCommand
            gcloud={`gcloud pubsub topics create ${id || 'TOPIC'}${settings.messageRetentionSeconds ? ` --message-retention-duration=${settings.messageRetentionSeconds}s` : ''}${schema ? ` --schema=${schema.split('/').pop()} --message-encoding=${encoding.toLowerCase()}` : ''} --project=${projectId}`}
          />
        ) : null}
      </div>
    </Sheet>
  );
}

// ---- subscription --------------------------------------------------------------------------------

interface SubForm {
  id: string;
  topic: string;
  delivery: DeliveryType;
  endpoint: string;
  pushAccount: string;
  audience: string;
  noWrapper: boolean;
  writeMetadata: boolean;
  table: string;
  useTopicSchema: boolean;
  useTableSchema: boolean;
  dropUnknown: boolean;
  bqAccount: string;
  bucket: string;
  prefix: string;
  suffix: string;
  maxDuration: string;
  maxBytes: string;
  format: 'text' | 'avro';
  gcsAccount: string;
  ackDeadline: string;
  retentionDays: string;
  retainAcked: boolean;
  expires: boolean;
  expirationDays: string;
  retry: boolean;
  minBackoff: string;
  maxBackoff: string;
  deadLetter: boolean;
  deadLetterTopic: string;
  maxAttempts: string;
  filter: string;
  exactlyOnce: boolean;
  ordering: boolean;
}

function formFrom(s: PubSubSubscription | null, topic: string): SubForm {
  return {
    id: '',
    topic: s?.topic ?? topic,
    delivery: s?.deliveryType ?? 'pull',
    endpoint: s?.push?.endpoint ?? '',
    pushAccount: s?.push?.serviceAccount ?? '',
    audience: s?.push?.audience ?? '',
    noWrapper: s?.push?.noWrapper ?? false,
    writeMetadata: s?.push?.writeMetadata ?? s?.bigquery?.writeMetadata ?? s?.cloudStorage?.writeMetadata ?? false,
    table: s?.bigquery?.table ?? '',
    useTopicSchema: s?.bigquery?.useTopicSchema ?? false,
    useTableSchema: s?.bigquery?.useTableSchema ?? false,
    dropUnknown: s?.bigquery?.dropUnknownFields ?? false,
    bqAccount: s?.bigquery?.serviceAccount ?? '',
    bucket: s?.cloudStorage?.bucket ?? '',
    prefix: s?.cloudStorage?.filenamePrefix ?? '',
    suffix: s?.cloudStorage?.filenameSuffix ?? '',
    maxDuration: s?.cloudStorage?.maxDurationSeconds ? String(s.cloudStorage.maxDurationSeconds) : '',
    maxBytes: s?.cloudStorage?.maxBytes ?? '',
    format: s?.cloudStorage?.format ?? 'text',
    gcsAccount: s?.cloudStorage?.serviceAccount ?? '',
    ackDeadline: String(s?.ackDeadlineSeconds ?? 10),
    retentionDays: days(s?.retentionSeconds ?? 7 * 86_400),
    retainAcked: s?.retainAcked ?? false,
    expires: s ? s.expirationSeconds !== null : true,
    expirationDays: days(s?.expirationSeconds ?? 31 * 86_400),
    retry: !!s?.retry,
    minBackoff: String(s?.retry?.minimumBackoffSeconds ?? 10),
    maxBackoff: String(s?.retry?.maximumBackoffSeconds ?? 600),
    deadLetter: !!s?.deadLetter,
    deadLetterTopic: s?.deadLetter?.topic ?? '',
    maxAttempts: String(s?.deadLetter?.maxDeliveryAttempts ?? 5),
    filter: s?.filter ?? '',
    exactlyOnce: s?.exactlyOnce ?? false,
    ordering: s?.ordering ?? false,
  };
}

function validate(f: SubForm, creating: boolean): string | null {
  if (creating && (!f.id || idError(f.id))) return 'Enter a valid subscription id.';
  if (creating && !f.topic) return 'Choose a topic.';
  const ack = Number(f.ackDeadline);
  if (!(ack >= 10 && ack <= 600)) return 'The ack deadline is 10 to 600 seconds.';
  const ret = Number(f.retentionDays);
  if (!(ret * 86_400 >= 600 && ret <= 31)) return 'Retention is 10 minutes to 31 days.';
  if (f.expires && !(Number(f.expirationDays) >= 1 && Number(f.expirationDays) <= 365)) return 'Expiration is 1 to 365 days of inactivity.';
  if (f.retry && !(Number(f.minBackoff) <= Number(f.maxBackoff) && Number(f.maxBackoff) <= 600))
    return 'Backoff is 0 to 600 seconds, minimum not above maximum.';
  if (f.deadLetter && (!f.deadLetterTopic || !(Number(f.maxAttempts) >= 5 && Number(f.maxAttempts) <= 100)))
    return 'Choose a dead-letter topic and 5 to 100 attempts.';
  if (f.deadLetter && f.deadLetterTopic === f.topic) return 'The dead-letter topic must differ from the subscription’s topic.';
  if (f.delivery === 'push' && !/^https?:\/\/\S+$/.test(f.endpoint)) return 'Enter the push endpoint URL.';
  if (f.delivery === 'bigquery' && !/^[^:.]+[:.][^.]+\.[^.]+$/.test(f.table)) return 'Enter the table as project.dataset.table.';
  if (f.delivery === 'cloudStorage' && !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(f.bucket)) return 'Enter the bucket name.';
  return null;
}

export function SubscriptionSheet({
  projectId,
  subscription,
  topic = '',
  open,
  onOpenChange,
  onDone,
}: {
  projectId: string;
  subscription: PubSubSubscription | null;
  topic?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: (s: PubSubSubscription) => void;
}) {
  const [f, setF] = useState<SubForm>(formFrom(null, topic));
  const topics = useTopics(projectId);
  const create = useCreateSubscription(projectId);
  const update = useUpdateSubscription(projectId, subscription?.id ?? '');
  useEffect(() => {
    if (open) setF(formFrom(subscription, topic));
  }, [open, subscription, topic]);
  const set = <K extends keyof SubForm>(k: K, v: SubForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const error = validate(f, !subscription);
  const topicOptions = (topics.data?.items ?? []).map((t) => ({ value: t.name, label: t.id }));
  const settings = {
    deliveryType: f.delivery,
    ...(f.delivery === 'push'
      ? {
          push: {
            endpoint: f.endpoint,
            ...(f.pushAccount ? { serviceAccount: f.pushAccount } : {}),
            ...(f.audience ? { audience: f.audience } : {}),
            noWrapper: f.noWrapper,
            writeMetadata: f.writeMetadata,
          },
        }
      : {}),
    ...(f.delivery === 'bigquery'
      ? {
          bigquery: {
            table: f.table,
            useTopicSchema: f.useTopicSchema,
            useTableSchema: f.useTableSchema,
            writeMetadata: f.writeMetadata,
            dropUnknownFields: f.dropUnknown,
            ...(f.bqAccount ? { serviceAccount: f.bqAccount } : {}),
          },
        }
      : {}),
    ...(f.delivery === 'cloudStorage'
      ? {
          cloudStorage: {
            bucket: f.bucket,
            filenamePrefix: f.prefix,
            filenameSuffix: f.suffix,
            ...(f.maxDuration ? { maxDurationSeconds: Number(f.maxDuration) } : {}),
            ...(f.maxBytes ? { maxBytes: f.maxBytes } : {}),
            format: f.format,
            writeMetadata: f.writeMetadata,
            ...(f.gcsAccount ? { serviceAccount: f.gcsAccount } : {}),
          },
        }
      : {}),
    ackDeadlineSeconds: Number(f.ackDeadline),
    retentionSeconds: Math.round(Number(f.retentionDays) * 86_400),
    retainAcked: f.retainAcked,
    expirationSeconds: f.expires ? Math.round(Number(f.expirationDays) * 86_400) : null,
    retry: f.retry ? { minimumBackoffSeconds: Number(f.minBackoff), maximumBackoffSeconds: Number(f.maxBackoff) } : null,
    deadLetter: f.deadLetter ? { topic: f.deadLetterTopic, maxDeliveryAttempts: Number(f.maxAttempts) } : null,
    labels: subscription?.labels ?? {},
    exactlyOnce: f.exactlyOnce,
  };
  const locked = subscription ? 'Fixed when the subscription was created.' : undefined;
  const finish = (s: PubSubSubscription) => {
    onOpenChange(false);
    onDone?.(s);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={subscription ? `Edit ${subscription.id}` : 'Create subscription'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={subscription ? FloppyDiskIcon : PlusIcon}
            loading={create.isPending || update.isPending}
            disabled={!!error}
            disabledReason={error}
            onClick={() =>
              subscription
                ? update.mutate(settings, { onSuccess: (s) => finish(s) })
                : create.mutate(
                    { ...settings, id: f.id, topic: f.topic, filter: f.filter, ordering: f.ordering },
                    { onSuccess: (s) => finish(s) },
                  )
            }
          >
            {subscription ? 'Save subscription' : 'Create subscription'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!subscription ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Subscription id" required error={idError(f.id) ?? undefined}>
              <Input mono value={f.id} onChange={(e) => set('id', e.target.value)} autoFocus />
            </Field>
            <Field label="Topic" required>
              <Select<string>
                value={f.topic}
                onValueChange={(v) => set('topic', v)}
                options={[{ value: '', label: 'Choose a topic' }, ...topicOptions]}
              />
            </Field>
          </div>
        ) : null}
        <Field label="Delivery">
          <Select<DeliveryType>
            value={f.delivery}
            onValueChange={(v) => set('delivery', v)}
            options={[
              { value: 'pull', label: 'Pull' },
              { value: 'push', label: 'Push to an endpoint' },
              { value: 'bigquery', label: 'Write to BigQuery' },
              { value: 'cloudStorage', label: 'Write to Cloud Storage' },
            ]}
          />
        </Field>
        {f.delivery === 'push' ? (
          <div className="flex flex-col gap-3">
            <Field label="Endpoint URL" required>
              <Input
                mono
                value={f.endpoint}
                onChange={(e) => set('endpoint', e.target.value)}
                placeholder="https://service-abc.a.run.app/events"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Service account for the OIDC token" help="Empty sends no token.">
                <Input mono value={f.pushAccount} onChange={(e) => set('pushAccount', e.target.value)} />
              </Field>
              <Field label="Token audience" help="Empty uses the endpoint URL.">
                <Input mono value={f.audience} onChange={(e) => set('audience', e.target.value)} disabled={!f.pushAccount} />
              </Field>
            </div>
            <Switch
              checked={f.noWrapper}
              onCheckedChange={(v) => set('noWrapper', v)}
              label="Unwrap the payload"
              description="Send the raw message body instead of the JSON envelope."
            />
            {f.noWrapper ? (
              <Switch checked={f.writeMetadata} onCheckedChange={(v) => set('writeMetadata', v)} label="Send metadata as headers" />
            ) : null}
          </div>
        ) : null}
        {f.delivery === 'bigquery' ? (
          <div className="flex flex-col gap-3">
            <Field label="Table" required help="project.dataset.table">
              <Input mono value={f.table} onChange={(e) => set('table', e.target.value)} />
            </Field>
            <Switch
              checked={f.useTopicSchema}
              onCheckedChange={(v) => {
                set('useTopicSchema', v);
                if (v) set('useTableSchema', false);
              }}
              label="Use the topic schema"
            />
            <Switch
              checked={f.useTableSchema}
              onCheckedChange={(v) => {
                set('useTableSchema', v);
                if (v) set('useTopicSchema', false);
              }}
              label="Use the table schema"
            />
            <Switch checked={f.writeMetadata} onCheckedChange={(v) => set('writeMetadata', v)} label="Write metadata columns" />
            <Switch checked={f.dropUnknown} onCheckedChange={(v) => set('dropUnknown', v)} label="Drop unknown fields" />
            <Field label="Service account" help="Empty uses the Pub/Sub service agent.">
              <Input mono value={f.bqAccount} onChange={(e) => set('bqAccount', e.target.value)} />
            </Field>
          </div>
        ) : null}
        {f.delivery === 'cloudStorage' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bucket" required>
              <Input mono value={f.bucket} onChange={(e) => set('bucket', e.target.value)} />
            </Field>
            <Field label="Output format">
              <Select<'text' | 'avro'>
                value={f.format}
                onValueChange={(v) => set('format', v)}
                options={[
                  { value: 'text', label: 'Text' },
                  { value: 'avro', label: 'Avro' },
                ]}
              />
            </Field>
            <Field label="File name prefix">
              <Input mono value={f.prefix} onChange={(e) => set('prefix', e.target.value)} />
            </Field>
            <Field label="File name suffix">
              <Input mono value={f.suffix} onChange={(e) => set('suffix', e.target.value)} />
            </Field>
            <Field label="Max duration (s)" help="60 to 600.">
              <Input mono value={f.maxDuration} onChange={(e) => set('maxDuration', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Max bytes per file">
              <Input mono value={f.maxBytes} onChange={(e) => set('maxBytes', e.target.value.replace(/\D/g, ''))} />
            </Field>
            {f.format === 'avro' ? (
              <Switch checked={f.writeMetadata} onCheckedChange={(v) => set('writeMetadata', v)} label="Write metadata" />
            ) : null}
          </div>
        ) : null}

        <Legend className="mt-2">Delivery settings</Legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ack deadline (s)" help="10 to 600.">
            <Input mono value={f.ackDeadline} onChange={(e) => set('ackDeadline', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Retention (days)" help="10 minutes to 31 days.">
            <Input mono value={f.retentionDays} onChange={(e) => set('retentionDays', e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
        </div>
        <Switch
          checked={f.retainAcked}
          onCheckedChange={(v) => set('retainAcked', v)}
          label="Retain acknowledged messages"
          description="Needed to seek back to a time before messages were acknowledged."
        />
        <Switch
          checked={f.expires}
          onCheckedChange={(v) => set('expires', v)}
          label="Expire when inactive"
          description="Deletes the subscription after a period with no subscriber activity."
        />
        {f.expires ? (
          <Field label="Inactive days before expiring">
            <Input mono value={f.expirationDays} onChange={(e) => set('expirationDays', e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
        ) : null}
        <Switch
          checked={f.retry}
          onCheckedChange={(v) => set('retry', v)}
          label="Retry with exponential backoff"
          description="Otherwise messages are redelivered at once."
        />
        {f.retry ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum backoff (s)">
              <Input mono value={f.minBackoff} onChange={(e) => set('minBackoff', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Maximum backoff (s)">
              <Input mono value={f.maxBackoff} onChange={(e) => set('maxBackoff', e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
        ) : null}
        <Switch
          checked={f.deadLetter}
          onCheckedChange={(v) => set('deadLetter', v)}
          label="Dead lettering"
          description="Forward messages after too many delivery attempts."
        />
        {f.deadLetter ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dead-letter topic">
              <Select<string>
                value={f.deadLetterTopic}
                onValueChange={(v) => set('deadLetterTopic', v)}
                options={[{ value: '', label: 'Choose a topic' }, ...topicOptions.filter((t) => t.value !== f.topic)]}
              />
            </Field>
            <Field label="Max delivery attempts" help="5 to 100.">
              <Input mono value={f.maxAttempts} onChange={(e) => set('maxAttempts', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <p className="col-span-2 m-0 text-meta text-ink-3">
              The Pub/Sub service agent must be allowed to publish to that topic and to subscribe to this subscription. The subscription
              page offers to add both grants.
            </p>
          </div>
        ) : null}
        <Switch
          checked={f.exactlyOnce}
          onCheckedChange={(v) => set('exactlyOnce', v)}
          label="Exactly-once delivery"
          description="Pull subscriptions only."
          disabled={f.delivery !== 'pull'}
        />
        <Field label="Filter" help={locked ?? 'On attributes, such as attributes.type = "order". Cannot change later.'}>
          <Input mono value={f.filter} onChange={(e) => set('filter', e.target.value)} disabled={!!subscription} />
        </Field>
        <Switch
          checked={f.ordering}
          onCheckedChange={(v) => set('ordering', v)}
          label="Message ordering"
          description={locked ?? 'Deliver messages with the same ordering key in order. Cannot change later.'}
          disabled={!!subscription}
        />
        {!subscription ? (
          <EquivalentCommand
            gcloud={`gcloud pubsub subscriptions create ${f.id || 'SUBSCRIPTION'} --topic=${f.topic.split('/').pop() || 'TOPIC'} --ack-deadline=${f.ackDeadline}${f.delivery === 'push' ? ` --push-endpoint=${sh(f.endpoint)}` : ''}${f.filter ? ` --message-filter=${sh(f.filter)}` : ''}${f.ordering ? ' --enable-message-ordering' : ''}${f.deadLetter && f.deadLetterTopic ? ` --dead-letter-topic=${f.deadLetterTopic.split('/').pop()} --max-delivery-attempts=${f.maxAttempts}` : ''}${f.expires ? ` --expiration-period=${f.expirationDays}d` : ' --expiration-period=never'} --project=${projectId}`}
          />
        ) : null}
      </div>
    </Sheet>
  );
}
