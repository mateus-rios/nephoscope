import type {
  CreateSchema,
  CreateSubscription,
  CreateTopic,
  ListResponse,
  Publish,
  PubSubMessage,
  PubSubSchema,
  PubSubSnapshot,
  PubSubSubscription,
  PubSubTopic,
  Resend,
  ResendResult,
  Seek,
  SubscriptionSettings,
  TopicSettings,
  ValidateMessage,
} from '@nephoscope/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { NEPHOSCOPE_CONFIG, type NephoscopeConfig } from '../../core/config/config.js';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { rawJson } from '../../core/gcp/proto.js';
import { sdk } from '../../core/gcp/sdk.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';
import { isoToProtoTimestamp } from '../firestore/codec.js';
import {
  mapReceived,
  mapSchema,
  mapSnapshot,
  mapSubscription,
  mapTopic,
  SUBSCRIPTION_MASK,
  subscriptionToProto,
  TOPIC_MASK,
  topicToProto,
} from './pubsub-mapping.js';

// biome-ignore lint/suspicious/noExplicitAny: generated clients are loosely typed at this boundary.
type Any = any;

const last = (name: string) => name.split('/').pop() ?? name;
const PULL_TIMEOUT_MS = 5000;

export interface PubSubClients {
  pubsub: Any;
  publisher: Any;
  subscriber: Any;
  schemas: Any;
}

/** Pub/Sub (SPEC-0006 D-01 to D-08). Every change finishes at once, so it is recorded as an instant operation. */
@Injectable()
export class PubSubService {
  constructor(
    private readonly factory: GcpClientFactory,
    private readonly operations: OperationsService,
    @Inject(NEPHOSCOPE_CONFIG) private readonly config: NephoscopeConfig,
  ) {}

  get emulator(): string | null {
    return this.config.emulators.pubsub;
  }

  /**
   * The high-level client resolves the endpoint, including PUBSUB_EMULATOR_HOST (SPEC-0001 D-18);
   * the low-level clients reuse its options so both styles reach the same backend.
   */
  async clients(profileId: string): Promise<PubSubClients> {
    const m = await sdk.pubsub();
    return this.factory.get(profileId, 'pubsub', (auth) => {
      // The emulator takes no credentials; the high-level client connects to it without TLS.
      const pubsub = new m.PubSub(this.emulator ? {} : { auth: auth as never });
      const resolved = pubsub.options;
      const opts: Any = this.emulator ? { ...resolved, port: Number(resolved.port) } : { auth: auth as never };
      const set: PubSubClients & { close: () => Promise<void> } = {
        pubsub,
        publisher: new m.v1.PublisherClient(opts),
        subscriber: new m.v1.SubscriberClient(opts),
        schemas: new m.v1.SchemaServiceClient(opts),
        close: async () => {
          await Promise.allSettled([pubsub.close(), set.publisher.close(), set.subscriber.close(), set.schemas.close()]);
        },
      };
      return set;
    });
  }

  /** A high-level client bound to one project: streaming pull needs the project id (D-05). */
  async forProject(profileId: string, projectId: string): Promise<Any> {
    const m = await sdk.pubsub();
    return this.factory.get(
      profileId,
      `pubsub-hl:${projectId}`,
      (auth) => new m.PubSub(this.emulator ? { projectId } : { projectId, auth: auth as never }),
    );
  }

  private href(projectId: string, kind: 'topics' | 'subscriptions' | 'schemas', id: string) {
    return `/p/${projectId}/pubsub/${kind}/${encodeURIComponent(id)}`;
  }

  private record(h: ProfileHandle, projectId: string, kind: string, name: string, displayName: string, href: string | null) {
    this.operations.recordInstant({ profileId: h.profile.id, projectId, product: 'pubsub', kind, resource: { name, displayName, href } });
  }

  // ---- topics -----------------------------------------------------------------------------------

  async topics(h: ProfileHandle, projectId: string): Promise<ListResponse<PubSubTopic>> {
    const { publisher } = await this.clients(h.profile.id);
    const [items] = await publisher.listTopics({ project: `projects/${projectId}` });
    return { items: (items as Any[]).map(mapTopic).sort((a, b) => a.id.localeCompare(b.id)), nextPageToken: null };
  }

  async topic(h: ProfileHandle, name: string): Promise<PubSubTopic> {
    const [t] = await (await this.clients(h.profile.id)).publisher.getTopic({ topic: name });
    return mapTopic(t);
  }

