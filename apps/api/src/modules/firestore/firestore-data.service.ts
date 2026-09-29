import { randomInt } from 'node:crypto';
import {
  type Aggregation,
  type AggregationResult,
  type CollectionIdsPage,
  type CreateDocument,
  type DocumentsPage,
  type ExplainMetrics,
  type ExplainMode,
  type FirestoreDatabase,
  type FirestoreDocument,
  fieldPath,
  type ImportBatch,
  type ImportBatchResult,
  type OperationSummary,
  parseFieldPath,
  type QueryResult,
  type QuerySpec,
  type SaveDocument,
  splitTransforms,
  type WireFields,
} from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../../core/credentials/profiles.service.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';
import { structToJson } from '../observability/log-mapping.js';
import {
  assertPath,
  documentsRoot,
  fieldsFromProto,
  fieldsToProto,
  isoToProtoTimestamp,
  mapDocument,
  protoTimestampToIso,
  transformToProto,
} from './codec.js';
import { type DataClient, FirestoreClients } from './firestore-clients.js';
import { mapDatabase } from './firestore-mapping.js';
import { deriveIndex, indexFromErrorMessage } from './index-suggestion.js';
import { nextCursor, toStructuredQuery } from './structured-query.js';

// biome-ignore lint/suspicious/noExplicitAny: protobuf messages are loosely typed at this boundary.
type Proto = any;

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** The 20-character ids the SDKs generate (D-05). */
export function autoId(): string {
  let id = '';
  for (let i = 0; i < 20; i++) id += ID_CHARS.charAt(randomInt(ID_CHARS.length));
  return id;
}

/** Lowest document id, used to bound a collection's descendants (as the SDK's recursive delete does). */
const MIN_ID = '__id-9223372036854775808__';
const DELETE_PAGE = 1000;
const WRITE_BATCH = 500;

function collectStream<T>(stream: NodeJS.ReadableStream & { cancel?: () => void }, signal?: AbortSignal): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const out: T[] = [];
    const abort = () => {
      stream.cancel?.();
      reject(ProblemException.of('CONFLICT', 'Cancelled.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    stream.on('data', (d: T) => out.push(d));
    stream.on('error', (e) => {
      signal?.removeEventListener('abort', abort);
      reject(e);
    });
    stream.on('end', () => {
      signal?.removeEventListener('abort', abort);
      resolve(out);
    });
  });
}

function explainFrom(metrics: Proto): ExplainMetrics | null {
  if (!metrics) return null;
  const stats = metrics.executionStats;
  const duration = stats?.executionDuration;
  return {
    indexesUsed: (metrics.planSummary?.indexesUsed ?? []).map((s: Proto) => structToJson(s)),
    stats: stats
      ? {
          resultsReturned: stats.resultsReturned !== undefined ? String(stats.resultsReturned) : null,
          readOperations: stats.readOperations !== undefined ? String(stats.readOperations) : null,
          executionDuration: duration ? `${Number(duration.seconds ?? 0) + Number(duration.nanos ?? 0) / 1e9}s` : null,
          debugStats: stats.debugStats ? structToJson(stats.debugStats) : null,
        }
      : null,
  };
}

/** Firestore data plane (SPEC-0004 D-04 to D-09, D-15, D-16). */
@Injectable()
export class FirestoreDataService {
  constructor(
    private readonly fs: FirestoreClients,
    private readonly operations: OperationsService,
  ) {}

  private dbName(projectId: string, databaseId: string): string {
    return `projects/${projectId}/databases/${databaseId}`;
  }

