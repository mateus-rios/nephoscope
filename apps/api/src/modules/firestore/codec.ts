import {
  classifyMap,
  doubleToNumber,
  type FirestoreDocument,
  numberToDouble,
  partsToTimestamp,
  reservedMapOf,
  type TimestampParts,
  type TransformValue,
  timestampToParts,
  type WireFields,
  type WireValue,
} from '@nephoscope/contracts';
import { ProblemException } from '../../core/problem/problem.js';

/**
 * Raw protocol values to wire values and back (SPEC-0004 D-01, D-02, CA-01). The low-level
 * clients return protobuf objects with longs as strings; nothing here goes through `Date`.
 */

// biome-ignore lint/suspicious/noExplicitAny: protobuf messages are loosely typed at this boundary.
type Proto = any;

function bytesToBase64(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
  return '';
}

export function protoTimestampToIso(ts: Proto): string | null {
  if (!ts || ts.seconds === undefined || ts.seconds === null) return null;
  return partsToTimestamp({ seconds: BigInt(String(ts.seconds)), nanos: Number(ts.nanos ?? 0) });
}

export function isoToProtoTimestamp(iso: string): { seconds: string; nanos: number } {
  const parts: TimestampParts | null = timestampToParts(iso);
  if (!parts) throw ProblemException.of('INVALID_ARGUMENT', `"${iso}" is not an RFC 3339 timestamp.`);
  return { seconds: parts.seconds.toString(), nanos: parts.nanos };
}

const VALUE_KEYS = [
  'nullValue',
  'booleanValue',
  'integerValue',
  'doubleValue',
  'timestampValue',
  'stringValue',
  'bytesValue',
  'referenceValue',
  'geoPointValue',
  'arrayValue',
  'mapValue',
] as const;

function valueKind(v: Proto): string | null {
  if (typeof v?.valueType === 'string') return v.valueType;
  for (const k of VALUE_KEYS) if (v?.[k] !== undefined && v[k] !== null) return k;
  const other = Object.keys(v ?? {}).find((k) => k.endsWith('Value'));
  return other ?? null;
}

export function fromProto(v: Proto): WireValue {
  const kind = valueKind(v);
  switch (kind) {
    case 'nullValue':
      return { t: 'null' };
    case 'booleanValue':
      return { t: 'boolean', v: Boolean(v.booleanValue) };
    case 'integerValue':
      return { t: 'integer', v: String(v.integerValue) };
    case 'doubleValue':
      return { t: 'double', v: numberToDouble(Number(v.doubleValue)) };
    case 'timestampValue':
      return { t: 'timestamp', v: protoTimestampToIso(v.timestampValue) ?? '1970-01-01T00:00:00Z' };
    case 'stringValue':
      return { t: 'string', v: String(v.stringValue) };
    case 'bytesValue':
      return { t: 'bytes', v: bytesToBase64(v.bytesValue) };
    case 'referenceValue':
      return { t: 'reference', v: String(v.referenceValue) };
    case 'geoPointValue':
      return { t: 'geopoint', v: { latitude: Number(v.geoPointValue.latitude ?? 0), longitude: Number(v.geoPointValue.longitude ?? 0) } };
    case 'arrayValue':
      return { t: 'array', v: (v.arrayValue.values ?? []).map(fromProto) };
    case 'mapValue':
      return classifyMap(fieldsFromProto(v.mapValue.fields));
    case null:
      return { t: 'null' };
    default:
      // A value type this build does not know, such as an Enterprise-only type: read-only.
      return { t: 'special', kind: kind.replace(/Value$/, ''), v: {} };
  }
}

export function fieldsFromProto(fields: Proto): WireFields {
  const out: WireFields = {};
  for (const [k, v] of Object.entries(fields ?? {}))
    Object.defineProperty(out, k, { value: fromProto(v), enumerable: true, writable: true });
  return out;
}

export function toProto(v: WireValue): Proto {
  switch (v.t) {
    case 'null':
      return { nullValue: 'NULL_VALUE' };
    case 'boolean':
      return { booleanValue: v.v };
    case 'integer':
      return { integerValue: v.v };
    case 'double':
      return { doubleValue: doubleToNumber(v.v) };
    case 'timestamp':
      return { timestampValue: isoToProtoTimestamp(v.v) };
    case 'string':
      return { stringValue: v.v };
    case 'bytes':
      return { bytesValue: Buffer.from(v.v, 'base64') };
    case 'reference':
      return { referenceValue: v.v };
    case 'geopoint':
      return { geoPointValue: { latitude: v.v.latitude, longitude: v.v.longitude } };
    case 'array':
      return { arrayValue: { values: v.v.map(toProto) } };
    case 'map':
      return { mapValue: { fields: fieldsToProto(v.v) } };
    case 'vector':
      return { mapValue: { fields: fieldsToProto(reservedMapOf(v)) } };
    case 'special':
      if (Object.keys(v.v).length === 0)
        throw ProblemException.of('INVALID_ARGUMENT', `Values of type ${v.kind} are read-only in Nephoscope.`);
      return { mapValue: { fields: fieldsToProto(v.v) } };
  }
}

export function fieldsToProto(fields: WireFields): Record<string, Proto> {
  const out: Record<string, Proto> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = toProto(v);
  return out;
}

/** A write transform at a field path (D-05): computed by the server, never by Nephoscope. */
export function transformToProto(fieldPath: string, t: TransformValue): Proto {
  switch (t.op) {
    case 'serverTimestamp':
      return { fieldPath, setToServerValue: 'REQUEST_TIME' };
    case 'increment':
      return { fieldPath, increment: toProto(t.v) };
    case 'maximum':
      return { fieldPath, maximum: toProto(t.v) };
    case 'minimum':
      return { fieldPath, minimum: toProto(t.v) };
    case 'arrayUnion':
      return { fieldPath, appendMissingElements: { values: t.v.map(toProto) } };
    case 'arrayRemove':
      return { fieldPath, removeAllFromArray: { values: t.v.map(toProto) } };
  }
}

/** `projects/p/databases/d/documents` for a database. */
export const documentsRoot = (projectId: string, databaseId: string) => `projects/${projectId}/databases/${databaseId}/documents`;

export function pathFromName(name: string): string {
  return name.replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\/?/, '');
}

export function mapDocument(doc: Proto, missing = false): FirestoreDocument {
  const name = String(doc.name);
  const path = pathFromName(name);
  return {
    name,
    path,
    id: path.split('/').pop() ?? '',
    fields: fieldsFromProto(doc.fields),
    createTime: protoTimestampToIso(doc.createTime),
    updateTime: protoTimestampToIso(doc.updateTime),
    missing,
  };
}

/** Checks that a path names a document (even segment count) or a collection (odd). */
export function assertPath(path: string, kind: 'document' | 'collection'): string {
  const segments = path.split('/');
  const ok = path !== '' && segments.every((s) => s.length > 0) && (segments.length % 2 === 0) === (kind === 'document');
  if (!ok) throw ProblemException.of('INVALID_ARGUMENT', `"${path}" is not a ${kind} path.`);
  return path;
}
