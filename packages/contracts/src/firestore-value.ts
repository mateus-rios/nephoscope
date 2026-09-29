/**
 * Firestore values without loss (SPEC-0004 D-02, D-03). Zod-free: the browser imports this through
 * `@nephoscope/contracts/firestore-value` to parse, print and diff typed JSON.
 */

export type DoubleValue = number | 'NaN' | 'Infinity' | '-Infinity' | '-0';

export type WireValue =
  | { t: 'null' }
  | { t: 'boolean'; v: boolean }
  | { t: 'integer'; v: string }
  | { t: 'double'; v: DoubleValue }
  | { t: 'timestamp'; v: string }
  | { t: 'string'; v: string }
  | { t: 'bytes'; v: string }
  | { t: 'reference'; v: string }
  | { t: 'geopoint'; v: { latitude: number; longitude: number } }
  | { t: 'array'; v: WireValue[] }
  | { t: 'map'; v: WireFields }
  | { t: 'vector'; v: number[] }
  /** Enterprise values stored as maps with reserved keys; shown read-only with their kind. */
  | { t: 'special'; kind: string; v: WireFields };

export type WireFields = { [field: string]: WireValue };
export type WireType = WireValue['t'];

/** Server-side field transforms, only in writes. */
export type TransformValue =
  | { t: 'transform'; op: 'serverTimestamp' }
  | { t: 'transform'; op: 'increment' | 'maximum' | 'minimum'; v: WireValue }
  | { t: 'transform'; op: 'arrayUnion' | 'arrayRemove'; v: WireValue[] };

/** A value in a write: a wire value, a transform, or a map that may hold transforms. */
export type WriteValue = WireValue | TransformValue | { t: 'map'; v: WriteFields };
export type WriteFields = { [field: string]: WriteValue };

export const INT64_MIN = -(2n ** 63n);
export const INT64_MAX = 2n ** 63n - 1n;

// ---- timestamps -----------------------------------------------------------------------------

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?([Zz]|[+-]\d{2}:\d{2})$/;

/** Seconds since the epoch and nanoseconds, exactly. */
export interface TimestampParts {
  seconds: bigint;
  nanos: number;
}

export function timestampToParts(text: string): TimestampParts | null {
  const m = RFC3339.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac = '', zone] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31 || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(Number(h), Number(mi), Number(s), 0);
  if (date.getUTCDate() !== day) return null;
  let seconds = BigInt(Math.round(date.getTime() / 1000));
  if (zone && zone.toUpperCase() !== 'Z') {
    const sign = zone.startsWith('-') ? -1n : 1n;
    const offset = BigInt(Number(zone.slice(1, 3)) * 3600 + Number(zone.slice(4, 6)) * 60);
    seconds -= sign * offset;
  }
  return { seconds, nanos: Number(frac.padEnd(9, '0') || '0') };
}

