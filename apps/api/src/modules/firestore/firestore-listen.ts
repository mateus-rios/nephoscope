import {
  type FirestoreDocument,
  type FirestoreListenParams,
  FirestoreListenParamsSchema,
  type FirestoreListenUpdate,
  parseFieldPath,
  partsToTimestamp,
  type QueryFilter,
  type QuerySpec,
  timestampToParts,
  type WireValue,
} from '@nephoscope/contracts';
import type { LiveChannelProvider, LiveHandle, LiveSink } from '../../core/live/live.types.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';
import { fieldsFromProto, pathFromName } from './codec.js';
import type { FirestoreClients } from './firestore-clients.js';
import { NAME_FIELD } from './structured-query.js';

/**
 * Live mode (SPEC-0004 D-10, CA-15): the high-level listener, one per (profile, database, query)
 * shared by every subscriber, pausing only after the tab is hidden for 60 seconds.
 */

// biome-ignore lint/suspicious/noExplicitAny: the Firestore SDK classes are loaded lazily.
type Any = any;

const OPS: Record<string, string> = {
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
  '==': '==',
  '!=': '!=',
  'array-contains': 'array-contains',
  in: 'in',
  'array-contains-any': 'array-contains-any',
  'not-in': 'not-in',
};

function sdkTimestamp(ts: Any): string | null {
  if (!ts) return null;
  return partsToTimestamp({ seconds: BigInt(ts.seconds), nanos: Number(ts.nanoseconds ?? 0) });
}

/** Wire values to the SDK's types, for filter operands and cursors. */
function toSdkValue(m: Any, db: Any, v: WireValue): unknown {
  switch (v.t) {
    case 'null':
      return null;
    case 'boolean':
    case 'string':
      return v.v;
    case 'integer':
      return BigInt(v.v);
    case 'double':
      return v.v === 'NaN'
        ? Number.NaN
        : v.v === 'Infinity'
          ? Number.POSITIVE_INFINITY
          : v.v === '-Infinity'
            ? Number.NEGATIVE_INFINITY
            : v.v === '-0'
              ? -0
              : v.v;
    case 'timestamp': {
      const p = timestampToParts(v.v);
      if (!p) throw ProblemException.of('INVALID_ARGUMENT', `Invalid timestamp ${v.v}`);
      return new m.Timestamp(Number(p.seconds), p.nanos);
    }
    case 'bytes':
      return Buffer.from(v.v, 'base64');
    case 'reference':
      return db.doc(pathFromName(v.v));
    case 'geopoint':
      return new m.GeoPoint(v.v.latitude, v.v.longitude);
    case 'array':
      return v.v.map((x) => toSdkValue(m, db, x));
    case 'map':
      return Object.fromEntries(Object.entries(v.v).map(([k, x]) => [k, toSdkValue(m, db, x)]));
    case 'vector':
      return m.FieldValue.vector(v.v);
    case 'special':
      throw ProblemException.of('INVALID_ARGUMENT', `Values of type ${v.kind} cannot be used in live mode.`);
  }
}

function sdkField(m: Any, path: string): Any {
  if (path === NAME_FIELD) return m.FieldPath.documentId();
  const segments = parseFieldPath(path);
  if (!segments) throw ProblemException.of('INVALID_ARGUMENT', `"${path}" is not a valid field path.`);
  return new m.FieldPath(...segments);
}

function sdkFilter(m: Any, db: Any, f: QueryFilter): Any {
  if (f.kind === 'and' || f.kind === 'or') {
    const parts = f.filters.map((x) => sdkFilter(m, db, x));
    return f.kind === 'and' ? m.Filter.and(...parts) : m.Filter.or(...parts);
  }
  const field = sdkField(m, f.field);
  if (f.kind === 'unary') {
    const operand = f.op === 'is-null' || f.op === 'is-not-null' ? null : Number.NaN;
    return m.Filter.where(field, f.op.startsWith('is-not') ? '!=' : '==', operand);
  }
  const value = f.field === NAME_FIELD && f.value.t === 'string' ? f.value.v : toSdkValue(m, db, f.value);
  return m.Filter.where(field, OPS[f.op], value);
}

