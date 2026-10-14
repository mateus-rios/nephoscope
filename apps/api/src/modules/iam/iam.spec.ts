import { owners, policyDiff } from '@nephoscope/contracts';
import { describe, expect, it, vi } from 'vitest';
import { fakeHandle } from '../../testing/fake-handle.js';
import { IamService, policyRisks } from './iam.service.js';
import { mapPolicy, mapTroubleshoot, memberOf, policyBody } from './iam-mapping.js';

const ops = { recordInstant: () => ({}) } as never;
const SELF = 'serviceAccount:tester@demo.iam.gserviceaccount.com';

const current = {
  version: 3,
  etag: 'BwX1',
  bindings: [
    { role: 'roles/owner', members: ['user:ana@example.com'] },
    { role: 'roles/editor', members: [SELF, 'group:ops@example.com'] },
  ],
};

describe('IAM policy (SPEC-0007 D-01)', () => {
  it('diffs bindings by role and condition', () => {
    const before = mapPolicy(current).bindings;
    const after = [
      { role: 'roles/owner', members: ['user:ana@example.com'], condition: null },
      { role: 'roles/editor', members: ['group:ops@example.com'], condition: null },
      {
        role: 'roles/run.viewer',
        members: [SELF],
        condition: { title: 'Expires', description: null, expression: 'request.time < timestamp("2027-01-01T00:00:00Z")' },
      },
    ];
    expect(policyDiff(before, after)).toEqual([
      { kind: 'remove', role: 'roles/editor', member: SELF, condition: null },
      { kind: 'add', role: 'roles/run.viewer', member: SELF, condition: 'Expires' },
    ]);
  });

  it('sends version 3 so conditional bindings are kept (T-01)', () => {
    const body = policyBody({
      etag: 'e',
      bindings: [{ role: 'roles/run.viewer', members: [SELF], condition: { title: 't', description: null, expression: 'x' } }],
    });
    expect(body).toEqual({
      version: 3,
      etag: 'e',
      bindings: [{ role: 'roles/run.viewer', members: [SELF], condition: { title: 't', description: undefined, expression: 'x' } }],
    });
  });

  it('flags removing the active principal and the last owner (T-03)', () => {
    const before = mapPolicy(current);
    const noSelf = {
      etag: 'BwX1',
      bindings: [{ role: 'roles/owner', members: ['user:ana@example.com'], condition: null }],
      confirmSelf: false,
      confirmLastOwner: false,
    };
    expect(policyRisks(before, noSelf, SELF)).toEqual({ removesSelf: true, removesLastOwner: false });
    const noOwner = { ...noSelf, bindings: [{ role: 'roles/editor', members: [SELF], condition: null }] };
    expect(policyRisks(before, noOwner, SELF)).toEqual({ removesSelf: false, removesLastOwner: true });
    expect(owners(before.bindings)).toEqual(['user:ana@example.com']);
  });

  it('refuses a stale etag and an unconfirmed self-removal before writing (T-02)', async () => {
    const { h, calls } = fakeHandle({ ':getIamPolicy': current, ':setIamPolicy': current });
    const iam = new IamService(ops, {} as never);
    await expect(
      iam.setProjectPolicy(h, 'demo', { etag: 'old', bindings: [], confirmSelf: false, confirmLastOwner: false }),
    ).rejects.toMatchObject({
      problem: { code: 'CONFLICT' },
    });
    await expect(
      iam.setProjectPolicy(h, 'demo', {
        etag: 'BwX1',
        bindings: [{ role: 'roles/owner', members: ['user:ana@example.com'], condition: null }],
        confirmSelf: false,
        confirmLastOwner: false,
      }),
    ).rejects.toMatchObject({ problem: { code: 'FAILED_PRECONDITION', reason: 'REMOVES_SELF' } });
    expect(calls.every((c) => !c.url.includes(':setIamPolicy'))).toBe(true);
    await iam.setProjectPolicy(h, 'demo', {
      etag: 'BwX1',
      bindings: [{ role: 'roles/owner', members: ['user:ana@example.com'], condition: null }],
      confirmSelf: true,
      confirmLastOwner: false,
    });
    expect(calls.at(-1)?.url).toContain('projects/demo:setIamPolicy');
  });

  it('names the active profile as a member', () => {
    expect(memberOf('x@demo.iam.gserviceaccount.com')).toBe('serviceAccount:x@demo.iam.gserviceaccount.com');
    expect(memberOf('ana@example.com')).toBe('user:ana@example.com');
    expect(memberOf(null)).toBeNull();
  });
});

describe('new keys (SPEC-0007 D-02, CA-02)', () => {
  it('keeps the private key on the server: one download, one profile', async () => {
    const keyJson = JSON.stringify({
      type: 'service_account',
      client_email: 'bot@demo.iam.gserviceaccount.com',
      private_key_id: 'abc123',
      private_key: 'PRIVATE',
    });
    const { h } = fakeHandle({
      'serviceAccounts/bot@demo.iam.gserviceaccount.com/keys': {
        name: 'projects/demo/serviceAccounts/bot@demo.iam.gserviceaccount.com/keys/abc123',
        keyType: 'USER_MANAGED',
        privateKeyData: Buffer.from(keyJson).toString('base64'),
      },
    });
    const add = vi.fn(async () => ({ profile: { id: 'p2', name: 'bot' }, check: {} }));
    const iam = new IamService(ops, { add } as never);
    const created = await iam.createKey(h, 'demo', 'bot@demo.iam.gserviceaccount.com');
    expect(JSON.stringify(created)).not.toContain('PRIVATE');
    expect(created.handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await iam.addKeyAsProfile(created.handle, { readOnly: true });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ key: keyJson, readOnly: true, defaultProject: 'demo' }));
    await expect(iam.addKeyAsProfile(created.handle, {})).rejects.toMatchObject({ problem: { code: 'FAILED_PRECONDITION' } });
    expect(iam.downloadKey(created.handle).json).toBe(keyJson);
    expect(() => iam.downloadKey(created.handle)).toThrow();
  });
});

describe('troubleshooter (SPEC-0007 D-04)', () => {
  it('reads the explained bindings', () => {
    const v = mapTroubleshoot({
      overallAccessState: 'CANNOT_ACCESS',
      allowPolicyExplanation: {
        explainedPolicies: [
          {
            fullResourceName: '//cloudresourcemanager.googleapis.com/projects/demo',
            allowAccessState: 'ALLOW_ACCESS_STATE_NOT_GRANTED',
            bindingExplanations: [
              {
                role: 'roles/run.viewer',
                rolePermission: 'ROLE_PERMISSION_NOT_INCLUDED',
                memberships: { a: { membership: 'MEMBERSHIP_MATCHED_PRINCIPAL' } },
                relevance: 'HEURISTIC_RELEVANCE_HIGH',
              },
            ],
          },
        ],
      },
    });
    expect(v.access).toBe('CANNOT_ACCESS');
    expect(v.explanations[0]?.bindings[0]).toMatchObject({
      role: 'roles/run.viewer',
      granted: 'ROLE_PERMISSION_NOT_INCLUDED',
      membership: 'MEMBERSHIP_MATCHED_PRINCIPAL',
    });
  });
});
