import { kitCollections } from '@nephoscope/contracts';
import { describe, expect, it, vi } from 'vitest';
import { detectOperation, readOperation } from '../../core/gcp/rest-ops.js';
import { fakeHandle } from '../../testing/fake-handle.js';
import { defaultPath, KitService } from './kit.service.js';
import { iapScope, kitSources } from './sources.js';

const fakeOps = {
  track: vi.fn((_h: unknown, input: { kind: string }) => ({ id: 'op', family: 'longrunning', kind: input.kind })),
} as never;

describe('kit sources', () => {
  it('has a source for every collection in the catalog, and nothing else', () => {
    expect(Object.keys(kitSources).sort()).toEqual(kitCollections.map((c) => c.key).sort());
  });

  it('builds every action the catalog declares', () => {
    for (const c of kitCollections)
      for (const a of c.actions ?? []) expect(kitSources[c.key]?.actions?.[a.id], `${c.key}:${a.id}`).toBeDefined();
  });
});

describe('kit paths and operations', () => {
  it('derives item paths from names and Compute self links', () => {
    expect(defaultPath({ name: 'projects/demo/locations/us/instances/a' })).toBe('locations/us/instances/a');
    expect(defaultPath({ selfLink: 'https://www.googleapis.com/compute/v1/projects/demo/zones/us-a/instances/vm' })).toBe(
      'zones/us-a/instances/vm',
    );
    expect(defaultPath({ name: 'transferJobs/123' })).toBe('transferJobs/123');
    expect(iapScope('regions/us-east1/backendServices/web')).toBe('compute-us-east1/services/web');
    expect(iapScope('global/backendServices/web')).toBe('compute/services/web');
  });

  it('recognizes each operation family', () => {
    expect(detectOperation({ name: 'projects/p/locations/l/operations/o', done: false }, 'https://x.googleapis.com/v1/')).toEqual({
      family: 'longrunning',
      url: 'https://x.googleapis.com/v1/projects/p/locations/l/operations/o',
    });
    expect(detectOperation({ kind: 'compute#operation', selfLink: 'https://compute.googleapis.com/o' }, '')?.family).toBe('compute');
    expect(detectOperation({ kind: 'sql#operation', selfLink: 'https://sqladmin.googleapis.com/o' }, '')?.family).toBe('cloudsql');
    expect(
      detectOperation({ operationType: 'SET_NODE_POOL_SIZE', status: 'RUNNING', selfLink: 'https://container.googleapis.com/v1/o' }, '')
        ?.family,
    ).toBe('gke');
    expect(detectOperation({ name: 'projects/p/instances/i', state: 'READY' }, '')).toBeNull();
  });

  it('reads finished operations as success, failure or cancellation', () => {
    expect(readOperation('longrunning', { done: false })).toEqual({ done: false });
    expect(readOperation('longrunning', { done: true, error: { code: 1, message: 'stop' } })).toMatchObject({ cancelled: true });
    expect(readOperation('compute', { status: 'RUNNING', progress: 40 })).toMatchObject({ done: false, progress: 40 });
    const failed = readOperation('compute', { status: 'DONE', httpErrorStatusCode: 403, error: { errors: [{ message: 'denied' }] } });
    expect(failed.error?.code).toBe('PERMISSION_DENIED');
    expect(readOperation('cloudsql', { status: 'DONE' })).toEqual({ done: true });
    expect(readOperation('gke', { status: 'DONE', error: { code: 9, message: 'bad' } }).error?.code).toBe('FAILED_PRECONDITION');
  });
});

describe('KitService', () => {
  it('lists a wildcard collection and marks each item with its path and location', async () => {
    const { h, calls } = fakeHandle({
      'projects/demo/locations/-/instances': {
        instances: [{ name: 'projects/demo/locations/us-central1-a/instances/nfs', state: 'READY' }],
      },
    });
    const r = await new KitService(fakeOps).list(h, 'demo', 'filestore/instances', {});
    expect(r.items).toEqual([
      expect.objectContaining({ _path: 'locations/us-central1-a/instances/nfs', _location: 'us-central1-a', state: 'READY' }),
    ]);
    expect(calls[0]?.url).toBe('https://file.googleapis.com/v1/projects/demo/locations/-/instances');
  });

  it('lists Compute aggregated collections by scope', async () => {
    const { h } = fakeHandle({
      'aggregated/sslCertificates': {
        items: {
          global: { sslCertificates: [{ selfLink: 'https://www.googleapis.com/compute/v1/projects/demo/global/sslCertificates/web' }] },
          'regions/us-east1': { warning: { code: 'NO_RESULTS_ON_PAGE' } },
        },
      },
    });
    const r = await new KitService(fakeOps).list(h, 'demo', 'certmanager/sslcerts', {});
    expect(r.items.map((i) => [i._path, i._location])).toEqual([['global/sslCertificates/web', 'global']]);
  });

  it('needs and checks the parent of child collections', async () => {
    const { h, calls } = fakeHandle({
      'instances/main/databases': { databases: [{ name: 'projects/demo/instances/main/databases/orders' }] },
    });
    const kit = new KitService(fakeOps);
    await expect(kit.list(h, 'demo', 'spanner/databases', {})).rejects.toMatchObject({ problem: { code: 'INVALID_ARGUMENT' } });
    await expect(kit.list(h, 'demo', 'spanner/databases', { parent: 'locations/x/instances/main' })).rejects.toMatchObject({
      problem: { code: 'INVALID_ARGUMENT' },
    });
    const r = await kit.list(h, 'demo', 'spanner/databases', { parent: 'instances/main' });
    expect(r.items[0]?._path).toBe('instances/main/databases/orders');
    expect(calls.at(-1)?.url).toBe('https://spanner.googleapis.com/v1/projects/demo/instances/main/databases');
  });

  it('refuses an item path outside the collection', async () => {
    const { h, calls } = fakeHandle({});
    const kit = new KitService(fakeOps);
    await expect(kit.get(h, 'demo', 'spanner/instances', 'instances/a/databases/b')).rejects.toMatchObject({
      problem: { code: 'INVALID_ARGUMENT' },
    });
    await expect(kit.get(h, 'demo', 'spanner/instances', 'instances/..')).rejects.toMatchObject({ problem: { code: 'INVALID_ARGUMENT' } });
    expect(calls).toHaveLength(0);
  });

  it('requires the typed name and valid values before an action reaches Google', async () => {
    const { h, calls } = fakeHandle({ 'instances/cache': { name: 'projects/demo/locations/us-central1/operations/op-1', done: false } });
    const kit = new KitService(fakeOps);
    const path = 'locations/us-central1/instances/cache';
    await expect(kit.action(h, 'demo', 'memorystore/redis', 'delete', { path, values: {} })).rejects.toMatchObject({
      problem: { code: 'CONFIRMATION_REQUIRED' },
    });
    await expect(kit.action(h, 'demo', 'memorystore/redis', 'scale', { path, values: { memorySizeGb: 0 } })).rejects.toMatchObject({
      problem: { code: 'INVALID_ARGUMENT' },
    });
    expect(calls).toHaveLength(0);
    await kit.action(h, 'demo', 'memorystore/redis', 'scale', { path, values: { memorySizeGb: 5 } });
    expect(calls[0]).toMatchObject({ method: 'PATCH', data: { memorySizeGb: 5 } });
    expect(calls[0]?.url).toBe(
      'https://redis.googleapis.com/v1/projects/demo/locations/us-central1/instances/cache?updateMask=memorySizeGb',
    );
  });
});
