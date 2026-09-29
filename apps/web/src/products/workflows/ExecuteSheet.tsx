import type { CallLogLevel, HistoryLevel, Workflow } from '@nephoscope/contracts';
import { PlayIcon } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button } from '../../design/Button';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Field, Select } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { EquivalentCommand, sh } from '../../kit/EquivalentCommand';
import { useArgHistory, useExecuteWorkflow } from './api';

function jsonError(text: string): string | null {
  if (!text.trim()) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid JSON';
  }
}

/** Execute with an argument, recent arguments and history level (SPEC-0003 D-11, CA-21). */
export function ExecuteSheet({
  projectId,
  workflow,
  open,
  onOpenChange,
  readOnlyReason,
}: {
  projectId: string;
  workflow: Workflow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnlyReason: string | null;
}) {
  const [argument, setArgument] = useState('{}');
  const [logLevel, setLogLevel] = useState<CallLogLevel>('CALL_LOG_LEVEL_UNSPECIFIED');
  const [history, setHistory] = useState<HistoryLevel>('EXECUTION_HISTORY_LEVEL_UNSPECIFIED');
  const recents = useArgHistory(workflow.name);
  const execute = useExecuteWorkflow(projectId, workflow.location, workflow.id);
  const navigate = useNavigate();
  // biome-ignore lint/correctness/useExhaustiveDependencies: recents are read once, when the sheet opens.
  useEffect(() => {
    if (open) {
      setArgument(recents.data?.[0] ?? '{}');
      setLogLevel('CALL_LOG_LEVEL_UNSPECIFIED');
      setHistory('EXECUTION_HISTORY_LEVEL_UNSPECIFIED');
    }
  }, [open]);
  const error = jsonError(argument);
  const flags = [`--location=${workflow.location}`, `--project=${projectId}`];
  if (argument.trim()) flags.push(`--data=${sh(argument.replace(/\s+/g, ' ').trim())}`);
  if (logLevel !== 'CALL_LOG_LEVEL_UNSPECIFIED') flags.push(`--call-log-level=${logLevel.toLowerCase().replaceAll('_', '-')}`);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Execute ${workflow.id}`}
      description="Starts an execution of the deployed revision."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PlayIcon}
            loading={execute.isPending}
            disabled={!!error || !!readOnlyReason}
            disabledReason={readOnlyReason ?? error}
            onClick={() =>
              execute.mutate(
                {
                  argument,
                  callLogLevel: logLevel === 'CALL_LOG_LEVEL_UNSPECIFIED' ? undefined : logLevel,
                  historyLevel: history === 'EXECUTION_HISTORY_LEVEL_UNSPECIFIED' ? undefined : history,
                },
                {
                  onSuccess: (e) => {
                    onOpenChange(false);
                    void navigate({ to: `/p/${projectId}/workflows/${workflow.location}/${workflow.id}/executions/${e.id}` });
                  },
                },
              )
            }
          >
            Execute workflow
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {(recents.data?.length ?? 0) > 0 ? (
          <Field label="Recent arguments" help="The last 20 arguments used with this workflow, newest first.">
            <Select<string>
              value=""
              onValueChange={(v) => v && setArgument(v)}
              options={[
                { value: '', label: 'Choose a recent argument' },
                ...(recents.data ?? []).map((a) => ({ value: a, label: a.length > 80 ? `${a.slice(0, 79)}…` : a })),
              ]}
            />
          </Field>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-dense font-medium text-ink">Argument</span>
          <CodeEditor value={argument} onChange={setArgument} language="json" height={220} label="Execution argument" />
          {error ? (
            <span className="text-meta text-redline-ink">{error}</span>
          ) : (
            <span className="text-meta text-ink-3">JSON passed to the main params. Empty sends no argument.</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Call logs">
            <Select<CallLogLevel>
              value={logLevel}
              onValueChange={setLogLevel}
              options={[
                { value: 'CALL_LOG_LEVEL_UNSPECIFIED', label: 'As the workflow sets' },
                { value: 'LOG_ALL_CALLS', label: 'All calls' },
                { value: 'LOG_ERRORS_ONLY', label: 'Errors only' },
                { value: 'LOG_NONE', label: 'None' },
              ]}
            />
          </Field>
          <Field label="Execution history" help="Detailed keeps the variables of every step.">
            <Select<HistoryLevel>
              value={history}
              onValueChange={setHistory}
              options={[
                { value: 'EXECUTION_HISTORY_LEVEL_UNSPECIFIED', label: 'As the workflow sets' },
                { value: 'EXECUTION_HISTORY_BASIC', label: 'Basic' },
                { value: 'EXECUTION_HISTORY_DETAILED', label: 'Detailed' },
              ]}
            />
          </Field>
        </div>
        <EquivalentCommand
          gcloud={`gcloud workflows run ${workflow.id} ${flags.join(' ')}`}
          rest={{ method: 'POST', url: `https://workflowexecutions.googleapis.com/v1/${workflow.name}/executions`, body: { argument } }}
        />
      </div>
    </Sheet>
  );
}