/** RFC 3339 in UTC with the fraction trimmed, the one form Nephoscope prints. */
export function partsToTimestamp(parts: TimestampParts): string {
  const ms = Number(parts.seconds) * 1000;
  const date = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const year = date.getUTCFullYear();
  const base = `${pad(year, 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  const frac = parts.nanos ? `.${String(parts.nanos).padStart(9, '0').replace(/0+$/, '')}` : '';
  return `${base}${frac}Z`;
}

export function normalizeTimestamp(text: string): string | null {
  const parts = timestampToParts(text);
  return parts ? partsToTimestamp(parts) : null;
}

// ---- doubles ----------------------------------------------------------------------------------

export function doubleToNumber(v: DoubleValue): number {
  if (v === 'NaN') return Number.NaN;
  if (v === 'Infinity') return Number.POSITIVE_INFINITY;
  if (v === '-Infinity') return Number.NEGATIVE_INFINITY;
  if (v === '-0') return -0;
  return v;
}

export function numberToDouble(n: number): DoubleValue {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Number.POSITIVE_INFINITY) return 'Infinity';
  if (n === Number.NEGATIVE_INFINITY) return '-Infinity';
  if (Object.is(n, -0)) return '-0';
  return n;
}

/** "1.0" for 1: a double always prints with a fraction or an exponent. */
export function formatDouble(n: number): string {
  const s = String(n);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

// ---- reserved maps (vectors and Enterprise types) ------------------------------------------

/** Reclassifies a map that uses the reserved `__type__` key (D-02). */
export function classifyMap(fields: WireFields): WireValue {
  const type = fields.__type__;
  if (type?.t === 'string' && /^__.+__$/.test(type.v)) {
    const value = fields.value;
    if (type.v === '__vector__' && Object.keys(fields).length === 2 && value?.t === 'array') {
      const nums: number[] = [];
      for (const x of value.v) {
        if (x.t === 'double' && typeof x.v === 'number') nums.push(x.v);
        else if (x.t === 'integer') nums.push(Number(x.v));
        else return { t: 'special', kind: type.v.slice(2, -2), v: fields };
      }
      return { t: 'vector', v: nums };
    }
    return { t: 'special', kind: type.v.slice(2, -2), v: fields };
  }
  return { t: 'map', v: fields };
}

/** The stored map of a vector or special value. */
export function reservedMapOf(value: Extract<WireValue, { t: 'vector' | 'special' }>): WireFields {
  if (value.t === 'special') return value.v;
  return {
    __type__: { t: 'string', v: '__vector__' },
    value: { t: 'array', v: value.v.map((n) => ({ t: 'double', v: numberToDouble(n) })) },
  };
}

/** Sets a field as an own property, so names like __proto__ stay data. */
export function setField<T>(target: { [k: string]: T }, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

// ---- equality ---------------------------------------------------------------------------------

export function wireEquals(a: WriteValue | undefined, b: WriteValue | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.t !== b.t) return false;
  switch (a.t) {
    case 'null':
      return true;
    case 'double': {
      const y = (b as typeof a).v;
      return Object.is(doubleToNumber(a.v), doubleToNumber(y));
    }
    case 'geopoint': {
      const y = (b as typeof a).v;
      return a.v.latitude === y.latitude && a.v.longitude === y.longitude;
    }
    case 'array': {
      const y = (b as typeof a).v;
      return a.v.length === y.length && a.v.every((x, i) => wireEquals(x, y[i]));
    }
    case 'vector': {
      const y = (b as typeof a).v;
      return a.v.length === y.length && a.v.every((x, i) => Object.is(x, y[i]));
    }
    case 'map':
    case 'special': {
      const x = a.v as WriteFields;
      const y = (b as { v: WriteFields }).v;
      if (a.t === 'special' && a.kind !== (b as typeof a).kind) return false;
      const keys = Object.keys(x);
      return keys.length === Object.keys(y).length && keys.every((k) => Object.hasOwn(y, k) && wireEquals(x[k], y[k]));
    }
    case 'transform': {
      const y = b as TransformValue;
      if (a.op !== y.op) return false;
      if (a.op === 'serverTimestamp') return true;
      const av = (a as { v: WireValue | WireValue[] }).v;
      const bv = (y as { v: WireValue | WireValue[] }).v;
      if (Array.isArray(av) && Array.isArray(bv)) return av.length === bv.length && av.every((x, i) => wireEquals(x, bv[i]));
      return !Array.isArray(av) && !Array.isArray(bv) && wireEquals(av, bv);
    }
    default:
      return (a as { v: unknown }).v === (b as { v: unknown }).v;
  }
}

// ---- field paths ------------------------------------------------------------------------------

const SIMPLE_SEGMENT = /^[A-Za-z_][A-Za-z_0-9]*$/;

/** One field path segment, quoted with backticks when it needs it (D-05). */
export function quoteSegment(segment: string): string {
  return SIMPLE_SEGMENT.test(segment) ? segment : `\`${segment.replaceAll('\\', '\\\\').replaceAll('`', '\\`')}\``;
}

export function fieldPath(segments: string[]): string {
  return segments.map(quoteSegment).join('.');
}

/** Splits `a.\`b.c\`.d` into segments. Returns null when the path is malformed. */
export function parseFieldPath(path: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === '`') {
      let seg = '';
      i++;
      while (i < path.length && path[i] !== '`') {
        if (path[i] === '\\' && i + 1 < path.length) i++;
        seg += path[i];
        i++;
      }
      if (path[i] !== '`') return null;
      i++;
      out.push(seg);
    } else {
      const end = path.indexOf('.', i);
      const seg = path.slice(i, end === -1 ? path.length : end);
      if (!seg) return null;
      out.push(seg);
      i += seg.length;
    }
    if (i < path.length) {
      if (path[i] !== '.') return null;
      i++;
      if (i === path.length) return null;
    }
  }
  return out.length > 0 ? out : null;
}

