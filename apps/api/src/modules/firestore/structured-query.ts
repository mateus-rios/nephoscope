import { type FirestoreDocument, parseFieldPath, type QueryFilter, type QuerySpec, type WireValue } from '@nephoscope/contracts';
import { ProblemException } from '../../core/problem/problem.js';
import { toProto } from './codec.js';

/** QuerySpec to a Firestore StructuredQuery (SPEC-0004 D-06). */

// biome-ignore lint/suspicious/noExplicitAny: protobuf messages are loosely typed at this boundary.
type Proto = any;

const FIELD_OPS: Record<string, string> = {
  '<': 'LESS_THAN',
  '<=': 'LESS_THAN_OR_EQUAL',
  '>': 'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL',
  '==': 'EQUAL',
  '!=': 'NOT_EQUAL',
  'array-contains': 'ARRAY_CONTAINS',
  in: 'IN',
  'array-contains-any': 'ARRAY_CONTAINS_ANY',
  'not-in': 'NOT_IN',
};

const UNARY_OPS: Record<string, string> = {
  'is-null': 'IS_NULL',
  'is-nan': 'IS_NAN',
  'is-not-null': 'IS_NOT_NULL',
  'is-not-nan': 'IS_NOT_NAN',
};

const INEQUALITY = new Set(['<', '<=', '>', '>=', '!=', 'not-in', 'is-not-null', 'is-not-nan']);

export const NAME_FIELD = '__name__';

/** Canonical field path (validated), such as a.`b c`. */
export function normalizeFieldPath(path: string): string {
  if (path === NAME_FIELD) return path;
  const segments = parseFieldPath(path);
  if (!segments) throw ProblemException.of('INVALID_ARGUMENT', `"${path}" is not a valid field path.`);
  return path;
}

/** Where the query runs: its parent resource name and collection id. */
export function querySource(root: string, spec: QuerySpec): { parent: string; collectionId: string; allDescendants: boolean } {
  if (spec.source.kind === 'group') {
    return {
      parent: spec.source.parent ? `${root}/${spec.source.parent}` : root,
      collectionId: spec.source.collectionId,
      allDescendants: true,
    };
  }
  const segments = spec.source.path.split('/');
  const collectionId = segments.pop() ?? '';
  return { parent: segments.length > 0 ? `${root}/${segments.join('/')}` : root, collectionId, allDescendants: false };
}

/** A document id typed as a string becomes a reference, as the SDKs do for __name__. */
function nameValue(v: WireValue, root: string, collectionParent: string | null): WireValue {
  if (v.t !== 'string') return v;
  if (v.v.startsWith('projects/')) return { t: 'reference', v: v.v };
  if (v.v.includes('/')) return { t: 'reference', v: `${root}/${v.v}` };
  if (!collectionParent) throw ProblemException.of('INVALID_ARGUMENT', 'In a collection group query, __name__ takes a full document path.');
  return { t: 'reference', v: `${collectionParent}/${v.v}` };
}

function operand(field: string, v: WireValue, root: string, collectionParent: string | null): WireValue {
  if (field !== NAME_FIELD) return v;
  if (v.t === 'array') return { t: 'array', v: v.v.map((x) => nameValue(x, root, collectionParent)) };
  return nameValue(v, root, collectionParent);
}

function filterToProto(f: QueryFilter, root: string, collectionParent: string | null): Proto | null {
  if (f.kind === 'field') {
    return {
      fieldFilter: {
        field: { fieldPath: normalizeFieldPath(f.field) },
        op: FIELD_OPS[f.op],
        value: toProto(operand(f.field, f.value, root, collectionParent)),
      },
    };
  }
  if (f.kind === 'unary') return { unaryFilter: { field: { fieldPath: normalizeFieldPath(f.field) }, op: UNARY_OPS[f.op] } };
  const filters = f.filters.map((x) => filterToProto(x, root, collectionParent)).filter((x): x is Proto => x !== null);
  if (filters.length === 0) return null;
  if (filters.length === 1) return filters[0];
  return { compositeFilter: { op: f.kind === 'and' ? 'AND' : 'OR', filters } };
}

function inequalityFields(f: QueryFilter | undefined, out: Set<string>): Set<string> {
  if (!f) return out;
  if (f.kind === 'and' || f.kind === 'or') for (const x of f.filters) inequalityFields(x, out);
  else if (INEQUALITY.has(f.op)) out.add(f.field);
  return out;
}

