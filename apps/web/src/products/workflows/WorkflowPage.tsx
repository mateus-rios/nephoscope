import type { WorkflowExecution, WorkflowExecutionState, WorkflowRevision } from '@nephoscope/contracts';
import { GitDiffIcon, PlayIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { DiffEditor } from '../../design/code/CodeEditor';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Dialog, MenuItem } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { LogsPanel } from '../../kit/LogsPanel';
import { MetricsPanel } from '../../kit/MetricsPanel';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { duration } from '../../lib/format';
import { useOperations } from '../../state/operations';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { JobSheet } from '../scheduler/JobSheet';
import { TriggersTab } from '../shared/TriggersTab';
import { deleteWorkflow, useWorkflow, useWorkflowExecutions, useWorkflowRaw, useWorkflowRevisions, workflowLogFilter } from './api';
import { ExecuteSheet } from './ExecuteSheet';
import { SourceEditor } from './SourceEditor';
import { sourceLanguage } from './schema';
import { WorkflowGraph } from './WorkflowGraph';
import { logLevelLabel, WorkflowStateGlyph } from './WorkflowsPage';

const TABS = [
  { key: 'source', label: 'Source' },
  { key: 'graph', label: 'Graph' },
  { key: 'executions', label: 'Executions' },
  { key: 'revisions', label: 'Revisions' },
  { key: 'triggers', label: 'Triggers' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'logs', label: 'Logs' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function ExecutionStateGlyph({ state }: { state: WorkflowExecutionState }) {
  switch (state) {
    case 'succeeded':
      return <StatusGlyph kind="ok" label="Succeeded" />;
    case 'failed':
      return <StatusGlyph kind="error" label="Failed" />;
    case 'active':
      return <StatusGlyph kind="running" label="Running" />;
    case 'queued':
      return <StatusGlyph kind="pending" label="Queued" />;
    case 'cancelled':
      return <StatusGlyph kind="paused" label="Cancelled" />;
    default:
      return <StatusGlyph kind="unknown" label={state === 'unavailable' ? 'Unavailable' : 'Unknown'} />;
  }
}

function RevisionsTab({ projectId, location, id }: { projectId: string; location: string; id: string }) {
  const query = useWorkflowRevisions(projectId, location, id, true);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [pair, setPair] = useState<[WorkflowRevision, WorkflowRevision] | null>(null);
  const revisions = query.data ?? [];
  const columns: ResourceColumn<WorkflowRevision>[] = [
    {
      id: 'id',
      header: 'Revision',
      hideable: false,
      sortValue: (r) => r.revisionId,
      cell: (r) => <span className="font-mono text-[12px]">{r.revisionId}</span>,
    },
    {
      id: 'created',
      header: 'Deployed',
      width: '9rem',
      sortValue: (r) => r.createTime ?? '',
      cell: (r) => <Timestamp iso={r.createTime} />,
    },
    {
      id: 'size',
      header: 'Lines',
      width: '6rem',
      align: 'right',
      cell: (r) => <span className="tnum">{r.sourceContents.split('\n').length}</span>,
    },
  ];
  if (query.isPending) return <DelayedSkeleton />;
  if (query.error instanceof ApiError) return <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />;
  return (
    <div className="pt-3">
      <ResourceTable
        tableId="workflow-revisions"
        label="Revisions"
        rows={revisions}
        columns={columns}
        getRowId={(r) => r.revisionId}
        selectable
        selection={selection}
        onSelectionChange={(next) => setSelection(new Set([...next].slice(-2)))}
        emptyTitle="No revisions"
        toolbar={
          <Button
            icon={GitDiffIcon}
            disabled={selection.size !== 2}
            disabledReason="Select two revisions"
            onClick={() => {
              const picked = revisions
                .filter((r) => selection.has(r.revisionId))
                .sort((a, b) => (a.createTime ?? '').localeCompare(b.createTime ?? ''));
              const [a, b] = picked;
              if (picked.length === 2 && a && b) setPair([a, b]);
            }}
          >
            Compare revisions
          </Button>
        }
      />
      <Dialog
        open={pair !== null}
        onOpenChange={(o) => !o && setPair(null)}
        width="xl"
        title={pair ? `Compare ${pair[0].revisionId} with ${pair[1].revisionId}` : ''}
      >
        {pair ? (
          <DiffEditor
            original={pair[0].sourceContents}
            modified={pair[1].sourceContents}
            language={sourceLanguage(pair[1].sourceContents)}
            height="60vh"
            label="Revision differences"
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function ExecutionsTab({ projectId, location, id }: { projectId: string; location: string; id: string }) {
  const query = useWorkflowExecutions(projectId, location, id);
  const navigate = useNavigate();
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const href = (e: WorkflowExecution) => `/p/${projectId}/workflows/${location}/${id}/executions/${e.id}`;
  const columns: ResourceColumn<WorkflowExecution>[] = [
    {
      id: 'id',
      header: 'Execution',
      hideable: false,
      sortValue: (e) => e.startTime ?? '',
      cell: (e) => (
        <Link to={href(e)} className="font-mono text-[12px] text-ink" onClick={(ev) => ev.stopPropagation()}>
          {e.id}
        </Link>
      ),
    },
    { id: 'state', header: 'Status', width: '8rem', sortValue: (e) => e.state, cell: (e) => <ExecutionStateGlyph state={e.state} /> },
    {
      id: 'started',
      header: 'Started',
      width: '8.5rem',
      sortValue: (e) => e.startTime ?? '',
      cell: (e) => <Timestamp iso={e.startTime} />,
    },
    {
      id: 'duration',
      header: 'Duration',
      width: '6rem',
      cell: (e) => <span className="tnum text-ink-2">{e.durationSeconds !== null ? duration(e.durationSeconds * 1000) : ''}</span>,
    },
    {
      id: 'revision',
      header: 'Revision',
      width: '9rem',
      cell: (e) => <span className="font-mono text-[12px] text-ink-2">{e.revisionId}</span>,
    },
  ];
  if (query.isPending) return <DelayedSkeleton />;
  if (query.error instanceof ApiError) return <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />;
  return (
    <div className="pt-3">
      <ResourceTable
        tableId="workflow-executions"
        label="Executions"
        rows={rows}
        columns={columns}
        getRowId={(e) => e.id}
        onOpen={(e) => void navigate({ to: href(e) })}
        emptyTitle="Never executed"
        emptyText="Execute the workflow to see its steps run."
        hasMore={query.hasNextPage}
        loadingMore={query.isFetchingNextPage}
        onLoadMore={() => void query.fetchNextPage()}
      />
    </div>
  );
}

/** A workflow (SPEC-0003 CA-19 to CA-21). */
export function WorkflowPage() {
  const { projectId, location, workflow: id } = useParams({ strict: false }) as { projectId: string; location: string; workflow: string };
  const query = useWorkflow(projectId, location, id);
  const [tab, setTab] = useSearchState<Tab>(
    'tab',
    'source',
    TABS.map((t) => t.key),
  );
  const [lines, setLines] = useSearchState<string>('lines', '');
  const raw = useWorkflowRaw(projectId, location, id, tab === 'yaml');
  const [executing, setExecuting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const navigate = useNavigate();
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);

  const w = query.data;
  if (query.isPending) return <DelayedSkeleton rows={8} className="p-6" />;
  if (query.error instanceof ApiError || !w)
    return query.error instanceof ApiError ? <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} /> : null;
  const [from, to] = lines.split('-').map(Number);
  const initialSelection = from ? { startLine: from, endLine: to || from } : null;

  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Workflows', to: `/p/${projectId}/workflows` }, { label: w.id }]}
        title={w.id}
        status={<WorkflowStateGlyph state={w.state} />}
        subtitle={w.description}
        actions={
          <Button icon={PlayIcon} onClick={() => setExecuting(true)} disabled={!!readOnly} disabledReason={readOnly}>
            Execute
          </Button>
        }
        menu={
          <>
            <MenuItem onClick={() => setScheduling(true)} disabled={!!readOnly}>
              Schedule this workflow
            </MenuItem>
            <MenuItem onClick={() => setDeleting(true)} className="text-redline-ink" disabled={!!readOnly}>
              Delete workflow
            </MenuItem>
          </>
        }
        cells={[
          { label: 'Location', value: <Mono value={w.location} />, mono: true },
          { label: 'Revision', value: w.revisionId ?? '', mono: true },
          { label: 'Updated', value: <Timestamp iso={w.updateTime} /> },
          { label: 'Call logs', value: logLevelLabel[w.callLogLevel] },
          {
            label: 'Service account',
            value: w.serviceAccount ? <Mono value={w.serviceAccount.split('/').pop() ?? ''} /> : 'Default',
            wide: true,
          },
        ]}
        tabs={TABS}
        defaultTab="source"
      >
        {(current) => {
          switch (current) {
            case 'source':
              return (
                <SourceEditor
                  key={w.revisionId ?? 'x'}
                  projectId={projectId}
                  workflow={w}
                  readOnlyReason={readOnly}
                  initialSelection={initialSelection}
                />
              );
            case 'graph':
              return (
                <WorkflowGraph
                  source={w.sourceContents}
                  onSelect={(n) => {
                    if (!n.lines) return;
                    setLines(`${n.lines.start}-${n.lines.end}`);
                    setTab('source');
                  }}
                />
              );
            case 'executions':
              return <ExecutionsTab projectId={projectId} location={w.location} id={w.id} />;
            case 'revisions':
              return <RevisionsTab projectId={projectId} location={w.location} id={w.id} />;
            case 'triggers':
              return <TriggersTab projectId={projectId} match={{ kind: 'workflow', name: w.name }} />;
            case 'metrics':
              return <MetricsPanel projectId={projectId} kind="workflow" labels={{ workflow_id: w.id, location: w.location }} />;
            case 'logs':
              return <LogsPanel projectId={projectId} filter={workflowLogFilter(w.id, w.location)} />;
            case 'yaml':
              return (
                <RawView value={raw.data} fileName={w.id} loading={raw.isPending} error={raw.error} onRetry={() => void raw.refetch()} />
              );
          }
        }}
      </DetailLayout>
      <ExecuteSheet projectId={projectId} workflow={w} open={executing} onOpenChange={setExecuting} readOnlyReason={readOnly} />
      <JobSheet
        projectId={projectId}
        open={scheduling}
        onOpenChange={setScheduling}
        job={null}
        readOnlyReason={readOnly}
        prefill={{
          id: `${w.id}-schedule`,
          region: w.location,
          description: `Executes the workflow ${w.id}`,
          target: {
            kind: 'http',
            uri: `https://workflowexecutions.googleapis.com/v1/${w.name}/executions`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // The argument is a JSON string inside the request body.
            body: JSON.stringify({ argument: '{}' }, null, 2),
            auth: {
              kind: 'oauth',
              serviceAccount: w.serviceAccount?.split('/').pop() ?? '',
              scope: 'https://www.googleapis.com/auth/cloud-platform',
            },
          },
        }}
      />
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete workflow"
        consequence={`The workflow ${w.id}, its revisions and its execution history are deleted. Running executions are cancelled.`}
        expected={w.id}
        confirmLabel="Delete workflow"
        command={`gcloud workflows delete ${w.id} --location=${w.location} --project=${projectId}`}
        onConfirm={async (confirm) => {
          const { operation } = await deleteWorkflow(projectId, w.location, w.id, confirm);
          useOperations.getState().upsert(operation);
          void navigate({ to: `/p/${projectId}/workflows` });
        }}
      />
    </>
  );
}
