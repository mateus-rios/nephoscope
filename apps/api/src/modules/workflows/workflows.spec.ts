import { describe, expect, it } from 'vitest';
import { workflowHref } from './workflows.service.js';
import { deployErrorPosition, mapExecution, mapStepEntry, mapWorkflow } from './workflows-mapping.js';

describe('workflows mapping', () => {
  it('maps a workflow with its source and settings', () => {
    const w = mapWorkflow({
      name: 'projects/demo/locations/us-central1/workflows/order-flow',
      state: 'ACTIVE',
      revisionId: '000003-7c4',
      sourceContents: 'main:\n  steps:\n    - done:\n        return: 1\n',
      callLogLevel: 'LOG_ERRORS_ONLY',
      executionHistoryLevel: 'EXECUTION_HISTORY_DETAILED',
      serviceAccount: 'projects/demo/serviceAccounts/wf@demo.iam.gserviceaccount.com',
      userEnvVars: { MODE: 'prod' },
    });
    expect(w).toMatchObject({
      id: 'order-flow',
      location: 'us-central1',
      state: 'active',
      callLogLevel: 'LOG_ERRORS_ONLY',
      executionHistoryLevel: 'EXECUTION_HISTORY_DETAILED',
      userEnvVars: { MODE: 'prod' },
    });
    expect(w.sourceContents).toContain('return: 1');
  });

  it('maps a failed execution with its stack trace', () => {
    const e = mapExecution({
      name: 'projects/demo/locations/us-central1/workflows/order-flow/executions/abc-123',
      state: 'FAILED',
      duration: { seconds: '12', nanos: 500000000 },
      argument: '{"id":1}',
      error: {
        payload: '{"code":404}',
        context: 'HTTP 404',
        stackTrace: { elements: [{ step: 'fetch', routine: 'main', position: { line: '7', column: '9' } }] },
      },
      status: { currentSteps: [{ routine: 'main', step: 'fetch' }] },
    });
    expect(e).toMatchObject({
      id: 'abc-123',
      workflow: 'projects/demo/locations/us-central1/workflows/order-flow',
      state: 'failed',
      durationSeconds: 12.5,
    });
    expect(e.error?.stackTrace[0]).toEqual({ step: 'fetch', routine: 'main', line: 7, column: 9 });
  });

  it('maps REST step entries with detailed variables', () => {
    expect(
      mapStepEntry({
        entryId: '4',
        routine: 'main',
        step: 'assign_total',
        stepType: 'STEP_ASSIGN',
        state: 'STATE_SUCCEEDED',
        variableData: { variables: { total: 42 } },
      }),
    ).toMatchObject({ entryId: '4', stepType: 'assign', state: 'succeeded', variables: { total: 42 } });
  });

  it('finds the line and column of a deploy error (T-11)', () => {
    expect(deployErrorPosition('Could not deploy workflow: main.yaml:5:3: parse error: unexpected key')).toEqual({ line: 5, column: 3 });
    expect(deployErrorPosition('failed to build: parse error (line 12, column 7): invalid step')).toEqual({ line: 12, column: 7 });
    expect(deployErrorPosition('failed to build: missing step name at line 4')).toEqual({ line: 4, column: null });
    expect(deployErrorPosition('permission denied')).toBeNull();
  });

  it('links workflows and executions to web routes', () => {
    expect(workflowHref('projects/demo/locations/us-central1/workflows/order-flow')).toBe('/p/demo/workflows/us-central1/order-flow');
    expect(workflowHref('projects/demo/locations/us-central1/workflows/order-flow/executions/abc')).toBe(
      '/p/demo/workflows/us-central1/order-flow/executions/abc',
    );
  });
});
