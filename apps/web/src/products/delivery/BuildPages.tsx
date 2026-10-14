import {
  BUILD_DONE,
  type BuildDetail,
  type BuildLogsMessage,
  type BuildSummary,
  buildStatuses,
  GCP_REGIONS,
  type ListResponse,
  type OperationAccepted,
  type TriggerView,
} from '@nephoscope/contracts';
import { PlayIcon, PlusIcon } from '@phosphor-icons/react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Section, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph, type StatusKind } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { EquivalentCommand, sh } from '../../kit/EquivalentCommand';
import { FactList } from '../../kit/FactList';
import { KeyValueEditor } from '../../kit/KeyValueEditor';
import { LogsPanel } from '../../kit/LogsPanel';
import { useOperationMutation } from '../../kit/operations';
import { RawView } from '../../kit/RawView';
import { KitTable } from '../../kit/resource/KitTable';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api, qs } from '../../lib/api';
import { duration } from '../../lib/format';
import { live } from '../../lib/live';
import { useActiveProfile, useInstance } from '../../state/queries';
import { useSession } from '../../state/session';
import { readOnlyReason } from '../run/common';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/cloudbuild`;

function useReadOnly() {
  const instance = useInstance();
  const { profile } = useActiveProfile();
  return readOnlyReason(instance.data?.readOnly, profile?.readOnly);
}

const STATUS: Record<string, [StatusKind, string]> = {
  SUCCESS: ['ok', 'Succeeded'],
  FAILURE: ['error', 'Failed'],
  INTERNAL_ERROR: ['error', 'Internal error'],
  TIMEOUT: ['error', 'Timed out'],
  CANCELLED: ['paused', 'Cancelled'],
  EXPIRED: ['paused', 'Expired'],
  WORKING: ['running', 'Running'],
  QUEUED: ['pending', 'Queued'],
  PENDING: ['pending', 'Pending'],
};

export function BuildStatus({ status, approval }: { status: string; approval?: string | null }) {
  if (approval === 'PENDING') return <StatusGlyph kind="warn" label="Awaiting approval" />;
  const [kind, label] = STATUS[status] ?? ['unknown', status.toLowerCase()];
  return <StatusGlyph kind={kind} label={label} />;
}

const took = (b: BuildSummary) =>
  b.startTime ? duration(Date.parse(b.finishTime ?? new Date().toISOString()) - Date.parse(b.startTime)) : '';
const buildHref = (projectId: string, b: Pick<BuildSummary, 'location' | 'id'>) =>
  `/p/${projectId}/cloudbuild/builds/${b.location}/${b.id}`;

function Builds({ projectId }: { projectId: string }) {
  const profileId = useSession((s) => s.profileId);
  const [location, setLocation] = useSearchState<string>('location', 'global');
  const [status, setStatus] = useSearchState<string>('status', 'any');
  const navigate = useNavigate();
  const q = useInfiniteQuery({
    queryKey: ['cloudbuild', profileId, projectId, 'builds', location, status],
    queryFn: ({ signal, pageParam }) =>
      api<ListResponse<BuildSummary>>(
        `${base(projectId)}/builds${qs({ location, status: status === 'any' ? undefined : status, pageToken: pageParam })}`,
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextPageToken ?? undefined,
    enabled: !!profileId,
  });
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items), [q.data]);
  const columns: ResourceColumn<BuildSummary>[] = [
    {
      id: 'status',
      header: 'State',
      width: '10rem',
      sortValue: (b) => b.status,
      cell: (b) => <BuildStatus status={b.status} approval={b.approval} />,
    },
    {
      id: 'id',
      header: 'Build',
      hideable: false,
      sortValue: (b) => b.id,
      cell: (b) => (
        <Link to={buildHref(projectId, b)} className="font-mono text-[12px] text-ink" onClick={(e) => e.stopPropagation()}>
          {b.id.slice(0, 8)}
        </Link>
      ),
    },
    { id: 'source', header: 'Source', cell: (b) => (b.source ? <Mono value={b.source} /> : <span className="text-ink-3">None</span>) },
    {
      id: 'trigger',
      header: 'Trigger',
      width: '9rem',
      cell: (b) => (b.triggerId ? <Mono value={b.triggerId.slice(0, 8)} /> : <span className="text-ink-3">Manual</span>),
    },
    {
      id: 'created',
      header: 'Started',
      width: '9rem',
      sortValue: (b) => b.createTime ?? '',
      cell: (b) => <Timestamp iso={b.createTime} />,
    },
    { id: 'took', header: 'Duration', width: '7rem', align: 'right', cell: (b) => <span className="tnum">{took(b)}</span> },
    { id: 'location', header: 'Location', width: '9rem', defaultHidden: true, cell: (b) => <Mono value={b.location} /> },
    { id: 'tags', header: 'Tags', defaultHidden: true, cell: (b) => <Mono value={b.tags.join(', ')} /> },
  ];
  return (
    <div className="pt-3">
      {q.isPending ? (
        <DelayedSkeleton />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : (
        <ResourceTable
          tableId="cloudbuild-builds"
          label="Builds"
          rows={rows}
          columns={columns}
          getRowId={(b) => b.name}
          onOpen={(b) => void navigate({ to: buildHref(projectId, b) })}
          emptyTitle="No builds"
          emptyText="Builds run a series of steps in containers, from a trigger or from gcloud builds submit."
          hasMore={q.hasNextPage}
          loadingMore={q.isFetchingNextPage}
          onLoadMore={() => void q.fetchNextPage()}
          toolbar={
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Location" className="w-48">
                <Select<string>
                  value={location}
                  onValueChange={setLocation}
                  options={[
                    { value: 'global', label: 'global' },
                    { value: 'all', label: 'All locations' },
                    ...GCP_REGIONS.map((r) => ({ value: r, label: r })),
                  ]}
                />
              </Field>
              <Field label="State" className="w-44">
                <Select<string>
                  value={status}
                  onValueChange={setStatus}
                  options={[
                    { value: 'any', label: 'Any state' },
                    ...buildStatuses.slice(1).map((s) => ({ value: s, label: STATUS[s]?.[1] ?? s })),
                  ]}
                />
              </Field>
            </div>
          }
        />
      )}
    </div>
  );
}

const TRIGGER_TEMPLATE = `{
  "name": "build-on-push",
  "description": "",
  "github": {
    "owner": "OWNER",
    "name": "REPOSITORY",
    "push": { "branch": "^main$" }
  },
  "filename": "cloudbuild.yaml"
}`;

function RunTriggerSheet({ projectId, trigger, onClose }: { projectId: string; trigger: TriggerView | null; onClose: () => void }) {
  const [kind, setKind] = useState<'branch' | 'tag' | 'commit'>('branch');
  const [value, setValue] = useState('');
  const [subs, setSubs] = useState<{ name: string; value: string }[]>([]);
  useEffect(() => {
    if (trigger) {
      setKind('branch');
      setValue((trigger.branch ?? 'main').replace(/^\^|\$$/g, ''));
      setSubs([]);
    }
  }, [trigger]);
  const run = useOperationMutation({
    mutationFn: () =>
      api<OperationAccepted>(`${base(projectId)}/triggers/${enc(trigger?.location ?? 'global')}/${enc(trigger?.id ?? '')}/run`, {
        body: { ref: { kind, value }, substitutions: Object.fromEntries(subs.filter((s) => s.name).map((s) => [s.name, s.value])) },
      }),
    started: () => `Running trigger ${trigger?.triggerName ?? ''}`,
    onSuccess: () => onClose(),
  });
  return (
    <Sheet
      open={trigger !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`Run ${trigger?.triggerName ?? ''}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="commit" icon={PlayIcon} loading={run.isPending} disabled={!value.trim()} onClick={() => run.mutate(undefined)}>
            Run trigger
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[9rem_1fr] gap-3">
          <Field label="Build from">
            <Select<'branch' | 'tag' | 'commit'>
              value={kind}
              onValueChange={setKind}
              options={[
                { value: 'branch', label: 'Branch' },
                { value: 'tag', label: 'Tag' },
                { value: 'commit', label: 'Commit' },
              ]}
            />
          </Field>
          <Field label={kind === 'branch' ? 'Branch' : kind === 'tag' ? 'Tag' : 'Commit SHA'}>
            <Input mono value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        </div>
        <KeyValueEditor label="Substitutions" keyLabel="Variable (_NAME)" rows={subs} onChange={setSubs} />
        <EquivalentCommand
          gcloud={`gcloud builds triggers run ${trigger?.triggerName ?? 'TRIGGER'} --${kind === 'commit' ? 'sha' : kind}=${sh(value || 'main')} --region=${trigger?.location ?? 'global'} --project=${projectId}`}
        />
      </div>
    </Sheet>
  );
}

