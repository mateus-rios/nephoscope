import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config/config.js';
import { JsonStore } from './json-store.js';

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), 'nephoscope-store-'));
  const store = new JsonStore({ ...loadConfig({}), dataDir: dir });
  await store.init();
  return { store, dir };
}

describe('JsonStore (SPEC-0001 CA-53 to CA-55)', () => {
  it('writes atomically and reads back', async () => {
    const { store, dir } = await makeStore();
    await store.write('store/prefs.json', { density: 'compact' });
    expect(await store.read('store/prefs.json', {})).toEqual({ density: 'compact' });
    const files = await readdir(join(dir, 'store'));
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
  });

  it('serializes concurrent writes to the same file', async () => {
    const { store } = await makeStore();
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.write('store/n.json', { i })));
    expect(await store.read('store/n.json', { i: -1 })).toEqual({ i: 19 });
  });

  it('moves a corrupted file aside and returns the fallback', async () => {
    const { store, dir } = await makeStore();
    await writeFile(join(dir, 'store', 'prefs.json'), '{broken', 'utf8');
    expect(await store.read('store/prefs.json', { ok: true })).toEqual({ ok: true });
    expect(store.takeCorruptions()).toEqual(['store/prefs.json']);
    const files = await readdir(join(dir, 'store'));
    expect(files.some((f) => f.startsWith('prefs.json.corrupt-'))).toBe(true);
  });

  it('appends lines and rotates', async () => {
    const { store, dir } = await makeStore();
    for (let i = 0; i < 5; i++) await store.appendLine('audit.jsonl', `{"n":${i}}`, 30, 2);
    const current = await readFile(join(dir, 'audit.jsonl'), 'utf8');
    expect(current.trim().split('\n').length).toBeLessThan(5);
    const files = await readdir(dir);
    expect(files).toContain('audit.jsonl.1');
  });
});
