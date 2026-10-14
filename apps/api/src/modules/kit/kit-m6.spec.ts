import { describe, expect, it, vi } from 'vitest';
import { fakeHandle } from '../../testing/fake-handle.js';
import { KitService } from './kit.service.js';
import { firewallRulesText, parseAllocations, parseFirewallRules, parseLabels } from './sources-m6.js';

const fakeOps = {
  track: vi.fn((_h: unknown, input: { kind: string }) => ({ id: 'op', family: 'compute', kind: input.kind })),
} as never;

const VM = 'zones/us-central1-a/instances/web-1';
const VM_URL = `https://compute.googleapis.com/compute/v1/projects/demo/${VM}`;

describe('M6 kit helpers', () => {
  it('parses firewall protocols and ports, merging per protocol', () => {
    expect(parseFirewallRules('tcp:80,tcp:8000-8080, udp:53,icmp')).toEqual([
      { IPProtocol: 'tcp', ports: ['80', '8000-8080'] },
      { IPProtocol: 'udp', ports: ['53'] },
      { IPProtocol: 'icmp' },
    ]);
    expect(parseFirewallRules('tcp:22,tcp')).toEqual([{ IPProtocol: 'tcp' }]);
    expect(parseFirewallRules('all')).toEqual([{ IPProtocol: 'all' }]);
    expect(firewallRulesText(parseFirewallRules('tcp:80,tcp:443,udp'))).toBe('tcp:80,tcp:443,udp');
  });

  it('parses labels and App Engine allocations', () => {
    expect(parseLabels('env=prod, team = web')).toEqual({ env: 'prod', team: 'web' });
    expect(parseAllocations('v1=0.9, v2=0.1')).toEqual({ v1: 0.9, v2: 0.1 });
    let problem: unknown;
    try {
      parseAllocations('v1=0.5, v2=0.4');
    } catch (err) {
      problem = (err as { problem?: unknown }).problem;
    }
    expect(problem).toMatchObject({ code: 'INVALID_ARGUMENT', detail: expect.stringContaining('add up to 0.9') });
  });
});