  async topicRaw(h: ProfileHandle, name: string): Promise<unknown> {
    const [t] = await (await this.clients(h.profile.id)).publisher.getTopic({ topic: name });
    return rawJson(t);
  }

  async createTopic(h: ProfileHandle, projectId: string, body: CreateTopic): Promise<PubSubTopic> {
    const name = `projects/${projectId}/topics/${body.id}`;
    const [t] = await (await this.clients(h.profile.id)).publisher.createTopic(topicToProto(name, body));
    this.record(h, projectId, 'pubsub.topic.create', name, `Create topic ${body.id}`, this.href(projectId, 'topics', body.id));
    return mapTopic(t);
  }

  async updateTopic(h: ProfileHandle, projectId: string, name: string, body: TopicSettings): Promise<PubSubTopic> {
    const [t] = await (await this.clients(h.profile.id)).publisher.updateTopic({
      topic: topicToProto(name, body),
      updateMask: { paths: TOPIC_MASK },
    });
    this.record(h, projectId, 'pubsub.topic.update', name, `Update topic ${last(name)}`, this.href(projectId, 'topics', last(name)));
    return mapTopic(t);
  }

  async deleteTopic(h: ProfileHandle, projectId: string, name: string): Promise<void> {
    await (await this.clients(h.profile.id)).publisher.deleteTopic({ topic: name });
    this.record(h, projectId, 'pubsub.topic.delete', name, `Delete topic ${last(name)}`, null);
  }

  async topicSubscriptions(h: ProfileHandle, name: string): Promise<string[]> {
    const [names] = await (await this.clients(h.profile.id)).publisher.listTopicSubscriptions({ topic: name });
    return [...(names as string[])].sort();
  }

  async topicSnapshots(h: ProfileHandle, name: string): Promise<string[]> {
    const [names] = await (await this.clients(h.profile.id)).publisher.listTopicSnapshots({ topic: name });
    return [...(names as string[])].sort();
  }

  async publish(h: ProfileHandle, projectId: string, topic: string, body: Publish): Promise<{ messageIds: string[] }> {
    const { publisher } = await this.clients(h.profile.id);
    const messages = body.messages.map((m) => ({
      data: Buffer.from(m.data, 'base64'),
      attributes: m.attributes ?? {},
      ...(m.orderingKey ? { orderingKey: m.orderingKey } : {}),
    }));
    for (const m of messages)
      if (m.data.length === 0 && Object.keys(m.attributes).length === 0)
        throw ProblemException.of('INVALID_ARGUMENT', 'A message needs data or at least one attribute.');
    const ids: string[] = [];
    // The API takes up to 1,000 messages and 10 MB per request; send in chunks that stay under both.
    let chunk: typeof messages = [];
    let size = 0;
    const flush = async () => {
      if (chunk.length === 0) return;
      const [res] = await publisher.publish({ topic, messages: chunk });
      ids.push(...(res.messageIds ?? []));
      chunk = [];
      size = 0;
    };
    for (const m of messages) {
      const bytes = m.data.length + JSON.stringify(m.attributes).length + 64;
      if (size + bytes > 9_000_000) await flush();
      chunk.push(m);
      size += bytes;
    }
    await flush();
    this.record(
      h,
      projectId,
      'pubsub.topic.publish',
      topic,
      `Publish ${ids.length} ${ids.length === 1 ? 'message' : 'messages'} to ${last(topic)}`,
      this.href(projectId, 'topics', last(topic)),
    );
    return { messageIds: ids };
  }

  // ---- subscriptions ----------------------------------------------------------------------------

  async subscriptions(h: ProfileHandle, projectId: string): Promise<ListResponse<PubSubSubscription>> {
    const { subscriber } = await this.clients(h.profile.id);
    const [items] = await subscriber.listSubscriptions({ project: `projects/${projectId}` });
    return { items: (items as Any[]).map(mapSubscription).sort((a, b) => a.id.localeCompare(b.id)), nextPageToken: null };
  }

  async subscription(h: ProfileHandle, name: string): Promise<PubSubSubscription> {
    const [s] = await (await this.clients(h.profile.id)).subscriber.getSubscription({ subscription: name });
    return mapSubscription(s);
  }

  async subscriptionRaw(h: ProfileHandle, name: string): Promise<unknown> {
    const [s] = await (await this.clients(h.profile.id)).subscriber.getSubscription({ subscription: name });
    return rawJson(s);
  }

