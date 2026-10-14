import type {
  LogBucket,
  LogBucketLink,
  LogExclusionView,
  LogMetric,
  LogSink,
  LogView,
  SaveLogMetric,
  SaveSink,
  SinkDestinationKind,
} from '@nephoscope/contracts';

// biome-ignore lint/suspicious/noExplicitAny: Logging REST resources are read field by field.
type Any = any;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const short = (name: string): string => name.split('/').pop() ?? name;

export function destinationKind(destination: string): SinkDestinationKind {
  if (destination.startsWith('storage.googleapis.com/')) return 'storage';
  if (destination.startsWith('bigquery.googleapis.com/')) return 'bigquery';
  if (destination.startsWith('pubsub.googleapis.com/')) return 'pubsub';
  if (/^logging\.googleapis\.com\/projects\/[^/]+\/locations\/[^/]+\/buckets\//.test(destination)) return 'logbucket';
  if (/^logging\.googleapis\.com\/projects\/[^/]+$/.test(destination)) return 'project';
  return 'other';
}

/** The role a sink's writer identity needs on its destination (SPEC-0005 D-05, CA-06). */
export function requiredRole(kind: SinkDestinationKind): string | null {
  switch (kind) {
    case 'storage':
      return 'roles/storage.objectCreator';
    case 'bigquery':
      return 'roles/bigquery.dataEditor';
    case 'pubsub':
      return 'roles/pubsub.publisher';
    case 'logbucket':
      return 'roles/logging.bucketWriter';
    case 'project':
      return 'roles/logging.logWriter';
    default:
      return null;
  }
}

export function mapExclusion(e: Any): LogExclusionView {
  return { name: String(e?.name ?? ''), description: str(e?.description), filter: String(e?.filter ?? ''), disabled: !!e?.disabled };
}

export function mapSink(s: Any): LogSink {
  const destination = String(s?.destination ?? '');
  const kind = destinationKind(destination);
  const name = String(s?.name ?? '');
  const writer = str(s?.writerIdentity);
  return {
    name,
    destination,
    destinationKind: kind,
    filter: String(s?.filter ?? ''),
    description: str(s?.description),
    disabled: !!s?.disabled,
    writerIdentity: writer,
    requiredRole: writer ? requiredRole(kind) : null,
    exclusions: Array.isArray(s?.exclusions) ? s.exclusions.map(mapExclusion) : [],
    builtIn: name === '_Required' || name === '_Default' ? name : null,
    createTime: str(s?.createTime),
    updateTime: str(s?.updateTime),
  };
}

export function sinkBody(b: SaveSink): Any {
  return {
    name: b.name,
    destination: b.destination,
    filter: b.filter,
    description: b.description ?? '',
    disabled: b.disabled,
    exclusions: b.exclusions.map((e) => ({ name: e.name, description: e.description ?? '', filter: e.filter, disabled: e.disabled })),
  };
}

export function mapBucket(b: Any): LogBucket {
  const name = String(b?.name ?? '');
  const id = short(name);
  return {
    name,
    id,
    location: /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '',
    description: str(b?.description),
    retentionDays: typeof b?.retentionDays === 'number' ? b.retentionDays : null,
    locked: !!b?.locked,
    analyticsEnabled: !!b?.analyticsEnabled,
    lifecycleState: String(b?.lifecycleState ?? 'LIFECYCLE_STATE_UNSPECIFIED'),
    builtIn: id === '_Default' || id === '_Required',
    createTime: str(b?.createTime),
    updateTime: str(b?.updateTime),
  };
}

export function mapView(v: Any): LogView {
  const name = String(v?.name ?? '');
  return { name, id: short(name), description: str(v?.description), filter: String(v?.filter ?? ''), createTime: str(v?.createTime) };
}

export function mapLink(l: Any): LogBucketLink {
  return { name: String(l?.name ?? ''), datasetId: str(l?.bigqueryDataset?.datasetId), lifecycleState: String(l?.lifecycleState ?? '') };
}

export function mapMetric(m: Any): LogMetric {
  const name = String(m?.name ?? '');
  const distribution = m?.metricDescriptor?.valueType === 'DISTRIBUTION';
  return {
    name,
    description: str(m?.description),
    filter: String(m?.filter ?? ''),
    kind: distribution ? 'distribution' : 'counter',
    unit: str(m?.metricDescriptor?.unit),
    labelExtractors: (m?.labelExtractors ?? {}) as Record<string, string>,
    valueExtractor: str(m?.valueExtractor),
    disabled: !!m?.disabled,
    metricType: `logging.googleapis.com/user/${name}`,
    createTime: str(m?.createTime),
    updateTime: str(m?.updateTime),
  };
}

/** The LogMetric body for a create or a replace. Label extractors declare their labels. */
export function metricBody(b: SaveLogMetric): Any {
  const labels = Object.keys(b.labelExtractors).map((key) => ({ key, valueType: 'STRING' }));
  const body: Any = {
    name: b.name,
    description: b.description ?? '',
    filter: b.filter,
    disabled: b.disabled,
    labelExtractors: b.labelExtractors,
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: b.kind === 'distribution' ? 'DISTRIBUTION' : 'INT64',
      unit: b.unit || '1',
      labels,
    },
  };
  if (b.kind === 'distribution') {
    body.valueExtractor = b.valueExtractor ?? '';
    const buckets = b.buckets ?? { count: 64, growthFactor: 2, scale: 0.01 };
    body.bucketOptions = {
      exponentialBuckets: { numFiniteBuckets: buckets.count, growthFactor: buckets.growthFactor, scale: buckets.scale },
    };
  }
  return body;
}

/** `projects/p/logs/cloudaudit.googleapis.com%2Factivity` to `cloudaudit.googleapis.com/activity`. */
export function logIdOf(logName: string): string {
  const raw = logName.replace(/^projects\/[^/]+\/logs\//, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** One CSV field: quoted when it holds a comma, a quote or a line break. */
export function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
