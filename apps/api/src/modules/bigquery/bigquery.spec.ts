import { describe, expect, it, vi } from 'vitest';
import { detectOperation, readOperation } from '../../core/gcp/rest-ops.js';
import { fakeHandle } from '../../testing/fake-handle.js';
import { csvCell, mapJobDetail, mapTable } from './bigquery.mapping.js';
import { BigQueryService } from './bigquery.module.js';

const restOps = { track: vi.fn((_h: unknown, input: { kind: string }) => ({ id: 'op', family: 'bigquery', kind: input.kind })) };
const service = (readOnly = false) => new BigQueryService(restOps as never, { recordInstant: () => ({}) } as never, { readOnly } as never);

describe('BigQuery (SPEC-0008)', () => {
  it('prices a query and reports errors with their position instead of failing (D-02)', async () => {
    const ok = fakeHandle({ 'projects/demo/jobs': { statistics: { query: { totalBytesProcessed: '1048576', statementType: 'SELECT' } } } });
    expect(await service().dryRun(ok.h, 'demo', { query: 'SELECT 1', params: [] })).toMatchObject({
      ok: true,
      totalBytesProcessed: '1048576',
      statementType: 'SELECT',
    });
    expect(ok.calls[0]?.data).toMatchObject({ configuration: { dryRun: true, query: { query: 'SELECT 1', useLegacySql: false } } });

    const bad = fakeHandle({});
    bad.h.auth.request = vi.fn(async () => {
      throw Object.assign(new Error('bad'), {
        response: { status: 400, data: { error: { code: 400, message: 'Syntax error: Unexpected identifier "FORM" at [2:1]' } } },
      });
    }) as never;
    const r = await service().dryRun(bad.h, 'demo', { query: 'SELECT 1\nFORM t', params: [] });
    expect(r).toMatchObject({ ok: false, error: { line: 2, column: 1 } });
    expect(r.error?.message).toContain('Syntax error');
  });

  it('runs every query with a ceiling on bytes billed, as a cancellable job (D-02, D-04)', async () => {
    const { h, calls } = fakeHandle({
      'projects/demo/jobs': {
        kind: 'bigquery#job',
        jobReference: { projectId: 'demo', jobId: 'j1', location: 'US' },
        status: { state: 'RUNNING' },
      },
    });
    const r = await service().run(h, 'demo', { query: 'SELECT 1', params: [], maximumBytesBilled: '10737418240' });
    expect(r.job).toEqual({ projectId: 'demo', jobId: 'j1', location: 'US' });
    expect(calls[0]?.data).toMatchObject({
      configuration: { query: { maximumBytesBilled: '10737418240' }, labels: { client: 'nephoscope' } },
    });
    expect(restOps.track).toHaveBeenCalledWith(h, expect.objectContaining({ product: 'bigquery', cancel: expect.any(Function) }));
  });

  it('lets a read-only profile run only a SELECT without a destination (T-14)', async () => {
    const dml = fakeHandle({ 'projects/demo/jobs': { statistics: { query: { statementType: 'DELETE' } } } });
    (dml.h.profile as { readOnly?: boolean }).readOnly = true;
    await expect(
      service().run(dml.h, 'demo', { query: 'DELETE FROM t WHERE TRUE', params: [], maximumBytesBilled: '1' }),
    ).rejects.toMatchObject({
      problem: { code: 'READ_ONLY' },
    });
    expect(dml.calls).toHaveLength(1);

    const select = fakeHandle({
      'projects/demo/jobs': (c: { data?: { configuration?: { dryRun?: boolean } } }) =>
        c.data?.configuration?.dryRun
          ? { statistics: { query: { statementType: 'SELECT' } } }
          : { kind: 'bigquery#job', jobReference: { projectId: 'demo', jobId: 'j2', location: 'US' } },
    });
    (select.h.profile as { readOnly?: boolean }).readOnly = true;
    await expect(service().run(select.h, 'demo', { query: 'SELECT 1', params: [], maximumBytesBilled: '1' })).resolves.toMatchObject({
      job: { jobId: 'j2' },
    });
    await expect(
      service(true).run(select.h, 'demo', {
        query: 'SELECT 1',
        params: [],
        maximumBytesBilled: '1',
        destination: { datasetId: 'd', tableId: 't', writeDisposition: 'WRITE_EMPTY' },
      }),
    ).rejects.toMatchObject({ problem: { code: 'READ_ONLY' } });
  });

  it('refuses a read-only run when the dry run cannot check the query (fail closed)', async () => {
    const { h, calls } = fakeHandle({});
    (h.profile as { readOnly?: boolean }).readOnly = true;
    h.auth.request = vi.fn(async (o: { url: string; data?: unknown }) => {
      calls.push(o as never);
      throw Object.assign(new Error('denied'), {
        response: {
          status: 403,
          data: { error: { code: 403, message: 'Access Denied: Table p:d.t: Permission bigquery.tables.updateData denied' } },
        },
      });
    }) as never;
    await expect(
      service().run(h, 'demo', { query: 'DELETE FROM `p.d.t` WHERE TRUE', params: [], maximumBytesBilled: '1' }),
    ).rejects.toMatchObject({
      problem: { code: 'READ_ONLY' },
    });
    // Only the dry run was sent; no job was inserted.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.data).toMatchObject({ configuration: { dryRun: true } });
  });

  it('follows jobs as the bigquery operation family', () => {
    const op = detectOperation({ kind: 'bigquery#job', jobReference: { projectId: 'demo', jobId: 'j1', location: 'EU' } }, '');
    expect(op).toEqual({ family: 'bigquery', url: 'https://bigquery.googleapis.com/bigquery/v2/projects/demo/jobs/j1?location=EU' });
    expect(readOperation('bigquery', { status: { state: 'RUNNING' } })).toEqual({ done: false, message: 'running' });
    expect(readOperation('bigquery', { status: { state: 'DONE' } })).toEqual({ done: true });
    expect(
      readOperation('bigquery', { status: { state: 'DONE', errorResult: { reason: 'stopped', message: 'Job cancelled' } } }),
    ).toMatchObject({
      done: true,
      cancelled: true,
    });
    const limit = readOperation('bigquery', {
      status: { state: 'DONE', errorResult: { reason: 'bytesBilledLimitExceeded', message: 'Query exceeded limit for bytes billed' } },
    });
    expect(limit.error?.status).toBe(400);
  });

  it('asks for the number of tables before deleting a dataset with tables (D-01)', async () => {
    const { h, calls } = fakeHandle({
      'datasets/sales/tables': { tables: [{ tableReference: { tableId: 'a' } }, { tableReference: { tableId: 'b' } }] },
    });
    await expect(service().deleteDataset(h, 'demo', 'demo', 'sales', { confirm: 'sales' })).rejects.toMatchObject({
      problem: { code: 'FAILED_PRECONDITION' },
    });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('maps table metadata and job plans', () => {
    const t = mapTable({
      tableReference: { projectId: 'p', datasetId: 'd', tableId: 't' },
      type: 'TABLE',
      creationTime: '1700000000000',
      numRows: '42',
      numBytes: '2048',
      timePartitioning: { type: 'DAY', field: 'created' },
      clustering: { fields: ['country'] },
      schema: { fields: [{ name: 'tags', type: 'RECORD', mode: 'REPEATED', fields: [{ name: 'k', type: 'STRING' }] }] },
    });
    expect(t).toMatchObject({ createTime: '2023-11-14T22:13:20.000Z', partitioning: 'DAY on created', clustering: ['country'] });
    expect(t.schema[0]).toMatchObject({ name: 'tags', type: 'STRUCT', mode: 'REPEATED', fields: [{ name: 'k', type: 'STRING' }] });
    const j = mapJobDetail({
      jobReference: { projectId: 'p', jobId: 'j', location: 'US' },
      configuration: { query: { query: 'SELECT 1', destinationTable: { projectId: 'p', datasetId: '_anon', tableId: 'anon1' } } },
      status: { state: 'DONE' },
      statistics: {
        totalSlotMs: '120',
        query: {
          totalBytesBilled: '10485760',
          cacheHit: false,
          queryPlan: [{ name: 'S00: Input', status: 'COMPLETE', recordsRead: '10' }],
        },
      },
    });
    expect(j).toMatchObject({
      type: 'QUERY',
      totalSlotMs: '120',
      cacheHit: false,
      destination: { tableId: 'anon1' },
      stages: [{ name: 'S00: Input', recordsRead: '10' }],
    });
  });

  it('writes CSV cells safely', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell({ k: '1' })).toBe('"{""k"":""1""}"');
  });
});
