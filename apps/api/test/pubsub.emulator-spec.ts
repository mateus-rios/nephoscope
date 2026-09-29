import type { PubSubWatchUpdate } from '@nephoscope/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NephoscopeConfig } from '../src/core/config/config.js';
import type { ProfileHandle } from '../src/core/credentials/profiles.service.js';
import { GcpClientFactory } from '../src/core/gcp/client-factory.js';
import type { LiveSink } from '../src/core/live/live.types.js';
import { OperationsService } from '../src/core/operations/operations.service.js';
import type { JsonStore } from '../src/core/store/json-store.js';
import { PubSubService } from '../src/modules/pubsub/pubsub.service.js';
import { mapReceived } from '../src/modules/pubsub/pubsub-mapping.js';
import { pubsubWatchChannel, WATCH_PREFIX } from '../src/modules/pubsub/pubsub-watch.js';

/** SPEC-0006 T-01 to T-04 against the Pub/Sub emulator (PUBSUB_EMULATOR_HOST). */

const host = process.env.PUBSUB_EMULATOR_HOST;
const PROJECT = `nephoscope-ps-${Date.now()}`;
const handle = { profile: { id: 'env' }, auth: {} } as unknown as ProfileHandle;
const factory = new GcpClientFactory({ get: () => handle, onRemoved: () => {} } as never);
const store = { read: async <T>(_: string, f: T) => f, write: async () => {} } as unknown as JsonStore;
const operations = new OperationsService(store);
const ps = new PubSubService(factory, operations, { emulators: { pubsub: host ?? null } } as unknown as NephoscopeConfig);
const b64 = (s: string) => Buffer.from(s).toString('base64');
const TOPIC = `projects/${PROJECT}/topics/orders`;
const SUB = `projects/${PROJECT}/subscriptions/orders-pull`;

async function waitFor<T>(fn: () => T | undefined, ms = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() - start > ms) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('messages', () => {
  it('show valid UTF-8 as text and anything else only as base64 (CA-09)', () => {
    expect(mapReceived({ message: { messageId: '1', data: Buffer.from('<b>hi</b>') } }).text).toBe('<b>hi</b>');
    expect(mapReceived({ message: { messageId: '2', data: Buffer.from([0xff, 0x00]) } })).toMatchObject({ text: null, data: '/wA=' });
  });
});

describe.skipIf(!host)('Pub/Sub against the emulator', () => {
  beforeAll(async () => {
    await ps.createTopic(handle, PROJECT, {
      id: 'orders',
      labels: {},
      messageRetentionSeconds: null,
      allowedPersistenceRegions: [],
      schemaSettings: null,
    });
    await ps.createSubscription(handle, PROJECT, {
      id: 'orders-pull',
      topic: TOPIC,
      deliveryType: 'pull',
      ackDeadlineSeconds: 30,
      retentionSeconds: 7 * 86_400,
      retainAcked: false,
      expirationSeconds: null,
      retry: null,
      deadLetter: null,
      labels: {},
      filter: '',
      exactlyOnce: false,
      ordering: false,
    });
  });
  afterAll(() => factory.onModuleDestroy());

  it('publishes messages with attributes (T-01)', async () => {
    const r = await ps.publish(handle, PROJECT, TOPIC, {
      messages: [1, 2, 3].map((n) => ({ data: b64(`{"order":${n}}`), attributes: { source: 'test', n: String(n) } })),
    });
    expect(r.messageIds).toHaveLength(3);
    const subs = await ps.topicSubscriptions(handle, TOPIC);
    expect(subs).toEqual([SUB]);
    expect((await ps.subscription(handle, SUB)).expirationSeconds).toBeNull();
  });

  it('peeks and gives the messages back at once (T-02)', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5 && seen.size < 3; i++) for (const m of await ps.peek(handle, SUB, 10)) seen.add(m.text ?? '');
    expect([...seen].sort()).toEqual(['{"order":1}', '{"order":2}', '{"order":3}']);
    // Still available to another subscriber right after.
    const again = new Set<string>();
    for (let i = 0; i < 5 && again.size < 3; i++) for (const m of await ps.peek(handle, SUB, 10)) again.add(m.messageId);
    expect(again.size).toBe(3);
  });

  it('pulls and acknowledges, removing the messages (T-03)', async () => {
    let acked = 0;
    for (let i = 0; i < 5 && acked < 3; i++) acked += (await ps.pullAck(handle, PROJECT, SUB, 10)).length;
    expect(acked).toBe(3);
    expect(await ps.peek(handle, SUB, 10)).toEqual([]);
  });

  it('watches a topic through its own subscription and deletes it on close (T-04)', async () => {
    const channel = pubsubWatchChannel(ps);
    const updates: PubSubWatchUpdate[] = [];
    const sink: LiveSink = {
      data: (u) => updates.push(u as PubSubWatchUpdate),
      gap: () => {},
      error: (e) => updates.push({ error: e } as never),
      end: () => {},
    };
    const live = await channel.open({ profile: handle, projectId: PROJECT, params: { topic: TOPIC, filter: '' } }, sink);
    const first = await waitFor(() => updates[0]);
    expect(first.subscription).toMatch(new RegExp(`/subscriptions/${WATCH_PREFIX}[0-9a-f]{10}$`));
    await ps.publish(handle, PROJECT, TOPIC, { messages: [{ data: b64('watched'), attributes: {} }] });
    const got = await waitFor(() => updates.flatMap((u) => u.messages).find((m) => m.text === 'watched'));
    expect(got.text).toBe('watched');
    await live.close();
    expect(await ps.topicSubscriptions(handle, TOPIC)).toEqual([SUB]);
  });
});
