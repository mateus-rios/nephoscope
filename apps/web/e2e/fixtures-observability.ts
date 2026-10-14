import type {
  AlertPolicyView,
  DashboardSummary,
  ErrorEventView,
  ErrorGroupView,
  KitItem,
  LogBucket,
  LogMetric,
  LogSink,
  MetricDescriptorView,
  NotificationChannelView,
  SeriesResult,
  TraceSummary,
  TraceView,
  UptimeCheckView,
} from '@nephoscope/contracts';
import { list, logs, PROJECT } from './fixtures';

type Route = [string, RegExp, (url: URL) => unknown];

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const P = `/api/projects/${PROJECT}`;

export const sinks: LogSink[] = [
  {
    name: '_Required',
    destination: `logging.googleapis.com/projects/${PROJECT}/locations/global/buckets/_Required`,
    destinationKind: 'logbucket',
    filter: 'LOG_ID("cloudaudit.googleapis.com/activity") OR LOG_ID("externalaudit.googleapis.com/activity")',
    description: null,
    disabled: false,
    writerIdentity: null,
    requiredRole: null,
    exclusions: [],
    builtIn: '_Required',
    createTime: iso(90_000),
    updateTime: iso(90_000),
  },
  {
    name: 'errors-to-pubsub',
    destination: `pubsub.googleapis.com/projects/${PROJECT}/topics/log-errors`,
    destinationKind: 'pubsub',
    filter: 'severity>=ERROR',
    description: 'Feeds the on-call bot',
    disabled: false,
    writerIdentity: 'serviceAccount:service-123456789@gcp-sa-logging.iam.gserviceaccount.com',
    requiredRole: 'roles/pubsub.publisher',
    exclusions: [{ name: 'health', description: null, filter: 'httpRequest.requestUrl:"/healthz"', disabled: false }],
    builtIn: null,
    createTime: iso(4000),
    updateTime: iso(200),
  },
];

export const buckets: LogBucket[] = [
  {
    name: `projects/${PROJECT}/locations/global/buckets/_Default`,
    id: '_Default',
    location: 'global',
    description: null,
    retentionDays: 30,
    locked: false,
    analyticsEnabled: true,
    lifecycleState: 'ACTIVE',
    builtIn: true,
    createTime: iso(90_000),
    updateTime: iso(90_000),
  },
  {
    name: `projects/${PROJECT}/locations/global/buckets/_Required`,
    id: '_Required',
    location: 'global',
    description: null,
    retentionDays: 400,
    locked: true,
    analyticsEnabled: false,
    lifecycleState: 'ACTIVE',
    builtIn: true,
    createTime: iso(90_000),
    updateTime: iso(90_000),
  },
  {
    name: `projects/${PROJECT}/locations/us-central1/buckets/audit-long`,
    id: 'audit-long',
    location: 'us-central1',
    description: 'Kept a year',
    retentionDays: 365,
    locked: false,
    analyticsEnabled: false,
    lifecycleState: 'ACTIVE',
    builtIn: false,
    createTime: iso(9000),
    updateTime: iso(800),
  },
];

export const logMetrics: LogMetric[] = [
  {
    name: 'checkout_errors',
    description: 'Failed checkouts',
    filter: 'resource.type="cloud_run_revision" AND jsonPayload.event="checkout_failed"',
    kind: 'counter',
    unit: '1',
    labelExtractors: { reason: 'EXTRACT(jsonPayload.reason)' },
    valueExtractor: null,
    disabled: false,
    metricType: 'logging.googleapis.com/user/checkout_errors',
    createTime: iso(5000),
    updateTime: iso(300),
  },
];

const descriptors: MetricDescriptorView[] = [
  {
    type: 'run.googleapis.com/request_count',
    displayName: 'Request Count',
    description: 'Number of requests reaching the revision.',
    metricKind: 'DELTA',
    valueType: 'INT64',
    unit: '1',
    labels: [
      { key: 'response_code_class', description: '' },
      { key: 'response_code', description: '' },
    ],
    resourceTypes: ['cloud_run_revision'],
    launchStage: 'GA',
  },
  {
    type: 'run.googleapis.com/request_latencies',
    displayName: 'Request Latencies',
    description: 'Distribution of request latency in milliseconds.',
    metricKind: 'DELTA',
    valueType: 'DISTRIBUTION',
    unit: 'ms',
    labels: [{ key: 'response_code_class', description: '' }],
    resourceTypes: ['cloud_run_revision'],
    launchStage: 'GA',
  },
];