  async createSubscription(h: ProfileHandle, projectId: string, body: CreateSubscription): Promise<PubSubSubscription> {
    const name = `projects/${projectId}/subscriptions/${body.id}`;
    const proto = subscriptionToProto(name, body);
    for (const k of Object.keys(proto)) if (proto[k] === null) delete proto[k];
    const [s] = await (await this.clients(h.profile.id)).subscriber.createSubscription({
      ...proto,
      topic: body.topic,
      filter: body.filter ?? '',
      enableMessageOrdering: !!body.ordering,
    });
    this.record(
      h,
      projectId,
      'pubsub.subscription.create',
      name,
      `Create subscription ${body.id}`,
      this.href(projectId, 'subscriptions', body.id),
    );
    return mapSubscription(s);
  }

  async updateSubscription(h: ProfileHandle, projectId: string, name: string, body: SubscriptionSettings): Promise<PubSubSubscription> {
    const proto = subscriptionToProto(name, body);
    for (const k of ['retryPolicy', 'deadLetterPolicy']) if (proto[k] === null) proto[k] = {};
    const [s] = await (await this.clients(h.profile.id)).subscriber.updateSubscription({
      subscription: proto,
      updateMask: { paths: SUBSCRIPTION_MASK },
    });
    this.record(
      h,
      projectId,
      'pubsub.subscription.update',
      name,
      `Update subscription ${last(name)}`,
      this.href(projectId, 'subscriptions', last(name)),
    );
    return mapSubscription(s);
  }

  async deleteSubscription(h: ProfileHandle, projectId: string, name: string): Promise<void> {
    await (await this.clients(h.profile.id)).subscriber.deleteSubscription({ subscription: name });
    this.record(h, projectId, 'pubsub.subscription.delete', name, `Delete subscription ${last(name)}`, null);
  }

  async detach(h: ProfileHandle, projectId: string, name: string): Promise<void> {
    await (await this.clients(h.profile.id)).publisher.detachSubscription({ subscription: name });
    this.record(
      h,
      projectId,
      'pubsub.subscription.detach',
      name,
      `Detach subscription ${last(name)}`,
      this.href(projectId, 'subscriptions', last(name)),
    );
  }

  /** One synchronous pull; an empty subscription answers with a deadline instead of messages. */
  private async pull(subscriber: Any, subscription: string, max: number): Promise<Any[]> {
    try {
      const [res] = await subscriber.pull({ subscription, maxMessages: max }, { timeout: PULL_TIMEOUT_MS, retry: null });
      return res.receivedMessages ?? [];
    } catch (err) {
      const p = toProblem(err);
      if (p.code === 'DEADLINE_EXCEEDED') return [];
      throw err;
    }
  }

  private async nack(subscriber: Any, subscription: string, ackIds: string[]): Promise<void> {
    if (ackIds.length > 0) await subscriber.modifyAckDeadline({ subscription, ackIds, ackDeadlineSeconds: 0 });
  }

  /** Peek (D-04): pull, then give every message back at once with a zero ack deadline. */
  async peek(h: ProfileHandle, subscription: string, max: number): Promise<PubSubMessage[]> {
    const { subscriber } = await this.clients(h.profile.id);
    const received = await this.pull(subscriber, subscription, max);
    await this.nack(
      subscriber,
      subscription,
      received.map((r) => String(r.ackId)),
    );
    return received.map(mapReceived);
  }

  /** Pull and acknowledge (CA-04): removes the messages from the subscription. */
  async pullAck(h: ProfileHandle, projectId: string, subscription: string, max: number): Promise<PubSubMessage[]> {
    const { subscriber } = await this.clients(h.profile.id);
    const received = await this.pull(subscriber, subscription, max);
    if (received.length > 0) await subscriber.acknowledge({ subscription, ackIds: received.map((r) => String(r.ackId)) });
    this.record(
      h,
      projectId,
      'pubsub.subscription.pullAck',
      subscription,
      `Acknowledge ${received.length} messages of ${last(subscription)}`,
      this.href(projectId, 'subscriptions', last(subscription)),
    );
    return received.map(mapReceived);
  }

  async seek(h: ProfileHandle, projectId: string, subscription: string, body: Seek): Promise<void> {
    const { subscriber } = await this.clients(h.profile.id);
    if ('snapshot' in body) await subscriber.seek({ subscription, snapshot: body.snapshot });
    else await subscriber.seek({ subscription, time: isoToProtoTimestamp(body.time) });
    const to = 'snapshot' in body ? `snapshot ${last(body.snapshot)}` : body.time;
    this.record(
      h,
      projectId,
      'pubsub.subscription.seek',
      subscription,
      `Seek ${last(subscription)} to ${to}`,
      this.href(projectId, 'subscriptions', last(subscription)),
    );
  }

