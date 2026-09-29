import type { IndexDefinition, IndexField, QueryFilter, QuerySpec } from '@nephoscope/contracts';
import { NAME_FIELD, querySource } from './structured-query.js';

/**
 * The composite index a failed query needs (SPEC-0004 D-09). Google's error links to the console
 * with `create_composite=<base64 Index message>`; the message is decoded here by hand, since the
 * link format is not a documented API (R-03). Without a link, the index is derived from the query.
 */

class Reader {
  private i = 0;
  constructor(private readonly b: Uint8Array) {}
  get done(): boolean {
    return this.i >= this.b.length;
  }
  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.i >= this.b.length) throw new Error('Truncated varint');
      const byte = this.b[this.i++] ?? 0;
      result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
      shift += 7;
      if (shift > 63) throw new Error('Varint too long');
    }
  }
  bytes(): Uint8Array {
    const len = this.varint();
    const out = this.b.subarray(this.i, this.i + len);
    if (out.length !== len) throw new Error('Truncated field');
    this.i += len;
    return out;
  }
  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 2) this.bytes();
    else if (wire === 1) this.i += 8;
    else if (wire === 5) this.i += 4;
    else throw new Error(`Unsupported wire type ${wire}`);
  }
}

const text = (b: Uint8Array) => Buffer.from(b).toString('utf8');

function decodeField(b: Uint8Array): IndexField {
  const r = new Reader(b);
  const field: IndexField = { fieldPath: '' };
  while (!r.done) {
    const tag = r.varint();
    const no = Math.floor(tag / 8);
    const wire = tag % 8;
    if (no === 1 && wire === 2) field.fieldPath = text(r.bytes());
    else if (no === 2 && wire === 0) {
      const order = r.varint();
      if (order === 1) field.order = 'ASCENDING';
      else if (order === 2) field.order = 'DESCENDING';
    } else if (no === 3 && wire === 0) {
      if (r.varint() === 1) field.arrayConfig = 'CONTAINS';
    } else if (no === 4 && wire === 2) {
      const v = new Reader(r.bytes());
      while (!v.done) {
        const t = v.varint();
        if (Math.floor(t / 8) === 1 && t % 8 === 0) field.vectorDimension = v.varint();
        else v.skip(t % 8);
      }
    } else r.skip(wire);
  }
  return field;
}

/** Decodes an Index message; returns null when it does not look like one. */
export function decodeIndexMessage(bytes: Uint8Array): IndexDefinition | null {
  try {
    const r = new Reader(bytes);
    let name = '';
    let scope = 1;
    const fields: IndexField[] = [];
    while (!r.done) {
      const tag = r.varint();
      const no = Math.floor(tag / 8);
      const wire = tag % 8;
      if (no === 1 && wire === 2) name = text(r.bytes());
      else if (no === 2 && wire === 0) scope = r.varint();
      else if (no === 3 && wire === 2) fields.push(decodeField(r.bytes()));
      else r.skip(wire);
    }
    const group = /\/collectionGroups\/([^/]+)\//.exec(name)?.[1];
    if (!group || fields.length === 0 || fields.some((f) => !f.fieldPath)) return null;
    return { collectionGroup: group, queryScope: scope === 2 ? 'COLLECTION_GROUP' : 'COLLECTION', fields };
  } catch {
    return null;
  }
}

/** Finds the create_composite link in an error message and decodes it. */
export function indexFromErrorMessage(message: string): IndexDefinition | null {
  const m = /create_composite=([A-Za-z0-9_\-+/=%]+)/.exec(message);
  if (!m?.[1]) return null;
  const b64 = decodeURIComponent(m[1]).replaceAll('-', '+').replaceAll('_', '/');
  return decodeIndexMessage(new Uint8Array(Buffer.from(b64, 'base64')));
}

function collect(f: QueryFilter | undefined, eq: IndexField[], ineq: IndexField[]): void {
  if (!f) return;
  if (f.kind === 'and' || f.kind === 'or') {
    for (const x of f.filters) collect(x, eq, ineq);
    return;
  }
  const has = (list: IndexField[]) => list.some((x) => x.fieldPath === f.field);
  if (f.kind === 'field' && (f.op === 'array-contains' || f.op === 'array-contains-any')) {
    if (!eq.some((x) => x.fieldPath === f.field && x.arrayConfig)) eq.push({ fieldPath: f.field, arrayConfig: 'CONTAINS' });
  } else if (f.kind === 'field' && (f.op === '==' || f.op === 'in')) {
    if (!has(eq)) eq.push({ fieldPath: f.field, order: 'ASCENDING' });
  } else if (!has(ineq)) ineq.push({ fieldPath: f.field, order: 'ASCENDING' });
}

/** Equality fields, then inequality fields, then order fields (D-09 fallback). */
export function deriveIndex(spec: QuerySpec): IndexDefinition {
  const eq: IndexField[] = [];
  const ineq: IndexField[] = [];
  collect(spec.where, eq, ineq);
  const fields = [...eq];
  const add = (f: IndexField) => {
    if (f.fieldPath === NAME_FIELD) return;
    const i = fields.findIndex((x) => x.fieldPath === f.fieldPath && !x.arrayConfig);
    if (i >= 0) fields.splice(i, 1);
    fields.push(f);
  };
  for (const f of ineq) add(f);
  for (const o of spec.orderBy) add({ fieldPath: o.field, order: o.direction === 'asc' ? 'ASCENDING' : 'DESCENDING' });
  if (spec.findNearest) fields.push({ fieldPath: spec.findNearest.field, vectorDimension: spec.findNearest.vector.length });
  const source = querySource('', spec);
  return { collectionGroup: source.collectionId, queryScope: source.allDescendants ? 'COLLECTION_GROUP' : 'COLLECTION', fields };
}