const line = (offset: number, scale: number) =>
  Array.from({ length: 120 }, (_, i): [number, number] => [
    now - (120 - i) * 30_000,
    Math.round((offset + scale * Math.sin(i / 9)) * 100) / 100,
  ]);

export const series: SeriesResult = {
  stepSeconds: 30,
  series: [
    { labels: { response_code_class: '2xx' }, points: line(42, 9) },
    { labels: { response_code_class: '4xx' }, points: line(6, 2) },
    { labels: { response_code_class: '5xx' }, points: line(1.2, 0.8) },
  ],
};

export const dashboards: DashboardSummary[] = [
  {
    name: `projects/123/dashboards/ops-1`,
    id: 'ops-1',
    displayName: 'API operations',
    etag: 'e1',
    layout: 'mosaic',
    widgets: 4,
    labels: {},
  },
];

export const dashboard = {
  name: `projects/123/dashboards/ops-1`,
  displayName: 'API operations',
  etag: 'e1',
  mosaicLayout: {
    columns: 48,
    tiles: [
      {
        xPos: 0,
        yPos: 0,
        width: 24,
        height: 16,
        widget: {
          title: 'Requests by class',
          xyChart: {
            dataSets: [
              { timeSeriesQuery: { prometheusQuery: 'sum by (response_code_class) (rate(run_googleapis_com:request_count[5m]))' } },
            ],
          },
        },
      },
      {
        xPos: 24,
        yPos: 0,
        width: 12,
        height: 8,
        widget: {
          title: 'Requests now',
          scorecard: { timeSeriesQuery: { prometheusQuery: 'sum(rate(run_googleapis_com:request_count[5m]))' } },
        },
      },
      {
        xPos: 36,
        yPos: 0,
        width: 12,
        height: 8,
        widget: { title: 'Runbook', text: { content: '## On call\nRestart <b>api</b> only after paging.', format: 'MARKDOWN' } },
      },
      { xPos: 24, yPos: 8, width: 24, height: 8, widget: { title: 'Error ratio', pieChart: { dataSets: [] } } },
    ],
  },
};

export const policies: AlertPolicyView[] = [
  {
    name: `projects/${PROJECT}/alertPolicies/1001`,
    id: '1001',
    displayName: 'API p99 latency above 800 ms',
    enabled: true,
    combiner: 'OR',
    severity: 'WARNING',
    conditions: [
      {
        name: `projects/${PROJECT}/alertPolicies/1001/conditions/1`,
        displayName: 'p99 latency',
        kind: 'threshold',
        filter: 'metric.type = "run.googleapis.com/request_latencies" AND resource.type = "cloud_run_revision"',
        query: null,
        comparison: 'COMPARISON_GT',
        threshold: 45,
        duration: '300s',
        aggregations: [{ alignmentPeriod: '60s', perSeriesAligner: 'ALIGN_PERCENTILE_99' }],
      },
    ],
    channels: [`projects/${PROJECT}/notificationChannels/77`],
    documentation: 'Check the latest deploy first.',
    userLabels: {},
    createTime: iso(9000),
    updateTime: iso(600),
  },
];

export const channels: NotificationChannelView[] = [
  {
    name: `projects/${PROJECT}/notificationChannels/77`,
    id: '77',
    type: 'email',
    displayName: 'On-call email',
    labels: { email_address: 'oncall@example.com' },
    enabled: true,
    verificationStatus: null,
  },
  {
    name: `projects/${PROJECT}/notificationChannels/78`,
    id: '78',
    type: 'sms',
    displayName: 'Pager',
    labels: { number: '+15550100' },
    enabled: true,
    verificationStatus: 'UNVERIFIED',
  },
];

