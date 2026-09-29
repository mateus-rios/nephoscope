import type { PublicAccessMode, Revision, RunService } from '@nephoscope/contracts';
import { ArrowCounterClockwiseIcon, GitDiffIcon, TrashIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { stringify } from 'yaml';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { DiffEditor } from '../../design/code/CodeEditor';
import { Legend, type Note, Notes, Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Dialog } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Chip, Mono, Timestamp } from '../../design/Values';
import { ApiError } from '../../lib/api';
import { useOperations } from '../../state/operations';
import { deleteRevision, useRevisionRaw, useRollback, useServiceAccessOne, useSetAccess } from './api';
import { ingressLabel, RunStatusGlyph } from './common';

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-6 gap-y-1.5 px-6">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <Legend as="dt">{k}</Legend>
          <dd className="m-0 min-w-0 text-dense text-ink">{v ?? <span className="text-ink-3">None</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ServiceOverview({ service }: { service: RunService }) {
  const c = service.template.containers.find((x) => x.port !== null) ?? service.template.containers[0];
  const sidecars = service.template.containers.filter((x) => x !== c);
  const conditions = service.conditions.filter((x) => x.state !== 'SUCCEEDED' || x.type === 'Ready');
  return (
    <div className="flex flex-col">
      <Section title="Traffic">
        <table className="mx-6 border-collapse text-dense">
          <thead>
            <tr>
              <th className="legend py-1 pr-8 text-left">Target</th>
              <th className="legend py-1 pr-8 text-right">Percent</th>
              <th className="legend py-1 pr-8 text-left">Tag</th>
              <th className="legend py-1 text-left">Tag URL</th>
            </tr>
          </thead>
          <tbody>
            {service.trafficStatuses.map((t) => (
              <tr key={`${t.type}-${t.revision}-${t.tag}`} className="border-t border-rule">
                <td className="py-1 pr-8 font-mono text-[12px]">
                  {t.type === 'LATEST' ? `Latest (${service.latestReadyRevision ?? 'none ready'})` : t.revision}
                </td>
                <td className="tnum py-1 pr-8 text-right">{t.percent}%</td>
                <td className="py-1 pr-8">{t.tag ? <Chip mono>{t.tag}</Chip> : null}</td>
                <td className="py-1">{t.uri ? <Mono value={t.uri} copy /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Container">
        <Facts
          items={[
            ['Image', c ? <Mono value={c.image} copy /> : null],
            ['Port', c?.port ?? null],
            ['Command', c && c.command.length > 0 ? <Mono value={c.command.join(' ')} /> : null],
            ['Arguments', c && c.args.length > 0 ? <Mono value={c.args.join(' ')} /> : null],
            ['CPU and memory', c ? `${c.cpu ?? 'default'} CPU, ${c.memory ?? 'default'}` : null],
            ['CPU allocation', c?.cpuIdle === false ? 'Always allocated' : 'Only during requests'],
            ['Environment', c ? `${c.env.length} variables, ${c.env.filter((e) => e.secret).length} from secrets` : null],
            ['Probes', c?.hasProbes ? 'Configured (read-only here)' : 'None'],
            ['Sidecars', sidecars.length > 0 ? sidecars.map((s) => s.name || s.image).join(', ') : null],
            [
              'Volumes',
              service.template.volumes.length > 0 ? service.template.volumes.map((v) => `${v.name} (${v.kind})`).join(', ') : null,
            ],
          ]}
        />
      </Section>
      <Section title="Scaling and runtime">
        <Facts
          items={[
            ['Instances', `${service.template.minInstances ?? 0} to ${service.template.maxInstances ?? 'default'}`],
            ['Concurrency', service.template.concurrency ?? 'default'],
            ['Request timeout', service.template.timeoutSeconds !== null ? `${service.template.timeoutSeconds} s` : null],
            [
              'Execution environment',
              service.template.executionEnvironment === 'UNSPECIFIED'
                ? 'Default'
                : service.template.executionEnvironment === 'GEN1'
                  ? 'First generation'
                  : 'Second generation',
            ],
            [
              'Service account',
              service.template.serviceAccount ? <Mono value={service.template.serviceAccount} copy /> : 'Compute Engine default',
            ],
            ['Session affinity', service.template.sessionAffinity ? 'On' : 'Off'],
          ]}
        />
      </Section>
      {conditions.length > 0 ? (
        <Section title="Conditions">
          <ul className="m-0 flex list-none flex-col gap-1 px-6">
            {conditions.map((cond) => (
              <li key={cond.type} className="flex items-start gap-2 text-dense">
                <StatusGlyph
                  kind={
                    cond.state === 'SUCCEEDED'
                      ? 'ok'
                      : cond.state === 'FAILED'
                        ? 'error'
                        : cond.state === 'UNSPECIFIED'
                          ? 'unknown'
                          : 'running'
                  }
                  label={cond.type}
                />
                <span className="text-ink-2">{cond.message}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {Object.keys(service.labels).length > 0 ? (
        <Section title="Labels">
          <div className="flex flex-wrap gap-1 px-6">
            {Object.entries(service.labels).map(([k, v]) => (
              <Chip key={k} mono>
                {k}={v}
              </Chip>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

const NOISE = [
  'name',
  'uid',
  'generation',
  'createTime',
  'updateTime',
  'deleteTime',
  'expireTime',
  'etag',
  'conditions',
  'observedGeneration',
  'logUri',
  'reconciling',
  'creator',
  'service',
  'scalingStatus',
  'satisfiesPzs',
];

/** The revision without output-only fields, for "compare before you trust" (SPEC-0003 D-05). */
export function normalizedRevision(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const copy = { ...(raw as Record<string, unknown>) };
  for (const k of NOISE) delete copy[k];
  return stringify(copy, { lineWidth: 0, sortMapEntries: true });
}

function CompareDialog({
  projectId,
  service,
  pair,
  onClose,
}: {
  projectId: string;
  service: RunService;
  pair: [string, string] | null;
  onClose: () => void;
}) {
  const [older, newer] = pair ?? [null, null];
  const a = useRevisionRaw(projectId, service.location, service.id, older);
  const b = useRevisionRaw(projectId, service.location, service.id, newer);
  return (
    <Dialog
      open={pair !== null}
      onOpenChange={(o) => !o && onClose()}
      width="xl"
      title={`Compare ${older} with ${newer}`}
      description="Templates without output-only fields. Left is the older revision."
    >
      {a.isPending || b.isPending ? (
        <DelayedSkeleton rows={8} />
      ) : a.error instanceof ApiError ? (
        <ProblemState problem={a.error.problem} />
      ) : b.error instanceof ApiError ? (
        <ProblemState problem={b.error.problem} />
      ) : (
        <DiffEditor
          original={normalizedRevision(a.data)}
          modified={normalizedRevision(b.data)}
          language="yaml"
          height="60vh"
          label={`Differences between ${older} and ${newer}`}
        />
      )}
    </Dialog>
  );
}

export function RevisionsTab({
  projectId,
  service,
  revisions,
  loading,
  error,
  onRetry,
  readOnlyReason,
}: {
  projectId: string;
  service: RunService;
  revisions: Revision[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  readOnlyReason: string | null;
}) {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [pair, setPair] = useState<[string, string] | null>(null);
  const [rollbackTo, setRollbackTo] = useState<Revision | null>(null);
  const [deleting, setDeleting] = useState<Revision | null>(null);
  const rollback = useRollback(projectId, service.location, service.id);

  const columns: ResourceColumn<Revision>[] = [
    {
      id: 'name',
      header: 'Revision',
      hideable: false,
      sortValue: (r) => r.id,
      cell: (r) => <span className="font-mono text-[12px] text-ink">{r.id}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      width: '8rem',
      sortValue: (r) => r.status,
      cell: (r) => <RunStatusGlyph status={r.status} message={r.statusMessage} />,
    },
    {
      id: 'traffic',
      header: 'Traffic',
      width: '6rem',
      align: 'right',
      sortValue: (r) => r.percent,
      cell: (r) => <span className="tnum">{r.percent}%</span>,
    },
    {
      id: 'tags',
      header: 'Tags',
      width: '8rem',
      cell: (r) =>
        r.tags.length ? (
          <span className="flex gap-1">
            {r.tags.map((t) => (
              <Chip key={t} mono>
                {t}
              </Chip>
            ))}
          </span>
        ) : null,
    },
    {
      id: 'created',
      header: 'Deployed',
      width: '8.5rem',
      sortValue: (r) => r.createTime ?? '',
      cell: (r) => <Timestamp iso={r.createTime} />,
    },
    {
      id: 'creator',
      header: 'By',
      width: '12rem',
      sortValue: (r) => r.creator ?? '',
      cell: (r) => <span className="truncate text-ink-2">{r.creator}</span>,
    },
    { id: 'image', header: 'Image', cell: (r) => <Mono value={r.images[0] ?? ''} /> },
    {
      id: 'actions',
      header: 'Actions',
      width: '11rem',
      hideable: false,
      cell: (r) => (
        <span className="flex items-center gap-1">
          {r.percent < 100 && r.status === 'ready' ? (
            <Button
              size="sm"
              variant="ghost"
              icon={ArrowCounterClockwiseIcon}
              disabled={!!readOnlyReason}
              disabledReason={readOnlyReason}
              onClick={() => setRollbackTo(r)}
            >
              Roll back
            </Button>
          ) : null}
          {r.percent === 0 ? (
            <Button
              size="sm"
              variant="ghost"
              icon={TrashIcon}
              disabled={!!readOnlyReason}
              disabledReason={readOnlyReason}
              onClick={() => setDeleting(r)}
            >
              Delete
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  const picked = [...selection];
  const ordered = (): [string, string] => {
    const byTime = revisions.filter((r) => picked.includes(r.id)).sort((x, y) => (x.createTime ?? '').localeCompare(y.createTime ?? ''));
    return [byTime[0]?.id ?? picked[0] ?? '', byTime[1]?.id ?? picked[1] ?? ''];
  };

  if (loading) return <DelayedSkeleton />;
  if (error instanceof ApiError) return <ProblemState problem={error.problem} onRetry={onRetry} />;
  return (
    <div className="pt-3">
      <ResourceTable
        tableId="run-revisions"
        label="Revisions"
        rows={revisions}
        columns={columns}
        getRowId={(r) => r.id}
        selectable
        selection={selection}
        onSelectionChange={(next) => setSelection(new Set([...next].slice(-2)))}
        emptyTitle="No revisions"
        toolbar={
          <div className="flex items-center gap-2">
            <Button
              icon={GitDiffIcon}
              disabled={selection.size !== 2}
              disabledReason="Select two revisions"
              onClick={() => setPair(ordered())}
            >
              Compare revisions
            </Button>
            <span className="text-meta text-ink-3">Select two revisions to see what changed between them.</span>
          </div>
        }
      />
      <CompareDialog projectId={projectId} service={service} pair={pair} onClose={() => setPair(null)} />
      <Dialog
        open={rollbackTo !== null}
        onOpenChange={(o) => !o && setRollbackTo(null)}
        title={`Roll back to ${rollbackTo?.id}`}
        description="All traffic moves to this revision. Tags stay, with no traffic."
        footer={
          <>
            <Button onClick={() => setRollbackTo(null)}>Cancel</Button>
            <Button
              variant="commit"
              loading={rollback.isPending}
              onClick={() => rollbackTo && rollback.mutate(rollbackTo.id, { onSuccess: () => setRollbackTo(null) })}
            >
              Send 100% to {rollbackTo?.id}
            </Button>
          </>
        }
      >
        <p className="m-0 text-dense text-ink-2">
          Revision {rollbackTo?.id} was deployed <Timestamp iso={rollbackTo?.createTime} /> with {rollbackTo?.images[0]}.
        </p>
      </Dialog>
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete revision"
        consequence={`Revision ${deleting?.id ?? ''} and its configuration are deleted. It serves no traffic now.`}
        expected={deleting?.id ?? ''}
        confirmLabel="Delete revision"
        command={deleting ? `gcloud run revisions delete ${deleting.id} --region=${service.location} --project=${projectId}` : undefined}
        onConfirm={async (confirm) => {
          if (!deleting) return;
          const { operation } = await deleteRevision(projectId, service.location, service.id, deleting.id, confirm);
          useOperations.getState().upsert(operation);
        }}
      />
    </div>
  );
}

const ACCESS_TEXT: Record<PublicAccessMode, { title: string; text: string }> = {
  none: { title: 'Require authentication', text: 'Only principals with roles/run.invoker can call the service.' },
  allUsers: { title: 'Public through IAM', text: 'Grants roles/run.invoker to allUsers. Anyone on the internet can call the service.' },
  invokerIamDisabled: {
    title: 'Public by turning off the invoker check',
    text: 'The service skips the IAM check for callers. For organizations whose policy forbids allUsers bindings.',
  },
};

export function SecurityTab({
  projectId,
  service,
  readOnlyReason,
}: {
  projectId: string;
  service: RunService;
  readOnlyReason: string | null;
}) {
  const access = useServiceAccessOne(projectId, service.location, service.id);
  const setAccess = useSetAccess(projectId, service.location, service.id);
  const [choice, setChoice] = useState<PublicAccessMode | null>(null);
  const current = access.data?.mode;
  const selected = choice ?? (current && current !== 'unknown' ? current : 'none');
  const notes: Note[] = useMemo(
    () =>
      current && current !== 'none' && current !== 'unknown'
        ? [{ id: 'public', tone: 'warn', text: 'This service is public: anyone who has its URL can call it.' }]
        : [],
    [current],
  );
  return (
    <div className="flex flex-col">
      <Notes notes={notes} />
      <Section
        title="Who can call this service"
        description="A service is either private or public, in one of two ways. The one in effect is marked."
      >
        {access.isPending ? (
          <DelayedSkeleton rows={3} />
        ) : access.error instanceof ApiError ? (
          <ProblemState problem={access.error.problem} onRetry={() => void access.refetch()} />
        ) : (
          <div className="flex max-w-3xl flex-col gap-3 px-6">
            <div role="radiogroup" aria-label="Access" className="flex flex-col gap-2">
              {(Object.keys(ACCESS_TEXT) as PublicAccessMode[]).map((mode) => (
                <label
                  key={mode}
                  className="flex cursor-pointer items-start gap-2 rounded-control border border-rule p-3 hover:bg-hover has-[:checked]:border-ink"
                >
                  <input type="radio" name="access" className="mt-1" checked={selected === mode} onChange={() => setChoice(mode)} />
                  <span className="flex flex-col">
                    <span className="text-dense font-medium text-ink">
                      {ACCESS_TEXT[mode].title}
                      {current === mode ? <span className="ml-2 text-meta font-normal text-ink-3">In effect</span> : null}
                    </span>
                    <span className="text-meta text-ink-2">{ACCESS_TEXT[mode].text}</span>
                  </span>
                </label>
              ))}
            </div>
            <div>
              <Button
                variant="commit"
                disabled={selected === current || !!readOnlyReason}
                disabledReason={readOnlyReason ?? 'This is the current access'}
                loading={setAccess.isPending}
                onClick={() => setAccess.mutate(selected, { onSuccess: () => setChoice(null) })}
              >
                Save access
              </Button>
            </div>
            <Facts items={[['Invokers', access.data && access.data.invokers.length > 0 ? access.data.invokers.join(', ') : null]]} />
          </div>
        )}
      </Section>
      <Section title="Identity">
        <Facts
          items={[
            [
              'Service account',
              service.template.serviceAccount ? (
                <Mono value={service.template.serviceAccount} copy />
              ) : (
                'Compute Engine default service account'
              ),
            ],
          ]}
        />
      </Section>
    </div>
  );
}

export function NetworkingTab({ service }: { service: RunService }) {
  const vpc = service.template.vpc;
  return (
    <Section title="Networking">
      <Facts
        items={[
          ['Ingress', ingressLabel[service.ingress]],
          ['Default URL', service.defaultUriDisabled ? 'Disabled' : service.uri ? <Mono value={service.uri} copy /> : null],
          ['URLs', service.urls.length > 1 ? service.urls.join(', ') : null],
          [
            'VPC egress',
            vpc
              ? vpc.connector
                ? `Connector ${vpc.connector}`
                : `Direct VPC ${vpc.networkInterfaces.map((n) => n.subnetwork || n.network).join(', ')}`
              : 'No VPC access',
          ],
          ['Route to the VPC', vpc ? (vpc.egress === 'ALL_TRAFFIC' ? 'All traffic' : 'Private ranges only') : null],
          ['Network tags', vpc?.networkInterfaces[0]?.tags.length ? vpc.networkInterfaces[0].tags.join(', ') : null],
        ]}
      />
    </Section>
  );
}