// ---- diff ---------------------------------------------------------------------------------------

export interface FieldChange {
  path: string[];
  kind: 'added' | 'removed' | 'changed';
  before?: WireValue;
  after?: WriteValue;
}

const isPlainMap = (v: WriteValue | undefined): v is { t: 'map'; v: WriteFields } => v?.t === 'map';

/** Leaf-level changes; maps on both sides are compared field by field. */
export function diffFields(before: WireFields, after: WriteFields, prefix: string[] = []): FieldChange[] {
  const out: FieldChange[] = [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const k of keys) {
    const path = [...prefix, k];
    const b = before[k];
    const a = after[k];
    if (b === undefined && a !== undefined) out.push({ path, kind: 'added', after: a });
    else if (a === undefined && b !== undefined) out.push({ path, kind: 'removed', before: b });
    else if (b && a && isPlainMap(b) && isPlainMap(a) && Object.keys(b.v).length > 0 && Object.keys(a.v).length > 0)
      out.push(...diffFields(b.v as WireFields, a.v, path));
    else if (!wireEquals(b, a)) out.push({ path, kind: 'changed', before: b, after: a });
  }
  return out;
}

/** Splits write fields into plain fields and transforms at their field paths. */
export function splitTransforms(
  fields: WriteFields,
  prefix: string[] = [],
): { fields: WireFields; transforms: { path: string[]; transform: TransformValue }[] } {
  const plain: WireFields = {};
  const transforms: { path: string[]; transform: TransformValue }[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v.t === 'transform') transforms.push({ path: [...prefix, k], transform: v });
    else if (v.t === 'map') {
      const inner = splitTransforms(v.v, [...prefix, k]);
      transforms.push(...inner.transforms);
      if (Object.keys(inner.fields).length > 0 || inner.transforms.length === 0) setField(plain, k, { t: 'map', v: inner.fields });
    } else setField(plain, k, v);
  }
  return { fields: plain, transforms };
}

// ---- typed JSON parser ----------------------------------------------------------------------------

export interface TypedJsonError {
  message: string;
  line: number;
  column: number;
}

export type TypedJsonResult = { ok: true; value: WriteFields; id?: string } | { ok: false; error: TypedJsonError };

export interface TypedJsonOptions {
  /** `projects/p/databases/d/documents`, so `$ref` can be relative. */
  documentsRoot?: string;
  /** Transforms are only valid in writes. */
  allowTransforms?: boolean;
  /** Imports (D-16): a top-level "$id" string names the document instead of being a field. */
  idKey?: boolean;
}

type Node =
  | { k: 'num'; text: string; at: number }
  | { k: 'str'; v: string; at: number }
  | { k: 'bool'; v: boolean; at: number }
  | { k: 'null'; at: number }
  | { k: 'arr'; items: Node[]; at: number }
  | { k: 'obj'; entries: { key: string; keyAt: number; value: Node }[]; at: number };

class ParseError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

