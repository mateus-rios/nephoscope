import type { Workflow } from '@nephoscope/contracts';
import { deployErrorPosition } from '@nephoscope/contracts/workflows-schema';
import { ArrowCounterClockwiseIcon, RocketIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { CodeEditor, type EditorMarker } from '../../design/code/CodeEditor';
import { type Note, Notes } from '../../design/Drafting';
import { Switch } from '../../design/Form';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { ApiError } from '../../lib/api';
import { useOperations } from '../../state/operations';
import { useDeployWorkflow } from './api';
import { parseWorkflow, stepAtLine } from './graph';
import { sourceLanguage, WORKFLOW_SCHEMA } from './schema';
import { WorkflowGraph } from './WorkflowGraph';

interface SourceEditorProps {
  projectId: string;
  workflow: Workflow;
  readOnlyReason: string | null;
  /** Lines to select when arriving from the Graph tab. */
  initialSelection: { startLine: number; endLine: number } | null;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The editor with schema validation, deploy markers and a live graph (SPEC-0003 D-10, CA-20). */
export function SourceEditor({ projectId, workflow, readOnlyReason, initialSelection }: SourceEditorProps) {
  const [draft, setDraft] = useState(workflow.sourceContents);
  const [baseline, setBaseline] = useState(workflow.sourceContents);
  const [showGraph, setShowGraph] = useState(true);
  const [selection, setSelection] = useState(initialSelection);
  const [cursorLine, setCursorLine] = useState<number | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const deploy = useDeployWorkflow(projectId, workflow.location, workflow.id);
  const operation = useOperations((s) => (operationId ? s.byId[operationId] : undefined));

  // A new revision from elsewhere replaces the baseline; unsaved edits stay.
  useEffect(() => {
    if (workflow.sourceContents !== baseline) {
      if (draft === baseline) setDraft(workflow.sourceContents);
      setBaseline(workflow.sourceContents);
    }
  }, [workflow.sourceContents, baseline, draft]);

  // SPEC-0003 T-11: a failed deploy becomes a marker at the reported line.
  useEffect(() => {
    if (operation?.status === 'failed') setDeployError(operation.error?.detail ?? operation.message ?? 'The deploy failed.');
    if (operation?.status === 'succeeded') setDeployError(null);
  }, [operation?.status, operation?.error?.detail, operation?.message]);

  const markers = useMemo<EditorMarker[]>(() => {
    if (!deployError) return [];
    const pos = deployErrorPosition(deployError);
    return pos ? [{ line: pos.line, column: pos.column ?? undefined, message: deployError }] : [];
  }, [deployError]);

  const debounced = useDebounced(draft, 300);
  const parsed = useMemo(() => parseWorkflow(debounced), [debounced]);
  const selectedNode = useMemo(() => {
    if (cursorLine === null) return null;
    const s = stepAtLine(parsed, cursorLine);
    return s?.id ?? null;
  }, [parsed, cursorLine]);

  const dirty = draft !== baseline;
  const language = sourceLanguage(draft);
  const notes: Note[] = [];
  if (deployError) notes.push({ id: 'deploy', tone: 'error', text: `Deploy failed: ${deployError}` });
  if (operation?.status === 'running') notes.push({ id: 'deploying', tone: 'info', text: 'Deploying a new revision.' });
  if (workflow.stateError) notes.push({ id: 'state', tone: 'error', text: workflow.stateError });

  return (
    <div className="flex flex-col">
      <Notes notes={notes} title="Status" />
      <div className="flex flex-wrap items-center gap-3 px-6 py-3">
        <Switch checked={showGraph} onCheckedChange={setShowGraph} label="Show graph" />
        <span className="text-meta text-ink-3">{dirty ? 'Unsaved changes' : `Revision ${workflow.revisionId ?? ''}`}</span>
        <span className="ml-auto flex items-center gap-2">
          <Button icon={ArrowCounterClockwiseIcon} variant="ghost" disabled={!dirty} onClick={() => setDraft(baseline)}>
            Discard changes
          </Button>
          <Button
            variant="commit"
            icon={RocketIcon}
            disabled={!dirty || !!readOnlyReason}
            disabledReason={readOnlyReason ?? 'No changes to deploy'}
            loading={deploy.isPending}
            onClick={() => {
              setDeployError(null);
              deploy.mutate(
                { sourceContents: draft },
                {
                  onSuccess: (r) => {
                    setOperationId(r.operation.id);
                    setBaseline(draft);
                  },
                  onError: (err) => setDeployError(err instanceof ApiError ? err.problem.detail : String(err)),
                },
              );
            }}
          >
            Deploy
          </Button>
        </span>
      </div>
      <div
        className={
          showGraph ? 'grid grid-cols-1 gap-0 border-t border-rule xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]' : 'border-t border-rule'
        }
      >
        <div className="min-w-0 p-3">
          <CodeEditor
            value={draft}
            onChange={setDraft}
            language={language}
            path={`workflow/${workflow.id}.${language}`}
            jsonSchema={WORKFLOW_SCHEMA}
            markers={markers}
            selection={selection}
            onCursorLine={setCursorLine}
            height="68vh"
            label={`Source of ${workflow.id}`}
          />
        </div>
        {showGraph ? (
          <div className="min-w-0 border-l border-rule">
            <WorkflowGraph
              source={debounced}
              height="calc(68vh + 24px)"
              selected={selectedNode}
              onSelect={(n) => n.lines && setSelection({ startLine: n.lines.start, endLine: n.lines.end })}
            />
          </div>
        ) : null}
      </div>
      <div className="px-6 py-3">
        <EquivalentCommand
          gcloud={`gcloud workflows deploy ${workflow.id} --location=${workflow.location} --project=${projectId} --source=${workflow.id}.${language}`}
        />
      </div>
    </div>
  );
}
