import {
  type AlertConditionView,
  type AlertPolicyView,
  alertComparisons,
  type CreateAlertPolicy,
  type SeriesQuery,
} from '@nephoscope/contracts';
import { PlusIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { MenuItem, Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { FactList } from '../../kit/FactList';
import { RawView } from '../../kit/RawView';
import { rangeStart, type TimeRange, timeRangeLabels, timeRanges } from '../../kit/timeRange';
import { UPlotChart } from '../../kit/UPlotChart';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { deletePolicy, useChannels, useCreatePolicy, usePolicies, usePolicy, useSeries, useSetPolicyEnabled } from './api';

const COMPARISON_LABEL: Record<(typeof alertComparisons)[number], string> = {
  COMPARISON_GT: 'Above',
  COMPARISON_GE: 'At or above',
  COMPARISON_LT: 'Below',
  COMPARISON_LE: 'At or below',
};
const ALIGNERS = [
  'ALIGN_MEAN',
  'ALIGN_MAX',
  'ALIGN_MIN',
  'ALIGN_SUM',
  'ALIGN_RATE',
  'ALIGN_DELTA',
  'ALIGN_COUNT',
  'ALIGN_PERCENTILE_99',
  'ALIGN_PERCENTILE_95',
];

function PolicyState({ enabled }: { enabled: boolean }) {
  return enabled ? <StatusGlyph kind="ok" label="Enabled" /> : <StatusGlyph kind="paused" label="Disabled" />;
}

/** The query that charts a condition, as its policy evaluates it (SPEC-0005 D-10). */
export function conditionQuery(c: AlertConditionView, since: string, until: string): SeriesQuery | null {
  if ((c.kind === 'threshold' || c.kind === 'absent') && c.filter) {
    const a = c.aggregations[0] ?? {};
    return {
      kind: 'filter',
      filter: c.filter,
      aggregation: {
        alignmentPeriod: a.alignmentPeriod,
        perSeriesAligner: a.perSeriesAligner,
        crossSeriesReducer: a.crossSeriesReducer,
        groupByFields: a.groupByFields,
      },
      since,
      until,
    };
  }
  if (c.kind === 'promql' && c.query) return { kind: 'promql', query: c.query, since, until };
  if (c.kind === 'mql' && c.query) return { kind: 'mql', query: c.query, since, until };
  return null;
}

function ConditionChart({
  projectId,
  condition,
  since,
  until,
}: {
  projectId: string;
  condition: AlertConditionView;
  since: string;
  until: string;
}) {
  const q = conditionQuery(condition, since, until);
  const r = useSeries(projectId, q);
  if (!q) return <p className="m-0 text-dense text-ink-3">This kind of condition has no chart in Nephoscope.</p>;
  if (r.isPending) return <DelayedSkeleton rows={4} />;
  if (r.error instanceof ApiError) return <ProblemState problem={r.error.problem} onRetry={() => void r.refetch()} />;
  if ((r.data?.series.length ?? 0) === 0) return <p className="m-0 text-dense text-ink-3">No data in this range.</p>;
  return <UPlotChart series={r.data?.series ?? []} label={condition.displayName} height={220} threshold={condition.threshold} />;
}

/** One alert policy: conditions with their charts, channels and documentation (SPEC-0005 D-10). */
export function AlertPolicyPage() {
  const { projectId, policy: id } = useParams({ strict: false }) as { projectId: string; policy: string };
  const q = usePolicy(projectId, id);
  const channels = useChannels(projectId);
  const setEnabled = useSetPolicyEnabled(projectId);
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [range, setRange] = useSearchState<TimeRange>('range', '1d', timeRanges);
  const [anchor] = useState(() => Date.now());
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  if (q.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (q.error instanceof ApiError || !q.data)
    return q.error instanceof ApiError ? <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} /> : null;
  const p = q.data.policy;
  const names = new Map((channels.data ?? []).map((c) => [c.name, c.displayName]));
  const since = rangeStart(range, anchor);
  const until = new Date(anchor).toISOString();
  return (
    <>
      <DetailLayout<'overview' | 'json'>
        crumbs={[{ label: 'Monitoring', to: `/p/${projectId}/monitoring?tab=alerts` }, { label: p.displayName }]}
        title={p.displayName}
        status={<PolicyState enabled={p.enabled} />}
        actions={
          <Button
            disabled={!!readOnly}
            disabledReason={readOnly}
            loading={setEnabled.isPending}
            onClick={() => setEnabled.mutate({ id, enabled: !p.enabled })}
          >
            {p.enabled ? 'Disable policy' : 'Enable policy'}
          </Button>
        }
        menu={
          <MenuItem onClick={() => setDeleting(true)} disabled={!!readOnly} className="text-redline-ink">
            Delete policy
          </MenuItem>
        }
        cells={[
          { label: 'Conditions', value: String(p.conditions.length) },
          { label: 'Combiner', value: p.combiner },
          { label: 'Severity', value: p.severity ?? 'None' },
          { label: 'Updated', value: <Timestamp iso={p.updateTime} /> },
        ]}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'json', label: 'JSON' },
        ]}
        defaultTab="overview"
      >
        {(tab) =>
          tab === 'json' ? (
            <RawView value={q.data.raw} fileName={p.id} />
          ) : (
            <>
              <div className="flex items-end gap-2 px-6 pt-4">
                <Field label="Chart range" className="w-44">
                  <Select<TimeRange>
                    value={range}
                    onValueChange={setRange}
                    options={timeRanges.map((r) => ({ value: r, label: timeRangeLabels[r] }))}
                  />
                </Field>
                <p className="m-0 pb-2 text-meta text-ink-3">
                  The Monitoring API does not list open incidents; each condition is charted the way the policy evaluates it.
                </p>
              </div>
              {p.conditions.map((c) => (
                <Section
                  key={c.name}
                  title={c.displayName || 'Condition'}
                  description={
                    c.kind === 'threshold' && c.comparison
                      ? `${COMPARISON_LABEL[c.comparison as keyof typeof COMPARISON_LABEL] ?? c.comparison} ${c.threshold ?? ''} for ${c.duration ?? '0s'}`
                      : c.kind
                  }
                >
                  <div className="flex flex-col gap-2 px-6">
                    {c.filter ? <Mono value={c.filter} /> : null}
                    {c.query ? <Mono value={c.query} /> : null}
                    <ConditionChart projectId={projectId} condition={c} since={since} until={until} />
                  </div>
                </Section>
              ))}
              <Section title="Notifications and documentation">
                <FactList
                  facts={[
                    ['Channels', p.channels.length ? p.channels.map((c) => names.get(c) ?? c.split('/').pop()).join(', ') : null],
                    ['Documentation', p.documentation ? <span className="whitespace-pre-wrap">{p.documentation}</span> : null],
                  ]}
                />
              </Section>
            </>
          )
        }
      </DetailLayout>
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete alert policy"
        consequence={`The policy ${p.displayName} stops alerting and is deleted.`}
        expected={id}
        confirmLabel="Delete policy"
        command={`gcloud alpha monitoring policies delete ${id} --project=${projectId}`}
        onConfirm={async (c) => {
          await deletePolicy(projectId, id, c);
          void navigate({ to: `/p/${projectId}/monitoring` as string, search: { tab: 'alerts' } });
        }}
      />
    </>
  );
}

