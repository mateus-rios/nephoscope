import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  classifyMap,
  diffFields,
  documentSize,
  fieldPath,
  normalizeTimestamp,
  numberToDouble,
  parseFieldPath,
  parseTypedDocuments,
  parseTypedJson,
  parseTypedValue,
  partsToTimestamp,
  printExportLine,
  printTypedJson,
  splitTransforms,
  timestampToParts,
  type WireFields,
  type WireValue,
  wireEquals,
} from './firestore-value.js';

const ROOT = 'projects/p/databases/(default)/documents';

const segment = fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !s.includes('/') && s !== '.' && s !== '..');
const key = fc.string({ maxLength: 10 }).filter((k) => k !== '__type__');

const scalar: fc.Arbitrary<WireValue> = fc.oneof(
  fc.constant<WireValue>({ t: 'null' }),
  fc.boolean().map((v): WireValue => ({ t: 'boolean', v })),
  fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }).map((v): WireValue => ({ t: 'integer', v: v.toString() })),
  fc.double().map((n): WireValue => ({ t: 'double', v: numberToDouble(n) })),
  fc
    .record({ seconds: fc.bigInt({ min: -62135596800n, max: 253402300799n }), nanos: fc.integer({ min: 0, max: 999_999_999 }) })
    .map((p): WireValue => ({ t: 'timestamp', v: partsToTimestamp(p) })),
  fc.string({ unit: 'binary' }).map((v): WireValue => ({ t: 'string', v })),
  fc.uint8Array({ maxLength: 40 }).map((b): WireValue => ({ t: 'bytes', v: Buffer.from(b).toString('base64') })),
  fc
    .array(fc.tuple(segment, segment), { minLength: 1, maxLength: 3 })
    .map((pairs): WireValue => ({ t: 'reference', v: `${ROOT}/${pairs.map(([c, d]) => `${c}/${d}`).join('/')}` })),
  fc
    .record({ latitude: fc.double({ min: -90, max: 90, noNaN: true }), longitude: fc.double({ min: -180, max: 180, noNaN: true }) })
    .map((v): WireValue => ({ t: 'geopoint', v })),
  fc
    .array(
      fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => (n === 0 ? 0 : n)),
      { minLength: 1, maxLength: 6 },
    )
    .map((v): WireValue => ({ t: 'vector', v })),
);

const { value } = fc.letrec<{ value: WireValue; map: WireValue }>((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    scalar,
    tie('map'),
    fc.array(fc.oneof(scalar, tie('map')), { maxLength: 4 }).map((v): WireValue => ({ t: 'array', v })),
  ),
  map: fc.dictionary(key, tie('value'), { maxKeys: 4 }).map((v): WireValue => ({ t: 'map', v })),
}));

const document = fc.dictionary(key, value, { maxKeys: 6 });

