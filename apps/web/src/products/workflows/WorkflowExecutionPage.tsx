import type { StepEntry, WorkflowExecutionUpdate } from '@nephoscope/contracts';
import { CaretDownIcon, CaretRightIcon, StopIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Legend, type Note, Notes, Section } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { JsonTree } from '../../design/JsonTree';
import { StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { LogsPanel } from '../../kit/LogsPanel';
import { ApiError } from '../../lib/api';
import { duration } from '../../lib/format';
import { live } from '../../lib/live';
import { useActiveProfile, useInstance } from '../../state/queries';
import { useSession } from '../../state/session';
import { readOnlyReason } from '../run/common';
import { useCancelWorkflowExecution, useWorkflow, useWorkflowExecution, workflowLogFilter } from './api';
import { type GraphHighlight, WorkflowGraph } from './WorkflowGraph';
import { ExecutionStateGlyph } from './WorkflowPage';

const TABS = [
  { key: 'steps', label: 'Steps' },
  { key: 'graph', label: 'Graph' },
  { key: 'io', label: 'Input and output' },
  { key: 'logs', label: 'Logs' },
] as const;
type Tab = (typeof TABS)[number]['key'];

function pretty(json: string | null): string {
  if (!json) return '';
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function StepRow({ step }: { step: StepEntry }) {
  const [open, setOpen] = useState(false);
  const expandable = step.variables !== null || step.exception !== null;
  const glyph =
    step.state === 'succeeded' ? (
      <StatusGlyph kind="ok" label="Succeeded" compact />
    ) : step.state === 'failed' ? (
      <StatusGlyph kind="error" label="Failed" compact />
    ) : step.state === 'in_progress' ? (
      <StatusGlyph kind="running" label="Running" compact />
    ) : step.state === 'cancelled' ? (
      <StatusGlyph kind="paused" label="Cancelled" compact />
    ) : (
      <StatusGlyph kind="unknown" label="Unknown" compact />
    );
  return (
    <li className="border-b border-rule">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        className="grid w-full grid-cols-[1rem_3rem_1.25rem_minmax(0,1fr)_8rem_8rem_7rem] items-center gap-x-2 px-6 py-1 text-left text-dense enabled:hover:bg-hover"
      >
        {expandable ? open ? <CaretDownIcon size={12} aria-hidden /> : <CaretRightIcon size={12} aria-hidden /> : <span />}
        <span className="tnum font-mono text-[11px] text-ink-3">{step.entryId}</span>
        {glyph}
        <span className="truncate font-mono text-[12px] text-ink">
          {step.routine !== 'main' ? <span className="text-ink-3">{step.routine} / </span> : null}
          {step.step}
          {step.iteration ? <span className="text-ink-3"> #{step.iteration}</span> : null}
        </span>
        <span className="truncate text-meta text-ink-2">{step.stepType.replaceAll('_', ' ')}</span>
        <span className="text-meta text-ink-2">
          <Timestamp iso={step.createTime} />
        </span>
        <span className="tnum text-right text-meta text-ink-2">
          {step.createTime && step.updateTime ? duration(Date.parse(step.updateTime) - Date.parse(step.createTime)) : ''}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 px-6 pt-1 pb-3 pl-12">
          {step.exception ? (
            <pre className="m-0 overflow-auto rounded-control bg-redline-tint p-2 font-mono text-[11px] whitespace-pre-wrap text-redline-ink">
              {pretty(step.exception)}
            </pre>
          ) : null}
          {step.variables ? (
            <JsonTree value={step.variables} label={`Variables after ${step.step}`} expandDepth={1} height={320} searchable={false} />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** One workflow execution, live while it runs (SPEC-0003 D-11, CA-22). */
export function WorkflowExecutionPage() {
  const {
    projectId,
    location,
    workflow: id,
    execution,
  } = useParams({ strict: false }) as { projectId: string; location: string; workflow: string; execution: string };
  const profileId = useSession((s) => s.profileId);
  const workflow = useWorkflow(projectId, location, id);
  const { exec, steps, key } = useWorkflowExecution(projectId, location, id, execution);
  const cancel = useCancelWorkflowExecution(projectId, location, id);
  const client = useQueryClient();
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  const e = exec.data;
  const running = e?.state === 'active' || e?.state === 'queued';

  // biome-ignore lint/correctness/useExhaustiveDependencies: the query key derives from the params; e changes on every update.
  useEffect(() => {
    if (!profileId || !running || !e) return;
    return live.subscribe(
      'workflows.execution',
      { profileId, projectId },
      { name: e.name },
      {
        data(payload) {
          const update = payload as WorkflowExecutionUpdate;
          client.setQueryData(key, update.execution);
          client.setQueryData([...key, 'steps'], update.steps);
        },
      },
    );
  }, [profileId, running, e?.name, projectId, client]);

  const highlight = useMemo<GraphHighlight>(() => {
    const ran = new Set<string>();
    const failed = new Set<string>();
    const current = new Set<string>();
    for (const s of steps.data ?? []) {
      const k = `${s.routine}/${s.step}`;
      ran.add(k);
      if (s.state === 'failed') failed.add(k);
      if (s.state === 'in_progress') current.add(k);
    }
    for (const c of e?.currentSteps ?? []) current.add(`${c.routine}/${c.step}`);
    return { ran, failed, current };
  }, [steps.data, e?.currentSteps]);

  if (exec.isPending) return <DelayedSkeleton rows={8} className="p-6" />;
  if (exec.error instanceof ApiError || !e)
    return exec.error instanceof ApiError ? <ProblemState problem={exec.error.problem} onRetry={() => void exec.refetch()} /> : null;

  const notes: Note[] = [];
  if (running) notes.push({ id: 'live', tone: 'info', text: 'This page updates by itself until the execution ends.' });
  if (e.historyLevel !== 'EXECUTION_HISTORY_DETAILED')
    notes.push({
      id: 'basic',
      tone: 'info',
      text: 'Basic history: step variables are not recorded. Execute with detailed history to see them.',
    });
  const base = `/p/${projectId}/workflows/${location}/${id}`;

  return (
    <DetailLayout<Tab>
      crumbs={[
        { label: 'Workflows', to: `/p/${projectId}/workflows` },
        { label: id, to: base },
        { label: 'Executions', to: `${base}?tab=executions` },
        { label: e.id },
      ]}
      title={e.id}
      status={<ExecutionStateGlyph state={e.state} />}
      actions={
        running ? (
          <Button
            icon={StopIcon}
            loading={cancel.isPending}
            disabled={!!readOnly}
            disabledReason={readOnly}
            onClick={() => cancel.mutate(e.id)}
          >
            Cancel execution
          </Button>
        ) : undefined
      }
      cells={[
        { label: 'Started', value: <Timestamp iso={e.startTime} /> },
        {
          label: 'Duration',
          value:
            e.durationSeconds !== null
              ? duration(e.durationSeconds * 1000)
              : running && e.startTime
                ? duration(Date.now() - Date.parse(e.startTime))
                : '',
        },
        { label: 'Revision', value: e.revisionId ?? '', mono: true },
        { label: 'Steps', value: String(steps.data?.length ?? '') },
        { label: 'History', value: e.historyLevel === 'EXECUTION_HISTORY_DETAILED' ? 'Detailed' : 'Basic' },
      ]}
      tabs={TABS}
      defaultTab="steps"
    >
      {(current) => {
        switch (current) {
          case 'steps':
            return (
              <>
                <Notes notes={notes} />
                {e.error ? (
                  <Section title="Error">
                    <div className="flex flex-col gap-2 px-6">
                      <pre className="m-0 overflow-auto rounded-control bg-redline-tint p-3 font-mono text-[12px] whitespace-pre-wrap text-redline-ink">
                        {pretty(e.error.payload) || e.error.context}
                      </pre>
                      {e.error.stackTrace.length > 0 ? (
                        <ol className="m-0 flex list-none flex-col gap-0.5 p-0 font-mono text-[11px] text-ink-2">
                          {e.error.stackTrace.map((s, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: frames repeat in recursion and never reorder.
                            <li key={`${s.routine}-${s.step}-${i}`}>
                              at {s.routine}/{s.step}
                              {s.line ? ` (line ${s.line}${s.column ? `, column ${s.column}` : ''})` : ''}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </div>
                  </Section>
                ) : null}
                {steps.isPending ? (
                  <DelayedSkeleton />
                ) : steps.error instanceof ApiError ? (
                  <ProblemState problem={steps.error.problem} onRetry={() => void steps.refetch()} />
                ) : (steps.data?.length ?? 0) === 0 ? (
                  <EmptyState title="No steps yet">Steps appear as the execution runs them.</EmptyState>
                ) : (
                  <ol aria-label="Step entries" className="m-0 list-none border-t border-rule p-0">
                    {steps.data?.map((s) => (
                      <StepRow key={s.entryId} step={s} />
                    ))}
                  </ol>
                )}
              </>
            );
          case 'graph':
            return workflow.data ? <WorkflowGraph source={workflow.data.sourceContents} highlight={highlight} /> : <DelayedSkeleton />;
          case 'io':
            return (
              <div className="grid grid-cols-1 gap-4 px-6 py-4 xl:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Legend>Argument</Legend>
                  <CodeEditor value={pretty(e.argument) || 'null'} language="json" readOnly height={320} label="Execution argument" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Legend>{e.error ? 'Error' : 'Result'}</Legend>
                  <CodeEditor
                    value={e.error ? pretty(e.error.payload) : pretty(e.result) || (running ? '' : 'null')}
                    language="json"
                    readOnly
                    height={320}
                    label={e.error ? 'Execution error' : 'Execution result'}
                  />
                </div>
                <p className="m-0 text-meta text-ink-3">
                  Execution <Mono value={e.name} copy />
                </p>
              </div>
            );
          case 'logs':
            return <LogsPanel projectId={projectId} filter={workflowLogFilter(id, location, e.id)} />;
        }
      }}
    </DetailLayout>
  );
}