function lex(text: string): Node {
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text.charAt(i))) i++;
  };
  const value = (): Node => {
    ws();
    const at = i;
    const c = text.charAt(i);
    if (c === '{') {
      i++;
      const entries: { key: string; keyAt: number; value: Node }[] = [];
      const seen = new Set<string>();
      ws();
      if (text.charAt(i) === '}') {
        i++;
        return { k: 'obj', entries, at };
      }
      for (;;) {
        ws();
        const keyAt = i;
        if (text.charAt(i) !== '"') throw new ParseError('Expected a quoted field name.', i);
        const key = string();
        if (seen.has(key)) throw new ParseError(`The field "${key}" appears twice.`, keyAt);
        seen.add(key);
        ws();
        if (text.charAt(i) !== ':') throw new ParseError('Expected ":" after the field name.', i);
        i++;
        entries.push({ key, keyAt, value: value() });
        ws();
        if (text.charAt(i) === ',') {
          i++;
          continue;
        }
        if (text.charAt(i) === '}') {
          i++;
          return { k: 'obj', entries, at };
        }
        throw new ParseError('Expected "," or "}".', i);
      }
    }
    if (c === '[') {
      i++;
      const items: Node[] = [];
      ws();
      if (text.charAt(i) === ']') {
        i++;
        return { k: 'arr', items, at };
      }
      for (;;) {
        items.push(value());
        ws();
        if (text.charAt(i) === ',') {
          i++;
          continue;
        }
        if (text.charAt(i) === ']') {
          i++;
          return { k: 'arr', items, at };
        }
        throw new ParseError('Expected "," or "]".', i);
      }
    }
    if (c === '"') return { k: 'str', v: string(), at };
    if (text.startsWith('true', i)) {
      i += 4;
      return { k: 'bool', v: true, at };
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return { k: 'bool', v: false, at };
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return { k: 'null', at };
    }
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (m && m[0].length > 0 && m[0] !== '-') {
      i += m[0].length;
      return { k: 'num', text: m[0], at };
    }
    throw new ParseError(i >= text.length ? 'Unexpected end of input.' : `Unexpected character "${c}".`, i);
  };
  const string = (): string => {
    const start = i;
    i++;
    let out = '';
    for (;;) {
      if (i >= text.length) throw new ParseError('Unterminated string.', start);
      const c = text.charAt(i);
      if (c === '"') {
        i++;
        return out;
      }
      if (c === '\\') {
        const e = text.charAt(i + 1);
        const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e in simple) {
          out += simple[e];
          i += 2;
        } else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
          out += String.fromCharCode(Number.parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
        } else throw new ParseError('Invalid escape in string.', i);
      } else if (c < ' ') {
        throw new ParseError('Control characters must be escaped in strings.', i);
      } else {
        out += c;
        i++;
      }
    }
  };
  const root = value();
  ws();
  if (i < text.length) throw new ParseError('Unexpected text after the document.', i);
  return root;
}

const TRANSFORMS = ['$serverTimestamp', '$increment', '$maximum', '$minimum', '$arrayUnion', '$arrayRemove'] as const;
const WRAPPERS = ['$int', '$double', '$timestamp', '$bytes', '$ref', '$geo', '$vector', ...TRANSFORMS] as const;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function unescapeKey(key: string): string {
  return key.startsWith('$$') ? key.slice(1) : key;
}

function convert(node: Node, opts: TypedJsonOptions, inArray: boolean): WriteValue {
  switch (node.k) {
    case 'null':
      return { t: 'null' };
    case 'bool':
      return { t: 'boolean', v: node.v };
    case 'str':
      return { t: 'string', v: node.v };
    case 'num': {
      if (/[.eE]/.test(node.text)) {
        const n = Number(node.text);
        if (!Number.isFinite(n)) throw new ParseError(`${node.text} is out of the double range. Use {"$double": "Infinity"}.`, node.at);
        return { t: 'double', v: numberToDouble(n) };
      }
      const big = BigInt(node.text);
      if (big < INT64_MIN || big > INT64_MAX) throw new ParseError(`${node.text} is out of the 64-bit integer range.`, node.at);
      return { t: 'integer', v: big.toString() };
    }
    case 'arr': {
      const items = node.items.map((x) => {
        const v = convert(x, opts, true);
        if (v.t === 'array') throw new ParseError('Firestore arrays cannot contain arrays directly. Wrap the inner array in a map.', x.at);
        if (v.t === 'transform') throw new ParseError('Transforms cannot appear inside arrays.', x.at);
        return v as WireValue;
      });
      return { t: 'array', v: items };
    }
    case 'obj': {
      const only = node.entries.length === 1 ? node.entries[0] : undefined;
      if (only?.key.startsWith('$') && !only.key.startsWith('$$')) return wrapper(only.key, only.value, only.keyAt, opts, inArray);
      const fields: WriteFields = {};
      for (const e of node.entries) {
        if (e.key.startsWith('$') && !e.key.startsWith('$$'))
          throw new ParseError(
            `"${e.key}" looks like a wrapper, but wrappers must be the only key of their object. Write "$${e.key}" for a field named ${e.key}.`,
            e.keyAt,
          );
        setField(fields, unescapeKey(e.key), convert(e.value, opts, false));
      }
      const hasTransform = Object.values(fields).some((v) => v.t === 'transform' || (v.t === 'map' && containsTransform(v.v)));
      return hasTransform ? { t: 'map', v: fields } : classifyMap(fields as WireFields);
    }
  }
}

