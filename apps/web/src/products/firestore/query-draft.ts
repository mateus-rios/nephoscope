import type { Aggregation, FieldOperator, QueryFilter, QuerySpec, UnaryOperator } from '@nephoscope/contracts';
import { parseFieldPath, parseTypedValue, printTypedValue, type WireValue } from '@nephoscope/contracts/firestore-value';

/**
 * The query builder's editable form (SPEC-0004 D-06). Values stay as typed JSON text until the
 * query runs, so an invalid value is reported next to its row (CA-12).
 */

export type DraftCondition =
  | { id: string; kind: 'field'; field: string; op: FieldOperator; value: string }
  | { id: string; kind: 'unary'; field: string; op: UnaryOperator };
export type DraftGroup = { id: string; kind: 'and' | 'or'; items: DraftNode[] };
export type DraftNode = DraftCondition | DraftGroup;

export const isGroup = (n: DraftNode): n is DraftGroup => n.kind === 'and' || n.kind === 'or';

export interface Draft {
  source: 'collection' | 'group';
  path: string;
  collectionId: string;
  parent: string;
  where: DraftGroup;
  orderBy: { id: string; field: string; direction: 'asc' | 'desc' }[];
  limit: string;
  offset: string;
  start: { mode: '' | 'at' | 'after'; values: string };
  end: { mode: '' | 'at' | 'before'; values: string };
  select: string;
  nearest: {
    enabled: boolean;
    field: string;
    vector: string;
    measure: 'EUCLIDEAN' | 'COSINE' | 'DOT_PRODUCT';
    limit: string;
    distanceField: string;
    threshold: string;
  };
  aggregations: { id: string; op: 'count' | 'sum' | 'avg'; field: string }[];
}

let counter = 0;
export const newId = () => `n${Date.now().toString(36)}${(counter++).toString(36)}`;

export function newDraft(path = ''): Draft {
  return {
    source: 'collection',
    path,
    collectionId: '',
    parent: '',
    where: { id: newId(), kind: 'and', items: [] },
    orderBy: [],
    limit: '50',
    offset: '',
    start: { mode: '', values: '' },
    end: { mode: '', values: '' },
    select: '',
    nearest: { enabled: false, field: '', vector: '', measure: 'COSINE', limit: '10', distanceField: '', threshold: '' },
    aggregations: [{ id: newId(), op: 'count', field: '' }],
  };
}

export const ARRAY_OPS: readonly string[] = ['in', 'not-in', 'array-contains-any'];

export type DraftErrors = Record<string, string>;
export type SpecResult = { ok: true; spec: QuerySpec } | { ok: false; errors: DraftErrors };

function fieldError(field: string): string | null {
  if (!field.trim()) return 'Enter a field path.';
  if (field === '__name__') return null;
  return parseFieldPath(field.trim()) ? null : 'Not a valid field path. Quote segments with backticks, such as `my field`.';
}

