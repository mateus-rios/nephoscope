import { type FirestoreListenUpdate, parseTypedJson, type WireFields } from '@nephoscope/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NephoscopeConfig } from '../src/core/config/config.js';
import type { ProfileHandle } from '../src/core/credentials/profiles.service.js';
import { GcpClientFactory } from '../src/core/gcp/client-factory.js';
import { sdk } from '../src/core/gcp/sdk.js';
import type { LiveSink } from '../src/core/live/live.types.js';
import { OperationsService } from '../src/core/operations/operations.service.js';
import type { JsonStore } from '../src/core/store/json-store.js';
import { FirestoreClients } from '../src/modules/firestore/firestore-clients.js';
import { FirestoreDataService } from '../src/modules/firestore/firestore-data.service.js';
import { firestoreListenChannel } from '../src/modules/firestore/firestore-listen.js';

/**
 * SPEC-0004 emulator scenarios (T-02 to T-12). Run with the Firestore emulator:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 pnpm --filter @nephoscope/api test:emulator
 */

const host = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = `nephoscope-test-${Date.now()}`;
const DB = '(default)';

const handle = { profile: { id: 'env' }, auth: {} } as unknown as ProfileHandle;
const profiles = { get: () => handle, onRemoved: () => {} };
const store = { read: async <T>(_: string, fallback: T) => fallback, write: async () => {} } as unknown as JsonStore;
const config = { emulators: { firestore: host ?? null } } as unknown as NephoscopeConfig;

const factory = new GcpClientFactory(profiles as never);
const clients = new FirestoreClients(factory, config);
const operations = new OperationsService(store);
const data = new FirestoreDataService(clients, operations);

function fields(json: string): WireFields {
  const r = parseTypedJson(json, { documentsRoot: `projects/${PROJECT}/databases/${DB}/documents`, allowTransforms: true });
  if (!r.ok) throw new Error(r.error.message);
  return r.value as WireFields;
}