function containsTransform(fields: WriteFields): boolean {
  return Object.values(fields).some((v) => v.t === 'transform' || (v.t === 'map' && containsTransform(v.v)));
}

function numberArg(node: Node, what: string): WireValue {
  if (node.k !== 'num') throw new ParseError(`${what} takes a number.`, node.at);
  return convert(node, {}, false) as WireValue;
}

function wrapper(key: string, node: Node, at: number, opts: TypedJsonOptions, inArray: boolean): WriteValue {
  if (!(WRAPPERS as readonly string[]).includes(key))
    throw new ParseError(`Unknown wrapper "${key}". Write "$${key}" for a field named ${key}.`, at);
  if ((TRANSFORMS as readonly string[]).includes(key)) {
    if (!opts.allowTransforms) throw new ParseError(`${key} is a write transform and cannot be used here.`, at);
    if (inArray) throw new ParseError('Transforms cannot appear inside arrays.', at);
  }
  switch (key) {
    case '$int': {
      const text = node.k === 'str' ? node.v : node.k === 'num' ? node.text : '';
      if (!/^-?\d+$/.test(text)) throw new ParseError('$int takes an integer, as a string or a number.', node.at);
      const big = BigInt(text);
      if (big < INT64_MIN || big > INT64_MAX) throw new ParseError(`${text} is out of the 64-bit integer range.`, node.at);
      return { t: 'integer', v: big.toString() };
    }
    case '$double': {
      if (node.k === 'num') return { t: 'double', v: numberToDouble(Number(node.text)) };
      if (node.k === 'str' && ['NaN', 'Infinity', '-Infinity', '-0'].includes(node.v)) return { t: 'double', v: node.v as DoubleValue };
      if (node.k === 'str' && node.v.trim() !== '' && Number.isFinite(Number(node.v)))
        return { t: 'double', v: numberToDouble(Number(node.v)) };
      throw new ParseError('$double takes a number or "NaN", "Infinity", "-Infinity", "-0".', node.at);
    }
    case '$timestamp': {
      const ts = node.k === 'str' ? normalizeTimestamp(node.v) : null;
      if (!ts) throw new ParseError('$timestamp takes an RFC 3339 string, such as "2026-09-28T12:00:00.123456Z".', node.at);
      return { t: 'timestamp', v: ts };
    }
    case '$bytes':
      if (node.k !== 'str' || !BASE64.test(node.v)) throw new ParseError('$bytes takes a base64 string.', node.at);
      return { t: 'bytes', v: node.v };
    case '$ref': {
      // Document ids may contain spaces, so the path is taken exactly, less a leading slash.
      const path = node.k === 'str' ? node.v.replace(/^\//, '') : '';
      if (!path || path.split('/').some((s) => s === '')) throw new ParseError('$ref takes a document path, such as users/abc.', node.at);
      if (path.startsWith('projects/')) {
        if (!/^projects\/[^/]+\/databases\/[^/]+\/documents\/[^/]+\/[^/]+(\/[^/]+\/[^/]+)*$/.test(path))
          throw new ParseError('$ref must name a document: projects/p/databases/d/documents/collection/id.', node.at);
        return { t: 'reference', v: path };
      }
      if (path.split('/').length % 2 !== 0) throw new ParseError('$ref must name a document, such as users/abc.', node.at);
      if (!opts.documentsRoot) throw new ParseError('$ref needs the full name here: projects/p/databases/d/documents/…', node.at);
      return { t: 'reference', v: `${opts.documentsRoot}/${path}` };
    }
    case '$geo': {
      if (node.k !== 'obj') throw new ParseError('$geo takes {"latitude": …, "longitude": …}.', node.at);
      const lat = node.entries.find((e) => e.key === 'latitude')?.value;
      const lng = node.entries.find((e) => e.key === 'longitude')?.value;
      if (node.entries.length !== 2 || lat?.k !== 'num' || lng?.k !== 'num')
        throw new ParseError('$geo takes {"latitude": …, "longitude": …}.', node.at);
      const latitude = Number(lat.text);
      const longitude = Number(lng.text);
      if (latitude < -90 || latitude > 90) throw new ParseError('Latitude must be between -90 and 90.', lat.at);
      if (longitude < -180 || longitude > 180) throw new ParseError('Longitude must be between -180 and 180.', lng.at);
      return { t: 'geopoint', v: { latitude, longitude } };
    }
    case '$vector': {
      if (node.k !== 'arr' || node.items.some((x) => x.k !== 'num')) throw new ParseError('$vector takes an array of numbers.', node.at);
      return { t: 'vector', v: node.items.map((x) => Number((x as { text: string }).text)) };
    }
    case '$serverTimestamp':
      if (node.k !== 'bool' || !node.v) throw new ParseError('Write {"$serverTimestamp": true}.', node.at);
      return { t: 'transform', op: 'serverTimestamp' };
    case '$increment':
    case '$maximum':
    case '$minimum':
      return { t: 'transform', op: key.slice(1) as 'increment', v: numberArg(node, key) };
    default: {
      if (node.k !== 'arr') throw new ParseError(`${key} takes an array.`, node.at);
      const items = node.items.map((x) => convert(x, opts, true) as WireValue);
      return { t: 'transform', op: key.slice(1) as 'arrayUnion', v: items };
    }
  }
}

function position(text: string, at: number): { line: number; column: number } {
  const before = text.slice(0, at);
  const line = before.split('\n').length;
  return { line, column: at - before.lastIndexOf('\n') };
}

/** Parses a document's fields from typed JSON, keeping every number's literal type (D-03). */
export function parseTypedJson(text: string, opts: TypedJsonOptions = {}): TypedJsonResult {
  try {
    const root = lex(text);
    if (root.k !== 'obj') throw new ParseError('A document is a JSON object of fields.', root.at);
    const fields: WriteFields = {};
    let id: string | undefined;
    for (const e of root.entries) {
      if (opts.idKey && e.key === '$id') {
        if (e.value.k !== 'str' || !e.value.v || e.value.v.includes('/'))
          throw new ParseError('"$id" must be a document id without slashes.', e.keyAt);
        id = e.value.v;
        continue;
      }
      if (e.key.startsWith('$') && !e.key.startsWith('$$'))
        throw new ParseError(`Write "$${e.key}" for a field named ${e.key}; single "$" keys are wrappers.`, e.keyAt);
      setField(fields, unescapeKey(e.key), convert(e.value, opts, false));
    }
    return id === undefined ? { ok: true, value: fields } : { ok: true, value: fields, id };
  } catch (err) {
    if (err instanceof ParseError) return { ok: false, error: { message: err.message, ...position(text, err.at) } };
    throw err;
  }
}

export type TypedDocumentsResult =
  | { ok: true; documents: { id?: string; fields: WireFields }[] }
  | { ok: false; error: TypedJsonError & { document: number } };

/**
 * Documents to import (D-16): a JSON array of typed objects, or NDJSON with one per line. Each may
 * name itself with "$id"; transforms are not allowed in imports.
 */
export function parseTypedDocuments(text: string, opts: TypedJsonOptions = {}): TypedDocumentsResult {
  const trimmed = text.replace(/^﻿/, '').trim();
  const documents: { id?: string; fields: WireFields }[] = [];
  if (trimmed.startsWith('[')) {
    let root: Node;
    try {
      root = lex(trimmed);
    } catch (err) {
      if (err instanceof ParseError) return { ok: false, error: { message: err.message, ...position(trimmed, err.at), document: 0 } };
      throw err;
    }
    if (root.k !== 'arr') return { ok: false, error: { message: 'Expected an array of documents.', line: 1, column: 1, document: 0 } };
    for (const [i, item] of root.items.entries()) {
      if (item.k !== 'obj')
        return { ok: false, error: { message: 'Each document is a JSON object.', ...position(trimmed, item.at), document: i + 1 } };
      const r = parseTypedJson(trimmed.slice(item.at, endOf(trimmed, item)), { ...opts, idKey: true, allowTransforms: false });
      if (!r.ok) return { ok: false, error: { ...r.error, ...position(trimmed, item.at), document: i + 1 } };
      documents.push(r.id === undefined ? { fields: r.value as WireFields } : { id: r.id, fields: r.value as WireFields });
    }
    return { ok: true, documents };
  }
  const lines = trimmed.split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    const r = parseTypedJson(line, { ...opts, idKey: true, allowTransforms: false });
    if (!r.ok) return { ok: false, error: { ...r.error, line: i + 1, document: documents.length + 1 } };
    documents.push(r.id === undefined ? { fields: r.value as WireFields } : { id: r.id, fields: r.value as WireFields });
  }
  return { ok: true, documents };
}