function convertNode(node: DraftNode, root: string, errors: DraftErrors): QueryFilter | null {
  if (isGroup(node)) {
    const filters = node.items.map((x) => convertNode(x, root, errors)).filter((x): x is QueryFilter => x !== null);
    if (filters.length === 0) return null;
    return { kind: node.kind, filters };
  }
  const fe = fieldError(node.field);
  if (fe) {
    errors[node.id] = fe;
    return null;
  }
  if (node.kind === 'unary') return { kind: 'unary', field: node.field.trim(), op: node.op };
  if (!node.value.trim()) {
    errors[node.id] = 'Enter a value.';
    return null;
  }
  // A bare word is taken as a string, the way people type values in a filter.
  const text = /^[-+]?(\d|\.)|^[[{"]|^(true|false|null)$/.test(node.value.trim()) ? node.value : JSON.stringify(node.value.trim());
  const parsed = parseTypedValue(text, { documentsRoot: root });
  if (!parsed.ok) {
    errors[node.id] = parsed.error.message;
    return null;
  }
  if (ARRAY_OPS.includes(node.op) && parsed.value.t !== 'array') {
    errors[node.id] = `${node.op} takes an array of values, such as ["a", "b"].`;
    return null;
  }
  return { kind: 'field', field: node.field.trim(), op: node.op, value: parsed.value };
}

function cursorValues(text: string, root: string): WireValue[] | string {
  const parsed = parseTypedValue(text.trim().startsWith('[') ? text : `[${text}]`, { documentsRoot: root });
  if (!parsed.ok) return parsed.error.message;
  if (parsed.value.t !== 'array' || parsed.value.v.length === 0) return 'Give one value per order field, as a JSON array.';
  return parsed.value.v;
}

const intIn = (text: string, min: number, max: number): number | null | 'bad' => {
  if (!text.trim()) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= min && n <= max ? n : 'bad';
};

export function draftToSpec(draft: Draft, root: string, opts: { live?: boolean } = {}): SpecResult {
  const errors: DraftErrors = {};
  let source: QuerySpec['source'];
  if (draft.source === 'collection') {
    const segs = draft.path.split('/').filter(Boolean);
    if (segs.length % 2 !== 1) errors.source = 'Enter a collection path, such as users or users/abc/orders.';
    source = { kind: 'collection', path: segs.join('/') };
  } else {
    if (!draft.collectionId.trim() || draft.collectionId.includes('/')) errors.source = 'Enter a collection id, such as orders.';
    const parent = draft.parent.split('/').filter(Boolean);
    if (parent.length % 2 !== 0) errors.source = 'The parent must be a document path, or empty for the whole database.';
    source = { kind: 'group', collectionId: draft.collectionId.trim(), parent: parent.join('/') };
  }
  const where = convertNode(draft.where, root, errors) ?? undefined;
  const orderBy = draft.orderBy.map((o) => {
    const fe = fieldError(o.field);
    if (fe) errors[o.id] = fe;
    return { field: o.field.trim(), direction: o.direction };
  });
  const limit = intIn(draft.limit, 1, 10_000);
  if (limit === 'bad') errors.limit = 'A whole number from 1 to 10,000.';
  if (opts.live && (limit === null || (typeof limit === 'number' && limit > 1000)))
    errors.limit = 'Live mode needs a limit of at most 1,000.';
  const offset = intIn(draft.offset, 0, 10_000);
  if (offset === 'bad') errors.offset = 'A whole number from 0 to 10,000.';
  const spec: QuerySpec = { source, orderBy, ...(where ? { where } : {}) };
  if (typeof limit === 'number') spec.limit = limit;
  if (typeof offset === 'number' && offset > 0) spec.offset = offset;
  if (draft.start.mode) {
    const v = cursorValues(draft.start.values, root);
    if (typeof v === 'string') errors.start = v;
    else spec.start = { mode: draft.start.mode, values: v };
  }
  if (draft.end.mode) {
    const v = cursorValues(draft.end.values, root);
    if (typeof v === 'string') errors.end = v;
    else spec.end = { mode: draft.end.mode, values: v };
  }
  const select = draft.select
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (select.length > 0) {
    const bad = select.find((s) => fieldError(s));
    if (bad) errors.select = `"${bad}" is not a valid field path.`;
    spec.select = select;
  }
  if (draft.nearest.enabled) {
    const n = draft.nearest;
    const fe = fieldError(n.field);
    if (fe) errors.nearest = fe;
    const vec = parseTypedValue(n.vector.trim().startsWith('[') ? n.vector : `[${n.vector}]`);
    const numbers =
      vec.ok && vec.value.t === 'array'
        ? vec.value.v.map((x) => (x.t === 'integer' ? Number(x.v) : x.t === 'double' && typeof x.v === 'number' ? x.v : Number.NaN))
        : [];
    if (numbers.length === 0 || numbers.some((x) => !Number.isFinite(x)))
      errors.nearest = 'The query vector is an array of numbers, such as [0.1, 0.2].';
    const nl = intIn(n.limit, 1, 1000);
    if (typeof nl !== 'number') errors.nearest = 'The neighbor limit is a whole number from 1 to 1,000.';
    const threshold = n.threshold.trim() ? Number(n.threshold) : undefined;
    if (threshold !== undefined && !Number.isFinite(threshold)) errors.nearest = 'The distance threshold is a number.';
    spec.findNearest = {
      field: n.field.trim(),
      vector: numbers,
      measure: n.measure,
      limit: typeof nl === 'number' ? nl : 10,
      ...(n.distanceField.trim() ? { distanceField: n.distanceField.trim() } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
    };
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, spec };
}

export function draftAggregations(draft: Draft): { ok: true; aggregations: Aggregation[] } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const aggregations = draft.aggregations.map((a): Aggregation => {
    if (a.op === 'count') return { op: 'count' };
    const fe = fieldError(a.field);
    if (fe) errors[a.id] = fe;
    return { op: a.op, field: a.field.trim() };
  });
  if (aggregations.length === 0) errors.aggregations = 'Add an aggregation.';
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, aggregations };
}

/** Draft from a spec, for recent queries and links. */
export function specToDraft(spec: QuerySpec, root: string): Draft {
  const d = newDraft();
  const value = (v: WireValue) => printTypedValue(v, { documentsRoot: root });
  const node = (f: QueryFilter): DraftNode =>
    f.kind === 'and' || f.kind === 'or'
      ? { id: newId(), kind: f.kind, items: f.filters.map(node) }
      : f.kind === 'unary'
        ? { id: newId(), kind: 'unary', field: f.field, op: f.op }
        : { id: newId(), kind: 'field', field: f.field, op: f.op, value: value(f.value) };
  if (spec.source.kind === 'collection') d.path = spec.source.path;
  else {
    d.source = 'group';
    d.collectionId = spec.source.collectionId;
    d.parent = spec.source.parent ?? '';
  }
  if (spec.where) {
    const w = node(spec.where);
    d.where = isGroup(w) ? w : { id: newId(), kind: 'and', items: [w] };
  }
  d.orderBy = spec.orderBy.map((o) => ({ id: newId(), ...o }));
  d.limit = spec.limit !== undefined ? String(spec.limit) : '';
  d.offset = spec.offset ? String(spec.offset) : '';
  if (spec.start) d.start = { mode: spec.start.mode, values: `[${spec.start.values.map(value).join(', ')}]` };
  if (spec.end) d.end = { mode: spec.end.mode, values: `[${spec.end.values.map(value).join(', ')}]` };
  d.select = spec.select?.join(', ') ?? '';
  if (spec.findNearest) {
    const n = spec.findNearest;
    d.nearest = {
      enabled: true,
      field: n.field,
      vector: `[${n.vector.join(', ')}]`,
      measure: n.measure,
      limit: String(n.limit),
      distanceField: n.distanceField ?? '',
      threshold: n.threshold !== undefined ? String(n.threshold) : '',
    };
  }
  return d;
}

/** A one-line summary for the recent-queries menu. */
export function describeSpec(spec: QuerySpec): string {
  const src = spec.source.kind === 'collection' ? spec.source.path : `group ${spec.source.collectionId}`;
  const count = (f: QueryFilter | undefined): number =>
    !f ? 0 : f.kind === 'and' || f.kind === 'or' ? f.filters.reduce((n, x) => n + count(x), 0) : 1;
  const n = count(spec.where);
  return `${src}${n ? `, ${n} ${n === 1 ? 'filter' : 'filters'}` : ''}${spec.orderBy.length ? `, by ${spec.orderBy.map((o) => o.field).join(', ')}` : ''}${spec.limit ? `, limit ${spec.limit}` : ''}`;
}
