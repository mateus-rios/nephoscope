import type {
  Capabilities,
  InstanceView,
  ListResponse,
  LogPage,
  MetricsResponse,
  Profile,
  ProjectSummary,
  Revision,
  RunExecution,
  RunJob,
  RunJobSummary,
  RunService,
  RunServiceSummary,
  RunTask,
  ServiceAccess,
} from './types';

/** API fixtures in the contract shapes, for pages rendered without Google (SPEC-0002 G5). */

export const PROJECT = 'demo-project';
const now = Date.parse('2026-09-28T12:00:00Z');
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

export const instance: InstanceView = {
  version: '0.1.0',
  readOnly: false,
  requireToken: false,
  host: { name: '127.0.0.1', isLoopback: true },
  emulators: { firestore: null, pubsub: null, storage: null },
  dataDir: { writable: true, profilesUnreadable: false },
  credentials: { environmentMissing: false, environmentFileSet: true, environmentError: null },
  notices: [],
};

export const profiles: Profile[] = [
  {
    id: 'env',
    name: 'Environment',
    source: 'environment',
    type: 'service_account',
    principal: 'deployer@demo-project.iam.gserviceaccount.com',
    keyId: 'a1b2c3d4e5f6',
    keyProjectId: PROJECT,
    defaultProject: PROJECT,
    quotaProjectId: null,
    colorTag: 'blue',
    readOnly: false,
    createdAt: iso(60 * 24 * 30),
  } as Profile,
];

export const project: ProjectSummary = {
  projectId: PROJECT,
  name: 'Demo project',
  projectNumber: '123456789012',
  state: 'ACTIVE',
  parent: { type: 'organization', id: '998877665544' },
  labels: { env: 'sandbox' },
  createTime: iso(60 * 24 * 400),
};

export const capabilities: Capabilities = {
  projectId: PROJECT,
  checkedAt: iso(1),
  services: {
    known: true,
    enabled: [
      'run.googleapis.com',
      'cloudfunctions.googleapis.com',
      'workflows.googleapis.com',
      'workflowexecutions.googleapis.com',
      'cloudscheduler.googleapis.com',
      'cloudtasks.googleapis.com',
      'eventarc.googleapis.com',
      'logging.googleapis.com',
      'monitoring.googleapis.com',
      'serviceusage.googleapis.com',
    ],
    problemCode: null,
  },
  permissions: { known: true, tested: [], granted: [], invalid: [] },
} as unknown as Capabilities;

const container = (image: string, env: RunService['template']['containers'][number]['env'] = []) => ({
  name: 'app',
  image,
  command: [],
  args: ['--serve'],
  env,
  port: 8080,
  cpu: '1',
  memory: '512Mi',
  cpuIdle: true,
  startupCpuBoost: false,
  workingDir: null,
  hasProbes: true,
  volumeMounts: [],
});

export const services: RunServiceSummary[] = [
  {
    name: `projects/${PROJECT}/locations/us-central1/services/api`,
    id: 'api',
    location: 'us-central1',
    uri: 'https://api-abc123-uc.a.run.app',
    status: 'ready',
    statusMessage: null,
    lastDeployTime: iso(42),
    lastDeployer: 'deployer@demo-project.iam.gserviceaccount.com',
    traffic: [
      { type: 'LATEST', revision: 'api-00012-xyz', percent: 90, tag: null, uri: null },
      { type: 'REVISION', revision: 'api-00011-abc', percent: 10, tag: 'canary', uri: 'https://canary---api-abc123-uc.a.run.app' },
    ],
    ingress: 'ALL',
    invokerIamDisabled: false,
    isFunction: false,
    functionTarget: null,
    functionRuntime: null,
    labels: { team: 'core' },
  },
  {
    name: `projects/${PROJECT}/locations/europe-west1/services/web`,
    id: 'web',
    location: 'europe-west1',
    uri: 'https://web-abc123-ew.a.run.app',
    status: 'deploying',
    statusMessage: 'Waiting for the revision to be ready',
    lastDeployTime: iso(2),
    lastDeployer: 'alice@example.com',
    traffic: [{ type: 'LATEST', revision: 'web-00031-kkk', percent: 100, tag: null, uri: null }],
    ingress: 'INTERNAL_LOAD_BALANCER',
    invokerIamDisabled: true,
    isFunction: false,
    functionTarget: null,
    functionRuntime: null,
    labels: {},
  },
  {
    name: `projects/${PROJECT}/locations/us-east1/services/resize-image`,
    id: 'resize-image',
    location: 'us-east1',
    uri: 'https://resize-image-abc123-ue.a.run.app',
    status: 'failed',
    statusMessage: 'Container failed to start and listen on port 8080',
    lastDeployTime: iso(60 * 26),
    lastDeployer: 'bob@example.com',
    traffic: [{ type: 'LATEST', revision: 'resize-image-00004-pqr', percent: 100, tag: null, uri: null }],
    ingress: 'ALL',
    invokerIamDisabled: false,
    isFunction: true,
    functionTarget: 'resizeImage',
    functionRuntime: 'nodejs22',
    labels: { 'goog-managed-by': 'cloudfunctions' },
  },
];