export const uptime: UptimeCheckView[] = [
  {
    name: `projects/${PROJECT}/uptimeCheckConfigs/home-abc`,
    id: 'home-abc',
    displayName: 'Home page',
    protocol: 'HTTPS',
    target: 'example.com',
    path: '/',
    port: 443,
    periodSeconds: 60,
    timeoutSeconds: 10,
    regions: [],
    passRate: 1,
  },
  {
    name: `projects/${PROJECT}/uptimeCheckConfigs/api-def`,
    id: 'api-def',
    displayName: 'API health',
    protocol: 'HTTPS',
    target: 'api.example.com',
    path: '/healthz',
    port: 443,
    periodSeconds: 60,
    timeoutSeconds: 10,
    regions: [],
    passRate: 0.93,
  },
];

export const errorGroups: ErrorGroupView[] = [
  {
    groupId: 'CNjx6cK6kMuQ',
    name: `projects/${PROJECT}/groups/CNjx6cK6kMuQ`,
    resolutionStatus: 'OPEN',
    message:
      "TypeError: Cannot read properties of undefined (reading 'id')\n    at checkout (/app/src/checkout.js:42:17)\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
    count: 318,
    affectedUsers: 41,
    firstSeen: iso(3000),
    lastSeen: iso(4),
    services: [{ service: 'api', version: 'api-00012-xyz' }],
    timedCounts: Array.from({ length: 24 }, (_, i): [number, number] => [now - (24 - i) * 3_600_000, Math.round(8 + 6 * Math.sin(i / 3))]),
    trackingIssues: [],
  },
  {
    groupId: 'COP9yJ6dqYbq',
    name: `projects/${PROJECT}/groups/COP9yJ6dqYbq`,
    resolutionStatus: 'ACKNOWLEDGED',
    message: 'Error: connect ECONNREFUSED 10.0.0.5:5432\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1555:16)',
    count: 12,
    affectedUsers: 0,
    firstSeen: iso(900),
    lastSeen: iso(70),
    services: [{ service: 'worker', version: null }],
    timedCounts: [],
    trackingIssues: [],
  },
];

export const errorEvents: ErrorEventView[] = [
  {
    eventTime: iso(4),
    service: 'api',
    version: 'api-00012-xyz',
    message: errorGroups[0]?.message ?? '',
    httpRequest: { method: 'POST', url: '/v1/checkout', status: 500, userAgent: 'Mozilla/5.0' },
    user: 'user-8812',
    reportLocation: null,
  },
];

export const traces: TraceSummary[] = Array.from({ length: 12 }, (_, i) => ({
  traceId: `4bf92f3577b34da6a3ce929d0e0e47${String(i).padStart(2, '0')}`,
  rootName: i % 3 === 0 ? '/v1/checkout' : '/v1/items',
  start: iso(i * 3),
  durationMs: [42, 180, 35, 920, 61, 48, 2400, 77, 39, 140, 55, 410][i] ?? 50,
  spanCount: 3 + (i % 4),
}));

export const trace: TraceView = {
  traceId: traces[0]?.traceId ?? '',
  spans: [
    {
      spanId: '1',
      parentSpanId: null,
      name: '/v1/checkout',
      kind: 'RPC_SERVER',
      start: iso(0.02),
      end: new Date(now - 1200 + 920).toISOString(),
      labels: { '/http/method': 'POST', '/http/status_code': '200' },
    },
    {
      spanId: '2',
      parentSpanId: '1',
      name: 'firestore.get carts',
      kind: 'RPC_CLIENT',
      start: new Date(now - 1180).toISOString(),
      end: new Date(now - 1050).toISOString(),
      labels: {},
    },
    {
      spanId: '3',
      parentSpanId: '1',
      name: 'payments.charge',
      kind: 'RPC_CLIENT',
      start: new Date(now - 1040).toISOString(),
      end: new Date(now - 420).toISOString(),
      labels: { provider: 'acme' },
    },
    {
      spanId: '4',
      parentSpanId: '3',
      name: 'https POST api.acme.example',
      kind: 'RPC_CLIENT',
      start: new Date(now - 1000).toISOString(),
      end: new Date(now - 460).toISOString(),
      labels: {},
    },
  ],
};