describe('typed JSON (SPEC-0004 D-03, T-01)', () => {
  it('round-trips every wire value through print and parse', () => {
    fc.assert(
      fc.property(document, (fields: WireFields) => {
        for (const indent of [0, 2]) {
          const text = printTypedJson(fields, { documentsRoot: ROOT, indent });
          const parsed = parseTypedJson(text, { documentsRoot: ROOT });
          if (!parsed.ok) throw new Error(`${parsed.error.message} in ${text}`);
          expect(wireEquals({ t: 'map', v: parsed.value }, { t: 'map', v: fields })).toBe(true);
          expect(printTypedJson(parsed.value, { documentsRoot: ROOT, indent })).toBe(text);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('keeps integer and double apart by their literal (T-02)', () => {
    const r = parseTypedJson('{"a": 1, "b": 1.0, "c": {"$int": "9007199254740993"}, "d": {"$double": "NaN"}, "e": 2e3}');
    expect(r).toEqual({
      ok: true,
      value: {
        a: { t: 'integer', v: '1' },
        b: { t: 'double', v: 1 },
        c: { t: 'integer', v: '9007199254740993' },
        d: { t: 'double', v: 'NaN' },
        e: { t: 'double', v: 2000 },
      },
    });
    expect(printTypedJson(r.ok ? r.value : {}, { indent: 0 })).toBe(
      '{"a":1,"b":1.0,"c":{"$int":"9007199254740993"},"d":{"$double":"NaN"},"e":2000.0}',
    );
  });

  it('parses wrappers, escaped keys and transforms', () => {
    const r = parseTypedJson(
      '{"$$price": 3, "at": {"$timestamp": "2026-09-28T12:00:00.123456+02:00"}, "who": {"$ref": "users/abc"}, "n": {"$increment": 5}, "t": {"$serverTimestamp": true}}',
      { documentsRoot: ROOT, allowTransforms: true },
    );
    expect(r.ok && r.value).toEqual({
      $price: { t: 'integer', v: '3' },
      at: { t: 'timestamp', v: '2026-09-28T10:00:00.123456Z' },
      who: { t: 'reference', v: `${ROOT}/users/abc` },
      n: { t: 'transform', op: 'increment', v: { t: 'integer', v: '5' } },
      t: { t: 'transform', op: 'serverTimestamp' },
    });
  });

  it('reports errors with their position', () => {
    expect(parseTypedJson('{\n  "a": 1,\n  "b": {"$nope": 1}\n}')).toEqual({
      ok: false,
      error: { message: 'Unknown wrapper "$nope". Write "$$nope" for a field named $nope.', line: 3, column: 9 },
    });
    expect(parseTypedJson('{"a": 99999999999999999999}').ok).toBe(false);
    expect(parseTypedJson('{"a": {"$increment": 1}}').ok).toBe(false);
    expect(parseTypedJson('{"a": [[1]]}').ok).toBe(false);
    expect(parseTypedJson('{"a": 1, "a": 2}').ok).toBe(false);
    expect(parseTypedJson('[1]').ok).toBe(false);
  });

  it('reads vectors and reserved maps as their own types', () => {
    const vector = classifyMap({ __type__: { t: 'string', v: '__vector__' }, value: { t: 'array', v: [{ t: 'double', v: 0.5 }] } });
    expect(vector).toEqual({ t: 'vector', v: [0.5] });
    expect(classifyMap({ __type__: { t: 'string', v: '__decimal128__' }, value: { t: 'string', v: '1.5' } })).toMatchObject({
      t: 'special',
      kind: 'decimal128',
    });
    expect(parseTypedValue('{"$vector": [1, 2.5]}')).toEqual({ ok: true, value: { t: 'vector', v: [1, 2.5] } });
  });
});

describe('timestamps', () => {
  it('keep every digit and normalize to UTC', () => {
    expect(normalizeTimestamp('2026-09-28T12:00:00.123456Z')).toBe('2026-09-28T12:00:00.123456Z');
    expect(normalizeTimestamp('2026-09-28T12:00:00.100000000Z')).toBe('2026-09-28T12:00:00.1Z');
    expect(normalizeTimestamp('0001-01-01T00:00:00Z')).toBe('0001-01-01T00:00:00Z');
    expect(timestampToParts('1970-01-01T00:00:01.000000001Z')).toEqual({ seconds: 1n, nanos: 1 });
    expect(normalizeTimestamp('2026-02-30T00:00:00Z')).toBeNull();
  });
});

describe('field paths and diffs', () => {
  it('quote segments that need it', () => {
    expect(fieldPath(['a', 'b c', 'x`y', '1st'])).toBe('a.`b c`.`x\\`y`.`1st`');
    expect(parseFieldPath('a.`b c`.`x\\`y`.`1st`')).toEqual(['a', 'b c', 'x`y', '1st']);
    expect(parseFieldPath('a..b')).toBeNull();
  });

  it('diff maps field by field and split transforms', () => {
    const before: WireFields = { a: { t: 'integer', v: '1' }, m: { t: 'map', v: { x: { t: 'string', v: 'old' }, y: { t: 'null' } } } };
    const parsed = parseTypedJson('{"a": 1.0, "m": {"x": "new", "y": null, "z": {"$serverTimestamp": true}}, "b": true}', {
      allowTransforms: true,
    });
    if (!parsed.ok) throw new Error('parse');
    expect(diffFields(before, parsed.value).map((c) => `${c.kind} ${fieldPath(c.path)}`)).toEqual([
      'changed a',
      'added b',
      'changed m.x',
      'added m.z',
    ]);
    const split = splitTransforms(parsed.value);
    expect(split.transforms.map((t) => fieldPath(t.path))).toEqual(['m.z']);
    expect(split.fields.m).toEqual({ t: 'map', v: { x: { t: 'string', v: 'new' }, y: { t: 'null' } } });
  });

  it('estimates document size by the storage rules', () => {
    // users/abc: (6 + 4) + 16 = 26; "a" 2 + string "hi" 3 = 5; + 32.
    expect(documentSize('users/abc', { a: { t: 'string', v: 'hi' } })).toBe(63);
  });
});

describe('import and export lines (D-16)', () => {
  it('carry the document id under $id', () => {
    const line = printExportLine('a b', { n: { t: 'integer', v: '1' } }, { indent: 0 });
    expect(line).toBe('{"$id":"a b","n":1}');
    expect(parseTypedJson(line, { idKey: true })).toEqual({ ok: true, value: { n: { t: 'integer', v: '1' } }, id: 'a b' });
    expect(printExportLine('x', {}, { indent: 0 })).toBe('{"$id":"x"}');
    expect(parseTypedJson('{"$id": "a/b"}', { idKey: true }).ok).toBe(false);
    expect(parseTypedJson('{"$id": "a"}').ok).toBe(false);
  });
});

describe('import files (D-16)', () => {
  it('read a typed JSON array or NDJSON', () => {
    const arr = parseTypedDocuments('[{"$id": "a", "n": 1}, {"s": "x, y", "m": {"k": [1.5]}}]');
    expect(arr).toEqual({
      ok: true,
      documents: [
        { id: 'a', fields: { n: { t: 'integer', v: '1' } } },
        { fields: { s: { t: 'string', v: 'x, y' }, m: { t: 'map', v: { k: { t: 'array', v: [{ t: 'double', v: 1.5 }] } } } } },
      ],
    });
    const nd = parseTypedDocuments('{"$id": "a", "n": 1}\n\n{"$id": "b", "n": {"$increment": 1}}\n');
    expect(nd.ok).toBe(false);
    expect(!nd.ok && nd.error).toMatchObject({ line: 3, document: 2 });
  });
});

describe('transforms', () => {
  it('print and parse back as themselves', () => {
    const text =
      '{"a": {"$increment": 1}, "b": {"$maximum": 2.5}, "c": {"$minimum": -1}, "d": {"$serverTimestamp": true}, "e": {"$arrayUnion": [1, "x"]}, "f": {"$arrayRemove": [null]}}';
    const parsed = parseTypedJson(text, { allowTransforms: true });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const printed = printTypedJson(parsed.value, { indent: 0 });
    expect(printed).toBe(
      '{"a":{"$increment":1},"b":{"$maximum":2.5},"c":{"$minimum":-1},"d":{"$serverTimestamp":true},"e":{"$arrayUnion":[1,"x"]},"f":{"$arrayRemove":[null]}}',
    );
    expect(parseTypedJson(printed, { allowTransforms: true })).toEqual(parsed);
  });
});