  async databases(h: ProfileHandle, projectId: string): Promise<FirestoreDatabase[]> {
    if (this.fs.emulator) {
      // The emulator has no admin API; any database id works in it (D-18).
      return [
        {
          name: this.dbName(projectId, '(default)'),
          id: '(default)',
          locationId: null,
          type: 'native',
          edition: 'standard',
          concurrencyMode: null,
          pointInTimeRecovery: false,
          deleteProtection: false,
          createTime: null,
          earliestVersionTime: null,
          versionRetentionSeconds: null,
          emulator: true,
        },
      ];
    }
    const admin = await this.fs.admin(h.profile.id, 'Listing databases');
    const [res] = await admin.listDatabases({ parent: `projects/${projectId}` });
    return (res.databases ?? []).map(mapDatabase).sort((a: FirestoreDatabase, b: FirestoreDatabase) => {
      if (a.id === '(default)') return -1;
      if (b.id === '(default)') return 1;
      return a.id.localeCompare(b.id);
    });
  }

  async collections(
    h: ProfileHandle,
    projectId: string,
    databaseId: string,
    q: { parent: string; pageSize: number; pageToken?: string },
  ): Promise<CollectionIdsPage> {
    const { client, opts } = await this.fs.data(h.profile.id);
    const root = documentsRoot(projectId, databaseId);
    const parent = q.parent ? `${root}/${assertPath(q.parent, 'document')}` : root;
    const [ids, , res] = await client.listCollectionIds(
      { parent, pageSize: q.pageSize, pageToken: q.pageToken ?? '' },
      { ...opts, autoPaginate: false },
    );
    return { items: [...(ids as string[])].sort(), nextPageToken: res?.nextPageToken || null };
  }

  async documents(
    h: ProfileHandle,
    projectId: string,
    databaseId: string,
    q: { collection: string; pageSize: number; pageToken?: string; showMissing: boolean; orderBy?: string },
  ): Promise<DocumentsPage> {
    const { client, opts } = await this.fs.data(h.profile.id);
    const segments = assertPath(q.collection, 'collection').split('/');
    const collectionId = segments.pop() ?? '';
    const root = documentsRoot(projectId, databaseId);
    const parent = segments.length > 0 ? `${root}/${segments.join('/')}` : root;
    const [docs, , res] = await client.listDocuments(
      {
        parent,
        collectionId,
        pageSize: q.pageSize,
        pageToken: q.pageToken ?? '',
        showMissing: q.showMissing,
        ...(q.orderBy ? { orderBy: q.orderBy } : {}),
      },
      { ...opts, autoPaginate: false },
    );
    return {
      items: (docs as Proto[]).map((d) => mapDocument(d, !d.createTime)),
      nextPageToken: res?.nextPageToken || null,
      readTime: null,
    };
  }

  async get(h: ProfileHandle, projectId: string, databaseId: string, path: string): Promise<FirestoreDocument> {
    const { client, opts } = await this.fs.data(h.profile.id);
    const name = `${documentsRoot(projectId, databaseId)}/${assertPath(path, 'document')}`;
    const [doc] = await client.getDocument({ name }, opts);
    return mapDocument(doc);
  }

  private async commit(dc: DataClient, projectId: string, databaseId: string, writes: Proto[]): Promise<Proto> {
    const [res] = await dc.client.commit({ database: this.dbName(projectId, databaseId), writes }, dc.opts);
    return res;
  }

  private writeFor(name: string, fields: SaveDocument['fields']): { update: Proto; updateTransforms: Proto[] } {
    const split = splitTransforms(fields);
    return {
      update: { name, fields: fieldsToProto(split.fields) },
      updateTransforms: split.transforms.map((t) => transformToProto(fieldPath(t.path), t.transform)),
    };
  }

  async create(h: ProfileHandle, projectId: string, databaseId: string, body: CreateDocument): Promise<FirestoreDocument> {
    const dc = await this.fs.data(h.profile.id);
    const path = `${assertPath(body.collection, 'collection')}/${body.id ?? autoId()}`;
    const name = `${documentsRoot(projectId, databaseId)}/${path}`;
    const write = this.writeFor(name, body.fields);
    await this.commit(dc, projectId, databaseId, [{ ...write, currentDocument: { exists: false } }]);
    this.record(h, projectId, databaseId, 'firestore.document.create', path, `Create ${path}`);
    return this.get(h, projectId, databaseId, path);
  }