async function waitFor<T>(fn: () => T | undefined, ms = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() - start > ms) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!host)('Firestore against the emulator', () => {
  beforeAll(async () => {
    await operations.onModuleInit();
  });
  afterAll(async () => {
    operations.onModuleDestroy();
    await factory.onModuleDestroy();
  });

  it('keeps integer, double, big integers and NaN apart (T-02)', async () => {
    const doc = await data.create(handle, PROJECT, DB, {
      collection: 'types',
      id: 't2',
      fields: fields('{"a": 1, "b": 1.0, "c": {"$int": "9007199254740993"}, "d": {"$double": "NaN"}}'),
    });
    expect(doc.fields).toEqual({
      a: { t: 'integer', v: '1' },
      b: { t: 'double', v: 1 },
      c: { t: 'integer', v: '9007199254740993' },
      d: { t: 'double', v: 'NaN' },
    });
  });

  it('keeps timestamp microseconds exactly (T-03)', async () => {
    const doc = await data.create(handle, PROJECT, DB, {
      collection: 'types',
      id: 't3',
      fields: fields('{"at": {"$timestamp": "2026-09-28T12:00:00.123456Z"}}'),
    });
    expect(doc.fields.at).toEqual({ t: 'timestamp', v: '2026-09-28T12:00:00.123456Z' });
  });

  it('lists a parent with only subcollections as missing (T-04)', async () => {
    await data.create(handle, PROJECT, DB, { collection: 'users/u1/orders', id: 'o1', fields: {} });
    const page = await data.documents(handle, PROJECT, DB, { collection: 'users', pageSize: 50, showMissing: true });
    expect(page.items.map((d) => [d.id, d.missing])).toEqual([['u1', true]]);
    const sub = await data.collections(handle, PROJECT, DB, { parent: 'users/u1', pageSize: 100 });
    expect(sub.items).toEqual(['orders']);
  });

  it('refuses a save when the document changed since it was read (T-05)', async () => {
    const first = await data.create(handle, PROJECT, DB, { collection: 'conflict', id: 'c1', fields: fields('{"n": 1}') });
    await data.save(handle, PROJECT, DB, 'conflict/c1', { fields: fields('{"n": 2}'), mask: ['n'], updateTime: first.updateTime });
    await expect(
      data.save(handle, PROJECT, DB, 'conflict/c1', { fields: fields('{"n": 3}'), mask: ['n'], updateTime: first.updateTime }),
    ).rejects.toMatchObject({ problem: { code: 'CONFLICT', reason: 'DOCUMENT_CHANGED' } });
    const now = await data.get(handle, PROJECT, DB, 'conflict/c1');
    expect(now.fields.n).toEqual({ t: 'integer', v: '2' });
  });

  it('applies increment and server timestamp transforms in one save (T-06)', async () => {
    const doc = await data.create(handle, PROJECT, DB, { collection: 'counters', id: 'k', fields: fields('{"n": 10, "keep": true}') });
    const saved = await data.save(handle, PROJECT, DB, 'counters/k', {
      fields: fields('{"n": {"$increment": 5}, "at": {"$serverTimestamp": true}, "keep": true}'),
      mask: ['n', 'at'],
      updateTime: doc.updateTime,
    });
    expect(saved.fields.n).toEqual({ t: 'integer', v: '15' });
    expect(saved.fields.at?.t).toBe('timestamp');
    expect(saved.fields.keep).toEqual({ t: 'boolean', v: true });
  });

  it('runs OR queries with order and a cursor (T-07)', async () => {
    const rows = [
      ['a', 'open', 1, 'me'],
      ['b', 'closed', 5, 'me'],
      ['c', 'closed', 2, 'me'],
      ['d', 'open', 9, 'you'],
      ['e', 'open', 4, 'me'],
    ] as const;
    for (const [id, status, priority, owner] of rows)
      await data.create(handle, PROJECT, DB, { collection: 'tickets', id, fields: fields(JSON.stringify({ status, priority, owner })) });
    const where = {
      kind: 'and' as const,
      filters: [
        {
          kind: 'or' as const,
          filters: [
            { kind: 'field' as const, field: 'status', op: '==' as const, value: { t: 'string' as const, v: 'open' } },
            { kind: 'field' as const, field: 'priority', op: '>' as const, value: { t: 'integer' as const, v: '3' } },
          ],
        },
        { kind: 'field' as const, field: 'owner', op: '==' as const, value: { t: 'string' as const, v: 'me' } },
      ],
    };
    const spec = {
      source: { kind: 'collection' as const, path: 'tickets' },
      where,
      orderBy: [{ field: 'priority', direction: 'asc' as const }],
      limit: 2,
    };
    const page1 = await data.query(handle, PROJECT, DB, spec);
    expect(page1.documents.map((d) => d.id)).toEqual(['a', 'e']);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await data.query(handle, PROJECT, DB, { ...spec, start: { mode: 'after', values: page1.nextCursor ?? [] } });
    expect(page2.documents.map((d) => d.id)).toEqual(['b']);
  });

  it('types count, sum and avg as Google does (T-08)', async () => {
    const r = await data.aggregate(handle, PROJECT, DB, { source: { kind: 'collection', path: 'tickets' }, orderBy: [] }, [
      { op: 'count' },
      { op: 'sum', field: 'priority' },
      { op: 'avg', field: 'priority' },
    ]);
    expect(r.values).toEqual([
      { t: 'integer', v: '5' },
      { t: 'integer', v: '21' },
      { t: 'double', v: 4.2 },
    ]);
  });

  it('deletes a collection with subcollections as a tracked operation (T-11)', async () => {
    const docs = Array.from({ length: 1200 }, (_, i) => ({ id: `d${String(i).padStart(4, '0')}`, fields: fields(`{"i": ${i}}`) }));
    for (let i = 0; i < docs.length; i += 500)
      await data.importBatch(handle, PROJECT, DB, { collection: 'bulk', mode: 'overwrite', documents: docs.slice(i, i + 500) });
    await data.create(handle, PROJECT, DB, { collection: 'bulk/d0001/children', id: 'x', fields: {} });
    await data.create(handle, PROJECT, DB, { collection: 'bulkish', id: 'survivor', fields: {} });
    expect(await data.count(handle, PROJECT, DB, 'bulk')).toBe(1200);
    const op = data.recursiveDelete(handle, PROJECT, DB, { collection: 'bulk' }, 1200);
    const done = await waitFor(() => {
      const cur = operations.get(op.id);
      return cur?.status === 'running' ? undefined : cur;
    }, 30_000);
    expect(done.status).toBe('succeeded');
    expect(done.message).toBe('1,201 documents deleted');
    expect(await data.count(handle, PROJECT, DB, 'bulk')).toBe(0);
    expect((await data.documents(handle, PROJECT, DB, { collection: 'bulkish', pageSize: 10, showMissing: true })).items).toHaveLength(1);
  });

  it('imports with skip-existing and reports what it skipped (T-12)', async () => {
    await data.create(handle, PROJECT, DB, { collection: 'imp', id: 'exists', fields: fields('{"v": 1}') });
    const r = await data.importBatch(handle, PROJECT, DB, {
      collection: 'imp',
      mode: 'skip',
      documents: [
        { id: 'exists', fields: fields('{"v": 2}') },
        { id: 'new', fields: fields('{"v": 3}') },
      ],
    });
    expect(r).toEqual({ written: 1, skipped: 1, failures: [] });
    expect((await data.get(handle, PROJECT, DB, 'imp/exists')).fields.v).toEqual({ t: 'integer', v: '1' });
  });

  it('streams live changes with exact types (T-09)', async () => {
    const channel = firestoreListenChannel(clients, () => sdk.firestore());
    const updates: FirestoreListenUpdate[] = [];
    const sink: LiveSink = {
      data: (p) => updates.push(p as FirestoreListenUpdate),
      gap: () => {},
      error: (e) => updates.push({ error: e } as never),
      end: () => {},
    };
    const handleLive = await channel.open(
      {
        profile: handle,
        projectId: PROJECT,
        params: { database: DB, query: { source: { kind: 'collection', path: 'tickets' }, orderBy: [], limit: 50 } },
      },
      sink,
    );
    const initial = await waitFor(() => updates.find((u) => u.initial));
    expect(initial.changes).toHaveLength(5);
    expect(initial.reads).toBe(5);
    await data.save(handle, PROJECT, DB, 'tickets/a', { fields: fields('{"priority": 1.5}'), mask: ['priority'], updateTime: null });
    const change = await waitFor(() => updates.find((u) => !u.initial && u.changes.some((c) => c.type === 'modified')));
    expect(change.changes[0]?.document.fields.priority).toEqual({ t: 'double', v: 1.5 });
    expect(change.reads).toBe(1);
    await handleLive.close();
  });
});