export const serviceAccess: ServiceAccess[] = [
  { name: services[0]!.name, mode: 'none', invokers: ['serviceAccount:web@demo-project.iam.gserviceaccount.com'] },
  { name: services[2]!.name, mode: 'allUsers', invokers: ['allUsers'] },
];

export const service: RunService = {
  name: services[0]!.name,
  id: 'api',
  location: 'us-central1',
  uri: 'https://api-abc123-uc.a.run.app',
  urls: ['https://api-abc123-uc.a.run.app', 'https://api-123456789012.us-central1.run.app'],
  status: 'ready',
  statusMessage: null,
  conditions: [{ type: 'Ready', state: 'SUCCEEDED', message: null, reason: null, severity: 'UNSPECIFIED', lastTransitionTime: iso(40) }],
  reconciling: false,
  generation: '12',
  creator: 'alice@example.com',
  lastModifier: 'deployer@demo-project.iam.gserviceaccount.com',
  createTime: iso(60 * 24 * 90),
  updateTime: iso(42),
  description: null,
  ingress: 'ALL',
  invokerIamDisabled: false,
  defaultUriDisabled: false,
  latestReadyRevision: 'api-00012-xyz',
  latestCreatedRevision: 'api-00012-xyz',
  traffic: [
    { type: 'LATEST', revision: null, percent: 90, tag: null },
    { type: 'REVISION', revision: 'api-00011-abc', percent: 10, tag: 'canary' },
  ],
  trafficStatuses: [
    { type: 'LATEST', revision: null, percent: 90, tag: null, uri: null },
    { type: 'REVISION', revision: 'api-00011-abc', percent: 10, tag: 'canary', uri: 'https://canary---api-abc123-uc.a.run.app' },
  ],
  template: {
    revision: null,
    containers: [
      container('us-docker.pkg.dev/demo-project/app/api:1.4.2', [
        { name: 'MODE', value: 'production', secret: null },
        { name: 'DB_PASSWORD', value: null, secret: { secret: 'db-password', version: '3' } },
      ]),
    ],
    minInstances: 1,
    maxInstances: 20,
    concurrency: 80,
    timeoutSeconds: 300,
    serviceAccount: 'api-runtime@demo-project.iam.gserviceaccount.com',
    executionEnvironment: 'GEN2',
    vpc: {
      connector: null,
      egress: 'PRIVATE_RANGES_ONLY',
      networkInterfaces: [{ network: 'default', subnetwork: 'default', tags: ['api'] }],
    },
    labels: {},
    volumes: [],
    sessionAffinity: false,
  },
  labels: { team: 'core' },
  functionTarget: null,
  etag: '"abc"',
};