function CreatePolicySheet({
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
  const [mode, setMode] = useState<'threshold' | 'json'>('threshold');
  const [name, setName] = useState('');
  const [source, setSource] = useState<'metric' | 'promql'>('metric');
  const [metricType, setMetricType] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [extra, setExtra] = useState('');
  const [aligner, setAligner] = useState('ALIGN_MEAN');
  const [promql, setPromql] = useState('');
  const [comparison, setComparison] = useState<(typeof alertComparisons)[number]>('COMPARISON_GT');
  const [threshold, setThreshold] = useState('');
  const [duration, setDuration] = useState('300');
  const [selected, setSelected] = useState<string[]>([]);
  const [docs, setDocs] = useState('');
  const [json, setJson] = useState('{\n  "displayName": "",\n  "combiner": "OR",\n  "conditions": []\n}');
  const channels = useChannels(projectId);
  const create = useCreatePolicy(projectId);
  const navigate = useNavigate();
  useEffect(() => {
    if (open) {
      setName('');
      setThreshold('');
      setSelected([]);
    }
  }, [open]);
  const thresholdOk = threshold.trim() !== '' && Number.isFinite(Number(threshold));
  const sourceOk = source === 'metric' ? metricType.trim().length > 0 : promql.trim().length > 0;
  const ok = mode === 'json' ? json.trim().length > 2 : name.trim() && sourceOk && thresholdOk;
  const body = (): CreateAlertPolicy =>
    mode === 'json'
      ? { mode: 'json', json }
      : {
          mode: 'threshold',
          displayName: name.trim(),
          source:
            source === 'metric'
              ? {
                  kind: 'metric',
                  metricType: metricType.trim(),
                  resourceType: resourceType.trim() || undefined,
                  extraFilter: extra.trim() || undefined,
                  aligner,
                }
              : { kind: 'promql', query: promql.trim() },
          comparison,
          threshold: Number(threshold),
          durationSeconds: Number(duration) || 0,
          alignmentSeconds: 60,
          channels: selected,
          documentation: docs.trim() || undefined,
        };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create alert policy"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={create.isPending}
            disabled={!!readOnly || !ok}
            disabledReason={readOnly ?? 'Name, source and threshold are required'}
            onClick={() =>
              create.mutate(body(), {
                onSuccess: (p) => {
                  onOpenChange(false);
                  void navigate({ to: `/p/${projectId}/monitoring/alerts/${p.id}` as string });
                },
              })
            }
          >
            Create alert policy
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Define the policy">
          <Select<'threshold' | 'json'>
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'threshold', label: 'Threshold form' },
              { value: 'json', label: 'JSON' },
            ]}
          />
        </Field>
        {mode === 'json' ? (
          <CodeEditor value={json} onChange={setJson} language="json" height={360} label="Alert policy JSON" />
        ) : (
          <>
            <Field label="Name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Source">
              <Select<'metric' | 'promql'>
                value={source}
                onValueChange={setSource}
                options={[
                  { value: 'metric', label: 'A metric type' },
                  { value: 'promql', label: 'A PromQL query' },
                ]}
              />
            </Field>
            {source === 'metric' ? (
              <>
                <Field label="Metric type" required help="Such as run.googleapis.com/request_latencies.">
                  <Input mono value={metricType} onChange={(e) => setMetricType(e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Resource type">
                    <Input mono value={resourceType} onChange={(e) => setResourceType(e.target.value)} placeholder="cloud_run_revision" />
                  </Field>
                  <Field label="Aligner">
                    <Select<string> value={aligner} onValueChange={setAligner} options={ALIGNERS.map((a) => ({ value: a, label: a }))} />
                  </Field>
                </div>
                <Field label="Extra filter" help={'Monitoring filter clauses, such as resource.labels.service_name = "api".'}>
                  <Input mono value={extra} onChange={(e) => setExtra(e.target.value)} />
                </Field>
              </>
            ) : (
              <Field label="PromQL" required help="The comparison below is appended to the query.">
                <CodeEditor value={promql} onChange={setPromql} language="promql" height={80} label="PromQL condition" />
              </Field>
            )}
            <div className="grid grid-cols-3 gap-3">
              <Field label="Alert when">
                <Select<(typeof alertComparisons)[number]>
                  value={comparison}
                  onValueChange={setComparison}
                  options={alertComparisons.map((c) => ({ value: c, label: COMPARISON_LABEL[c] }))}
                />
              </Field>
              <Field label="Threshold" required>
                <Input mono value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="For (seconds)">
                <Input mono value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
              </Field>
            </div>
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="mb-1 text-dense font-medium text-ink">Notification channels</legend>
              {(channels.data ?? []).length === 0 ? (
                <p className="m-0 text-meta text-ink-3">No channels. Create one on the Channels tab.</p>
              ) : null}
              {(channels.data ?? []).map((c) => (
                <label key={c.name} className="flex items-center gap-2 text-dense text-ink">
                  <input
                    type="checkbox"
                    checked={selected.includes(c.name)}
                    onChange={(e) => setSelected((p) => (e.target.checked ? [...p, c.name] : p.filter((x) => x !== c.name)))}
                  />
                  {c.displayName} <span className="text-meta text-ink-3">{c.type}</span>
                </label>
              ))}
            </fieldset>
            <Field label="Documentation" help="Sent with notifications. Markdown is allowed.">
              <CodeEditor value={docs} onChange={setDocs} language="markdown" height={100} label="Documentation" />
            </Field>
            <EquivalentCommand
              rest={{ method: 'POST', url: `https://monitoring.googleapis.com/v3/projects/${projectId}/alertPolicies`, body: body() }}
            />
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Alert policies (SPEC-0005 D-10). */
export function Alerts({ projectId, readOnly }: { projectId: string; readOnly: string | null }) {
  const q = usePolicies(projectId);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const href = (p: AlertPolicyView) => `/p/${projectId}/monitoring/alerts/${p.id}`;
  const columns: ResourceColumn<AlertPolicyView>[] = [
    {
      id: 'name',
      header: 'Policy',
      hideable: false,
      sortValue: (p) => p.displayName,
      cell: (p) => (
        <Link to={href(p)} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {p.displayName}
        </Link>
      ),
    },
    {
      id: 'state',
      header: 'State',
      width: '8rem',
      sortValue: (p) => (p.enabled ? 1 : 0),
      cell: (p) => <PolicyState enabled={p.enabled} />,
    },
    {
      id: 'conditions',
      header: 'Conditions',
      width: '7rem',
      align: 'right',
      cell: (p) => <span className="tnum">{p.conditions.length}</span>,
    },
    { id: 'kind', header: 'Kind', width: '9rem', cell: (p) => [...new Set(p.conditions.map((c) => c.kind))].join(', ') },
    { id: 'severity', header: 'Severity', width: '8rem', cell: (p) => p.severity ?? '' },
    { id: 'channels', header: 'Channels', width: '7rem', align: 'right', cell: (p) => <span className="tnum">{p.channels.length}</span> },
  ];
  return (
    <div className="pt-3">
      {q.isPending ? (
        <DelayedSkeleton />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : (
        <ResourceTable
          tableId="monitoring-policies"
          label="Alert policies"
          rows={q.data ?? []}
          columns={columns}
          getRowId={(p) => p.name}
          onOpen={(p) => void navigate({ to: href(p) })}
          emptyTitle="No alert policies"
          emptyText="An alert policy watches a metric and notifies channels when a condition holds."
          emptyAction={
            <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setCreating(true)}>
              Create alert policy
            </Button>
          }
          toolbar={
            <div className="flex justify-end">
              <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setCreating(true)}>
                Create alert policy
              </Button>
            </div>
          }
        />
      )}
      <CreatePolicySheet projectId={projectId} open={creating} onOpenChange={setCreating} readOnly={readOnly} />
    </div>
  );
}
