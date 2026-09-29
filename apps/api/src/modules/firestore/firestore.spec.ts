import type { QuerySpec } from '@nephoscope/contracts';
import { describe, expect, it } from 'vitest';
import { fromProto, toProto } from './codec.js';
import { decodeIndexMessage, deriveIndex, indexFromErrorMessage } from './index-suggestion.js';
import { effectiveOrder, nextCursor, toStructuredQuery } from './structured-query.js';

const ROOT = 'projects/p/databases/(default)/documents';

// Minimal protobuf writer for the Index message (google.firestore.admin.v1.Index).
const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n > 127) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
};
const str = (no: number, s: string) => {
  const b = [...Buffer.from(s)];
  return [...varint((no << 3) | 2), ...varint(b.length), ...b];
};
const num = (no: number, n: number) => [...varint(no << 3), ...varint(n)];
const msg = (no: number, body: number[]) => [...varint((no << 3) | 2), ...varint(body.length), ...body];

describe('codec (SPEC-0004 CA-01)', () => {
  it('reads every protocol value type', () => {
    expect(fromProto({ valueType: 'integerValue', integerValue: '-9223372036854775808' })).toEqual({
      t: 'integer',
      v: '-9223372036854775808',
    });
    expect(fromProto({ doubleValue: Number.NaN })).toEqual({ t: 'double', v: 'NaN' });
    expect(fromProto({ doubleValue: -0 })).toEqual({ t: 'double', v: '-0' });
    expect(fromProto({ timestampValue: { seconds: '1790000000', nanos: 120000 } })).toEqual({
      t: 'timestamp',
      v: '2026-09-21T14:13:20.00012Z',
    });
    expect(fromProto({ bytesValue: Buffer.from([1, 2, 3]) })).toEqual({ t: 'bytes', v: 'AQID' });
    expect(
      fromProto({
        mapValue: {
          fields: {
            __type__: { stringValue: '__vector__' },
            value: { arrayValue: { values: [{ doubleValue: 0.5 }, { doubleValue: 2 }] } },
          },
        },
      }),
    ).toEqual({ t: 'vector', v: [0.5, 2] });
    expect(fromProto({ fooValue: 'x' })).toEqual({ t: 'special', kind: 'foo', v: {} });
  });

  it('writes values back to the same protocol shape', () => {
    expect(toProto({ t: 'double', v: '-Infinity' })).toEqual({ doubleValue: Number.NEGATIVE_INFINITY });
    expect(toProto({ t: 'timestamp', v: '2026-09-21T14:13:20.00012Z' })).toEqual({
      timestampValue: { seconds: '1790000000', nanos: 120000 },
    });
    expect(fromProto(toProto({ t: 'vector', v: [1, 2] }))).toEqual({ t: 'vector', v: [1, 2] });
  });
});

describe('structured queries (D-06)', () => {
  const spec: QuerySpec = {
    source: { kind: 'collection', path: 'users/u1/orders' },
    where: {
      kind: 'and',
      filters: [
        { kind: 'field', field: 'total', op: '>', value: { t: 'integer', v: '10' } },
        { kind: 'field', field: '__name__', op: '!=', value: { t: 'string', v: 'o9' } },
        { kind: 'unary', field: 'note', op: 'is-not-null' },
      ],
    },
    orderBy: [{ field: 'placed', direction: 'desc' }],
    limit: 20,
  };

  it('makes the implicit order explicit so cursors match', () => {
    expect(effectiveOrder(spec)).toEqual([
      { field: 'placed', direction: 'desc' },
      { field: 'note', direction: 'asc' },
      { field: 'total', direction: 'asc' },
      { field: '__name__', direction: 'asc' },
    ]);
  });

  it('builds the parent, filters and document-id operands', () => {
    const { parent, structuredQuery } = toStructuredQuery(ROOT, spec);
    expect(parent).toBe(`${ROOT}/users/u1`);
    expect(structuredQuery.from).toEqual([{ collectionId: 'orders', allDescendants: false }]);
    expect(structuredQuery.where.compositeFilter.filters[1].fieldFilter.value).toEqual({ referenceValue: `${ROOT}/users/u1/orders/o9` });
    expect(structuredQuery.limit).toEqual({ value: 20 });
  });

  it('reads the next cursor from the last document', () => {
    const doc = {
      name: `${ROOT}/users/u1/orders/o1`,
      path: 'users/u1/orders/o1',
      id: 'o1',
      fields: { placed: { t: 'integer', v: '5' }, note: { t: 'string', v: 'x' }, total: { t: 'integer', v: '11' } },
      createTime: null,
      updateTime: null,
      missing: false,
    } as const;
    expect(nextCursor(spec, { ...doc, fields: { ...doc.fields } })).toEqual([
      { t: 'integer', v: '5' },
      { t: 'string', v: 'x' },
      { t: 'integer', v: '11' },
      { t: 'reference', v: `${ROOT}/users/u1/orders/o1` },
    ]);
  });

  it('queries a collection group under a document', () => {
    const { parent, structuredQuery } = toStructuredQuery(
      ROOT,
      { source: { kind: 'group', collectionId: 'orders', parent: 'users/u1' }, orderBy: [] },
      false,
    );
    expect(parent).toBe(`${ROOT}/users/u1`);
    expect(structuredQuery.from).toEqual([{ collectionId: 'orders', allDescendants: true }]);
    expect(structuredQuery.orderBy).toBeUndefined();
  });
});

describe('missing-index suggestion (D-09)', () => {
  const index = [
    ...str(1, 'projects/p/databases/(default)/collectionGroups/orders/indexes/_'),
    ...num(2, 1),
    ...msg(3, [...str(1, 'status'), ...num(2, 1)]),
    ...msg(3, [...str(1, 'tags'), ...num(3, 1)]),
    ...msg(3, [...str(1, 'placed'), ...num(2, 2)]),
    ...msg(3, [...str(1, '__name__'), ...num(2, 2)]),
  ];

  it('decodes the Index message in the create_composite link', () => {
    const b64 = Buffer.from(index).toString('base64url');
    const message = `The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=${b64}`;
    expect(indexFromErrorMessage(message)).toEqual({
      collectionGroup: 'orders',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'tags', arrayConfig: 'CONTAINS' },
        { fieldPath: 'placed', order: 'DESCENDING' },
        { fieldPath: '__name__', order: 'DESCENDING' },
      ],
    });
    expect(decodeIndexMessage(new Uint8Array([0xff, 0xff]))).toBeNull();
  });

  it('derives an index from the query when there is no link', () => {
    expect(
      deriveIndex({
        source: { kind: 'group', collectionId: 'orders', parent: '' },
        where: {
          kind: 'and',
          filters: [
            { kind: 'field', field: 'total', op: '>=', value: { t: 'integer', v: '1' } },
            { kind: 'field', field: 'status', op: '==', value: { t: 'string', v: 'open' } },
            { kind: 'field', field: 'tags', op: 'array-contains', value: { t: 'string', v: 'x' } },
          ],
        },
        orderBy: [{ field: 'total', direction: 'desc' }],
      }),
    ).toEqual({
      collectionGroup: 'orders',
      queryScope: 'COLLECTION_GROUP',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'tags', arrayConfig: 'CONTAINS' },
        { fieldPath: 'total', order: 'DESCENDING' },
      ],
    });
  });
});