export const revisions: Revision[] = [12, 11, 10, 9].map((n, i) => ({
  name: `${service.name}/revisions/api-000${n}-${['xyz', 'abc', 'mno', 'def'][i]}`,
  id: `api-000${n}-${['xyz', 'abc', 'mno', 'def'][i]}`,
  service: 'api',
  status: n === 10 ? 'failed' : 'ready',
  statusMessage: n === 10 ? 'Container failed to start' : null,
  createTime: iso(42 + i * 60 * 24),
  creator: 'deployer@demo-project.iam.gserviceaccount.com',
  percent: n === 12 ? 90 : n === 11 ? 10 : 0,
  tags: n === 11 ? ['canary'] : [],
  images: [`us-docker.pkg.dev/demo-project/app/api:1.4.${14 - n}`],
  imageDigests: [null],
  template: service.template,
  conditions: [],
  logUri: null,
}));

export const jobs: RunJobSummary[] = [
  {
    name: `projects/${PROJECT}/locations/us-central1/jobs/nightly-etl`,
    id: 'nightly-etl',
    location: 'us-central1',
    status: 'ready',
    statusMessage: null,
    taskCount: 3,
    executionCount: 128,
    lastExecution: {
      name: `projects/${PROJECT}/locations/us-central1/jobs/nightly-etl/executions/nightly-etl-8x2kd`,
      outcome: 'failed',
      createTime: iso(300),
      completionTime: iso(280),
    },
    lastDeployer: 'alice@example.com',
    labels: {},
  },
  {
    name: `projects/${PROJECT}/locations/us-central1/jobs/migrate-db`,
    id: 'migrate-db',
    location: 'us-central1',
    status: 'ready',
    statusMessage: null,
    taskCount: 1,
    executionCount: 4,
    lastExecution: {
      name: `projects/${PROJECT}/locations/us-central1/jobs/migrate-db/executions/migrate-db-7pqlm`,
      outcome: 'succeeded',
      createTime: iso(60 * 72),
      completionTime: iso(60 * 72 - 3),
    },
    lastDeployer: 'alice@example.com',
    labels: {},
  },
];

export const job: RunJob = {
  name: jobs[0]!.name,
  id: 'nightly-etl',
  location: 'us-central1',
  status: 'ready',
  statusMessage: null,
  conditions: [],
  reconciling: false,
  creator: 'alice@example.com',
  lastModifier: 'alice@example.com',
  createTime: iso(60 * 24 * 60),
  updateTime: iso(60 * 24 * 3),
  taskCount: 3,
  parallelism: 0,
  maxRetries: 3,
  timeoutSeconds: 3600,
  serviceAccount: 'etl@demo-project.iam.gserviceaccount.com',
  executionEnvironment: 'UNSPECIFIED',
  containers: [{ ...container('us-docker.pkg.dev/demo-project/app/etl:2.0.1'), args: ['--date=yesterday'], port: null }],
  vpc: null,
  labels: { team: 'data' },
  executionCount: 128,
  latestExecution: jobs[0]!.lastExecution!.name,
  etag: '"j1"',
};

export const executions: RunExecution[] = [
  {
    name: `${job.name}/executions/nightly-etl-9zzq1`,
    id: 'nightly-etl-9zzq1',
    job: 'nightly-etl',
    outcome: 'running',
    statusMessage: null,
    createTime: iso(3),
    startTime: iso(3),
    completionTime: null,
    taskCount: 3,
    parallelism: 0,
    running: 2,
    succeeded: 1,
    failed: 0,
    cancelled: 0,
    retried: 0,
    conditions: [],
    logUri: null,
    reconciling: true,
  },
  {
    name: `${job.name}/executions/nightly-etl-8x2kd`,
    id: 'nightly-etl-8x2kd',
    job: 'nightly-etl',
    outcome: 'failed',
    statusMessage: 'Task nightly-etl-8x2kd-task2 failed with exit code 1',
    createTime: iso(300),
    startTime: iso(300),
    completionTime: iso(280),
    taskCount: 3,
    parallelism: 0,
    running: 0,
    succeeded: 2,
    failed: 1,
    cancelled: 0,
    retried: 3,
    conditions: [],
    logUri: null,
    reconciling: false,
  },
];