  /**
   * Resend dead-lettered messages (D-06): pull from the dead-letter subscription until the chosen
   * ids are found, publish them again to the original topic, then acknowledge them. Others are
   * given back at once.
   */
  async resend(h: ProfileHandle, projectId: string, body: Resend): Promise<ResendResult> {
    const { subscriber, publisher } = await this.clients(h.profile.id);
    const wanted = new Set(body.messageIds);
    const resent: string[] = [];
    for (let round = 0; round < 5 && wanted.size > 0; round++) {
      const received = await this.pull(subscriber, body.from, 100);
      if (received.length === 0) break;
      const match = received.filter((r) => wanted.has(String(r.message?.messageId)));
      const other = received.filter((r) => !wanted.has(String(r.message?.messageId)));
      await this.nack(
        subscriber,
        body.from,
        other.map((r) => String(r.ackId)),
      );
      if (match.length > 0) {
        await publisher.publish({
          topic: body.to,
          messages: match.map((r) => ({
            data: r.message.data,
            attributes: r.message.attributes ?? {},
            ...(r.message.orderingKey ? { orderingKey: r.message.orderingKey } : {}),
          })),
        });
        await subscriber.acknowledge({ subscription: body.from, ackIds: match.map((r) => String(r.ackId)) });
        for (const r of match) {
          const id = String(r.message.messageId);
          wanted.delete(id);
          resent.push(id);
        }
      }
    }
    this.record(
      h,
      projectId,
      'pubsub.deadLetter.resend',
      body.to,
      `Resend ${resent.length} dead-lettered messages to ${last(body.to)}`,
      this.href(projectId, 'topics', last(body.to)),
    );
    return { resent, notFound: [...wanted] };
  }

  /** The grants a dead-letter policy needs for the Pub/Sub service agent (D-03). */
  async grantDeadLetter(h: ProfileHandle, projectId: string, subscription: string, projectNumber: string): Promise<{ member: string }> {
    const sub = await this.subscription(h, subscription);
    if (!sub.deadLetter) throw ProblemException.of('FAILED_PRECONDITION', 'This subscription has no dead-letter topic.');
    const member = `serviceAccount:service-${projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`;
    const { publisher, subscriber } = await this.clients(h.profile.id);
    const add = async (client: Any, resource: string, role: string) => {
      const [policy] = await client.getIamPolicy({ resource });
      const bindings = policy.bindings ?? [];
      const binding = bindings.find((b: Any) => b.role === role && !b.condition);
      if (binding?.members?.includes(member)) return;
      if (binding) binding.members.push(member);
      else bindings.push({ role, members: [member] });
      await client.setIamPolicy({ resource, policy: { ...policy, bindings } });
    };
    await add(publisher, sub.deadLetter.topic, 'roles/pubsub.publisher');
    await add(subscriber, subscription, 'roles/pubsub.subscriber');
    this.record(
      h,
      projectId,
      'pubsub.deadLetter.grant',
      subscription,
      `Grant dead-letter access for ${last(subscription)}`,
      this.href(projectId, 'subscriptions', last(subscription)),
    );
    return { member };
  }

  // ---- snapshots -----------------------------------------------------------------------------------

  async snapshots(h: ProfileHandle, projectId: string): Promise<ListResponse<PubSubSnapshot>> {
    const { subscriber } = await this.clients(h.profile.id);
    const [items] = await subscriber.listSnapshots({ project: `projects/${projectId}` });
    return { items: (items as Any[]).map(mapSnapshot).sort((a, b) => a.id.localeCompare(b.id)), nextPageToken: null };
  }

  async createSnapshot(h: ProfileHandle, projectId: string, id: string, subscription: string): Promise<PubSubSnapshot> {
    const name = `projects/${projectId}/snapshots/${id}`;
    const [s] = await (await this.clients(h.profile.id)).subscriber.createSnapshot({ name, subscription });
    this.record(h, projectId, 'pubsub.snapshot.create', name, `Create snapshot ${id}`, null);
    return mapSnapshot(s);
  }

  async deleteSnapshot(h: ProfileHandle, projectId: string, name: string): Promise<void> {
    await (await this.clients(h.profile.id)).subscriber.deleteSnapshot({ snapshot: name });
    this.record(h, projectId, 'pubsub.snapshot.delete', name, `Delete snapshot ${last(name)}`, null);
  }