describe('M6 kit sources', () => {
  it('decorates Compute instances with what the columns and actions need', async () => {
    const { h } = fakeHandle({
      'aggregated/instances': {
        items: {
          'zones/us-central1-a': {
            instances: [
              {
                name: 'web-1',
                selfLink: VM_URL,
                machineType: `${VM_URL.replace(/instances\/web-1$/, '')}machineTypes/e2-small`,
                networkInterfaces: [{ networkIP: '10.0.0.2', accessConfigs: [{ natIP: '34.1.2.3' }] }],
                tags: { items: ['web', 'ssh'] },
                labels: { env: 'prod' },
              },
            ],
          },
        },
      },
    });
    const r = await new KitService(fakeOps).list(h, 'demo', 'compute/instances', {});
    expect(r.items[0]).toMatchObject({
      _path: VM,
      _location: 'us-central1-a',
      _machineType: 'e2-small',
      _internalIp: '10.0.0.2',
      _externalIp: '34.1.2.3',
      _tags: 'web, ssh',
      _labels: 'env=prod',
    });
  });

  it('sends the current fingerprint with new labels (read from the item)', async () => {
    const { h, calls } = fakeHandle({
      [`/${VM}`]: { name: 'web-1', labelFingerprint: 'fp-1' },
      setLabels: { kind: 'compute#operation', selfLink: `${VM_URL.replace(/instances\/web-1$/, '')}operations/op-1`, status: 'RUNNING' },
    });
    await new KitService(fakeOps).action(h, 'demo', 'compute/instances', 'labels', { path: VM, values: { labels: 'env=prod, tier=web' } });
    const post = calls.find((c) => c.url.endsWith('/setLabels'));
    expect(post).toMatchObject({ method: 'POST', data: { labels: { env: 'prod', tier: 'web' }, labelFingerprint: 'fp-1' } });
  });

  it('replaces a firewall rule whole, so switching to deny clears the allow list', async () => {
    const rule = {
      name: 'allow-web',
      selfLink: 'https://compute.googleapis.com/compute/v1/projects/demo/global/firewalls/allow-web',
      direction: 'INGRESS',
      priority: 1000,
      allowed: [{ IPProtocol: 'tcp', ports: ['80'] }],
      sourceRanges: ['0.0.0.0/0'],
      targetTags: ['web'],
    };
    const { h, calls } = fakeHandle({
      'global/firewalls/allow-web': (c: { method: string }) =>
        c.method === 'GET' ? rule : { kind: 'compute#operation', selfLink: 'x/operations/1' },
    });
    await new KitService(fakeOps).action(h, 'demo', 'vpc/firewalls', 'edit', {
      path: 'global/firewalls/allow-web',
      values: { action: 'deny', priority: 900, ranges: '10.0.0.0/8', rules: 'tcp:22' },
    });
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.data).toMatchObject({
      name: 'allow-web',
      priority: 900,
      denied: [{ IPProtocol: 'tcp', ports: ['22'] }],
      sourceRanges: ['10.0.0.0/8'],
    });
    expect(put?.data).not.toHaveProperty('allowed');
    expect(put?.data).not.toHaveProperty('targetTags');
  });

  it('merges a Cloud SQL flag into the current list', async () => {
    const { h, calls } = fakeHandle({
      'instances/main': (c: { method: string }) =>
        c.method === 'GET'
          ? {
              name: 'main',
              settings: {
                databaseFlags: [
                  { name: 'max_connections', value: '100' },
                  { name: 'log_min_duration_statement', value: '500' },
                ],
              },
            }
          : { kind: 'sql#operation', selfLink: 'https://sqladmin.googleapis.com/v1/projects/demo/operations/o1', status: 'PENDING' },
    });
    await new KitService(fakeOps).action(h, 'demo', 'cloudsql/instances', 'setFlag', {
      path: 'instances/main',
      values: { name: 'max_connections', value: '200' },
    });
    expect(calls.find((c) => c.method === 'PATCH')?.data).toEqual({
      settings: {
        databaseFlags: [
          { name: 'log_min_duration_statement', value: '500' },
          { name: 'max_connections', value: '200' },
        ],
      },
    });
  });

  it('addresses a Cloud SQL user by name and host', async () => {
    const { h, calls } = fakeHandle({
      'instances/main/users': (c: { method: string }) =>
        c.method === 'GET'
          ? {
              items: [
                { name: 'app', host: '%' },
                { name: 'admin', host: '' },
              ],
            }
          : {},
    });
    const kit = new KitService(fakeOps);
    await kit.action(h, 'demo', 'cloudsql/users', 'password', { path: 'instances/main/users/app', values: { password: 's3cret pass' } });
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('https://sqladmin.googleapis.com/v1/projects/demo/instances/main/users?name=app&host=%25');
    expect(put?.data).toEqual({ name: 'app', host: '%', password: 's3cret pass' });
    await kit.action(h, 'demo', 'cloudsql/users', 'delete', { path: 'instances/main/users/admin', confirm: 'admin', values: {} });
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe(
      'https://sqladmin.googleapis.com/v1/projects/demo/instances/main/users?name=admin',
    );
  });

  it('creates a child under the checked parent only', async () => {
    const { h, calls } = fakeHandle({
      'instances/main/databases': { kind: 'sql#operation', selfLink: 'https://sqladmin.googleapis.com/v1/projects/demo/operations/o2' },
    });
    const kit = new KitService(fakeOps);
    await expect(kit.action(h, 'demo', 'cloudsql/databases', 'create', { values: { id: 'orders' } })).rejects.toMatchObject({
      problem: { code: 'INVALID_ARGUMENT' },
    });
    await expect(
      kit.action(h, 'demo', 'cloudsql/databases', 'create', { parent: 'instances/../x', values: { id: 'orders' } }),
    ).rejects.toMatchObject({
      problem: { code: 'INVALID_ARGUMENT' },
    });
    expect(calls).toHaveLength(0);
    await kit.action(h, 'demo', 'cloudsql/databases', 'create', { parent: 'instances/main', values: { id: 'orders' } });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://sqladmin.googleapis.com/v1/projects/demo/instances/main/databases',
      data: { name: 'orders' },
    });
  });

  it("keeps only a cluster's own operations and a primary's own replicas", async () => {
    const { h } = fakeHandle({
      'locations/us-central1/operations': {
        operations: [
          { name: 'op-1', targetLink: 'https://container.googleapis.com/v1/projects/demo/locations/us-central1/clusters/prod/nodePools/a' },
          { name: 'op-2', targetLink: 'https://container.googleapis.com/v1/projects/demo/locations/us-central1/clusters/prod-2' },
        ],
      },
      'projects/demo/instances': {
        items: [{ name: 'r1', masterInstanceName: 'demo:main' }, { name: 'main' }, { name: 'r2', masterInstanceName: 'demo:other' }],
      },
    });
    const kit = new KitService(fakeOps);
    const ops = await kit.list(h, 'demo', 'gke/operations', { parent: 'locations/us-central1/clusters/prod' });
    expect(ops.items.map((o) => o._path)).toEqual(['locations/us-central1/operations/op-1']);
    const replicas = await kit.list(h, 'demo', 'cloudsql/replicas', { parent: 'instances/main' });
    expect(replicas.items.map((r) => r._path)).toEqual(['instances/r1']);
  });

  it('lists the managed instances of a group with a POST', async () => {
    const { h, calls } = fakeHandle({
      listManagedInstances: { managedInstances: [{ instance: VM_URL, instanceStatus: 'RUNNING' }] },
    });
    const r = await new KitService(fakeOps).list(h, 'demo', 'compute/miginstances', {
      parent: 'zones/us-central1-a/instanceGroupManagers/web',
    });
    expect(calls[0]?.method).toBe('POST');
    expect(r.items[0]?._path).toBe(VM);
  });
});
