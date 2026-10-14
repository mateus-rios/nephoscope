import { describe, expect, it, vi } from 'vitest';
import { fakeHandle } from '../../testing/fake-handle.js';
import { FunctionUpgradeService } from '../functions/upgrade.js';
import { mapBudget, money, orgPolicyRow, quotaRows, sortPolicies, withUsage } from './platform.mapping.js';

describe('Billing (SPEC-0009 D-02)', () => {
  it('reads money exactly', () => {
    expect(money({ currencyCode: 'USD', units: '1234', nanos: 560000000 })).toEqual({ currency: 'USD', amount: '1234.56' });
    expect(money({ currencyCode: 'EUR', units: '-12', nanos: -500000000 })).toEqual({ currency: 'EUR', amount: '-12.50' });
    expect(money({ currencyCode: 'USD', units: '0', nanos: 999999999 })).toEqual({ currency: 'USD', amount: '1.00' });
    expect(money(null)).toBeNull();
  });

  it('knows whether a budget covers the project', () => {
    const b = {
      name: 'billingAccounts/A/budgets/1',
      displayName: 'Team',
      amount: { specifiedAmount: { currencyCode: 'USD', units: '500' } },
      thresholdRules: [{ thresholdPercent: 0.9 }],
    };
    expect(mapBudget(b, '123')).toMatchObject({
      coversProject: true,
      amount: { amount: '500.00' },
      thresholds: [{ percent: 90, basis: 'CURRENT_SPEND' }],
    });
    expect(mapBudget({ ...b, budgetFilter: { projects: ['projects/999'] } }, '123').coversProject).toBe(false);
    expect(mapBudget({ ...b, budgetFilter: { projects: ['projects/123'] } }, '123').coversProject).toBe(true);
  });
});

describe('Quotas (SPEC-0009 D-03, T-07)', () => {
  it('gives one row per region with its limit and usage', () => {
    const info = {
      quotaId: 'CPUS-per-project-region',
      metric: 'compute.googleapis.com/cpus',
      quotaDisplayName: 'CPUs',
      dimensionsInfos: [
        { dimensions: { region: 'us-central1' }, details: { value: '24' } },
        { dimensions: { region: 'europe-west1' }, details: { value: '8' } },
      ],
    };
    const rows = withUsage(quotaRows(info), [
      {
        metric: { labels: { quota_metric: 'compute.googleapis.com/cpus' } },
        resource: { labels: { location: 'us-central1' } },
        points: [{ value: { int64Value: '20' } }],
      },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ dimensions: 'region=us-central1', limit: '24', usage: 20, percent: 83.3, rate: null }),
      expect.objectContaining({ dimensions: 'region=europe-west1', limit: '8', usage: null, percent: null }),
    ]);
    const rate = quotaRows({
      quotaId: 'ReadRequestsPerMinutePerProject',
      metric: 'x',
      refreshInterval: 'MINUTE',
      dimensionsInfos: [{ details: { value: '600' } }],
    });
    expect(rate[0]).toMatchObject({ rate: 'per minute', dimensions: 'global', limit: '600' });
  });
});

describe('Organization policies (SPEC-0009 D-05, T-08)', () => {
  it('puts the constraints that explain errors first', () => {
    const c = (id: string, bool = true) => ({
      name: `projects/1/constraints/${id}`,
      displayName: id,
      ...(bool ? { booleanConstraint: {} } : { listConstraint: {} }),
    });
    const rows = sortPolicies([
      orgPolicyRow(c('compute.disableSerialPortAccess'), { rules: [{ enforce: true }] }, false),
      orgPolicyRow(c('aaa.unrelated'), null, false),
      orgPolicyRow(c('iam.allowedPolicyMemberDomains', false), { rules: [{ values: { allowedValues: ['C0abc'] } }] }, false),
      orgPolicyRow(c('gcp.resourceLocations', false), null, true),
    ]);
    expect(rows.map((r) => r.id)).toEqual([
      'iam.allowedPolicyMemberDomains',
      'gcp.resourceLocations',
      'compute.disableSerialPortAccess',
      'aaa.unrelated',
    ]);
    expect(rows[0]).toMatchObject({
      constraint: 'constraints/iam.allowedPolicyMemberDomains',
      effective: 'Allowed: C0abc',
      restricts: true,
      important: true,
      type: 'list',
    });
    expect(rows[1]).toMatchObject({ effective: 'Default', setOnProject: true });
  });
});

describe('Gen1 upgrade (SPEC-0003 D-18)', () => {
  const NAME = 'projects/demo/locations/us-central1/functions/hello';
  const restOps = { track: vi.fn((_h: unknown, input: { kind: string }) => ({ id: 'op', family: 'longrunning', kind: input.kind })) };

  it('runs a step only from a state that allows it', async () => {
    const { h, calls } = fakeHandle({
      [NAME]: { name: NAME, environment: 'GEN_1', upgradeInfo: { upgradeState: 'SETUP_FUNCTION_UPGRADE_CONFIG_SUCCESSFUL' } },
      ':redirectFunctionUpgradeTraffic': { name: 'projects/demo/locations/us-central1/operations/op1', done: false },
    });
    const svc = new FunctionUpgradeService(restOps as never);
    await expect(svc.step(h, 'demo', NAME, 'setup', {})).rejects.toMatchObject({ problem: { code: 'FAILED_PRECONDITION' } });
    await expect(svc.step(h, 'demo', NAME, 'abort', {})).rejects.toMatchObject({ problem: { code: 'CONFIRMATION_REQUIRED' } });
    await svc.step(h, 'demo', NAME, 'redirect', {});
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      url: `https://cloudfunctions.googleapis.com/v2/${NAME}:redirectFunctionUpgradeTraffic`,
    });
    expect(restOps.track).toHaveBeenCalledWith(h, expect.objectContaining({ kind: 'functions.upgrade.redirect' }));
  });

  it('detaches only 2nd gen functions', async () => {
    const { h } = fakeHandle({ [NAME]: { name: NAME, environment: 'GEN_1' } });
    await expect(new FunctionUpgradeService(restOps as never).detach(h, 'demo', NAME)).rejects.toMatchObject({
      problem: { code: 'FAILED_PRECONDITION' },
    });
  });
});
