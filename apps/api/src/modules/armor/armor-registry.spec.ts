import { describe, expect, it } from 'vitest';
import { fakeHandle } from '../../testing/fake-handle.js';
import { ResourceIamService } from '../iam/resource-iam.js';
import { mapDockerImage, mapRepository } from '../registry/registry.module.js';
import { ArmorService, mapPolicy, mapRule, ruleBody } from './armor.module.js';

describe('Cloud Armor mapping (SPEC-0007 D-09)', () => {
  it('reads IP and expression rules and sorts them by priority', () => {
    const p = mapPolicy(
      {
        name: 'edge',
        selfLink: 'https://compute.googleapis.com/compute/v1/projects/demo/global/securityPolicies/edge',
        rules: [
          { priority: 2147483647, action: 'allow', match: { versionedExpr: 'SRC_IPS_V1', config: { srcIpRanges: ['*'] } } },
          { priority: 100, action: 'deny(403)', match: { expr: { expression: "origin.region_code == 'XX'" } } },
          { priority: 10, action: 'allow', preview: true, match: { versionedExpr: 'SRC_IPS_V1', config: { srcIpRanges: ['10.0.0.0/8'] } } },
        ],
      },
      ['backend-web'],
    );
    expect(p.rules.map((r) => r.priority)).toEqual([10, 100, 2147483647]);
    expect(p.rules[0]).toMatchObject({ preview: true, match: { kind: 'ip', srcIpRanges: ['10.0.0.0/8'] } });
    expect(p.rules[1]?.match).toEqual({ kind: 'expr', srcIpRanges: [], expression: "origin.region_code == 'XX'" });
    expect(p).toMatchObject({ ruleCount: 3, targets: ['backend-web'] });
  });

  it('finishes a started reorder step when cancelled, then stops', async () => {
    const abort = new AbortController();
    let polls = 0;
    let result: Promise<string | undefined> | undefined;
    const ops = {
      trackLocal: (_i: unknown, run: (report: () => void, signal: AbortSignal) => Promise<string | undefined>) => {
        result = run(() => {}, abort.signal);
        return {};
      },
    };
    const { h, calls } = fakeHandle({
      '/securityPolicies/edge': { rules: [{ priority: 10 }, { priority: 20 }, { priority: 2147483647 }] },
      '/getRule': { kind: 'compute#securityPolicyRule', priority: 20, action: 'allow' },
      '/addRule': () => {
        abort.abort();
        return { selfLink: 'https://compute.googleapis.com/compute/v1/projects/demo/global/operations/op1' };
      },
      '/removeRule': { selfLink: 'https://compute.googleapis.com/compute/v1/projects/demo/global/operations/op2' },
      // Still running when the cancel arrives.
      '/operations/op1': () => ({ status: polls++ === 0 ? 'RUNNING' : 'DONE' }),
      '/operations/op2': { status: 'DONE' },
    });
    const armor = new ArmorService({} as never, ops as never);
    armor.pollMs = 0;
    // [20, 10] swaps two rules: through a temporary priority, three steps.
    await armor.reorder(h, 'demo', 'global/securityPolicies/edge', { order: [20, 10], confirm: '3' });
    expect(await result).toBe('Stopped after 1 of 3 steps.');
    const mutations = calls.filter((c) => /(add|remove)Rule/.test(c.url)).map((c) => c.url.replace(/^.*\//, ''));
    expect(mutations).toEqual(['addRule', 'removeRule?priority=20']);
    expect(calls.find((c) => c.url.endsWith('addRule'))?.data).toEqual({ action: 'allow', priority: 1_000_000_000 });
  });

  it('writes the body it reads back', () => {
    const raw = {
      priority: 20,
      action: 'deny(404)',
      description: 'block',
      preview: false,
      match: { versionedExpr: 'SRC_IPS_V1', config: { srcIpRanges: ['1.2.3.4/32'] } },
    };
    const rule = mapRule(raw);
    expect(rule.match.kind).toBe('ip');
    expect(
      ruleBody({
        priority: rule.priority,
        action: 'deny(404)',
        description: rule.description ?? '',
        preview: rule.preview,
        match: { kind: 'ip', srcIpRanges: rule.match.srcIpRanges },
      }),
    ).toEqual(raw);
  });
});

describe('Artifact Registry mapping (SPEC-0007 D-11)', () => {
  it('gives Docker repositories a registry URI', () => {
    expect(
      mapRepository({ name: 'projects/demo/locations/us-central1/repositories/apps', format: 'DOCKER', sizeBytes: '2048' }, 'demo'),
    ).toMatchObject({
      id: 'apps',
      location: 'us-central1',
      registryUri: 'us-central1-docker.pkg.dev/demo/apps',
      sizeBytes: '2048',
    });
    expect(mapRepository({ name: 'projects/demo/locations/us/repositories/npm', format: 'NPM' }, 'demo').registryUri).toBeNull();
  });

  it('splits an image URI into path and digest', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    expect(
      mapDockerImage({ uri: `us-central1-docker.pkg.dev/demo/apps/team/api@${digest}`, tags: ['v1'], imageSizeBytes: 10 }),
    ).toMatchObject({
      image: 'team/api',
      digest,
      tags: ['v1'],
      sizeBytes: '10',
    });
  });
});

describe('Resource permissions (SPEC-0001 CA-64)', () => {
  const ops = { recordInstant: () => ({}) } as never;

  it('reaches only allow-listed resources of the project', async () => {
    const { h, calls } = fakeHandle({ ':getIamPolicy': { etag: 'e', bindings: [] } });
    const iam = new ResourceIamService(ops);
    await iam.get(h, 'demo', { kind: 'secret', name: 'projects/demo/locations/us-east1/secrets/db' });
    expect(calls[0]?.url).toContain(
      'https://secretmanager.us-east1.rep.googleapis.com/v1/projects/demo/locations/us-east1/secrets/db:getIamPolicy',
    );
    const bad = [
      { kind: 'secret', name: 'projects/other/secrets/db' },
      { kind: 'secret', name: 'projects/demo/locations/../secrets/db' },
      { kind: 'kms-key', name: 'projects/demo/locations/global/keyRings/r' },
      { kind: 'ar-repo', name: 'projects/demo/locations/us/repositories/r/packages/x' },
    ] as const;
    for (const q of bad) await expect(iam.get(h, 'demo', q)).rejects.toMatchObject({ problem: { code: 'INVALID_ARGUMENT' } });
    expect(calls).toHaveLength(1);
  });
});