/** QuerySpec to the SDK's Query (the listener cannot take a raw StructuredQuery). */
export function toSdkQuery(m: Any, db: Any, spec: QuerySpec): Any {
  let q: Any;
  if (spec.source.kind === 'collection') q = db.collection(spec.source.path);
  else if (!spec.source.parent) q = db.collectionGroup(spec.source.collectionId);
  else throw ProblemException.of('INVALID_ARGUMENT', 'Live mode works on a collection or a collection group across the database.');
  if (spec.findNearest) throw ProblemException.of('INVALID_ARGUMENT', 'Vector search cannot run in live mode.');
  if (spec.where) q = q.where(sdkFilter(m, db, spec.where));
  for (const o of spec.orderBy) q = q.orderBy(sdkField(m, o.field), o.direction);
  const cursor = (values: WireValue[]) => values.map((v) => toSdkValue(m, db, v));
  if (spec.start) q = spec.start.mode === 'at' ? q.startAt(...cursor(spec.start.values)) : q.startAfter(...cursor(spec.start.values));
  if (spec.end) q = spec.end.mode === 'at' ? q.endAt(...cursor(spec.end.values)) : q.endBefore(...cursor(spec.end.values));
  if (spec.select) q = q.select(...spec.select.map((s) => sdkField(m, s)));
  if (spec.limit) q = q.limit(spec.limit);
  return q;
}

function mapSnapshotDoc(d: Any): FirestoreDocument {
  const name = String(d.ref.formattedName);
  const path = pathFromName(name);
  return {
    name,
    path,
    id: String(d.id),
    // The raw protocol fields, so live rows use the same exact codec as every other read.
    fields: fieldsFromProto(d._fieldsProto ?? {}),
    createTime: sdkTimestamp(d.createTime),
    updateTime: sdkTimestamp(d.updateTime),
    missing: false,
  };
}

interface Shared {
  sinks: Set<LiveSink>;
  docs: FirestoreDocument[];
  readTime: string | null;
  ready: boolean;
  stop: () => void;
}

export function firestoreListenChannel(fs: FirestoreClients, load: () => Promise<Any>): LiveChannelProvider<FirestoreListenParams> {
  const shared = new Map<string, Shared>();
  return {
    channel: 'firestore.listen',
    params: FirestoreListenParamsSchema as never,
    // Reopening reads every matching document again, so a hidden tab keeps listening for 60 s.
    pauseGraceMs: 60_000,
    async open(ctx, sink): Promise<LiveHandle> {
      if (!ctx.projectId) throw ProblemException.of('INVALID_ARGUMENT', 'Live mode needs a project.');
      const params = FirestoreListenParamsSchema.parse(ctx.params);
      const key = JSON.stringify([ctx.profile.profile.id, ctx.projectId, params.database, params.query]);
      let entry = shared.get(key);
      if (entry) {
        entry.sinks.add(sink);
        // A new subscriber gets the current rows at no extra read cost.
        if (entry.ready)
          sink.data({
            readTime: entry.readTime,
            initial: true,
            reads: 0,
            changes: entry.docs.map((document, i) => ({ type: 'added', document, oldIndex: -1, newIndex: i })),
          } satisfies FirestoreListenUpdate);
      } else {
        const m = await load();
        const db = await fs.sdk(ctx.profile.profile.id, ctx.projectId, params.database);
        const query = toSdkQuery(m, db, params.query);
        const created: Shared = { sinks: new Set([sink]), docs: [], readTime: null, ready: false, stop: () => {} };
        entry = created;
        shared.set(key, created);
        created.stop = query.onSnapshot(
          (snap: Any) => {
            const initial = !created.ready;
            const changes = snap.docChanges().map((c: Any) => ({
              type: c.type as 'added' | 'modified' | 'removed',
              document: mapSnapshotDoc(c.doc),
              oldIndex: c.oldIndex,
              newIndex: c.newIndex,
            }));
            created.docs = snap.docs.map(mapSnapshotDoc);
            created.readTime = sdkTimestamp(snap.readTime);
            created.ready = true;
            // The first snapshot bills one read per document (at least one); each change after that, one.
            const update: FirestoreListenUpdate = {
              readTime: created.readTime,
              initial,
              changes,
              reads: initial ? Math.max(1, snap.size) : changes.length,
            };
            for (const s of created.sinks) s.data(update);
          },
          (err: unknown) => {
            shared.delete(key);
            for (const s of created.sinks) s.error(toProblem(err));
          },
        );
      }
      const e = entry;
      return {
        close() {
          e.sinks.delete(sink);
          if (e.sinks.size === 0) {
            e.stop();
            shared.delete(key);
          }
        },
      };
    },
  };
}
