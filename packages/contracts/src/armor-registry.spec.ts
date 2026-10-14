import { describe, expect, it } from 'vitest';
import { ARMOR_DEFAULT_PRIORITY, type ReorderStep, reorderPlan } from './armor.js';
import { registryConfirmToken } from './registry.js';

/** Applies a plan the way the API does, failing on a step onto an occupied priority. */
function apply(current: number[], steps: ReorderStep[]): Map<number, number> {
  const at = new Map(current.map((p) => [p, p]));
  for (const s of steps) {
    if (at.has(s.to)) throw new Error(`step onto occupied priority ${s.to}`);
    at.set(s.to, at.get(s.from) as number);
    at.delete(s.from);
  }
  return at;
}

describe('Cloud Armor reorder plan (SPEC-0007 D-09)', () => {
  it('moves rules straight to free priorities', () => {
    expect(reorderPlan([5, 100, ARMOR_DEFAULT_PRIORITY], [100, 5])).toEqual([
      { from: 100, to: 10, temporary: false },
      { from: 5, to: 20, temporary: false },
    ]);
  });

  it('plans nothing when the order is already applied', () => {
    expect(reorderPlan([10, 20, 30, ARMOR_DEFAULT_PRIORITY], [10, 20, 30])).toEqual([]);
  });

  it('breaks a cycle through one temporary priority and never collides', () => {
    const current = [10, 20, 30, ARMOR_DEFAULT_PRIORITY];
    const steps = reorderPlan(current, [30, 10, 20]);
    expect(steps.filter((s) => s.temporary)).toHaveLength(1);
    const after = apply(current, steps);
    // Original rule 30 now sits at 10, rule 10 at 20, rule 20 at 30; the default rule is untouched.
    expect([after.get(10), after.get(20), after.get(30), after.get(ARMOR_DEFAULT_PRIORITY)]).toEqual([30, 10, 20, ARMOR_DEFAULT_PRIORITY]);
    expect(after.size).toBe(current.length);
  });

  it('requires every non-default rule exactly once', () => {
    expect(() => reorderPlan([10, 20, ARMOR_DEFAULT_PRIORITY], [20])).toThrow();
    expect(() => reorderPlan([10, 20, ARMOR_DEFAULT_PRIORITY], [20, 20])).toThrow();
    expect(() => reorderPlan([10, 20, ARMOR_DEFAULT_PRIORITY], [20, 10, ARMOR_DEFAULT_PRIORITY])).toThrow();
    expect(() => reorderPlan([10, 20, ARMOR_DEFAULT_PRIORITY], [20, 99])).toThrow();
  });
});

describe('Artifact Registry confirmation token (SPEC-0007 D-11)', () => {
  it('uses the decoded last segment', () => {
    expect(registryConfirmToken('projects/p/locations/us/repositories/r/packages/team%2Fapi')).toBe('team/api');
    expect(registryConfirmToken('projects/p/locations/us/repositories/r/packages/team%2Fapi/tags/v1.2')).toBe('v1.2');
  });

  it('truncates digests to a typeable prefix', () => {
    const digest = `sha256:${'0123456789abcdef'.repeat(4)}`;
    expect(registryConfirmToken(`projects/p/locations/us/repositories/r/packages/api/versions/${encodeURIComponent(digest)}`)).toBe(
      'sha256:0123456789ab',
    );
  });

  it('keeps a malformed escape as it is', () => {
    expect(registryConfirmToken('projects/p/locations/us/repositories/r/packages/bad%E0%A4%A')).toBe('bad%E0%A4%A');
  });
});