function TriggerSheet({
  projectId,
  trigger,
  open,
  onOpenChange,
}: {
  projectId: string;
  trigger: TriggerView | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const profileId = useSession((s) => s.profileId);
  const existing = useQuery({
    queryKey: ['cloudbuild', profileId, projectId, 'trigger', trigger?.name],
    queryFn: ({ signal }) =>
      api<unknown>(`${base(projectId)}/triggers/${enc(trigger?.location ?? '')}/${enc(trigger?.id ?? '')}`, { signal }),
    enabled: !!profileId && open && !!trigger,
  });
  const [json, setJson] = useState(TRIGGER_TEMPLATE);
  const [location, setLocation] = useState('global');
  useEffect(() => {
    if (!open) return;
    setLocation(trigger?.location ?? 'global');
    if (!trigger) setJson(TRIGGER_TEMPLATE);
  }, [open, trigger]);
  useEffect(() => {
    if (existing.data) setJson(JSON.stringify(existing.data, null, 2));
  }, [existing.data]);
  const save = useOperationMutation({
    mutationFn: () =>
      trigger
        ? api<OperationAccepted>(`${base(projectId)}/triggers/${enc(trigger.location)}/${enc(trigger.id)}`, {
            method: 'PUT',
            body: { location, json },
          })
        : api<OperationAccepted>(`${base(projectId)}/triggers`, { body: { location, json } }),
    started: () => (trigger ? `Saving trigger ${trigger.triggerName}` : 'Creating the trigger'),
    onSuccess: () => onOpenChange(false),
  });
  let error: string | null = null;
  try {
    JSON.parse(json);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={trigger ? `Edit ${trigger.triggerName}` : 'Create trigger'}
      description="Triggers are edited as JSON: push, pull request, manual (sourceToBuild), Pub/Sub (pubsubConfig) or webhook (webhookConfig)."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={save.isPending}
            disabled={!!error}
            disabledReason={error}
            onClick={() => save.mutate(undefined)}
          >
            {trigger ? 'Save trigger' : 'Create trigger'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Location">
          <Input mono value={location} onChange={(e) => setLocation(e.target.value)} disabled={!!trigger} />
        </Field>
        <CodeEditor value={json} onChange={setJson} language="json" height="55vh" label="Trigger JSON" />
        {error ? <p className="m-0 text-meta text-redline-ink">{error}</p> : null}
      </div>
    </Sheet>
  );
}

function Triggers({ projectId, readOnly }: { projectId: string; readOnly: string | null }) {
  const profileId = useSession((s) => s.profileId);
  const [location, setLocation] = useSearchState<string>('tloc', 'global');
  const q = useQuery({
    queryKey: ['cloudbuild', profileId, projectId, 'triggers', location],
    queryFn: ({ signal }) => api<ListResponse<TriggerView>>(`${base(projectId)}/triggers${qs({ location })}`, { signal }),
    enabled: !!profileId,
  });
  const [running, setRunning] = useState<TriggerView | null>(null);
  const [editing, setEditing] = useState<TriggerView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<TriggerView | null>(null);
  const toggle = useOperationMutation({
    mutationFn: (t: TriggerView) =>
      api<OperationAccepted>(`${base(projectId)}/triggers/${enc(t.location)}/${enc(t.id)}/state`, {
        method: 'PATCH',
        body: { disabled: !t.disabled },
      }),
    started: (t) => `${t.disabled ? 'Enabling' : 'Disabling'} ${t.triggerName}`,
    invalidate: [['cloudbuild']],
  });
  const columns: ResourceColumn<TriggerView>[] = [
    {
      id: 'name',
      header: 'Trigger',
      hideable: false,
      sortValue: (t) => t.triggerName,
      cell: (t) => <span className="font-medium text-ink">{t.triggerName}</span>,
    },
    {
      id: 'state',
      header: 'State',
      width: '8rem',
      cell: (t) => (t.disabled ? <StatusGlyph kind="paused" label="Disabled" /> : <StatusGlyph kind="ok" label="Enabled" />),
    },
    { id: 'event', header: 'Event', width: '8rem', sortValue: (t) => t.event, cell: (t) => t.event.replace('_', ' ') },
    { id: 'repo', header: 'Repository', cell: (t) => (t.repo ? <Mono value={t.repo} /> : <span className="text-ink-3">None</span>) },
    { id: 'ref', header: 'Branch or tag', width: '9rem', cell: (t) => <Mono value={t.branch ?? t.tag ?? ''} /> },
    { id: 'config', header: 'Config', width: '10rem', cell: (t) => <Mono value={t.filename ?? ''} /> },
    {
      id: 'actions',
      header: 'Actions',
      width: '15rem',
      hideable: false,
      cell: (t) => (
        <span className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={PlayIcon}
            disabled={!!readOnly || t.disabled}
            disabledReason={readOnly ?? 'The trigger is disabled'}
            onClick={() => setRunning(t)}
          >
            Run
          </Button>
          <Button size="sm" variant="ghost" disabled={!!readOnly} disabledReason={readOnly} onClick={() => toggle.mutate(t)}>
            {t.disabled ? 'Enable' : 'Disable'}
          </Button>
          <Button size="sm" variant="ghost" disabled={!!readOnly} disabledReason={readOnly} onClick={() => setDeleting(t)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];
  return (
    <div className="pt-3">
      {q.isPending ? (
        <DelayedSkeleton />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : (
        <ResourceTable
          tableId="cloudbuild-triggers"
          label="Triggers"
          rows={q.data?.items ?? []}
          columns={columns}
          getRowId={(t) => t.name || t.id}
          onOpen={(t) => !readOnly && setEditing(t)}
          emptyTitle="No triggers"
          emptyText="A trigger starts a build on a push, a pull request, a Pub/Sub message, a webhook, or by hand."
          toolbar={
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Location" className="w-48">
                <Select<string>
                  value={location}
                  onValueChange={setLocation}
                  options={[
                    { value: 'global', label: 'global' },
                    { value: 'all', label: 'All locations' },
                    ...GCP_REGIONS.map((r) => ({ value: r, label: r })),
                  ]}
                />
              </Field>
              <span className="ml-auto">
                <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setEditing('new')}>
                  Create trigger
                </Button>
              </span>
            </div>
          }
        />
      )}
      <RunTriggerSheet projectId={projectId} trigger={running} onClose={() => setRunning(null)} />
      <TriggerSheet
        projectId={projectId}
        trigger={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete trigger"
        consequence="The trigger stops starting builds. Past builds stay."
        expected={deleting?.id ?? ''}
        confirmLabel="Delete trigger"
        onConfirm={async (c) => {
          if (deleting)
            await api(`${base(projectId)}/triggers/${enc(deleting.location)}/${enc(deleting.id)}`, {
              method: 'DELETE',
              body: { confirm: c },
            });
          void q.refetch();
        }}
      />
    </div>
  );
}

/** Cloud Build: builds, triggers, connections and worker pools (SPEC-0007 D-12, CA-12). */
export function CloudBuildPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<'builds' | 'triggers' | 'connections' | 'pools'>('tab', 'builds', [
    'builds',
    'triggers',
    'connections',
    'pools',
  ]);
  const readOnly = useReadOnly();
  useEffect(() => {
    document.title = 'Cloud Build · Nephoscope';
  }, []);
  const tabs = [
    ['builds', 'Builds'],
    ['triggers', 'Triggers'],
    ['connections', 'Repository connections'],
    ['pools', 'Worker pools'],
  ] as const;
  return (
    <div className="pb-16">
      <TitleBlock title="Cloud Build" subtitle="Builds, the triggers that start them, and where they run." />
      <div role="tablist" aria-label="Cloud Build sections" className="flex gap-4 border-b border-rule px-6">
        {tabs.map(([k, label]) => (
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
            {label}
          </button>
        ))}
      </div>
      {tab === 'builds' ? <Builds projectId={projectId} /> : null}
      {tab === 'triggers' ? <Triggers projectId={projectId} readOnly={readOnly} /> : null}
      {tab === 'connections' ? <KitTable projectId={projectId} collectionKey="cloudbuild/connections" readOnly={readOnly} /> : null}
      {tab === 'pools' ? <KitTable projectId={projectId} collectionKey="cloudbuild/workerpools" readOnly={readOnly} /> : null}
    </div>
  );
}

/** Live log text of a build, from its log object (SPEC-0007 D-12, NFR-02). */
function BuildLog({ projectId, b }: { projectId: string; b: BuildDetail }) {
  const profileId = useSession((s) => s.profileId);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!profileId) return;
    setText('');
    setEnded(false);
    setError(null);
    return live.subscribe(
      'build.logs',
      { profileId, projectId },
      { location: b.location, buildId: b.id },
      {
        data(payload) {
          const m = payload as BuildLogsMessage;
          if (m.text) setText((t) => (t + m.text).slice(-2_000_000));
          if (m.done) setEnded(true);
        },
        error(p) {
          setError(p.detail);
        },
        end() {
          setEnded(true);
        },
      },
    );
  }, [profileId, projectId, b.location, b.id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new log text is the trigger; the effect reads the DOM.
  useEffect(() => {
    const el = pre.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <div className="flex flex-col gap-2 px-6 py-3">
      <span className="text-meta text-ink-2">
        {error ? (
          <span className="text-redline-ink">{error}</span>
        ) : ended ? (
          'The build has finished.'
        ) : (
          'Following the log as it is written.'
        )}
      </span>
      {/* Build output is project data: text only (SPEC-0001 D-22). */}
      <pre ref={pre} className="m-0 h-[60vh] overflow-auto rounded-control bg-well p-3 font-mono text-[12px] whitespace-pre-wrap text-ink">
        {text || (ended ? 'No log output.' : '')}
      </pre>
    </div>
  );
}

/** One build: steps with timings, logs, settings and actions (SPEC-0007 D-12). */
export function BuildPage() {
  const { projectId, location, build } = useParams({ strict: false }) as { projectId: string; location: string; build: string };
  const profileId = useSession((s) => s.profileId);
  const readOnly = useReadOnly();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['cloudbuild', profileId, projectId, 'build', location, build],
    queryFn: ({ signal }) => api<BuildDetail>(`${base(projectId)}/builds/${enc(location)}/${enc(build)}`, { signal }),
    enabled: !!profileId,
    refetchInterval: (query) => (query.state.data && BUILD_DONE.includes(query.state.data.status) ? false : 5000),
  });
  const action = useOperationMutation({
    mutationFn: (v: { verb: 'retry' | 'cancel' | 'approve'; decision?: 'APPROVED' | 'REJECTED' }) =>
      api<OperationAccepted>(`${base(projectId)}/builds/${enc(location)}/${enc(build)}/${v.verb}`, {
        body: v.decision ? { decision: v.decision } : {},
      }),
    started: (v) =>
      v.verb === 'retry'
        ? 'Retrying the build'
        : v.verb === 'cancel'
          ? 'Cancelling the build'
          : v.decision === 'APPROVED'
            ? 'Approving the build'
            : 'Rejecting the build',
    invalidate: [['cloudbuild']],
    onSuccess: (r, v) => {
      if (v.verb === 'retry') void navigate({ to: `/p/${projectId}/cloudbuild` as string });
      void r;
    },
  });
  if (q.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (q.error instanceof ApiError || !q.data)
    return q.error instanceof ApiError ? <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} /> : null;
  const b = q.data;
  const running = !BUILD_DONE.includes(b.status);
  const loggingOnly = b.logging === 'CLOUD_LOGGING_ONLY' || !b.logsBucket;
  return (
    <DetailLayout<'steps' | 'logs' | 'details' | 'json'>
      crumbs={[{ label: 'Cloud Build', to: `/p/${projectId}/cloudbuild` }, { label: b.id.slice(0, 8) }]}
      title={`Build ${b.id.slice(0, 8)}`}
      status={<BuildStatus status={b.status} approval={b.approval} />}
      actions={
        b.approval === 'PENDING' ? (
          <>
            <Button
              disabled={!!readOnly}
              disabledReason={readOnly}
              onClick={() => action.mutate({ verb: 'approve', decision: 'REJECTED' })}
            >
              Reject build
            </Button>
            <Button
              variant="commit"
              disabled={!!readOnly}
              disabledReason={readOnly}
              onClick={() => action.mutate({ verb: 'approve', decision: 'APPROVED' })}
            >
              Approve build
            </Button>
          </>
        ) : running ? (
          <Button disabled={!!readOnly} disabledReason={readOnly} onClick={() => action.mutate({ verb: 'cancel' })}>
            Cancel build
          </Button>
        ) : (
          <Button disabled={!!readOnly} disabledReason={readOnly} onClick={() => action.mutate({ verb: 'retry' })}>
            Retry build
          </Button>
        )
      }
      cells={[
        { label: 'Source', value: b.source ?? 'None' },
        { label: 'Started', value: <Timestamp iso={b.startTime ?? b.createTime} /> },
        { label: 'Duration', value: took(b) },
        { label: 'Location', value: b.location, mono: true },
      ]}
      tabs={[
        { key: 'steps', label: 'Steps' },
        { key: 'logs', label: 'Logs' },
        { key: 'details', label: 'Details' },
        { key: 'json', label: 'JSON' },
      ]}
      defaultTab="steps"
    >
      {(tab) =>
        tab === 'logs' ? (
          loggingOnly ? (
            <LogsPanel projectId={projectId} filter={`resource.type="build" resource.labels.build_id="${b.id}"`} />
          ) : (
            <BuildLog projectId={projectId} b={b} />
          )
        ) : tab === 'json' ? (
          <RawView value={b.raw} fileName={`build-${b.id}`} />
        ) : tab === 'details' ? (
          <Section title="Details">
            <FactList
              facts={[
                ['Build id', <Mono key="id" value={b.id} copy />],
                ['Service account', b.serviceAccount],
                ['Logs bucket', b.logsBucket],
                ['Logging', b.logging],
                ['Timeout', b.timeout],
                ['Images', b.images.length ? b.images.join(', ') : null],
                ['Tags', b.tags.length ? b.tags.join(', ') : null],
                ['Failure', b.failure],
                ...Object.entries(b.substitutions).map(([k, v]): [string, string] => [k, v]),
              ]}
            />
          </Section>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0 pt-3">
            {b.steps.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: steps may have no id; their order is their identity.
              <li key={i} className="grid grid-cols-[2rem_10rem_1fr_6rem] items-center gap-3 border-b border-rule px-6 py-1 text-dense">
                <span className="tnum text-ink-3">{i + 1}</span>
                <BuildStatus status={s.status} />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[12px] text-ink">{s.id ?? s.name}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-3">
                    {[s.entrypoint, ...s.args].filter(Boolean).join(' ')}
                  </span>
                </span>
                <span className="tnum text-right text-ink-2">
                  {s.startTime && s.endTime ? duration(Date.parse(s.endTime) - Date.parse(s.startTime)) : ''}
                </span>
              </li>
            ))}
          </ol>
        )
      }
    </DetailLayout>
  );
}
