import {
  BillingExportTableSchema,
  type BillingView,
  type BqJobRef,
  type BudgetView,
  type CostQuery,
  costSql,
  type InsightView,
  type OrgPoliciesView,
  type OrgPolicyRow,
  QUOTA_WARN_PERCENT,
  type QuotaPreferenceView,
  type QuotaRow,
  type QuotasView,
  type RecommendationsView,
  type RecommendationView,
} from '@nephoscope/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { Section, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { JsonTree } from '../../design/JsonTree';
import { Dialog } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { TabNav } from '../../design/TabNav';
import { Mono, Timestamp } from '../../design/Values';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { FactList } from '../../kit/FactList';
import { Notes, partialNote } from '../../kit/ListControls';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api, qs } from '../../lib/api';
import { useCapabilities, usePrefs, useUpdatePrefs } from '../../state/queries';
import { useSession } from '../../state/session';
import { JobResults, QueryEditor } from '../bigquery/QueryEditor';

const enc = encodeURIComponent;

function useGov<T>(projectId: string, key: unknown[], path: string, enabled = true) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: [key[0], profileId, projectId, ...key.slice(1)],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled: !!profileId && enabled,
  });
}

function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Nephoscope`;
  }, [title]);
}

// ---- Billing and costs (D-02) ----------------------------------------------------------------

const COSTS: { key: CostQuery; label: string }[] = [
  { key: 'service', label: 'By service' },
  { key: 'sku', label: 'By SKU' },
  { key: 'day', label: 'By day' },
];

function Costs({ projectId }: { projectId: string }) {
  const prefs = usePrefs();
  const update = useUpdatePrefs();
  const table = prefs.data?.billingExportTable ?? '';
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<CostQuery>('service');
  const [sql, setSql] = useState('');
  const [job, setJob] = useState<BqJobRef | null>(null);
  useEffect(() => {
    if (table) setSql(costSql(kind, table, projectId));
  }, [table, kind, projectId]);
  const valid = BillingExportTableSchema.safeParse(draft.trim()).success;
  const setting = (
    <div className="flex flex-wrap items-end gap-2 px-6">
      <Field
        label="Billing export table"
        help="project.dataset.table of the standard usage cost export. Kept in this Nephoscope's preferences."
        className="w-full max-w-[28rem]"
        error={draft && !valid ? 'Use project.dataset.table' : undefined}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={table || 'billing-project.billing_export.gcp_billing_export_v1_XXXXXX'}
          mono
        />
      </Field>
      <Button
        disabled={!valid}
        disabledReason="Use project.dataset.table"
        loading={update.isPending}
        onClick={() =>
          update.mutate({ billingExportTable: draft.trim() }, { onSuccess: () => toast.success('Billing export table saved') })
        }
      >
        {table ? 'Change table' : 'Use this table'}
      </Button>
    </div>
  );
  if (!table) {
    return (
      <div className="flex flex-col gap-4 pt-3">
        <EmptyState title="No billing export configured">
          Cloud Billing APIs do not report costs. Costs come from the billing export to BigQuery: turn it on in the billing account's
          Billing export settings, then name its table here.
        </EmptyState>
        {setting}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="px-6">
        <TabNav label="Cost queries" active={kind} onSelect={(k) => setKind(k as CostQuery)} items={COSTS} />
      </div>
      <QueryEditor
        projectId={projectId}
        sql={sql}
        onSqlChange={setSql}
        onJob={setJob}
        historyKey={`billing.costs:${projectId}`}
        note={
          <p className="m-0 px-6 text-dense text-ink">
            Ready-made queries over the billing export. They run in BigQuery, priced and capped like any query.
          </p>
        }
      />
      {job ? <JobResults key={job.jobId} projectId={projectId} job={job} /> : null}
      {setting}
    </div>
  );
}

/** Billing: account, budgets and costs from the billing export (SPEC-0009 D-02). */
export function BillingPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<'overview' | 'costs'>('tab', 'overview', ['overview', 'costs']);
  const q = useGov<BillingView>(projectId, ['billing'], `/api/projects/${enc(projectId)}/billing`, tab === 'overview');
  useTitle('Billing');
  const budgetColumns: ResourceColumn<BudgetView>[] = [
    {
      id: 'name',
      header: 'Budget',
      hideable: false,
      sortValue: (b) => b.displayName,
      cell: (b) => <span className="text-ink">{b.displayName}</span>,
    },
    {
      id: 'amount',
      header: 'Amount',
      width: '10rem',
      cell: (b) => (b.lastPeriod ? "Last period's spend" : b.amount ? `${b.amount.amount} ${b.amount.currency}` : ''),
    },
    { id: 'period', header: 'Period', width: '8rem', cell: (b) => (b.calendarPeriod ?? 'custom').toLowerCase() },
    {
      id: 'thresholds',
      header: 'Alerts at',
      cell: (b) => b.thresholds.map((t) => `${t.percent}%${t.basis === 'FORECASTED_SPEND' ? ' forecast' : ''}`).join(', '),
    },
    { id: 'covers', header: 'Covers this project', width: '9rem', cell: (b) => (b.coversProject ? 'Yes' : 'No') },
  ];
  const v = q.data;
  return (
    <div className="pb-16">
      <TitleBlock title="Billing" subtitle="The billing account this project charges to, its budgets, and costs from the billing export." />
      <TabNav
        label="Billing sections"
        active={tab}
        onSelect={(k) => setTab(k as 'overview' | 'costs')}
        items={[
          { key: 'overview', label: 'Overview' },
          { key: 'costs', label: 'Costs' },
        ]}
      />
      {tab === 'costs' ? (
        <Costs projectId={projectId} />
      ) : q.isPending ? (
        <DelayedSkeleton rows={4} className="p-6" />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : v ? (
        <>
          <div className="px-6 py-5">
            <FactList
              facts={[
                [
                  'Billing',
                  <StatusGlyph key="b" kind={v.billingEnabled ? 'ok' : 'paused'} label={v.billingEnabled ? 'Enabled' : 'Disabled'} />,
                ],
                ['Billing account', <Mono key="a" value={v.account ?? 'None'} />],
                ['Account name', v.accountDisplayName ?? (v.accountError ? `Not readable: ${v.accountError}` : '')],
                ['Account open', v.accountOpen === null ? '' : v.accountOpen ? 'Yes' : 'No'],
              ]}
            />
          </div>
          <Section title="Budgets" description={v.budgetsError ? `The budgets could not be read: ${v.budgetsError}` : undefined}>
            {v.budgets ? (
              <ResourceTable
                tableId="billing-budgets"
                label="Budgets"
                rows={v.budgets}
                columns={budgetColumns}
                getRowId={(b) => b.name}
                emptyTitle="No budgets"
                emptyText="A budget alerts when spend crosses a threshold."
              />
            ) : null}
          </Section>
        </>
      ) : null}
    </div>
  );
}

// ---- Quotas (D-03) ---------------------------------------------------------------------------

/** Quotas of a service with their limits and usage (SPEC-0009 D-03). */
export function QuotasPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<'quotas' | 'pending'>('tab', 'quotas', ['quotas', 'pending']);
  const [service, setService] = useSearchState<string>('service', 'compute.googleapis.com');
  const [filter, setFilter] = useState('');
  const caps = useCapabilities(projectId);
  const q = useGov<QuotasView>(
    projectId,
    ['quotas', service],
    `/api/projects/${enc(projectId)}/quotas${qs({ service })}`,
    tab === 'quotas',
  );
  const pending = useGov<QuotaPreferenceView[]>(
    projectId,
    ['quotas', 'pending'],
    `/api/projects/${enc(projectId)}/quotas/pending`,
    tab === 'pending',
  );
  useTitle('Quotas');
  const services = useMemo(() => {
    const enabled = (caps.data?.services.enabled ?? []).filter((s) => s.endsWith('.googleapis.com'));
    return [...new Set([service, ...enabled])].sort();
  }, [caps.data, service]);
  const f = filter.trim().toLowerCase();
  const rows = (q.data?.rows ?? []).filter((r) => !f || r.displayName.toLowerCase().includes(f) || r.dimensions.includes(f));
  const columns: ResourceColumn<QuotaRow>[] = [
    {
      id: 'name',
      header: 'Quota',
      hideable: false,
      sortValue: (r) => r.displayName,
      cell: (r) => <span className="text-ink">{r.displayName}</span>,
    },
    { id: 'dims', header: 'Applies to', width: '14rem', cell: (r) => <Mono value={r.dimensions} /> },
    { id: 'kind', header: 'Kind', width: '8rem', cell: (r) => r.rate ?? 'allocation' },
    {
      id: 'limit',
      header: 'Limit',
      width: '8rem',
      align: 'right',
      sortValue: (r) => Number(r.limit ?? -2),
      cell: (r) => (r.limit === '-1' ? 'Unlimited' : (r.limit ?? '')),
    },
    {
      id: 'usage',
      header: 'Usage',
      width: '7rem',
      align: 'right',
      sortValue: (r) => r.usage ?? -1,
      cell: (r) => (r.usage === null ? '' : r.usage.toLocaleString()),
    },
    {
      id: 'percent',
      header: 'Used',
      width: '8rem',
      sortValue: (r) => r.percent ?? -1,
      cell: (r) =>
        r.percent === null ? (
          ''
        ) : r.percent >= QUOTA_WARN_PERCENT ? (
          <StatusGlyph kind={r.percent >= 100 ? 'error' : 'warn'} label={`${r.percent}%`} />
        ) : (
          `${r.percent}%`
        ),
    },
    { id: 'eligible', header: 'Increase eligible', width: '8rem', defaultHidden: true, cell: (r) => (r.increaseEligible ? 'Yes' : 'No') },
  ];
  const pendingColumns: ResourceColumn<QuotaPreferenceView>[] = [
    { id: 'quota', header: 'Quota', hideable: false, cell: (r) => <Mono value={r.quotaId} /> },
    { id: 'service', header: 'Service', width: '14rem', cell: (r) => <Mono value={r.service} /> },
    { id: 'dims', header: 'Applies to', width: '12rem', cell: (r) => r.dimensions },
    { id: 'preferred', header: 'Asked for', width: '7rem', align: 'right', cell: (r) => r.preferred ?? '' },
    { id: 'granted', header: 'Granted', width: '7rem', align: 'right', cell: (r) => r.granted ?? '' },
    { id: 'state', header: 'State', cell: (r) => r.state ?? '' },
    { id: 'created', header: 'Asked', width: '9rem', cell: (r) => <Timestamp iso={r.createTime} /> },
  ];
  return (
    <div className="pb-16">
      <TitleBlock
        title="Quotas"
        subtitle={`Limits of a service and how much of them is in use; ${QUOTA_WARN_PERCENT}% and over is flagged.`}
      />
      <TabNav
        label="Quota sections"
        active={tab}
        onSelect={(k) => setTab(k as 'quotas' | 'pending')}
        items={[
          { key: 'quotas', label: 'Quotas' },
          { key: 'pending', label: 'Pending increases' },
        ]}
      />
      {tab === 'pending' ? (
        pending.error instanceof ApiError ? (
          <ProblemState problem={pending.error.problem} onRetry={() => void pending.refetch()} />
        ) : pending.isPending ? (
          <DelayedSkeleton />
        ) : (
          <div className="pt-3">
            <ResourceTable
              tableId="quota-pending"
              label="Pending quota increases"
              rows={pending.data ?? []}
              columns={pendingColumns}
              getRowId={(r) => r.name}
              emptyTitle="No pending increases"
            />
          </div>
        )
      ) : (
        <div className="pt-3">
          {q.data?.usageError ? (
            <Notes notes={[{ id: 'usage', tone: 'warn', text: `Usage could not be read from Cloud Monitoring: ${q.data.usageError}` }]} />
          ) : null}
          {q.error instanceof ApiError ? (
            <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
          ) : q.isPending ? (
            <DelayedSkeleton />
          ) : (
            <ResourceTable
              tableId="quotas"
              label={`Quotas of ${service}`}
              rows={rows}
              columns={columns}
              getRowId={(r) => `${r.quotaId}|${r.dimensions}`}
              filtered={!!f}
              emptyTitle="No quotas"
              toolbar={
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Service" className="w-72">
                    <Select<string> value={service} onValueChange={setService} options={services.map((s) => ({ value: s, label: s }))} />
                  </Field>
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter by quota or region"
                    aria-label="Filter quotas"
                    className="w-64"
                  />
                </div>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---- Recommendations (D-04) ------------------------------------------------------------------

const short = (s: string) => s.replace(/^google\./, '').replace(/Recommender$|Insight$/, '');

/** Recommendations and insights of the project (SPEC-0009 D-04). */
export function RecommendationsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<'recommendations' | 'insights'>('tab', 'recommendations', ['recommendations', 'insights']);
  const q = useGov<RecommendationsView>(projectId, ['recommender'], `/api/projects/${enc(projectId)}/recommendations`);
  const [open, setOpen] = useState<RecommendationView | InsightView | null>(null);
  useTitle('Recommendations');
  const recColumns: ResourceColumn<RecommendationView>[] = [
    { id: 'priority', header: 'Priority', width: '6rem', sortValue: (r) => r.priority ?? 'P9', cell: (r) => r.priority ?? '' },
    { id: 'description', header: 'Recommendation', hideable: false, cell: (r) => <span className="text-ink">{r.description}</span> },
    { id: 'category', header: 'Impact', width: '8rem', cell: (r) => (r.category ?? '').toLowerCase() },
    {
      id: 'cost',
      header: 'Cost change',
      width: '10rem',
      align: 'right',
      sortValue: (r) => Number(r.cost?.amount ?? 0),
      cell: (r) =>
        r.cost
          ? `${r.cost.amount} ${r.cost.currency}${r.costPeriod ? ` / ${Math.round(Number.parseInt(r.costPeriod, 10) / 86400)} d` : ''}`
          : '',
    },
    { id: 'recommender', header: 'Recommender', width: '14rem', cell: (r) => <Mono value={short(r.recommender)} /> },
    { id: 'location', header: 'Location', width: '9rem', cell: (r) => <Mono value={r.location} /> },
  ];
  const insightColumns: ResourceColumn<InsightView>[] = [
    { id: 'severity', header: 'Severity', width: '7rem', cell: (i) => (i.severity ?? '').toLowerCase() },
    { id: 'description', header: 'Insight', hideable: false, cell: (i) => <span className="text-ink">{i.description}</span> },
    { id: 'category', header: 'Category', width: '8rem', cell: (i) => (i.category ?? '').toLowerCase() },
    { id: 'type', header: 'Type', width: '14rem', cell: (i) => <Mono value={short(i.insightType)} /> },
  ];
  return (
    <div className="pb-16">
      <TitleBlock
        title="Recommendations"
        subtitle="Active recommendations and insights from the recommenders that apply to this project's resources."
      />
      <TabNav
        label="Recommendation sections"
        active={tab}
        onSelect={(k) => setTab(k as 'recommendations' | 'insights')}
        items={[
          { key: 'recommendations', label: `Recommendations${q.data ? ` (${q.data.recommendations.length})` : ''}` },
          { key: 'insights', label: `Insights${q.data ? ` (${q.data.insights.length})` : ''}` },
        ]}
      />
      <Notes notes={partialNote(q.data?.unreachable)} />
      {q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <DelayedSkeleton />
      ) : (
        <div className="pt-3">
          {tab === 'insights' ? (
            <ResourceTable
              tableId="insights"
              label="Insights"
              rows={q.data?.insights ?? []}
              columns={insightColumns}
              getRowId={(i) => i.name}
              onOpen={setOpen}
              emptyTitle="No active insights"
            />
          ) : (
            <ResourceTable
              tableId="recommendations"
              label="Recommendations"
              rows={q.data?.recommendations ?? []}
              columns={recColumns}
              getRowId={(r) => r.name}
              onOpen={setOpen}
              emptyTitle="No active recommendations"
              emptyText="Recommenders refresh daily; new resources may take a day to get one."
            />
          )}
        </div>
      )}
      <Dialog
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open?.description ?? ''}
        width="lg"
        footer={<Button onClick={() => setOpen(null)}>Close</Button>}
      >
        {open ? (
          <div className="flex flex-col gap-4">
            <FactList
              facts={[
                [
                  'Affects',
                  <span key="t" className="flex flex-col font-mono text-[12px] break-all">
                    {open.targets.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </span>,
                ],
                ['Refreshed', <Timestamp key="r" iso={open.lastRefreshTime} />],
                ['Name', <Mono key="n" value={open.name} copy />],
              ]}
            />
            <JsonTree value={open.content} label="Content" height={320} />
            <EquivalentCommand
              gcloud={
                'recommender' in open
                  ? `gcloud recommender recommendations describe ${open.name.split('/').pop()} --recommender=${open.recommender} --location=${open.location} --project=${projectId}`
                  : `gcloud recommender insights describe ${open.name.split('/').pop()} --insight-type=${open.insightType} --location=${open.location} --project=${projectId}`
              }
            />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

// ---- Organization policies (D-05) ------------------------------------------------------------

/** Effective organization policies of the project; the ones that explain errors first (SPEC-0009 D-05). */
export function OrgPoliciesPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const profileId = useSession((s) => s.profileId);
  const client = useQueryClient();
  const [reading, setReading] = useState(false);
  const key = ['orgpolicy', profileId, projectId];
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<OrgPoliciesView>(`/api/projects/${enc(projectId)}/orgpolicies`, { signal }),
    enabled: !!profileId,
  });
  // The server keeps the policies for 5 minutes; "Read again" skips that.
  async function readAgain() {
    setReading(true);
    try {
      client.setQueryData(key, await api<OrgPoliciesView>(`/api/projects/${enc(projectId)}/orgpolicies${qs({ refresh: 'true' })}`));
    } catch (err) {
      toast.error('Reading the policies failed', { description: err instanceof ApiError ? err.problem.detail : String(err) });
    } finally {
      setReading(false);
    }
  }
  const [filter, setFilter] = useState('');
  const [onlySet, setOnlySet] = useState<'all' | 'restricting' | 'project'>('all');
  const [open, setOpen] = useState<OrgPolicyRow | null>(null);
  useTitle('Organization policies');
  const f = filter.trim().toLowerCase();
  const rows = (q.data?.policies ?? []).filter(
    (r) =>
      (!f || r.displayName.toLowerCase().includes(f) || r.id.toLowerCase().includes(f)) &&
      (onlySet === 'all' || (onlySet === 'restricting' ? r.restricts : r.setOnProject)),
  );
  const columns: ResourceColumn<OrgPolicyRow>[] = [
    {
      id: 'name',
      header: 'Constraint',
      hideable: false,
      cell: (r) => (
        <span className="flex flex-col">
          <span className="text-ink">{r.displayName}</span>
          <span className="font-mono text-[11px] text-ink-3">{r.id}</span>
        </span>
      ),
    },
    {
      id: 'effective',
      header: 'Effective policy',
      cell: (r) => (r.restricts ? <StatusGlyph kind="warn" label={r.effective} /> : <span className="text-ink-2">{r.effective}</span>),
    },
    { id: 'important', header: 'Often explains errors', width: '9rem', cell: (r) => (r.important ? 'Yes' : '') },
    { id: 'set', header: 'Set on project', width: '8rem', cell: (r) => (r.setOnProject ? 'Yes' : 'Inherited') },
    { id: 'type', header: 'Type', width: '6rem', defaultHidden: true, cell: (r) => r.type },
  ];
  return (
    <div className="pb-16">
      <TitleBlock
        title="Organization policies"
        subtitle="The policies in effect for this project after inheritance. Constraints that often explain a refused change come first."
      />
      {q.data?.unreadable.length ? (
        <Notes
          notes={[{ id: 'unreadable', tone: 'warn', text: `${q.data.unreadable.length} constraints could not be read with this profile.` }]}
        />
      ) : null}
      {q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <DelayedSkeleton />
      ) : (
        <div className="pt-3">
          <ResourceTable
            tableId="orgpolicies"
            label="Organization policies"
            rows={rows}
            columns={columns}
            getRowId={(r) => r.constraint}
            onOpen={setOpen}
            filtered={rows.length !== (q.data?.policies.length ?? 0)}
            emptyTitle="No constraints"
            toolbar={
              <div className="flex flex-wrap items-end gap-3">
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter constraints"
                  aria-label="Filter constraints"
                  className="w-64"
                />
                <Field label="Show" className="w-56">
                  <Select<'all' | 'restricting' | 'project'>
                    value={onlySet}
                    onValueChange={setOnlySet}
                    options={[
                      { value: 'all', label: 'All constraints' },
                      { value: 'restricting', label: 'Only those that restrict' },
                      { value: 'project', label: 'Only those set on the project' },
                    ]}
                  />
                </Field>
                <span className="ml-auto">
                  <Button onClick={() => void readAgain()} loading={reading}>
                    Read again
                  </Button>
                </span>
              </div>
            }
          />
        </div>
      )}
      <Dialog
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open?.displayName ?? ''}
        width="lg"
        footer={<Button onClick={() => setOpen(null)}>Close</Button>}
      >
        {open ? (
          <div className="flex flex-col gap-4">
            <p className="m-0 text-dense whitespace-pre-line text-ink">{open.description}</p>
            <FactList
              facts={[
                ['Constraint', <Mono key="c" value={open.constraint} copy />],
                ['Effective policy', open.effective],
                ['Set on the project', open.setOnProject ? 'Yes' : 'No; inherited or default'],
              ]}
            />
            <JsonTree value={open.rules} label="Effective rules" height={240} />
            <EquivalentCommand gcloud={`gcloud org-policies describe ${open.id} --effective --project=${projectId}`} />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
