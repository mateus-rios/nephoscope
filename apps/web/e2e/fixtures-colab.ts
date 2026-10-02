import type {
  ColabCommit,
  ColabExecution,
  ColabExecutionList,
  ColabExecutionOutput,
  ColabNotebook,
  ColabNotebookDetail,
  ColabRuntime,
  ColabSchedule,
  ColabTemplate,
  NotebookDocument,
} from '@nephoscope/contracts';
import { PROJECT } from './fixtures';

/** Colab Enterprise fixtures (SPEC-0010), in the contract shapes. */

const now = Date.parse('2026-10-02T12:00:00Z');
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const L = 'us-central1';
const base = `projects/${PROJECT}/locations/${L}`;

export const NOTEBOOK_ID = '0f1e2d3c-aaaa-bbbb-cccc-1234567890ab';
export const EXECUTION_ID = '7311';
export const SCHEDULE_ID = '55';
export const TEMPLATE_ID = '4242';
export const RUNTIME_ID = 'rt-ana';
/** The project as Google names it in responses. */
const numbered = `projects/123456789/locations/${L}`;

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const notebooks: ColabNotebook[] = [
  {
    name: `${base}/repositories/${NOTEBOOK_ID}`,
    id: NOTEBOOK_ID,
    location: L,
    displayName: 'daily-sales.ipynb',
    createTime: iso(60 * 24 * 30),
    labels: { 'single-file-asset-type': 'notebook' },
    kmsKeyName: null,
  },
  {
    name: `projects/${PROJECT}/locations/southamerica-east1/repositories/9a8b7c6d-1111-2222-3333-444455556666`,
    id: '9a8b7c6d-1111-2222-3333-444455556666',
    location: 'southamerica-east1',
    displayName: 'churn-model.ipynb',
    createTime: iso(60 * 24 * 3),
    labels: { 'single-file-asset-type': 'notebook' },
    kmsKeyName: null,
  },
];

export const commits: ColabCommit[] = [
  {
    sha: 'c0ffee1234567890abcdef',
    message: 'Filter by region',
    authorName: 'ana@example.com',
    authorEmail: 'ana@example.com',
    time: iso(90),
  },
  {
    sha: 'beef00987654321fedcba0',
    message: 'First version',
    authorName: 'ana@example.com',
    authorEmail: 'ana@example.com',
    time: iso(60 * 24 * 30),
  },
];

export const notebookDetail: ColabNotebookDetail = {
  ...(notebooks[0] as ColabNotebook),
  path: 'content.ipynb',
  head: commits[0] as ColabCommit,
};

export const notebookDocument: NotebookDocument = {
  path: 'content.ipynb',
  commitSha: null,
  size: 18_432,
  error: null,
  notebook: {
    nbformat: '4.5',
    kernel: 'Python 3',
    language: 'python',
    cells: [
      {
        index: 0,
        type: 'markdown',
        source: '# Daily sales\nTotals per region, refreshed every morning.',
        executionCount: null,
        outputs: [],
      },
      {
        index: 1,
        type: 'code',
        source: 'import pandas as pd\ndf = pd.read_gbq("select region, total from sales.daily")\ndf.head(2)',
        executionCount: 4,
        outputs: [
          { kind: 'stream', name: 'stdout', text: 'Downloading: 100%|##########|\n' },
          {
            kind: 'result',
            executionCount: 4,
            text: '  region  total\n0  south   1200\n1  north    980',
            image: null,
            html: '<table><tr><td>south</td></tr></table><script>window.__colabXss = 1</script>',
            markdown: null,
            json: null,
            omitted: [],
          },
        ],
      },
      {
        index: 2,
        type: 'code',
        source: 'df.plot.bar(x="region", y="total")',
        executionCount: 5,
        outputs: [
          {
            kind: 'result',
            executionCount: null,
            text: '<Figure size 640x480>',
            image: { mime: 'image/png', data: PNG },
            html: null,
            markdown: null,
            json: null,
            omitted: [],
          },
        ],
      },
      {
        index: 3,
        type: 'code',
        source: 'df["missing"]',
        executionCount: 6,
        outputs: [
          {
            kind: 'error',
            name: 'KeyError',
            value: "'missing'",
            traceback: "KeyError                                  Traceback (most recent call last)\nKeyError: 'missing'",
          },
        ],
      },
    ],
  },
};

const job = {
  displayName: 'daily-sales',
  source: { kind: 'notebook' as const, repository: `${numbered}/repositories/${NOTEBOOK_ID}`, commitSha: null },
  template: `${numbered}/notebookRuntimeTemplates/${TEMPLATE_ID}`,
  customMachine: null,
  outputUri: 'gs://demo-results/colab',
  identity: { kind: 'serviceAccount' as const, email: 'runner@demo-project.iam.gserviceaccount.com' },
  timeoutSeconds: 86_400,
  kernelName: null,
};