  /** Save with the updateTime precondition (D-05, CA-10). */
  async save(h: ProfileHandle, projectId: string, databaseId: string, path: string, body: SaveDocument): Promise<FirestoreDocument> {
    const dc = await this.fs.data(h.profile.id);
    const name = `${documentsRoot(projectId, databaseId)}/${assertPath(path, 'document')}`;
    const write: Proto = this.writeFor(name, body.fields);
    if (body.mask) {
      const transformPaths = new Set(write.updateTransforms.map((t: Proto) => t.fieldPath));
      for (const p of body.mask) {
        if (!parseFieldPath(p)) throw ProblemException.of('INVALID_ARGUMENT', `"${p}" is not a valid field path.`);
      }
      write.updateMask = { fieldPaths: body.mask.filter((p) => !transformPaths.has(p)) };
    }
    write.currentDocument = body.updateTime ? { updateTime: isoToProtoTimestamp(body.updateTime) } : { exists: true };
    if (!body.updateTime && !body.mask) delete write.currentDocument;
    try {
      await this.commit(dc, projectId, databaseId, [write]);
    } catch (err) {
      const problem = toProblem(err);
      if (body.updateTime && (problem.grpcCode === 9 || problem.code === 'FAILED_PRECONDITION'))
        throw ProblemException.of('CONFLICT', 'Changed since you opened it. Reload to see the other change, or overwrite it.', {
          reason: 'DOCUMENT_CHANGED',
          grpcCode: problem.grpcCode,
        });
      throw err;
    }
    this.record(h, projectId, databaseId, 'firestore.document.update', path, `Save ${path}`);
    return this.get(h, projectId, databaseId, path);
  }

  async remove(h: ProfileHandle, projectId: string, databaseId: string, path: string): Promise<void> {
    const dc = await this.fs.data(h.profile.id);
    const name = `${documentsRoot(projectId, databaseId)}/${assertPath(path, 'document')}`;
    await this.commit(dc, projectId, databaseId, [{ delete: name }]);
    this.record(h, projectId, databaseId, 'firestore.document.delete', path, `Delete ${path}`);
  }

