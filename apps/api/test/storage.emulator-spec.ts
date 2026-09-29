import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NephoscopeConfig } from '../src/core/config/config.js';
import type { ProfileHandle } from '../src/core/credentials/profiles.service.js';
import { GcpClientFactory } from '../src/core/gcp/client-factory.js';
import { OperationsService } from '../src/core/operations/operations.service.js';
import type { JsonStore } from '../src/core/store/json-store.js';
import { StorageService } from '../src/modules/storage/storage.service.js';

/** SPEC-0006 T-11, T-12 and T-13 in part, against fake-gcs-server (STORAGE_EMULATOR_HOST). */

const host = process.env.STORAGE_EMULATOR_HOST;
const PROJECT = 'nephoscope-gcs';
const BUCKET = `nephoscope-test-${Date.now()}`;
const handle = { profile: { id: 'env', type: 'emulator_only' }, auth: {} } as unknown as ProfileHandle;
const factory = new GcpClientFactory({ get: () => handle, onRemoved: () => {} } as never);
const store = { read: async <T>(_: string, f: T) => f, write: async () => {} } as unknown as JsonStore;
const operations = new OperationsService(store);
const gcs = new StorageService(factory, operations, { emulators: { storage: host ?? null } } as unknown as NephoscopeConfig);
const body = (s: string) => Readable.from([Buffer.from(s)]);