/** The text span of an object node: re-lexes from its start to find the matching brace. */
function endOf(text: string, node: Node): number {
  let depth = 0;
  let inString = false;
  for (let i = node.at; i < text.length; i++) {
    const c = text.charAt(i);
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** Parses one value (a filter operand, a cell edit) from typed JSON. */
export function parseTypedValue(
  text: string,
  opts: TypedJsonOptions = {},
): { ok: true; value: WireValue } | { ok: false; error: TypedJsonError } {
  const wrapped = parseTypedJson(`{"v":${text}}`, { ...opts, allowTransforms: false });
  if (!wrapped.ok) return { ok: false, error: { ...wrapped.error, column: Math.max(1, wrapped.error.column - 5) } };
  return { ok: true, value: wrapped.value.v as WireValue };
}

// ---- typed JSON printer ----------------------------------------------------------------------------

function escapeKey(key: string): string {
  return key.startsWith('$') ? `$${key}` : key;
}

function printValue(v: WriteValue, root: string | undefined, indent: string, step: string): string {
  const nl = step ? '\n' : '';
  const sep = step ? ': ' : ':';
  switch (v.t) {
    case 'null':
      return 'null';
    case 'boolean':
      return String(v.v);
    case 'string':
      return JSON.stringify(v.v);
    case 'integer': {
      const big = BigInt(v.v);
      // Integers past 2^53 print wrapped, so tools that read JSON numbers as doubles do not round them.
      return big >= -(2n ** 53n) && big <= 2n ** 53n ? v.v : wrap('$int', JSON.stringify(v.v), sep);
    }
    case 'double':
      return typeof v.v === 'number' ? formatDouble(v.v) : wrap('$double', JSON.stringify(v.v), sep);
    case 'timestamp':
      return wrap('$timestamp', JSON.stringify(v.v), sep);
    case 'bytes':
      return wrap('$bytes', JSON.stringify(v.v), sep);
    case 'reference': {
      const rel = root && v.v.startsWith(`${root}/`) ? v.v.slice(root.length + 1) : v.v;
      return wrap('$ref', JSON.stringify(rel), sep);
    }
    case 'geopoint':
      return wrap('$geo', `{"latitude"${sep}${v.v.latitude},${step ? ' ' : ''}"longitude"${sep}${v.v.longitude}}`, sep);
    case 'vector':
      return wrap('$vector', `[${v.v.map((n) => String(n)).join(step ? ', ' : ',')}]`, sep);
    case 'array': {
      if (v.v.length === 0) return '[]';
      const inner = indent + step;
      return `[${nl}${v.v.map((x) => inner + printValue(x, root, inner, step)).join(`,${nl}`)}${nl}${indent}]`;
    }
    case 'map':
    case 'special':
      return printFields(v.v, root, indent, step);
    case 'transform':
      if (v.op === 'serverTimestamp') return wrap('$serverTimestamp', 'true', sep);
      if (v.op === 'arrayUnion' || v.op === 'arrayRemove')
        return wrap(`$${v.op}`, printValue({ t: 'array', v: v.v }, root, indent, ''), sep);
      return wrap(`$${v.op}`, printValue(v.v as WireValue, root, indent, step), sep);
  }
}

function wrap(key: string, body: string, sep: string): string {
  const pad = sep === ': ' ? ' ' : '';
  return `{${pad}"${key}"${sep}${body}${pad}}`;
}

function printFields(fields: WriteFields, root: string | undefined, indent: string, step: string): string {
  const keys = Object.keys(fields);
  if (keys.length === 0) return '{}';
  const nl = step ? '\n' : '';
  const sep = step ? ': ' : ':';
  const inner = indent + step;
  const lines = keys.map((k) => `${inner}${JSON.stringify(escapeKey(k))}${sep}${printValue(fields[k] as WriteValue, root, inner, step)}`);
  return `{${nl}${lines.join(`,${nl}`)}${nl}${indent}}`;
}

/** Prints fields as typed JSON; `indent` 0 prints one line (NDJSON). */
export function printTypedJson(fields: WriteFields, opts: { documentsRoot?: string; indent?: number } = {}): string {
  return printFields(fields, opts.documentsRoot, '', ' '.repeat(opts.indent ?? 2));
}

export function printTypedValue(value: WriteValue, opts: { documentsRoot?: string } = {}): string {
  return printValue(value, opts.documentsRoot, '', '');
}

/** One exported document: typed JSON with its id under "$id" (D-16). */
export function printExportLine(id: string, fields: WireFields, opts: { documentsRoot?: string; indent?: number } = {}): string {
  const body = printTypedJson(fields, opts);
  const step = ' '.repeat(opts.indent ?? 2);
  const nl = step ? '\n' : '';
  const idPart = `${step}"$id"${step ? ': ' : ':'}${JSON.stringify(id)}`;
  return body === '{}' ? `{${nl}${idPart}${nl}}` : `{${nl}${idPart},${body.slice(1)}`;
}

// ---- display and size ------------------------------------------------------------------------------

export const WIRE_TYPE_LABELS: Record<WireType, string> = {
  null: 'null',
  boolean: 'boolean',
  integer: 'integer',
  double: 'double',
  timestamp: 'timestamp',
  string: 'string',
  bytes: 'bytes',
  reference: 'reference',
  geopoint: 'geopoint',
  array: 'array',
  map: 'map',
  vector: 'vector',
  special: 'special',
};

/** A short, single-line rendering for cells and tree rows. */
export function previewValue(v: WireValue, documentsRoot?: string, max = 120): string {
  let s: string;
  switch (v.t) {
    case 'null':
      s = 'null';
      break;
    case 'string':
      s = v.v;
      break;
    case 'reference':
      s = documentsRoot && v.v.startsWith(`${documentsRoot}/`) ? v.v.slice(documentsRoot.length + 1) : v.v;
      break;
    case 'array':
      s = `[${v.v.length}]`;
      break;
    case 'map':
      s = `{${Object.keys(v.v).length}}`;
      break;
    case 'special':
      s = `${v.kind} value`;
      break;
    case 'vector':
      s = `vector(${v.v.length})`;
      break;
    case 'geopoint':
      s = `${v.v.latitude}, ${v.v.longitude}`;
      break;
    case 'bytes':
      s = `${Math.floor((v.v.length * 3) / 4) - (v.v.endsWith('==') ? 2 : v.v.endsWith('=') ? 1 : 0)} bytes`;
      break;
    case 'double':
      s = typeof v.v === 'number' ? formatDouble(v.v) : v.v;
      break;
    default:
      s = String(v.v);
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** UTF-8 byte length without TextEncoder, which the shared lib typings do not declare. */
function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Storage size of a document name (Firestore storage size rules). */
export function documentNameSize(path: string): number {
  return path.split('/').reduce((n, seg) => n + utf8Length(seg) + 1, 0) + 16;
}

export function valueSize(v: WireValue): number {
  switch (v.t) {
    case 'null':
    case 'boolean':
      return 1;
    case 'integer':
    case 'double':
    case 'timestamp':
      return 8;
    case 'string':
      return utf8Length(v.v) + 1;
    case 'bytes':
      return Math.floor((v.v.length * 3) / 4);
    case 'reference':
      return documentNameSize(v.v.replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//, ''));
    case 'geopoint':
      return 16;
    case 'array':
      return v.v.reduce((n, x) => n + valueSize(x), 0);
    case 'vector':
      return valueSize({ t: 'map', v: reservedMapOf(v) });
    case 'map':
    case 'special':
      return Object.entries(v.v).reduce((n, [k, x]) => n + utf8Length(k) + 1 + valueSize(x), 0);
  }
}

/** Estimated stored size of a document: name, fields, and 32 bytes of overhead. */
export function documentSize(path: string, fields: WireFields): number {
  return documentNameSize(path) + valueSize({ t: 'map', v: fields }) + 32;
}