  /**
   * Deletes a document and its subcollections, or a whole collection, as a cancellable operation
   * with a running count (D-05, CA-11). Descendants are found by the kindless query the SDK's
   * recursiveDelete uses, and deleted with batchWrite.
   */
  recursiveDelete(
    h: ProfileHandle,
    projectId: string,
    databaseId: string,
    target: { document?: string; collection?: string },
    total: number | null,
  ): OperationSummary {
    const root = documentsRoot(projectId, databaseId);
    const label = target.document ?? target.collection ?? '';
    return this.operations.trackLocal(
      {
        profileId: h.profile.id,
        projectId,
        product: 'firestore',
        kind: target.document ? 'firestore.document.recursiveDelete' : 'firestore.collection.delete',
        resource: {
          name: `${root}/${label}`,
          displayName: `Delete ${label}${target.document ? ' and its subcollections' : ''}`,
          href: null,
        },
      },
      async (report, signal) => {
        const dc = await this.fs.data(h.profile.id);
        let deleted = 0;
        const deleteNames = async (names: string[]) => {
          for (let i = 0; i < names.length; i += WRITE_BATCH) {
            if (signal.aborted) return;
            const writes = names.slice(i, i + WRITE_BATCH).map((n) => ({ delete: n }));
            const [res] = await dc.client.batchWrite({ database: this.dbName(projectId, databaseId), writes }, dc.opts);
            const failed = (res.status ?? []).filter((s: Proto) => s?.code);
            if (failed.length > 0)
              throw ProblemException.of('INTERNAL', `${failed.length} deletes failed: ${failed[0].message ?? 'unknown error'}`);
            deleted += writes.length;
            report(total ? (deleted / total) * 100 : null, `${deleted.toLocaleString('en-US')} documents deleted`);
          }
        };
        let parent: string;
        let collectionId: string | null = null;
        if (target.document) {
          parent = `${root}/${assertPath(target.document, 'document')}`;
        } else {
          const segments = assertPath(target.collection ?? '', 'collection').split('/');
          collectionId = segments.pop() ?? '';
          parent = segments.length > 0 ? `${root}/${segments.join('/')}` : root;
        }
        let after: string | null = null;
        for (;;) {
          if (signal.aborted) break;
          const where: Proto[] = [];
          if (collectionId !== null) {
            where.push(
              {
                fieldFilter: {
                  field: { fieldPath: '__name__' },
                  op: 'GREATER_THAN_OR_EQUAL',
                  value: { referenceValue: `${parent}/${collectionId}/${MIN_ID}` },
                },
              },
              {
                fieldFilter: {
                  field: { fieldPath: '__name__' },
                  op: 'LESS_THAN',
                  value: { referenceValue: `${parent}/${collectionId}\u0000/${MIN_ID}` },
                },
              },
            );
          }
          const structuredQuery: Proto = {
            from: [{ allDescendants: true }],
            select: { fields: [{ fieldPath: '__name__' }] },
            orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
            limit: { value: DELETE_PAGE },
            ...(where.length === 2 ? { where: { compositeFilter: { op: 'AND', filters: where } } } : {}),
            ...(after ? { startAt: { values: [{ referenceValue: after }], before: false } } : {}),
          };
          const rows = await collectStream<Proto>(dc.client.runQuery({ parent, structuredQuery }, dc.opts), signal);
          const names = rows.filter((r) => r.document?.name).map((r) => String(r.document.name));
          if (names.length === 0) break;
          await deleteNames(names);
          after = names.at(-1) ?? null;
          if (names.length < DELETE_PAGE) break;
        }
        if (target.document && !signal.aborted) await deleteNames([`${root}/${target.document}`]);
        return signal.aborted
          ? `Stopped after ${deleted.toLocaleString('en-US')} documents were deleted`
          : `${deleted.toLocaleString('en-US')} documents deleted`;
      },
    );
  }

  private problemWithIndex(err: unknown, spec: QuerySpec): never {
    const problem = toProblem(err);
    if (problem.grpcCode === 9 || problem.code === 'FAILED_PRECONDITION') {
      const message = err instanceof Error ? err.message : problem.detail;
      if (/index/i.test(message)) {
        const decoded = indexFromErrorMessage(message);
        const suggested = decoded ? { ...decoded, derived: false } : { ...deriveIndex(spec), derived: true };
        throw new ProblemException({ ...problem, detail: 'This query needs a composite index.', suggestedIndex: suggested });
      }
    }
    throw err;
  }

  async query(h: ProfileHandle, projectId: string, databaseId: string, spec: QuerySpec, explain?: ExplainMode): Promise<QueryResult> {
    const { client, opts } = await this.fs.data(h.profile.id);
    const { parent, structuredQuery } = toStructuredQuery(documentsRoot(projectId, databaseId), spec);
    try {
      const rows = await collectStream<Proto>(
        client.runQuery({ parent, structuredQuery, ...(explain ? { explainOptions: { analyze: explain === 'analyze' } } : {}) }, opts),
      );
      const documents = rows.filter((r) => r.document).map((r) => mapDocument(r.document));
      const readTime = [...rows].reverse().find((r) => r.readTime)?.readTime;
      const metrics = [...rows].reverse().find((r) => r.explainMetrics)?.explainMetrics;
      return {
        documents,
        readTime: protoTimestampToIso(readTime),
        nextCursor: spec.limit !== undefined && documents.length === spec.limit ? nextCursor(spec, documents.at(-1)) : null,
        explain: explainFrom(metrics),
      };
    } catch (err) {
      this.problemWithIndex(err, spec);
    }
  }

