import { afterAll, describe, expect, it } from 'vitest';
import type { NephoscopeConfig } from '../src/core/config/config.js';
import type { ProfileHandle } from '../src/core/credentials/profiles.service.js';
import { GcpClientFactory } from '../src/core/gcp/client-factory.js';
import { OperationsService } from '../src/core/operations/operations.service.js';
import type { JsonStore } from '../src/core/store/json-store.js';
import { DatastoreService } from '../src/modules/datastore/datastore.module.js';
import { keyToString, parseKey } from '../src/modules/datastore/datastore-codec.js';

/** SPEC-0004 T-21, against the Firestore emulator in Datastore mode (DATASTORE_EMULATOR_HOST). */

const host = process.env.DATASTORE_EMULATOR_HOST;
const PROJECT = `nephoscope-ds-${Date.now()}`;
const DB = '(default)';
const handle = { profile: { id: 'env' }, auth: {} } as unknown as ProfileHandle;
const factory = new GcpClientFactory({ get: () => handle, onRemoved: () => {} } as never);
const store = { read: async <T>(_: string, f: T) => f, write: async () => {} } as unknown as JsonStore;
const ds = new DatastoreService(factory, new OperationsService(store), {
  emulators: { datastore: host ?? null },
} as unknown as NephoscopeConfig);

describe('Datastore keys', () => {
  it('print and parse GQL key literals', () => {
    const key = {
      namespace: 'ns',
      path: [
        { kind: 'Task List', id: null, name: "it's" },
        { kind: 'Task', id: '42', name: null },
      ],
    };
    expect(keyToString(key)).toBe("KEY(`Task List`, 'it\\'s', Task, 42)");
    expect(parseKey(keyToString(key), 'ns')).toEqual(key);
  });
});

describe.skipIf(!host)('Datastore mode against the emulator (T-21)', () => {
  afterAll(() => factory.onModuleDestroy());

  it('lists kinds, runs GQL and saves a property excluded from indexes', async () => {
    for (let i = 1; i <= 3; i++)
      await ds.save(handle, PROJECT, DB, {
        key: { namespace: '', path: [{ kind: 'Task', id: null, name: `t${i}` }] },
        properties: {
          done: { value: { t: 'boolean', v: i === 2 }, excludeFromIndexes: false },
          weight: { value: { t: 'double', v: i + 0.5 }, excludeFromIndexes: false },
          owner: { value: { t: 'reference', v: "KEY(User, 'ana')" }, excludeFromIndexes: false },
        },
      });
    expect(await ds.kinds(handle, PROJECT, DB, '')).toEqual(['Task']);
    const page = await ds.gql(handle, PROJECT, DB, { namespace: '', gql: 'SELECT * FROM Task WHERE done = false' });
    expect(page.items.map((e) => e.key.path[0]?.name).sort()).toEqual(['t1', 't3']);
    expect(page.items[0]?.properties.weight?.value.t).toBe('double');
    expect(page.items[0]?.properties.owner?.value).toEqual({ t: 'reference', v: "KEY(User, 'ana')" });

    const saved = await ds.save(handle, PROJECT, DB, {
      key: { namespace: '', path: [{ kind: 'Task', id: null, name: 't1' }] },
      properties: { notes: { value: { t: 'string', v: 'long text' }, excludeFromIndexes: true } },
    });
    expect(saved.properties.notes).toEqual({ value: { t: 'string', v: 'long text' }, excludeFromIndexes: true });

    const small = await ds.gql(handle, PROJECT, DB, { namespace: '', gql: 'SELECT * FROM Task LIMIT 1' });
    expect(small.items).toHaveLength(1);
    await ds.remove(handle, PROJECT, DB, { namespace: '', path: [{ kind: 'Task', id: null, name: 't3' }] });
    const rest = await ds.entities(handle, PROJECT, DB, '', 'Task');
    expect(rest.items.map((e) => e.key.path[0]?.name)).toEqual(['t1', 't2']);
  });
});