export const tasks: RunTask[] = [0, 1, 2].map((index) => ({
  name: `${executions[0]!.name}/tasks/nightly-etl-9zzq1-task${index}`,
  index,
  outcome: index === 0 ? 'succeeded' : 'running',
  retried: 0,
  exitCode: index === 0 ? 0 : null,
  lastAttemptMessage: null,
  startTime: iso(3),
  completionTime: index === 0 ? iso(1) : null,
  logUri: null,
}));

function series(len: number, f: (i: number) => number): [number, number | null][] {
  return Array.from({ length: len }, (_, i) => [now - (len - i) * 60_000, f(i)]);
}

export const metrics: MetricsResponse = {
  alignmentSeconds: 60,
  since: iso(60),
  until: iso(0),
  hidden: [
    {
      id: 'startup',
      title: 'Startup latency',
      reason: 'The metric run.googleapis.com/container/startup_latencies does not exist in this project.',
    },
  ],
  charts: [
    {
      id: 'requests',
      title: 'Requests per second',
      unit: '1/s',
      series: [
        { key: 'rate:2xx', label: '2xx', points: series(60, (i) => 40 + 12 * Math.sin(i / 6)) },
        { key: 'rate:4xx', label: '4xx', points: series(60, (i) => 2 + Math.cos(i / 4)) },
        { key: 'rate:5xx', label: '5xx', points: series(60, (i) => (i > 40 && i < 46 ? 6 : 0.2)) },
      ],
    },
    {
      id: 'latency',
      title: 'Request latency',
      unit: 'ms',
      series: [
        { key: 'p50', label: 'p50', points: series(60, (i) => 38 + 5 * Math.sin(i / 5)) },
        { key: 'p95', label: 'p95', points: series(60, (i) => 120 + 30 * Math.sin(i / 7)) },
        { key: 'p99', label: 'p99', points: series(60, (i) => 310 + 90 * Math.sin(i / 9)) },
      ],
    },
    {
      id: 'instances',
      title: 'Instances',
      unit: 'count',
      series: [
        { key: 'max:active', label: 'active', points: series(60, (i) => 3 + (i > 30 ? 2 : 0)) },
        { key: 'max:idle', label: 'idle', points: series(60, () => 1) },
      ],
    },
    {
      id: 'cpu',
      title: 'CPU utilization',
      unit: 'ratio',
      series: [
        { key: 'p50', label: 'p50', points: series(60, (i) => 0.21 + 0.05 * Math.sin(i / 3)) },
        { key: 'p99', label: 'p99', points: series(60, (i) => 0.62 + 0.1 * Math.sin(i / 4)) },
      ],
    },
  ],
};

export const logs: LogPage = {
  nextPageToken: 'next',
  entries: Array.from({ length: 30 }, (_, i) => {
    const http = i % 3 === 0;
    const severity = i === 4 ? 'ERROR' : i === 9 ? 'WARNING' : http ? 'INFO' : 'DEFAULT';
    const timestamp = new Date(now - i * 7_000).toISOString();
    const raw: Record<string, unknown> = {
      insertId: `id${i}`,
      timestamp,
      severity,
      logName: `projects/${PROJECT}/logs/run.googleapis.com%2F${http ? 'requests' : 'stdout'}`,
      resource: { type: 'cloud_run_revision', labels: { service_name: 'api', location: 'us-central1', revision_name: 'api-00012-xyz' } },
      ...(http
        ? {
            httpRequest: {
              requestMethod: 'GET',
              requestUrl: `https://api-abc123-uc.a.run.app/v1/items/${i}`,
              status: 200,
              latency: '0.042s',
              userAgent: 'curl/8.7',
            },
          }
        : i === 4
          ? { jsonPayload: { message: 'Database connection refused', code: 'ECONNREFUSED', attempt: 3 } }
          : { textPayload: `Processed batch ${i} in ${10 + i} ms` }),
    };
    return {
      id: `id${i}@${timestamp}`,
      timestamp,
      severity,
      logName: raw.logName as string,
      resource: raw.resource as { type: string; labels: Record<string, string> },
      summary: http
        ? `GET 200 42 ms https://api-abc123-uc.a.run.app/v1/items/${i}`
        : i === 4
          ? 'Database connection refused'
          : `Processed batch ${i} in ${10 + i} ms`,
      http: http
        ? {
            method: 'GET',
            url: `https://api-abc123-uc.a.run.app/v1/items/${i}`,
            status: 200,
            latencyMs: 42,
            responseSize: '512',
            userAgent: 'curl/8.7',
            remoteIp: null,
          }
        : null,
      trace: null,
      raw,
    } as LogPage['entries'][number];
  }),
};