async function waitDone(id: string, ms = 20_000) {
  const start = Date.now();
  for (;;) {
    const op = operations.list().find((o) => o.id === id);
    if (op && op.status !== 'running') return op;
    if (Date.now() - start > ms) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!host)('Cloud Storage on the emulator', () => {
  beforeAll(async () => {
    await gcs.createBucket(handle, PROJECT, { name: BUCKET, location: 'US' });
  });

  afterAll(async () => {
    const s = await gcs.storage('env', PROJECT);
    await s
      .bucket(BUCKET)
      .deleteFiles({ force: true })
      .catch(() => {});
    await s
      .bucket(BUCKET)
      .delete()
      .catch(() => {});
  });

  it('lists the new bucket', async () => {
    const { items } = await gcs.buckets(handle, PROJECT);
    expect(items.map((b) => b.name)).toContain(BUCKET);
  });

  it('uploads by stream and refuses to overwrite without confirmation (T-11, CA-11)', async () => {
    const o = await gcs.upload(handle, PROJECT, BUCKET, 'docs/readme.txt', 'text/plain', false, body('hello'));
    expect(o).toMatchObject({ name: 'docs/readme.txt', size: '5', contentType: 'text/plain' });
    await expect(gcs.upload(handle, PROJECT, BUCKET, 'docs/readme.txt', 'text/plain', false, body('again'))).rejects.toMatchObject({
      problem: { code: 'ALREADY_EXISTS', reason: 'OBJECT_EXISTS' },
    });
    const replaced = await gcs.upload(handle, PROJECT, BUCKET, 'docs/readme.txt', 'text/plain', true, body('replaced'));
    expect(replaced.size).toBe('8');
  });

  it('browses one level with folders as prefixes (D-11)', async () => {
    await gcs.upload(handle, PROJECT, BUCKET, 'top.json', 'application/json', false, body('{}'));
    await gcs.upload(handle, PROJECT, BUCKET, 'docs/deep/x.txt', 'text/plain', false, body('x'));
    const root = await gcs.objects(handle, PROJECT, BUCKET, { prefix: '', flat: false, versions: false, softDeleted: false }, false);
    expect(root.prefixes).toEqual(['docs/']);
    expect(root.items.map((o) => o.name)).toEqual(['top.json']);
    const docs = await gcs.objects(handle, PROJECT, BUCKET, { prefix: 'docs/', flat: false, versions: false, softDeleted: false }, false);
    expect(docs.prefixes).toEqual(['docs/deep/']);
    expect(docs.items.map((o) => o.name)).toEqual(['docs/readme.txt']);
    const flat = await gcs.objects(handle, PROJECT, BUCKET, { prefix: 'docs/', flat: true, versions: false, softDeleted: false }, false);
    expect(flat.items.map((o) => o.name).sort()).toEqual(['docs/deep/x.txt', 'docs/readme.txt']);
  });

  it('creates an empty folder as a placeholder object', async () => {
    await gcs.createFolder(handle, PROJECT, BUCKET, 'empty/', false);
    const root = await gcs.objects(handle, PROJECT, BUCKET, { prefix: '', flat: false, versions: false, softDeleted: false }, false);
    expect(root.prefixes).toContain('empty/');
  });

  it('edits metadata and drops removed custom keys', async () => {
    await gcs.updateObject(handle, PROJECT, BUCKET, {
      name: 'top.json',
      metadata: { owner: 'ana', stage: 'draft' },
      cacheControl: 'no-cache',
    });
    const o = await gcs.updateObject(handle, PROJECT, BUCKET, { name: 'top.json', metadata: { owner: 'ana' } });
    // Cloud Storage drops a key patched to null; fake-gcs-server keeps it empty.
    expect(o.metadata.owner).toBe('ana');
    expect(o.metadata.stage ?? '').toBe('');
    expect(o.cacheControl).toBe('no-cache');
  });

  it('copies and moves objects', async () => {
    const copy = await gcs.copyObject(handle, PROJECT, BUCKET, {
      source: { name: 'top.json' },
      destinationBucket: BUCKET,
      destinationName: 'copy.json',
    });
    expect(copy.name).toBe('copy.json');
    await gcs.copyObject(handle, PROJECT, BUCKET, {
      source: { name: 'copy.json' },
      destinationBucket: BUCKET,
      destinationName: 'moved.json',
      move: true,
    });
    const names = (
      await gcs.objects(handle, PROJECT, BUCKET, { prefix: '', flat: true, versions: false, softDeleted: false }, false)
    ).items.map((o) => o.name);
    expect(names).toContain('moved.json');
    expect(names).not.toContain('copy.json');
  });

  it('reads byte ranges of an object', async () => {
    const s = await gcs.storage('env', PROJECT);
    const chunks: Buffer[] = [];
    for await (const c of s.bucket(BUCKET).file('docs/readme.txt').createReadStream({ start: 2, end: 4, validation: false }))
      chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('pla');
  });

  it('deletes objects and reports each failure', async () => {
    const r = await gcs.deleteObjects(handle, PROJECT, BUCKET, [{ name: 'moved.json' }, { name: 'missing.json' }]);
    expect(r.deleted).toBe(1);
    expect(r.failures.map((f) => f.name)).toEqual(['missing.json']);
  });

  it('refuses signed URLs and folder renames on the emulator (CA-13)', async () => {
    expect(gcs.capabilities(handle)).toMatchObject({ canSign: false, emulator: true });
    await expect(gcs.renameFolder(handle, PROJECT, BUCKET, 'docs/', 'papers/')).rejects.toMatchObject({
      problem: { reason: 'EMULATOR_UNSUPPORTED' },
    });
  });

  it('deletes a full bucket only with the typed count, as a tracked operation (D-10)', async () => {
    const other = `${BUCKET}-full`;
    await gcs.createBucket(handle, PROJECT, { name: other, location: 'US' });
    for (const n of ['a', 'b', 'c']) await gcs.upload(handle, PROJECT, other, n, 'text/plain', false, body(n));
    expect(await gcs.countObjects(handle, PROJECT, other)).toEqual({ count: 3, capped: false });
    await expect(gcs.deleteBucket(handle, PROJECT, other, '2')).rejects.toMatchObject({ problem: { code: 'CONFIRMATION_REQUIRED' } });
    const op = await gcs.deleteBucket(handle, PROJECT, other, '3');
    expect(op).not.toBeNull();
    const done = await waitDone(op?.id ?? '');
    expect(done.status).toBe('succeeded');
    const { items } = await gcs.buckets(handle, PROJECT);
    expect(items.map((b) => b.name)).not.toContain(other);
  });
});