  // ---- schemas ----------------------------------------------------------------------------------------

  async schemasList(h: ProfileHandle, projectId: string): Promise<ListResponse<PubSubSchema>> {
    const { schemas } = await this.clients(h.profile.id);
    const [items] = await schemas.listSchemas({ parent: `projects/${projectId}`, view: 'FULL' });
    return { items: (items as Any[]).map(mapSchema).sort((a, b) => a.id.localeCompare(b.id)), nextPageToken: null };
  }

  async schema(h: ProfileHandle, name: string): Promise<PubSubSchema> {
    const [s] = await (await this.clients(h.profile.id)).schemas.getSchema({ name, view: 'FULL' });
    return mapSchema(s);
  }

  async revisions(h: ProfileHandle, name: string): Promise<PubSubSchema[]> {
    const [items] = await (await this.clients(h.profile.id)).schemas.listSchemaRevisions({ name, view: 'FULL' });
    return (items as Any[]).map(mapSchema);
  }

  async createSchema(h: ProfileHandle, projectId: string, body: CreateSchema): Promise<PubSubSchema> {
    const [s] = await (await this.clients(h.profile.id)).schemas.createSchema({
      parent: `projects/${projectId}`,
      schemaId: body.id,
      schema: { type: body.type, definition: body.definition },
    });
    this.record(h, projectId, 'pubsub.schema.create', String(s.name), `Create schema ${body.id}`, this.href(projectId, 'schemas', body.id));
    return mapSchema(s);
  }

  async commitSchema(h: ProfileHandle, projectId: string, name: string, type: string, definition: string): Promise<PubSubSchema> {
    const [s] = await (await this.clients(h.profile.id)).schemas.commitSchema({ name, schema: { name, type, definition } });
    this.record(
      h,
      projectId,
      'pubsub.schema.commit',
      name,
      `Commit a revision of ${last(name)}`,
      this.href(projectId, 'schemas', last(name)),
    );
    return mapSchema(s);
  }

  async rollbackSchema(h: ProfileHandle, projectId: string, name: string, revisionId: string): Promise<PubSubSchema> {
    const [s] = await (await this.clients(h.profile.id)).schemas.rollbackSchema({ name, revisionId });
    this.record(
      h,
      projectId,
      'pubsub.schema.rollback',
      name,
      `Roll ${last(name)} back to ${revisionId}`,
      this.href(projectId, 'schemas', last(name)),
    );
    return mapSchema(s);
  }

  async deleteRevision(h: ProfileHandle, projectId: string, name: string, revisionId: string): Promise<void> {
    await (await this.clients(h.profile.id)).schemas.deleteSchemaRevision({ name: `${name}@${revisionId}` });
    this.record(
      h,
      projectId,
      'pubsub.schema.deleteRevision',
      name,
      `Delete revision ${revisionId} of ${last(name)}`,
      this.href(projectId, 'schemas', last(name)),
    );
  }

  async deleteSchema(h: ProfileHandle, projectId: string, name: string): Promise<void> {
    await (await this.clients(h.profile.id)).schemas.deleteSchema({ name });
    this.record(h, projectId, 'pubsub.schema.delete', name, `Delete schema ${last(name)}`, null);
  }

  /** Validation answers with an error when the definition or message is invalid; that is the result, not a failure. */
  private async validation(run: () => Promise<unknown>): Promise<{ valid: boolean; message: string | null }> {
    try {
      await run();
      return { valid: true, message: null };
    } catch (err) {
      const p = toProblem(err);
      if (p.code === 'INVALID_ARGUMENT') return { valid: false, message: p.detail };
      throw err;
    }
  }

  async validateSchema(h: ProfileHandle, projectId: string, type: string, definition: string) {
    const { schemas } = await this.clients(h.profile.id);
    return this.validation(() => schemas.validateSchema({ parent: `projects/${projectId}`, schema: { type, definition } }));
  }

  async validateMessage(h: ProfileHandle, projectId: string, name: string, body: ValidateMessage) {
    const { schemas } = await this.clients(h.profile.id);
    return this.validation(() =>
      schemas.validateMessage({
        parent: `projects/${projectId}`,
        name: body.revisionId ? `${name}@${body.revisionId}` : name,
        encoding: body.encoding,
        message: Buffer.from(body.data, 'base64'),
      }),
    );
  }
}
