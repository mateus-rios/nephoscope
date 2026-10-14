import type {
  DeployPipelineView,
  DeployReleaseView,
  DeployRolloutView,
  DeployTargetView,
  ListResponse,
  OperationAccepted,
  RolloutAction,
} from '@nephoscope/contracts';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Fragment, useEffect } from 'react';
import { Button } from '../../design/Button';
import { Section, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph, type StatusKind } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { Notes, partialNote } from '../../kit/ListControls';
import { useOperationMutation } from '../../kit/operations';
import { KitTable } from '../../kit/resource/KitTable';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { useSession } from '../../state/session';
import { readOnlyReason } from '../run/common';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/clouddeploy`;

function useReadOnly() {
  const instance = useInstance();
  const { profile } = useActiveProfile();
  return readOnlyReason(instance.data?.readOnly, profile?.readOnly);
}

function useDeployQuery<T>(projectId: string, key: unknown[], path: string, enabled = true) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['clouddeploy', profileId, projectId, ...key],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled: !!profileId && enabled,
  });
}

const ROLLOUT: Record<string, [StatusKind, string]> = {
  SUCCEEDED: ['ok', 'Succeeded'],
  FAILED: ['error', 'Failed'],
  IN_PROGRESS: ['running', 'In progress'],
  PENDING_APPROVAL: ['warn', 'Awaiting approval'],
  APPROVAL_REJECTED: ['error', 'Rejected'],
  PENDING: ['pending', 'Pending'],
  PENDING_RELEASE: ['pending', 'Pending release'],
  CANCELLING: ['running', 'Cancelling'],
  CANCELLED: ['paused', 'Cancelled'],
  HALTED: ['paused', 'Halted'],
};

function RolloutState({ state }: { state: string }) {
  const [kind, label] = ROLLOUT[state] ?? ['unknown', state.toLowerCase()];
  return <StatusGlyph kind={kind} label={label} />;
}

/** A pipeline's stages as a sequence of targets (SPEC-0007 D-13). */
export function StageSequence({ pipeline, latest }: { pipeline: DeployPipelineView; latest?: Map<string, string> }) {
  return (
    <ol aria-label={`Stages of ${pipeline.id}`} className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
      {pipeline.stages.map((s, i) => (
        <Fragment key={s.targetId}>
          {i > 0 ? <ArrowRightIcon size={14} className="text-ink-3" aria-hidden /> : null}
          <li className="flex flex-col rounded-control border border-rule-strong px-3 py-1.5">
            <span className="font-mono text-[12px] text-ink">{s.targetId}</span>
            <span className="text-meta text-ink-3">{[s.strategy, ...s.profiles].filter(Boolean).join(' · ') || 'standard'}</span>
            {latest?.get(s.targetId) ? <RolloutState state={latest.get(s.targetId) as string} /> : null}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

/** Delivery pipelines and targets (SPEC-0007 D-13, CA-13). */
export function CloudDeployPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<'pipelines' | 'targets'>('tab', 'pipelines', ['pipelines', 'targets']);
  const pipelines = useDeployQuery<ListResponse<DeployPipelineView>>(projectId, ['pipelines'], `${base(projectId)}/pipelines`);
  const targets = useDeployQuery<ListResponse<DeployTargetView>>(projectId, ['targets'], `${base(projectId)}/targets`, tab === 'targets');
  const navigate = useNavigate();
  useEffect(() => {
    document.title = 'Cloud Deploy · Nephoscope';
  }, []);
  const href = (p: DeployPipelineView) => `/p/${projectId}/clouddeploy/${p.location}/${p.id}`;
  const targetColumns: ResourceColumn<DeployTargetView>[] = [
    {
      id: 'id',
      header: 'Target',
      hideable: false,
      sortValue: (t) => t.id,
      cell: (t) => <span className="font-medium text-ink">{t.id}</span>,
    },
    { id: 'kind', header: 'Runtime', width: '9rem', sortValue: (t) => t.kind, cell: (t) => t.kind },
    { id: 'detail', header: 'Deploys to', cell: (t) => <Mono value={t.detail ?? ''} /> },
    { id: 'approval', header: 'Approval', width: '8rem', cell: (t) => (t.requireApproval ? 'Required' : 'No') },
    { id: 'location', header: 'Location', width: '9rem', cell: (t) => <Mono value={t.location} /> },
  ];
  const data = tab === 'pipelines' ? pipelines : targets;
  return (
    <div className="pb-16">
      <TitleBlock
        title="Cloud Deploy"
        subtitle="Delivery pipelines promote releases from target to target, with approvals where required."
      />
      <div role="tablist" aria-label="Cloud Deploy sections" className="flex gap-4 border-b border-rule px-6">
        {(['pipelines', 'targets'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={
              tab === k
                ? '-mb-px h-9 border-b-2 border-ink text-dense font-medium text-ink'
                : '-mb-px h-9 border-b-2 border-transparent text-dense text-ink-2 hover:text-ink'
            }
          >
            {k === 'pipelines' ? 'Delivery pipelines' : 'Targets'}
          </button>
        ))}
      </div>
      <Notes notes={partialNote(data.data?.unreachable)} />
      {data.isPending ? (
        <DelayedSkeleton />
      ) : data.error instanceof ApiError ? (
        <ProblemState problem={data.error.problem} onRetry={() => void data.refetch()} />
      ) : tab === 'targets' ? (
        <div className="pt-3">
          <ResourceTable
            tableId="clouddeploy-targets"
            label="Targets"
            rows={targets.data?.items ?? []}
            columns={targetColumns}
            getRowId={(t) => t.name}
            emptyTitle="No targets"
            emptyText="A target is where a pipeline stage deploys: a Cloud Run location or a GKE cluster."
          />
        </div>
      ) : (pipelines.data?.items ?? []).length === 0 ? (
        <EmptyState title="No delivery pipelines">
          A delivery pipeline is declared in clouddeploy.yaml and registered with gcloud deploy apply.
        </EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {(pipelines.data?.items ?? []).map((p) => (
            <li key={p.name} className="flex flex-col gap-2 border-b border-rule px-6 py-3">
              <div className="flex items-baseline gap-3">
                <Link to={href(p)} className="text-section font-semibold text-ink">
                  {p.id}
                </Link>
                <span className="font-mono text-[11px] text-ink-3">{p.location}</span>
                {p.suspended ? <StatusGlyph kind="paused" label="Suspended" /> : null}
                <span className="ml-auto">
                  <Button size="sm" onClick={() => void navigate({ to: href(p) })}>
                    Open pipeline
                  </Button>
                </span>
              </div>
              <StageSequence pipeline={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Rollouts({
  projectId,
  pipeline,
  release,
  readOnly,
}: {
  projectId: string;
  pipeline: DeployPipelineView;
  release: DeployReleaseView;
  readOnly: string | null;
}) {
  const path = `${base(projectId)}/pipelines/${enc(pipeline.location)}/${enc(pipeline.id)}/releases/${enc(release.id)}`;
  const q = useDeployQuery<DeployRolloutView[]>(projectId, ['rollouts', release.name], `${path}/rollouts`);
  const act = useOperationMutation({
    mutationFn: (v: { rollout: string; action: RolloutAction; phaseId?: string; jobId?: string }) =>
      api<OperationAccepted>(`${path}/rollouts/${enc(v.rollout)}/${v.action}`, { body: { phaseId: v.phaseId, jobId: v.jobId } }),
    started: (v) =>
      `${v.action === 'retryJob' ? 'Retrying a job of' : `${v.action[0]?.toUpperCase()}${v.action.slice(1)}`} rollout ${v.rollout}`,
    invalidate: [['clouddeploy']],
  });
  const done = new Set((q.data ?? []).filter((r) => r.state === 'SUCCEEDED').map((r) => r.targetId));
  const order = pipeline.stages.map((s) => s.targetId);
  const lastDone = Math.max(-1, ...[...done].map((t) => order.indexOf(t)));
  const next = order[lastDone + 1] ?? null;
  const promote = useOperationMutation({
    mutationFn: (targetId: string) => api<OperationAccepted>(`${path}/promote`, { body: { targetId } }),
    started: (t) => `Promoting ${release.id} to ${t}`,
    invalidate: [['clouddeploy']],
  });
  const columns: ResourceColumn<DeployRolloutView>[] = [
    { id: 'target', header: 'Target', width: '10rem', sortValue: (r) => r.targetId, cell: (r) => <Mono value={r.targetId} /> },
    { id: 'state', header: 'State', width: '11rem', cell: (r) => <RolloutState state={r.state} /> },
    { id: 'id', header: 'Rollout', cell: (r) => <Mono value={r.id} /> },
    {
      id: 'created',
      header: 'Created',
      width: '9rem',
      sortValue: (r) => r.createTime ?? '',
      cell: (r) => <Timestamp iso={r.createTime} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      width: '16rem',
      hideable: false,
      cell: (r) => {
        const failedJob = r.phases.flatMap((ph) =>
          ph.jobs.filter((j) => j.state === 'FAILED').map((j) => ({ phaseId: ph.id, jobId: j.id })),
        )[0];
        const nextPhase = r.phases.find((ph) => ph.state === 'PENDING');
        const dis = !!readOnly;
        return (
          <span className="flex gap-1">
            {r.state === 'PENDING_APPROVAL' ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={dis}
                  disabledReason={readOnly}
                  onClick={() => act.mutate({ rollout: r.id, action: 'approve' })}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={dis}
                  disabledReason={readOnly}
                  onClick={() => act.mutate({ rollout: r.id, action: 'reject' })}
                >
                  Reject
                </Button>
              </>
            ) : null}
            {r.state === 'IN_PROGRESS' && nextPhase ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={dis}
                disabledReason={readOnly}
                onClick={() => act.mutate({ rollout: r.id, action: 'advance', phaseId: nextPhase.id })}
              >
                Advance to {nextPhase.id}
              </Button>
            ) : null}
            {failedJob ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={dis}
                disabledReason={readOnly}
                onClick={() => act.mutate({ rollout: r.id, action: 'retryJob', ...failedJob })}
              >
                Retry job
              </Button>
            ) : null}
            {r.state === 'IN_PROGRESS' || r.state === 'PENDING_APPROVAL' ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={dis}
                disabledReason={readOnly}
                onClick={() => act.mutate({ rollout: r.id, action: 'cancel' })}
              >
                Cancel
              </Button>
            ) : null}
          </span>
        );
      },
    },
  ];
  return (
    <Section
      title={`Rollouts of ${release.id}`}
      actions={
        next ? (
          <Button
            variant="commit"
            disabled={!!readOnly || release.renderState !== 'SUCCEEDED'}
            disabledReason={readOnly ?? 'The release has not rendered'}
            loading={promote.isPending}
            onClick={() => promote.mutate(next)}
          >
            Promote to {next}
          </Button>
        ) : undefined
      }
    >
      {q.isPending ? (
        <DelayedSkeleton rows={3} />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : (
        <ResourceTable
          tableId="clouddeploy-rollouts"
          label="Rollouts"
          rows={q.data ?? []}
          columns={columns}
          getRowId={(r) => r.name}
          emptyTitle="No rollouts"
          emptyText="Promote the release to its first target to start a rollout."
        />
      )}
    </Section>
  );
}

/** One pipeline: stages, releases and their rollouts, automation runs (SPEC-0007 D-13). */
export function PipelinePage() {
  const { projectId, location, pipeline: id } = useParams({ strict: false }) as { projectId: string; location: string; pipeline: string };
  const p = useDeployQuery<DeployPipelineView>(
    projectId,
    ['pipeline', location, id],
    `${base(projectId)}/pipelines/${enc(location)}/${enc(id)}`,
  );
  const releases = useDeployQuery<DeployReleaseView[]>(
    projectId,
    ['releases', location, id],
    `${base(projectId)}/pipelines/${enc(location)}/${enc(id)}/releases`,
  );
  const [selected, setSelected] = useSearchState<string>('release', '');
  const readOnly = useReadOnly();
  if (p.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (p.error instanceof ApiError || !p.data)
    return p.error instanceof ApiError ? <ProblemState problem={p.error.problem} onRetry={() => void p.refetch()} /> : null;
  const pipeline = p.data;
  const release = (releases.data ?? []).find((r) => r.id === selected) ?? releases.data?.[0] ?? null;
  const columns: ResourceColumn<DeployReleaseView>[] = [
    {
      id: 'id',
      header: 'Release',
      hideable: false,
      sortValue: (r) => r.id,
      cell: (r) => <span className={r.id === release?.id ? 'font-semibold text-ink' : 'text-ink'}>{r.id}</span>,
    },
    {
      id: 'render',
      header: 'Render',
      width: '10rem',
      cell: (r) => (
        <StatusGlyph
          kind={r.renderState === 'SUCCEEDED' ? 'ok' : r.renderState === 'FAILED' ? 'error' : 'running'}
          label={r.renderState.toLowerCase().replace(/_/g, ' ')}
        />
      ),
    },
    { id: 'abandoned', header: 'Abandoned', width: '7rem', cell: (r) => (r.abandoned ? 'Yes' : 'No') },
    {
      id: 'created',
      header: 'Created',
      width: '9rem',
      sortValue: (r) => r.createTime ?? '',
      cell: (r) => <Timestamp iso={r.createTime} />,
    },
  ];
  return (
    <DetailLayout<'releases' | 'automation'>
      crumbs={[{ label: 'Cloud Deploy', to: `/p/${projectId}/clouddeploy` }, { label: pipeline.id }]}
      title={pipeline.id}
      subtitle={pipeline.description ?? undefined}
      cells={[
        { label: 'Location', value: pipeline.location, mono: true },
        { label: 'Stages', value: String(pipeline.stages.length) },
        { label: 'Updated', value: <Timestamp iso={pipeline.updateTime} /> },
      ]}
      tabs={[
        { key: 'releases', label: 'Releases' },
        { key: 'automation', label: 'Automation runs' },
      ]}
      defaultTab="releases"
    >
      {(tab) =>
        tab === 'automation' ? (
          <KitTable
            projectId={projectId}
            collectionKey="clouddeploy/automationruns"
            parent={`locations/${location}/deliveryPipelines/${id}`}
            readOnly={readOnly}
          />
        ) : (
          <>
            <Section title="Stages">
              <div className="px-6">
                <StageSequence pipeline={pipeline} />
              </div>
            </Section>
            <Section
              title="Releases"
              description="Creating a release needs skaffold configuration and sources: use gcloud deploy releases create."
            >
              {releases.isPending ? (
                <DelayedSkeleton rows={3} />
              ) : releases.error instanceof ApiError ? (
                <ProblemState problem={releases.error.problem} onRetry={() => void releases.refetch()} />
              ) : (
                <ResourceTable
                  tableId="clouddeploy-releases"
                  label="Releases"
                  rows={releases.data ?? []}
                  columns={columns}
                  getRowId={(r) => r.name}
                  onOpen={(r) => setSelected(r.id)}
                  emptyTitle="No releases"
                />
              )}
            </Section>
            {release ? <Rollouts projectId={projectId} pipeline={pipeline} release={release} readOnly={readOnly} /> : null}
          </>
        )
      }
    </DetailLayout>
  );
}