/**
 * The order Firestore applies, made explicit: the requested order, then inequality fields not
 * already ordered (ascending, by path), then __name__ in the direction of the last order. Cursors
 * built from it always match the query.
 */
export function effectiveOrder(spec: QuerySpec): { field: string; direction: 'asc' | 'desc' }[] {
  if (spec.findNearest) return spec.orderBy;
  const order = [...spec.orderBy];
  const ordered = new Set(order.map((o) => o.field));
  for (const field of [...inequalityFields(spec.where, new Set())].sort()) {
    // __name__ always comes last: Firestore has no index with fields after it.
    if (field !== NAME_FIELD && !ordered.has(field)) {
      order.push({ field, direction: 'asc' });
      ordered.add(field);
    }
  }
  if (!ordered.has(NAME_FIELD)) order.push({ field: NAME_FIELD, direction: order.at(-1)?.direction ?? 'asc' });
  return order;
}

/**
 * `explicitOrder` spells out the implicit order so cursors match (queries). Aggregations without
 * cursors skip it: Firestore cannot sum or average over a query ordered by __name__.
 */
export function toStructuredQuery(root: string, spec: QuerySpec, explicitOrder = true): { parent: string; structuredQuery: Proto } {
  const { parent, collectionId, allDescendants } = querySource(root, spec);
  const collectionParent = allDescendants ? null : `${parent}/${collectionId}`;
  const q: Proto = { from: [{ collectionId, allDescendants }] };
  const where = spec.where ? filterToProto(spec.where, root, collectionParent) : null;
  if (where) q.where = where;
  const order = explicitOrder || spec.start || spec.end ? effectiveOrder(spec) : spec.orderBy;
  if (order.length > 0)
    q.orderBy = order.map((o) => ({
      field: { fieldPath: normalizeFieldPath(o.field) },
      direction: o.direction === 'asc' ? 'ASCENDING' : 'DESCENDING',
    }));
  const cursorValues = (values: WireValue[]) => {
    if (values.length > order.length)
      throw ProblemException.of(
        'INVALID_ARGUMENT',
        `The cursor has ${values.length} values but the query orders by ${order.length} fields.`,
      );
    return values.map((v, i) => toProto(operand(order[i]?.field ?? '', v, root, collectionParent)));
  };
  if (spec.start) q.startAt = { values: cursorValues(spec.start.values), before: spec.start.mode === 'at' };
  if (spec.end) q.endAt = { values: cursorValues(spec.end.values), before: spec.end.mode === 'before' };
  if (spec.limit !== undefined) q.limit = { value: spec.limit };
  if (spec.offset) q.offset = spec.offset;
  if (spec.select) q.select = { fields: spec.select.map((f) => ({ fieldPath: normalizeFieldPath(f) })) };
  if (spec.findNearest) {
    const n = spec.findNearest;
    q.findNearest = {
      vectorField: { fieldPath: normalizeFieldPath(n.field) },
      queryVector: toProto({ t: 'vector', v: n.vector }),
      distanceMeasure: n.measure,
      limit: { value: n.limit },
      ...(n.distanceField ? { distanceResultField: normalizeFieldPath(n.distanceField) } : {}),
      ...(n.threshold !== undefined ? { distanceThreshold: { value: n.threshold } } : {}),
    };
  }
  return { parent, structuredQuery: q };
}

/** Reads a field by path from a document, for cursors. */
export function readField(doc: FirestoreDocument, path: string): WireValue | undefined {
  if (path === NAME_FIELD) return { t: 'reference', v: doc.name };
  const segments = parseFieldPath(path) ?? [path];
  let v: WireValue | undefined = { t: 'map', v: doc.fields };
  for (const s of segments) {
    if (v?.t !== 'map') return undefined;
    v = Object.hasOwn(v.v, s) ? v.v[s] : undefined;
  }
  return v;
}

/** Cursor values after the last document, for `start: after` on the next page. */
export function nextCursor(spec: QuerySpec, last: FirestoreDocument | undefined): WireValue[] | null {
  if (!last || spec.findNearest) return null;
  const values: WireValue[] = [];
  for (const o of effectiveOrder(spec)) {
    const v = readField(last, o.field);
    if (!v) return null;
    values.push(v);
  }
  return values;
}