export function list<T>(items: T[], extra: Partial<ListResponse<T>> = {}): ListResponse<T> {
  return { items, nextPageToken: null, unreachable: [], ...extra };
}

// ---- Functions ---------------------------------------------------------------------------------

export const functionList: import('@nephoscope/contracts').FunctionSummary[] = [
  {
    name: `projects/${PROJECT}/locations/us-central1/functions/hello`,
    id: 'hello',
    location: 'us-central1',
    generation: 'gen2',
    runtime: 'nodejs22',
    trigger: { kind: 'http', eventType: null, resource: null, retry: null },
    state: 'active',
    updateTime: iso(90),
    url: 'https://hello-abc123-uc.a.run.app',
    runService: `projects/${PROJECT}/locations/us-central1/services/hello`,
  },
  {
    name: `projects/${PROJECT}/locations/europe-west1/functions/onUpload`,
    id: 'onUpload',
    location: 'europe-west1',
    generation: 'gen1',
    runtime: 'python312',
    trigger: { kind: 'event', eventType: 'google.storage.object.finalize', resource: 'uploads', retry: true },
    state: 'active',
    updateTime: iso(60 * 24 * 40),
    url: null,
    runService: null,
  },
  {
    name: `projects/${PROJECT}/locations/us-east1/services/resize-image`,
    id: 'resize-image',
    location: 'us-east1',
    generation: 'run',
    runtime: 'nodejs22',
    trigger: { kind: 'http', eventType: null, resource: null, retry: null },
    state: 'failed',
    updateTime: iso(60 * 26),
    url: 'https://resize-image-abc123-ue.a.run.app',
    runService: `projects/${PROJECT}/locations/us-east1/services/resize-image`,
  },
];

export const helloFunction: import('@nephoscope/contracts').CloudFunction = {
  ...functionList[0]!,
  description: 'Says hello',
  stateMessages: [],
  entryPoint: 'hello',
  memory: '256M',
  cpu: '0.1666',
  timeoutSeconds: 60,
  serviceAccount: '123456789012-compute@developer.gserviceaccount.com',
  environment: { MODE: 'prod' },
  secretEnvironment: [],
  minInstances: 0,
  maxInstances: 100,
  concurrency: 1,
  ingress: 'ALLOW_ALL',
  vpcConnector: null,
  buildId: 'b1d2',
  dockerRepository: `projects/${PROJECT}/locations/us-central1/repositories/gcf-artifacts`,
  source: { bucket: 'gcf-v2-sources-123456789012-us-central1', object: 'hello/function-source.zip', generation: '1790000000000' },
  labels: { 'deployment-tool': 'cli-gcloud' },
  createTime: iso(60 * 24 * 10),
  sourceEditable: true,
};

export const helloSource: import('@nephoscope/contracts').FunctionSource = {
  archiveBytes: 1840,
  note: null,
  files: [
    {
      path: 'index.js',
      size: 120,
      binary: false,
      text: "const functions = require('@google-cloud/functions-framework');\n\nfunctions.http('hello', (req, res) => {\n  res.send(`Hello ${req.query.name || 'World'}!`);\n});\n",
    },
    {
      path: 'package.json',
      size: 90,
      binary: false,
      text: '{\n  "name": "hello",\n  "dependencies": { "@google-cloud/functions-framework": "^3.4.0" }\n}\n',
    },
  ],
};