  /** count, sum and avg, typed as Google returns them (D-07). */
  async aggregate(
    h: ProfileHandle,
    projectId: string,
    databaseId: string,
    spec: QuerySpec,
    aggregations: Aggregation[],
    explain?: ExplainMode,
  ): Promise<AggregationResult> {
    const { client, opts } = await this.fs.data(h.profile.id);
    const { parent, structuredQuery } = toStructuredQuery(documentsRoot(projectId, databaseId), spec, false);
    const aggs = aggregations.map((a, i) => {
      const alias = `a${i}`;
      if (a.op === 'count') return { alias, count: a.upTo ? { upTo: { value: a.upTo } } : {} };
      return { alias, [a.op]: { field: { fieldPath: a.field } } };
    });
    try {
      const rows = await collectStream<Proto>(
        client.runAggregationQuery(
          {
            parent,
            structuredAggregationQuery: { structuredQuery, aggregations: aggs },
            ...(explain ? { explainOptions: { analyze: explain === 'analyze' } } : {}),
          },
          opts,
        ),
      );
      const result = rows.find((r) => r.result)?.result;
      const fields = result ? fieldsFromProto(result.aggregateFields) : ({} as WireFields);
      return {
        values: aggs.map((a) => fields[a.alias] ?? { t: 'null' }),
        readTime: protoTimestampToIso([...rows].reverse().find((r) => r.readTime)?.readTime),
        explain: explainFrom([...rows].reverse().find((r) => r.explainMetrics)?.explainMetrics),
      };
    } catch (err) {
      this.problemWithIndex(err, spec);
    }
  }

  /** Documents in a collection, for the typed confirmation of a collection delete (D-05). */
  async count(h: ProfileHandle, projectId: string, databaseId: string, collection: string): Promise<number> {
    const r = await this.aggregate(h, projectId, databaseId, { source: { kind: 'collection', path: collection }, orderBy: [] }, [
      { op: 'count' },
    ]);
    const v = r.values[0];
    return v?.t === 'integer' ? Number(v.v) : 0;
  }

  /** One batch of a browser import (D-16); the page sends batches in order and can stop between them. */
  async importBatch(h: ProfileHandle, projectId: string, databaseId: string, body: ImportBatch): Promise<ImportBatchResult> {
    const dc = await this.fs.data(h.profile.id);
    const root = documentsRoot(projectId, databaseId);
    const collection = assertPath(body.collection, 'collection');
    const docs = body.documents.map((d) => {
      const id = d.id ?? autoId();
      if (id.includes('/')) throw ProblemException.of('INVALID_ARGUMENT', `The id "${id}" contains a slash.`);
      return { id, name: `${root}/${collection}/${id}`, fields: d.fields };
    });
    const writes = docs.map((d) => {
      const w: Proto = { update: { name: d.name, fields: fieldsToProto(d.fields) } };
      if (body.mode === 'skip') w.currentDocument = { exists: false };
      if (body.mode === 'merge') w.updateMask = { fieldPaths: Object.keys(d.fields).map((k) => fieldPath([k])) };
      return w;
    });
    const [res] = await dc.client.batchWrite({ database: this.dbName(projectId, databaseId), writes }, dc.opts);
    const out: ImportBatchResult = { written: 0, skipped: 0, failures: [] };
    (res.status ?? []).forEach((s: Proto, i: number) => {
      const code = Number(s?.code ?? 0);
      if (code === 0) out.written++;
      else if (body.mode === 'skip' && code === 6) out.skipped++;
      else out.failures.push({ id: docs[i]?.id ?? '', error: String(s.message ?? `Error ${code}`) });
    });
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'firestore',
      kind: 'firestore.import.batch',
      resource: { name: `${root}/${collection}`, displayName: `Import ${out.written} documents into ${collection}`, href: null },
    });
    return out;
  }

  private record(h: ProfileHandle, projectId: string, databaseId: string, kind: string, path: string, displayName: string): void {
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId,
      product: 'firestore',
      kind,
      resource: {
        name: `${documentsRoot(projectId, databaseId)}/${path}`,
        displayName,
        href: `/p/${projectId}/firestore/${encodeURIComponent(databaseId)}/data?path=${encodeURIComponent(path)}`,
      },
    });
  }
}
