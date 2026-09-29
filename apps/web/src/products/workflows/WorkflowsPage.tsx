import type { WorkflowState, WorkflowSummary } from '@nephoscope/contracts';
import { PlusIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Notes, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { Facet, partialNote, RefreshControl, useFacet } from '../../kit/ListControls';
import { ApiError } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { RUN_REGIONS } from '../run/DeploySheet';
import { useCreateWorkflow, useWorkflows } from './api';
import { WORKFLOW_SCHEMA } from './schema';

export function WorkflowStateGlyph({ state }: { state: WorkflowState }) {
  if (state === 'active') return <StatusGlyph kind="ok" label="Active" />;
  if (state === 'unavailable') return <StatusGlyph kind="error" label="Unavailable" />;
  return <StatusGlyph kind="unknown" label="Unknown" />;
}

export const logLevelLabel: Record<string, string> = {
  LOG_ALL_CALLS: 'All calls',
  LOG_ERRORS_ONLY: 'Errors only',
  LOG_NONE: 'None',
  CALL_LOG_LEVEL_UNSPECIFIED: 'Default',
};

const STARTER = `main:
  params: [args]
  steps:
    - init:
        assign:
          - name: \${default(map.get(args, "name"), "world")}
    - greet:
        call: sys.log
        args:
          text: \${"Hello, " + name}
    - done:
        return: \${"Hello, " + name}
`;

function CreateWorkflowSheet({
  projectId,
  open,
  onOpenChange,
  readOnly,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnly: string | null;
}) {
  const [id, setId] = useState('');
  const [region, setRegion] = useState('us-central1');
  const [source, setSource] = useState(STARTER);
  const [touched, setTouched] = useState(false);
  const create = useCreateWorkflow(projectId);
  const navigate = useNavigate();
  useEffect(() => {
    if (open) {
      setId('');
      setSource(STARTER);
      setTouched(false);
    }
  }, [open]);
  const idError = !/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(id) ? 'Letters, digits, hyphens and underscores, starting with a letter.' : null;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create workflow"
      description="Deploys a new workflow from YAML or JSON source."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PlusIcon}
            loading={create.isPending}
            disabled={!!readOnly}
            disabledReason={readOnly}
            onClick={() => {
              setTouched(true);
              if (idError) return;
              create.mutate(
                { id, region, sourceContents: source },
                {
                  onSuccess: () => {
                    onOpenChange(false);
                    void navigate({ to: `/p/${projectId}/workflows/${region}/${id}` });
                  },
                },
              );
            }}
          >
            Create workflow
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" error={touched ? idError : null} required>
            <Input mono value={id} onChange={(e) => setId(e.target.value)} autoFocus />
          </Field>
          <Field label="Region" required>
            <Input mono value={region} onChange={(e) => setRegion(e.target.value)} list="nephoscope-wf-regions" />
          </Field>
          <datalist id="nephoscope-wf-regions">
            {RUN_REGIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-dense font-medium text-ink">Source</span>
          <CodeEditor
            value={source}
            onChange={setSource}
            language="yaml"
            path="workflow/new.yaml"
            height={360}
            label="New workflow source"
            jsonSchema={WORKFLOW_SCHEMA}
          />
        </div>
        <EquivalentCommand
          gcloud={`gcloud workflows deploy ${id || 'NAME'} --location=${region} --project=${projectId} --source=workflow.yaml`}
        />
      </div>
    </Sheet>
  );
}

/** Workflows of every location (SPEC-0003 CA-18). */
export function WorkflowsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const query = useWorkflows(projectId);
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const location = useFacet('location');
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  useEffect(() => {
    document.title = 'Workflows · Nephoscope';
  }, []);
  const wfHref = (w: WorkflowSummary): string => `/p/${projectId}/workflows/${w.location}/${w.id}`;
  const all = query.data?.items ?? [];
  const q = filter.trim().toLowerCase();
  const rows = useMemo(
    () => all.filter((w) => (location === 'all' || w.location === location) && (!q || w.id.toLowerCase().includes(q))),
    [all, location, q],
  );

  const columns: ResourceColumn<WorkflowSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      hideable: false,
      sortValue: (w) => w.id,
      cell: (w) => (
        <Link to={wfHref(w)} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {w.id}
        </Link>
      ),
    },
    { id: 'state', header: 'Status', width: '8rem', sortValue: (w) => w.state, cell: (w) => <WorkflowStateGlyph state={w.state} /> },
    { id: 'location', header: 'Location', width: '10rem', sortValue: (w) => w.location, cell: (w) => <Mono value={w.location} /> },
    {
      id: 'revision',
      header: 'Revision',
      width: '9rem',
      sortValue: (w) => w.revisionId ?? '',
      cell: (w) => <span className="font-mono text-[12px] text-ink-2">{w.revisionId}</span>,
    },
    {
      id: 'logs',
      header: 'Call logs',
      width: '8rem',
      sortValue: (w) => w.callLogLevel,
      cell: (w) => <span className="text-ink-2">{logLevelLabel[w.callLogLevel]}</span>,
    },
    {
      id: 'updated',
      header: 'Updated',
      width: '8.5rem',
      sortValue: (w) => w.updateTime ?? '',
      cell: (w) => <Timestamp iso={w.updateTime} />,
    },
    {
      id: 'description',
      header: 'Description',
      defaultHidden: true,
      cell: (w) => <span className="truncate text-ink-2">{w.description}</span>,
    },
  ];

  return (
    <div className="pb-16">
      <TitleBlock
        title="Workflows"
        subtitle="Orchestrations of Google Cloud services and HTTP calls, in every location of this project."
        actions={
          <Button variant="commit" icon={PlusIcon} onClick={() => setCreating(true)} disabled={!!readOnly} disabledReason={readOnly}>
            Create workflow
          </Button>
        }
      />
      <Notes notes={partialNote(query.data?.unreachable)} />
      <div className="pt-3">
        {query.isPending ? (
          <DelayedSkeleton />
        ) : query.error instanceof ApiError ? (
          <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} />
        ) : (
          <ResourceTable
            tableId="workflows"
            label="Workflows"
            rows={rows}
            columns={columns}
            getRowId={(w) => w.name}
            onOpen={(w) => void navigate({ to: wfHref(w) })}
            filtered={rows.length !== all.length}
            emptyTitle="No workflows yet"
            emptyText="A workflow runs steps in order: HTTP calls, Google Cloud APIs, conditions and loops."
            emptyAction={
              <Button icon={PlusIcon} onClick={() => setCreating(true)}>
                Create workflow
              </Button>
            }
            toolbar={
              <div className="flex flex-wrap items-end gap-3">
                <Input
                  data-filter-input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name"
                  aria-label="Filter workflows"
                  className="w-64"
                />
                <Facet label="Location" param="location" rows={all} valueFor={(w) => w.location} />
                <span className="ml-auto">
                  <RefreshControl onRefresh={() => void query.refetch()} refreshing={query.isRefetching} />
                </span>
              </div>
            }
          />
        )}
      </div>
      <CreateWorkflowSheet projectId={projectId} open={creating} onOpenChange={setCreating} readOnly={readOnly} />
    </div>
  );
}
