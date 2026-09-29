import type {
  CallLogLevel,
  HistoryLevel,
  StepEntry,
  StepEntryState,
  Workflow,
  WorkflowError,
  WorkflowExecution,
  WorkflowExecutionState,
  WorkflowRevision,
  WorkflowSummary,
} from '@nephoscope/contracts';
import { callLogLevels, historyLevels } from '@nephoscope/contracts';
import { durationToSeconds, timestampToIso, toInt } from '../../core/gcp/proto.js';

// biome-ignore lint/suspicious/noExplicitAny: generated messages and REST JSON are read field by field.
type Any = any;

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const shortName = (name: string) => name.split('/').pop() ?? name;

const logLevel = (v: unknown): CallLogLevel =>
  (callLogLevels as readonly string[]).includes(String(v)) ? (v as CallLogLevel) : 'CALL_LOG_LEVEL_UNSPECIFIED';
const historyLevel = (v: unknown): HistoryLevel =>
  (historyLevels as readonly string[]).includes(String(v)) ? (v as HistoryLevel) : 'EXECUTION_HISTORY_LEVEL_UNSPECIFIED';

export function mapWorkflowSummary(w: Any): WorkflowSummary {
  const name = String(w?.name ?? '');
  return {
    name,
    id: shortName(name),
    location: /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '',
    state: w?.state === 'ACTIVE' ? 'active' : w?.state === 'UNAVAILABLE' ? 'unavailable' : 'unknown',
    revisionId: nonEmpty(w?.revisionId),
    updateTime: timestampToIso(w?.updateTime),
    callLogLevel: logLevel(w?.callLogLevel),
    description: nonEmpty(w?.description),
    labels: { ...(w?.labels ?? {}) },
  };
}

export function mapWorkflow(w: Any): Workflow {
  return {
    ...mapWorkflowSummary(w),
    createTime: timestampToIso(w?.createTime),
    revisionCreateTime: timestampToIso(w?.revisionCreateTime),
    serviceAccount: nonEmpty(w?.serviceAccount),
    sourceContents: String(w?.sourceContents ?? ''),
    stateError: nonEmpty(w?.stateError?.details),
    executionHistoryLevel: historyLevel(w?.executionHistoryLevel),
    userEnvVars: { ...(w?.userEnvVars ?? {}) },
    cryptoKeyName: nonEmpty(w?.cryptoKeyName),
  };
}

export function mapRevision(w: Any): WorkflowRevision {
  return {
    revisionId: String(w?.revisionId ?? ''),
    createTime: timestampToIso(w?.revisionCreateTime),
    sourceContents: String(w?.sourceContents ?? ''),
  };
}

const EXECUTION_STATES: Record<string, WorkflowExecutionState> = {
  QUEUED: 'queued',
  ACTIVE: 'active',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  UNAVAILABLE: 'unavailable',
};

function mapError(e: Any): WorkflowError | null {
  if (!e || (!nonEmpty(e.payload) && !nonEmpty(e.context))) return null;
  return {
    payload: nonEmpty(e.payload),
    context: nonEmpty(e.context),
    stackTrace: (e.stackTrace?.elements ?? []).map((el: Any) => ({
      step: nonEmpty(el?.step),
      routine: nonEmpty(el?.routine),
      line: toInt(el?.position?.line),
      column: toInt(el?.position?.column),
    })),
  };
}

export function mapExecution(e: Any): WorkflowExecution {
  const name = String(e?.name ?? '');
  return {
    name,
    id: shortName(name),
    workflow: name.replace(/\/executions\/[^/]+$/, ''),
    state: EXECUTION_STATES[String(e?.state)] ?? 'unknown',
    startTime: timestampToIso(e?.startTime),
    endTime: timestampToIso(e?.endTime),
    durationSeconds: durationToSeconds(e?.duration),
    argument: nonEmpty(e?.argument),
    result: nonEmpty(e?.result),
    error: mapError(e?.error),
    revisionId: nonEmpty(e?.workflowRevisionId),
    callLogLevel: logLevel(e?.callLogLevel),
    historyLevel: historyLevel(e?.executionHistoryLevel),
    currentSteps: (e?.status?.currentSteps ?? []).map((s: Any) => ({ routine: String(s?.routine ?? ''), step: String(s?.step ?? '') })),
    labels: { ...(e?.labels ?? {}) },
  };
}

const STEP_STATES: Record<string, StepEntryState> = {
  STATE_IN_PROGRESS: 'in_progress',
  STATE_SUCCEEDED: 'succeeded',
  STATE_FAILED: 'failed',
  STATE_CANCELLED: 'cancelled',
};

/** A step entry from the REST API (SPEC-0003 D-11). */
export function mapStepEntry(s: Any): StepEntry {
  return {
    entryId: String(s?.entryId ?? ''),
    routine: String(s?.routine ?? ''),
    step: String(s?.step ?? ''),
    stepType: String(s?.stepType ?? 'STEP_TYPE_UNSPECIFIED')
      .replace(/^STEP_/, '')
      .toLowerCase(),
    state: STEP_STATES[String(s?.state)] ?? 'unknown',
    createTime: nonEmpty(s?.createTime),
    updateTime: nonEmpty(s?.updateTime),
    exception: nonEmpty(s?.exception?.payload),
    variables: s?.variableData?.variables ? { ...s.variableData.variables } : null,
    iteration: nonEmpty(s?.stepEntryMetadata?.expectedIteration) ?? nonEmpty(s?.stepEntryMetadata?.progressNumber),
  };
}

export { deployErrorPosition } from '@nephoscope/contracts/workflows-schema';
