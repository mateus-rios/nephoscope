import {
  type DatastoreEntity,
  type DatastoreKey,
  type DatastoreProperty,
  doubleToNumber,
  numberToDouble,
  type WireValue,
} from '@nephoscope/contracts';
import { ProblemException } from '../../core/problem/problem.js';
import { isoToProtoTimestamp, protoTimestampToIso } from '../firestore/codec.js';

/** Datastore protocol values to wire values and back (SPEC-0004 D-13). Keys print as GQL KEY(...) literals. */

// biome-ignore lint/suspicious/noExplicitAny: protobuf messages are loosely typed at this boundary.
type Proto = any;

const quote = (s: string) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const quoteKind = (k: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `\`${k.replaceAll('\\', '\\\\').replaceAll('`', '\\`')}\``);

/** KEY(Kind, 'name', Child, 123), the GQL key literal. */
export function keyToString(key: DatastoreKey): string {
  return `KEY(${key.path.map((p) => `${quoteKind(p.kind)}, ${p.id ?? quote(p.name ?? '')}`).join(', ')})`;
}

/** Parses a GQL key literal; the namespace comes from the entity that holds it. */
export function parseKey(text: string, namespace: string): DatastoreKey {
  const m = /^\s*KEY\s*\((.*)\)\s*$/is.exec(text);
  if (!m?.[1]) throw ProblemException.of('INVALID_ARGUMENT', `"${text}" is not a key. Write KEY(Kind, 'name') or KEY(Kind, 123).`);
  const tokens: string[] = [];
  const body = m[1];
  let i = 0;
  while (i < body.length) {
    const c = body.charAt(i);
    if (c === ' ' || c === ',' || c === '\n' || c === '\t') {
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let out = '';
      i++;
      while (i < body.length && body.charAt(i) !== c) {
        if (body.charAt(i) === '\\' && i + 1 < body.length) i++;
        out += body.charAt(i);
        i++;
      }
      i++;
      tokens.push(`${c}${out}`);
      continue;
    }
    let out = '';
    while (i < body.length && !', \n\t'.includes(body.charAt(i))) out += body.charAt(i++);
    tokens.push(out);
  }
  if (tokens.length === 0 || tokens.length % 2 !== 0) throw ProblemException.of('INVALID_ARGUMENT', `"${text}" needs kind and id pairs.`);
  const path: DatastoreKey['path'] = [];
  for (let j = 0; j < tokens.length; j += 2) {
    const kindToken = tokens[j] ?? '';
    const idToken = tokens[j + 1] ?? '';
    const kind = kindToken.startsWith('`') || kindToken.startsWith("'") || kindToken.startsWith('"') ? kindToken.slice(1) : kindToken;
    if (idToken.startsWith("'") || idToken.startsWith('"')) path.push({ kind, id: null, name: idToken.slice(1) });
    else if (/^\d{1,19}$/.test(idToken)) path.push({ kind, id: idToken, name: null });
    else throw ProblemException.of('INVALID_ARGUMENT', `"${idToken}" is not an id or a quoted name.`);
  }
  return { namespace, path };
}

export function keyFromProto(k: Proto): DatastoreKey {
  return {
    namespace: String(k?.partitionId?.namespaceId ?? ''),
    path: (k?.path ?? []).map((p: Proto) => {
      const hasName = p.idType === 'name' || (p.name !== undefined && p.name !== null && p.name !== '');
      return {
        kind: String(p.kind),
        id: hasName ? null : p.id !== undefined && p.id !== null ? String(p.id) : null,
        name: hasName ? String(p.name) : null,
      };
    }),
  };
}

export function keyToProto(key: DatastoreKey, projectId: string, databaseId: string): Proto {
  return {
    partitionId: { projectId, databaseId: databaseId === '(default)' ? '' : databaseId, namespaceId: key.namespace },
    path: key.path.map((p) =>
      p.name !== null ? { kind: p.kind, name: p.name } : p.id !== null ? { kind: p.kind, id: p.id } : { kind: p.kind },
    ),
  };
}

function kindOf(v: Proto): string | null {
  if (typeof v?.valueType === 'string') return v.valueType;
  for (const k of [
    'nullValue',
    'booleanValue',
    'integerValue',
    'doubleValue',
    'timestampValue',
    'keyValue',
    'stringValue',
    'blobValue',
    'geoPointValue',
    'entityValue',
    'arrayValue',
  ])
    if (v?.[k] !== undefined && v[k] !== null) return k;
  return null;
}

export function valueFromProto(v: Proto): WireValue {
  switch (kindOf(v)) {
    case 'booleanValue':
      return { t: 'boolean', v: Boolean(v.booleanValue) };
    case 'integerValue':
      return { t: 'integer', v: String(v.integerValue) };
    case 'doubleValue':
      return { t: 'double', v: numberToDouble(Number(v.doubleValue)) };
    case 'timestampValue':
      return { t: 'timestamp', v: protoTimestampToIso(v.timestampValue) ?? '1970-01-01T00:00:00Z' };
    case 'keyValue':
      return { t: 'reference', v: keyToString(keyFromProto(v.keyValue)) };
    case 'stringValue':
      return { t: 'string', v: String(v.stringValue) };
    case 'blobValue':
      return { t: 'bytes', v: Buffer.from(v.blobValue ?? []).toString('base64') };
    case 'geoPointValue':
      return { t: 'geopoint', v: { latitude: Number(v.geoPointValue.latitude ?? 0), longitude: Number(v.geoPointValue.longitude ?? 0) } };
    case 'entityValue': {
      const props = v.entityValue?.properties ?? {};
      return { t: 'map', v: Object.fromEntries(Object.entries(props).map(([k, x]) => [k, valueFromProto(x)])) };
    }
    case 'arrayValue':
      return { t: 'array', v: (v.arrayValue?.values ?? []).map(valueFromProto) };
    default:
      return { t: 'null' };
  }
}

export function valueToProto(v: WireValue, ctx: { projectId: string; databaseId: string; namespace: string }): Proto {
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
      return { blobValue: Buffer.from(v.v, 'base64') };
    case 'reference':
      return { keyValue: keyToProto(parseKey(v.v, ctx.namespace), ctx.projectId, ctx.databaseId) };
    case 'geopoint':
      return { geoPointValue: v.v };
    case 'array':
      return { arrayValue: { values: v.v.map((x) => valueToProto(x, ctx)) } };
    case 'map':
      return { entityValue: { properties: Object.fromEntries(Object.entries(v.v).map(([k, x]) => [k, valueToProto(x, ctx)])) } };
    case 'vector':
    case 'special':
      throw ProblemException.of('INVALID_ARGUMENT', 'Datastore has no vector values.');
  }
}

export function entityFromProto(e: Proto): DatastoreEntity {
  const properties: Record<string, DatastoreProperty> = {};
  for (const [k, v] of Object.entries(e?.properties ?? {}))
    properties[k] = { value: valueFromProto(v), excludeFromIndexes: Boolean((v as Proto)?.excludeFromIndexes) };
  return { key: keyFromProto(e.key), properties };
}

export function entityToProto(entity: DatastoreEntity, projectId: string, databaseId: string): Proto {
  const ctx = { projectId, databaseId, namespace: entity.key.namespace };
  const properties: Record<string, Proto> = {};
  for (const [k, p] of Object.entries(entity.properties))
    properties[k] = { ...valueToProto(p.value, ctx), excludeFromIndexes: p.excludeFromIndexes };
  return { key: keyToProto(entity.key, projectId, databaseId), properties };
}