const spannerInstance: KitItem = {
  _path: 'instances/orders',
  _location: '',
  name: `projects/${PROJECT}/instances/orders`,
  displayName: 'Orders',
  config: `projects/${PROJECT}/instanceConfigs/regional-us-central1`,
  nodeCount: 1,
  processingUnits: 1000,
  state: 'READY',
  edition: 'STANDARD',
  createTime: iso(40_000),
  labels: { team: 'checkout' },
};

export const observabilityRoutes: Route[] = [
  [
    'GET',
    new RegExp(`^${P}/logging/catalog$`),
    () => ({
      logNames: ['run.googleapis.com/requests', 'run.googleapis.com/stdout', 'cloudaudit.googleapis.com/activity'],
      resourceTypes: ['cloud_run_revision', 'gce_instance'],
    }),
  ],
  ['GET', new RegExp(`^${P}/logging/sinks$`), () => sinks],
  ['GET', new RegExp(`^${P}/logging/exclusions$`), () => []],
  ['GET', new RegExp(`^${P}/logging/buckets$`), () => buckets],
  [
    'GET',
    new RegExp(`^${P}/logging/buckets/[^/]+/[^/]+/views$`),
    () => [{ name: 'x/views/_AllLogs', id: '_AllLogs', description: null, filter: '', createTime: iso(9000) }],
  ],
  ['GET', new RegExp(`^${P}/logging/buckets/[^/]+/[^/]+/links$`), () => []],
  ['GET', new RegExp(`^${P}/logging/metrics$`), () => logMetrics],
  ['GET', /^\/api\/saved\/[a-z]+$/, () => []],
  ['GET', new RegExp(`^${P}/monitoring/metric-descriptors$`), () => descriptors],
  ['POST', new RegExp(`^${P}/monitoring/series$`), () => series],
  ['GET', new RegExp(`^${P}/monitoring/dashboards$`), () => dashboards],
  ['GET', new RegExp(`^${P}/monitoring/dashboards/ops-1$`), () => dashboard],
  ['GET', new RegExp(`^${P}/monitoring/alert-policies$`), () => policies],
  ['GET', new RegExp(`^${P}/monitoring/alert-policies/1001$`), () => ({ policy: policies[0], raw: { name: policies[0]?.name } })],
  ['GET', new RegExp(`^${P}/monitoring/uptime-checks$`), () => uptime],
  ['GET', new RegExp(`^${P}/monitoring/channels$`), () => channels],
  ['GET', new RegExp(`^${P}/kit/monitoring/services$`), () => list([])],
  ['GET', new RegExp(`^${P}/errorreporting/groups$`), () => list(errorGroups)],
  ['GET', new RegExp(`^${P}/errorreporting/groups/CNjx6cK6kMuQ$`), () => errorGroups[0]],
  ['GET', new RegExp(`^${P}/errorreporting/groups/CNjx6cK6kMuQ/events$`), () => errorEvents],
  ['GET', new RegExp(`^${P}/trace/traces$`), () => list(traces)],
  ['GET', new RegExp(`^${P}/trace/traces/[0-9a-f]+$`), () => trace],
  ['GET', new RegExp(`^${P}/kit/spanner/instances$`), () => list([spannerInstance])],
  ['GET', new RegExp(`^${P}/kit/spanner/instances/item$`), () => spannerInstance],
  [
    'GET',
    new RegExp(`^${P}/kit/spanner/databases$`),
    () =>
      list([
        {
          _path: 'instances/orders/databases/main',
          _location: '',
          name: `projects/${PROJECT}/instances/orders/databases/main`,
          state: 'READY',
          databaseDialect: 'GOOGLE_STANDARD_SQL',
          versionRetentionPeriod: '1h',
          createTime: iso(30_000),
        },
      ]),
  ],
  [
    'GET',
    new RegExp(`^${P}/logs$`),
    () => ({
      ...logs,
      entries: logs.entries.map((e, i) => (i === 2 ? { ...e, trace: `projects/${PROJECT}/traces/${traces[0]?.traceId}` } : e)),
    }),
  ],
];