export const executions: ColabExecution[] = [
  {
    ...job,
    name: `${numbered}/notebookExecutionJobs/${EXECUTION_ID}`,
    id: EXECUTION_ID,
    location: L,
    state: 'failed',
    status: { code: 9, message: "Cell 4 raised KeyError: 'missing'" },
    schedule: `${numbered}/schedules/${SCHEDULE_ID}`,
    createTime: iso(180),
    updateTime: iso(171),
    labels: {},
  },
  {
    ...job,
    name: `${numbered}/notebookExecutionJobs/7310`,
    id: '7310',
    location: L,
    state: 'succeeded',
    status: null,
    schedule: `${numbered}/schedules/${SCHEDULE_ID}`,
    createTime: iso(60 * 24 + 180),
    updateTime: iso(60 * 24 + 172),
    labels: {},
  },
];

export const executionList: ColabExecutionList = { items: executions, nextPageToken: null, unreachable: [], truncated: ['us-central1'] };

export const executionOutput: ColabExecutionOutput = {
  uri: `gs://demo-results/colab/${EXECUTION_ID}`,
  bucket: 'demo-results',
  prefix: `colab/${EXECUTION_ID}`,
  objects: [{ name: `colab/${EXECUTION_ID}/daily-sales.ipynb`, size: 21_504, updated: iso(171) }],
  notebook: `colab/${EXECUTION_ID}/daily-sales.ipynb`,
};

export const schedules: ColabSchedule[] = [
  {
    name: `${numbered}/schedules/${SCHEDULE_ID}`,
    id: SCHEDULE_ID,
    location: L,
    displayName: 'Daily sales at 6',
    cron: 'TZ=America/Sao_Paulo 0 6 * * 1-5',
    state: 'active',
    maxConcurrentRunCount: 1,
    maxRunCount: null,
    startedRunCount: 212,
    allowQueueing: false,
    catchUp: false,
    startTime: iso(60 * 24 * 300),
    endTime: null,
    nextRunTime: iso(-60 * 15),
    lastPauseTime: null,
    lastResumeTime: null,
    lastRun: { scheduledRunTime: iso(180), response: `${numbered}/notebookExecutionJobs/${EXECUTION_ID}` },
    createTime: iso(60 * 24 * 300),
    updateTime: iso(60 * 24 * 10),
    job,
  },
];

export const templates: ColabTemplate[] = [
  {
    name: `${base}/notebookRuntimeTemplates/${TEMPLATE_ID}`,
    id: TEMPLATE_ID,
    location: L,
    displayName: 'GPU L4',
    description: 'For model training',
    type: 'user_defined',
    machine: { machineType: 'g2-standard-4', acceleratorType: 'NVIDIA_L4', acceleratorCount: 1, diskType: 'pd-balanced', diskSizeGb: 200 },
    network: { network: null, subnetwork: null, internetAccess: true, tags: [] },
    idleShutdown: { disabled: false, timeoutMinutes: 180 },
    euc: null,
    secureBoot: false,
    postStartupScript: { script: 'pip install -q polars', url: null, behavior: 'RUN_EVERY_START' },
    env: { MODE: 'prod' },
    colabImage: { releaseName: null, description: null },
    kmsKeyName: null,
    labels: { team: 'data' },
    createTime: iso(60 * 24 * 90),
    updateTime: iso(60 * 24 * 20),
  },
];

export const runtimes: ColabRuntime[] = [
  {
    name: `${base}/notebookRuntimes/${RUNTIME_ID}`,
    id: RUNTIME_ID,
    location: L,
    displayName: 'Ana GPU runtime',
    description: null,
    state: 'running',
    health: 'healthy',
    runtimeUser: 'ana@example.com',
    template: `${numbered}/notebookRuntimeTemplates/${TEMPLATE_ID}`,
    type: 'user_defined',
    machine: { machineType: 'g2-standard-4', acceleratorType: 'NVIDIA_L4', acceleratorCount: 1, diskType: 'pd-balanced', diskSizeGb: 200 },
    network: { network: null, subnetwork: null, internetAccess: true, tags: [] },
    idleShutdown: { disabled: false, timeoutMinutes: 180 },
    upgradable: true,
    version: 'colab-20260915',
    colabImage: 'Python 3.11',
    entryService: 'vertex',
    expirationTime: iso(-60 * 24 * 150),
    createTime: iso(60 * 5),
    updateTime: iso(30),
    labels: {},
  },
];
