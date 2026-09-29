import type { StepEntry, Workflow, WorkflowExecution, WorkflowSummary } from '@nephoscope/contracts';
import { PROJECT } from './fixtures';

const now = Date.parse('2026-09-28T12:00:00Z');
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

export const WORKFLOW_SOURCE = `main:
  params: [args]
  steps:
    - init:
        assign:
          - order: \${args.order}
          - total: 0
    - validate:
        switch:
          - condition: \${order.items == null}
            raise: "Order without items"
        next: price
    - price:
        for:
          value: item
          in: \${order.items}
          steps:
            - add:
                assign:
                  - total: \${total + item.price}
    - charge:
        try:
          call: http.post
          args:
            url: https://payments.example.com/charge
            body:
              amount: \${total}
          result: payment
        retry: \${http.default_retry}
        except:
          as: e
          steps:
            - notify:
                call: sys.log
                args:
                  text: \${e.message}
                  severity: ERROR
            - fail:
                raise: \${e}
    - done:
        return: \${payment.body}
`;

export const workflowList: WorkflowSummary[] = [
  {
    name: `projects/${PROJECT}/locations/us-central1/workflows/order-flow`,
    id: 'order-flow',
    location: 'us-central1',
    state: 'active',
    revisionId: '000007-2c1',
    updateTime: iso(60 * 5),
    callLogLevel: 'LOG_ERRORS_ONLY',
    description: 'Prices and charges an order',
    labels: {},
  },
  {
    name: `projects/${PROJECT}/locations/europe-west4/workflows/nightly-report`,
    id: 'nightly-report',
    location: 'europe-west4',
    state: 'active',
    revisionId: '000002-9aa',
    updateTime: iso(60 * 24 * 12),
    callLogLevel: 'CALL_LOG_LEVEL_UNSPECIFIED',
    description: null,
    labels: {},
  },
];

export const workflow: Workflow = {
  ...workflowList[0]!,
  createTime: iso(60 * 24 * 60),
  revisionCreateTime: iso(60 * 5),
  serviceAccount: `projects/${PROJECT}/serviceAccounts/workflows@${PROJECT}.iam.gserviceaccount.com`,
  sourceContents: WORKFLOW_SOURCE,
  stateError: null,
  executionHistoryLevel: 'EXECUTION_HISTORY_DETAILED',
  userEnvVars: {},
  cryptoKeyName: null,
};

export const EXECUTION_ID = '7d1f0c2a-1111-4c55-9a2e-5b0f3d2c9e10';

export const workflowExecution: WorkflowExecution = {
  name: `${workflow.name}/executions/${EXECUTION_ID}`,
  id: EXECUTION_ID,
  workflow: workflow.name,
  state: 'failed',
  startTime: iso(30),
  endTime: iso(29),
  durationSeconds: 4.2,
  argument: '{"order":{"id":42,"items":[{"price":10},{"price":5}]}}',
  result: null,
  error: {
    payload: '{"message":"HTTP 502 from payments","code":502}',
    context: null,
    stackTrace: [{ step: 'charge', routine: 'main', line: 22, column: 9 }],
  },
  revisionId: '000007-2c1',
  callLogLevel: 'LOG_ERRORS_ONLY',
  historyLevel: 'EXECUTION_HISTORY_DETAILED',
  currentSteps: [],
  labels: {},
};

const rows: [string, string, string, 'succeeded' | 'failed'][] = [
  ['1', 'init', 'assign', 'succeeded'],
  ['2', 'validate', 'switch', 'succeeded'],
  ['3', 'price', 'for', 'succeeded'],
  ['4', 'add', 'assign', 'succeeded'],
  ['5', 'add', 'assign', 'succeeded'],
  ['6', 'charge', 'try_retry_except', 'failed'],
  ['7', 'notify', 'std_lib_call', 'succeeded'],
  ['8', 'fail', 'raise', 'failed'],
];

export const workflowSteps: StepEntry[] = rows.map(([entryId, step, stepType, state]) => ({
  entryId,
  routine: 'main',
  step,
  stepType,
  state,
  createTime: iso(30),
  updateTime: iso(30),
  exception: state === 'failed' ? '{"message":"HTTP 502 from payments"}' : null,
  variables: { total: 15, order: { id: 42 } },
  iteration: step === 'add' ? String(Number(entryId) - 3) : null,
}));
