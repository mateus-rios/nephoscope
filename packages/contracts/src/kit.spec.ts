import { describe, expect, it } from 'vitest';
import { fillKitTemplate, type KitItem, KitPathSchema, readPath, validateKitValues } from './kit.js';
import { findKitCollection, kitCollections, kitTopLevel } from './kit-catalog.js';
import { findProduct } from './products.js';

const item: KitItem = {
  _path: 'locations/us-central1/instances/cache',
  _location: 'us-central1',
  name: 'projects/demo/locations/us-central1/instances/cache',
  uid: 'u-1',
  fileShares: [{ name: 'vol1', capacityGb: '1024' }],
  networks: [{ ipAddresses: ['10.0.0.2'] }, { ipAddresses: ['10.0.0.3', '10.0.0.4'] }],
  deployedModels: [{ displayName: 'a' }, { displayName: 'b' }],
};

describe('kit paths', () => {
  it('reads dotted, indexed and mapped paths', () => {
    expect(readPath(item, 'fileShares[0].capacityGb')).toBe('1024');
    expect(readPath(item, 'networks[].ipAddresses[]')).toEqual(['10.0.0.2', '10.0.0.3', '10.0.0.4']);
    expect(readPath(item, 'deployedModels[].displayName')).toEqual(['a', 'b']);
    expect(readPath(item, '#deployedModels')).toBe(2);
    expect(readPath(item, '#missing')).toBe(0);
    expect(readPath(item, 'missing.deep')).toBeUndefined();
  });

  it('fills templates from the item and the values', () => {
    expect(fillKitTemplate('{project} {id} {location} {seg:1} {field:uid} {$size}', { project: 'demo', item, values: { size: 4 } })).toBe(
      'demo cache us-central1 us-central1 u-1 4',
    );
  });

  it('refuses paths that could leave the collection', () => {
    expect(KitPathSchema.safeParse('locations/us/instances/a').success).toBe(true);
    for (const bad of ['a//b', 'a/b?x=1', 'a/b#c', '/a', 'a/']) expect(KitPathSchema.safeParse(bad).success, bad).toBe(false);
  });
});

describe('kit values', () => {
  const fields = [
    { id: 'size', label: 'Size', kind: 'int' as const, min: 1, max: 10, required: true },
    { id: 'uri', label: 'URI', kind: 'text' as const, pattern: '^gs://.+$' },
    { id: 'mode', label: 'Mode', kind: 'enum' as const, options: [{ value: 'A', label: 'A' }] },
  ];

  it('types valid values', () => {
    expect(validateKitValues(fields, { size: '3', uri: 'gs://b/f', mode: 'A' })).toEqual({
      ok: true,
      values: { size: 3, uri: 'gs://b/f', mode: 'A' },
    });
  });

  it('reports each invalid value', () => {
    const r = validateKitValues(fields, { size: '11', uri: 'http://x', mode: 'B' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path)).toEqual(['size', 'uri', 'mode']);
    expect(validateKitValues(fields, {}).ok).toBe(false);
  });
});

describe('kit catalog', () => {
  it('has unique keys, known products, and compilable anchored patterns', () => {
    const keys = kitCollections.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of kitCollections) {
      expect(findProduct(c.product), c.key).toBeDefined();
      expect(c.key.startsWith(`${c.product}/`), c.key).toBe(true);
      expect(c.pathPattern.startsWith('^') && c.pathPattern.endsWith('$'), c.key).toBe(true);
      expect(() => new RegExp(c.pathPattern)).not.toThrow();
      for (const child of c.children ?? []) expect(findKitCollection(child), `${c.key} child ${child}`).toBeDefined();
    }
  });

  it('never matches a parent-directory segment', () => {
    for (const c of kitCollections) {
      const re = new RegExp(c.pathPattern);
      for (const bad of ['locations/../instances/a', 'instances/..', 'regions/../clusters/b', 'transferJobs/..'])
        expect(re.test(bad), `${c.key} ${bad}`).toBe(false);
    }
  });

  it('gives every kit product a top-level collection', () => {
    for (const product of new Set(kitCollections.map((c) => c.product))) expect(kitTopLevel(product).length, product).toBeGreaterThan(0);
  });

  it('asks for the typed name on every delete', () => {
    for (const c of kitCollections) for (const a of c.actions ?? []) if (a.id === 'delete') expect(a.confirm && a.danger, c.key).toBe(true);
  });
});
