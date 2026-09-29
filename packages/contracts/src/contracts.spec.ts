import { describe, expect, it } from 'vitest';
import * as constants from './constants.js';
import * as contracts from './index.js';
import { ProblemSchema } from './problem.js';
import { findProduct, permissionCatalog, productGroups, products } from './products.js';

describe('constants', () => {
  it('are re-exported unchanged by the package root', () => {
    const root: Record<string, unknown> = { ...contracts };
    for (const [name, value] of Object.entries(constants)) {
      expect(root[name], name).toBe(value);
    }
  });
});

describe('product registry', () => {
  it('has unique ids and known groups', () => {
    const ids = products.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of products) expect(productGroups, p.id).toContain(p.group);
  });

  it('gives each hotkey to one product at most', () => {
    const keys = products.flatMap((p) => (p.hotkey ? [p.hotkey] : []));
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z]$/);
  });

  it('names Google services and IAM permissions in their canonical form', () => {
    for (const p of products) {
      if (p.service !== null) expect(p.service, p.id).toMatch(/^[a-z0-9-]+\.googleapis\.com$/);
      for (const perm of p.permissions) expect(perm, p.id).toMatch(/^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+){2,}$/);
    }
  });

  it('links every product to a spec file', () => {
    for (const p of products) expect(p.spec, p.id).toMatch(/^000[1-9]$/);
  });

  it('deduplicates the permission catalog', () => {
    const catalog = permissionCatalog();
    expect(new Set(catalog).size).toBe(catalog.length);
    expect(catalog.length).toBeGreaterThan(0);
  });

  it('finds products by id', () => {
    expect(findProduct('apis')?.available).toBe(true);
    expect(findProduct('nope')).toBeUndefined();
  });
});

describe('ProblemSchema', () => {
  it('accepts a problem with Google error details', () => {
    const parsed = ProblemSchema.safeParse({
      type: 'about:blank',
      title: 'API disabled',
      status: 403,
      detail: 'Cloud Run Admin API is disabled.',
      code: 'API_DISABLED',
      service: 'run.googleapis.com',
      consumer: 'projects/123',
      retryable: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown problem code', () => {
    expect(ProblemSchema.safeParse({ type: 'x', title: 'x', status: 500, detail: 'x', code: 'NOPE', retryable: false }).success).toBe(
      false,
    );
  });
});
