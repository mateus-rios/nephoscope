import {
  type BqDatasetSummary,
  type BqDatasetView,
  type BqField,
  type BqJobDetail,
  type BqJobSummary,
  type BqParam,
  type BqTableSummary,
  type BqTableView,
  type BqValue,
  bqTypeName,
} from '@nephoscope/contracts';

// biome-ignore lint/suspicious/noExplicitAny: BigQuery REST resources are read field by field.
type Any = any;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
/** BigQuery times are milliseconds since the epoch, as strings. */
export const msTime = (v: unknown): string | null => (typeof v === 'string' && /^\d+$/.test(v) ? new Date(Number(v)).toISOString() : null);

export function mapField(f: Any): BqField {
  return {
    name: String(f?.name ?? ''),
    type: bqTypeName(String(f?.type ?? 'STRING')),
    mode: f?.mode === 'REPEATED' ? 'REPEATED' : f?.mode === 'REQUIRED' ? 'REQUIRED' : 'NULLABLE',
    description: str(f?.description),
    policyTags: ((f?.policyTags?.names ?? []) as Any[]).map(String),
    fields: ((f?.fields ?? []) as Any[]).map(mapField),
  };
}

export function mapDatasetSummary(d: Any): BqDatasetSummary {
  return {
    projectId: String(d?.datasetReference?.projectId ?? ''),
    datasetId: String(d?.datasetReference?.datasetId ?? ''),
    location: String(d?.location ?? ''),
    labels: (d?.labels ?? {}) as Record<string, string>,
  };
}

export function mapDataset(d: Any): BqDatasetView {
  return {
    ...mapDatasetSummary(d),
    description: str(d?.description),
    defaultTableExpirationMs: str(d?.defaultTableExpirationMs),
    createTime: msTime(d?.creationTime),
    modifiedTime: msTime(d?.lastModifiedTime),
    etag: str(d?.etag),
  };
}

export function mapTableSummary(t: Any): BqTableSummary {
  return {
    projectId: String(t?.tableReference?.projectId ?? ''),
    datasetId: String(t?.tableReference?.datasetId ?? ''),
    tableId: String(t?.tableReference?.tableId ?? ''),
    type: String(t?.type ?? 'TABLE'),
    createTime: msTime(t?.creationTime),
    expirationTime: msTime(t?.expirationTime),
  };
}

export function mapTable(t: Any): BqTableView {
  const p = t?.timePartitioning;
  const r = t?.rangePartitioning;
  return {
    ...mapTableSummary(t),
    location: str(t?.location),
    description: str(t?.description),
    labels: (t?.labels ?? {}) as Record<string, string>,
    schema: ((t?.schema?.fields ?? []) as Any[]).map(mapField),
    numRows: str(t?.numRows),
    logicalBytes: str(t?.numBytes),
    physicalBytes: str(t?.numTotalPhysicalBytes) ?? str(t?.numPhysicalBytes),
    longTermBytes: str(t?.numLongTermBytes),
    partitioning: p
      ? `${p.type ?? 'DAY'} on ${p.field ?? '_PARTITIONTIME'}`
      : r
        ? `Integer range on ${r.field} (${r.range?.start} to ${r.range?.end} by ${r.range?.interval})`
        : null,
    clustering: ((t?.clustering?.fields ?? []) as Any[]).map(String),
    modifiedTime: msTime(t?.lastModifiedTime),
    viewQuery: str(t?.view?.query),
    materializedQuery: str(t?.materializedView?.query),
    externalUris: ((t?.externalDataConfiguration?.sourceUris ?? []) as Any[]).map(String),
    etag: str(t?.etag),
  };
}

export function mapJob(j: Any, full = false): BqJobSummary {
  const config = j?.configuration ?? {};
  const type = config.query
    ? 'QUERY'
    : config.load
      ? 'LOAD'
      : config.extract
        ? 'EXTRACT'
        : config.copy
          ? 'COPY'
          : String(config.jobType ?? 'UNKNOWN');
  const q = str(config.query?.query);
  const stats = j?.statistics ?? {};
  return {
    projectId: String(j?.jobReference?.projectId ?? ''),
    jobId: String(j?.jobReference?.jobId ?? ''),
    location: String(j?.jobReference?.location ?? ''),
    type,
    state: String(j?.status?.state ?? j?.state ?? ''),
    user: str(j?.user_email),
    createTime: msTime(stats.creationTime),
    startTime: msTime(stats.startTime),
    endTime: msTime(stats.endTime),
    query: q && !full && q.length > 500 ? `${q.slice(0, 500)}…` : q,
    totalBytesProcessed: str(stats.query?.totalBytesProcessed ?? stats.totalBytesProcessed),
    totalBytesBilled: str(stats.query?.totalBytesBilled),
    cacheHit: typeof stats.query?.cacheHit === 'boolean' ? stats.query.cacheHit : null,
    error: str(j?.status?.errorResult?.message ?? j?.errorResult?.message),
  };
}

export function mapJobDetail(j: Any): BqJobDetail {
  const stats = j?.statistics ?? {};
  const dest = j?.configuration?.query?.destinationTable;
  return {
    ...mapJob(j, true),
    totalSlotMs: str(stats.totalSlotMs ?? stats.query?.totalSlotMs),
    statementType: str(stats.query?.statementType),
    destination: dest ? { projectId: String(dest.projectId), datasetId: String(dest.datasetId), tableId: String(dest.tableId) } : null,
    stages: ((stats.query?.queryPlan ?? []) as Any[]).map((s) => ({
      name: String(s?.name ?? ''),
      status: str(s?.status),
      recordsRead: str(s?.recordsRead),
      recordsWritten: str(s?.recordsWritten),
      slotMs: str(s?.slotMs),
    })),
    errors: ((j?.status?.errors ?? []) as Any[]).map((e) => String(e?.message ?? '')).filter(Boolean),
  };
}

/** Named query parameters in the REST form. */
export function queryParameters(params: readonly BqParam[]) {
  return params.map((p) => ({ name: p.name, parameterType: { type: p.type }, parameterValue: { value: p.value } }));
}

/** One CSV cell: nested values as JSON, null as empty, quoted when needed. */
export function csvCell(v: BqValue): string {
  if (v === null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
