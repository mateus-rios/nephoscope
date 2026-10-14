import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  ARMOR_DEFAULT_PRIORITY,
  type ArmorPolicySummary,
  type ArmorPolicyView,
  type ArmorRule,
  type ArmorTarget,
  armorActions,
  type OperationAccepted,
  reorderPlan,
  type SaveArmorRule,
  type WafExpressionSet,
} from '@nephoscope/contracts';
import { DotsSixVerticalIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Notes, Section, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Switch, Textarea } from '../../design/Form';
import { Dialog, MenuItem, Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { EquivalentCommand, sh } from '../../kit/EquivalentCommand';
import { partialNote } from '../../kit/ListControls';
import { LogsPanel } from '../../kit/LogsPanel';
import { useOperationMutation } from '../../kit/operations';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api } from '../../lib/api';
import { useReducedMotion } from '../../lib/motion';
import { useActiveProfile, useInstance } from '../../state/queries';
import { useSession } from '../../state/session';
import { readOnlyReason } from '../run/common';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/armor`;
const policyApi = (p: string, scope: string, name: string) => `${base(p)}/policies/${enc(scope)}/${enc(name)}`;

function useReadOnly() {
  const instance = useInstance();
  const { profile } = useActiveProfile();
  return readOnlyReason(instance.data?.readOnly, profile?.readOnly);
}

function useArmorQuery<T>(projectId: string, key: unknown[], path: string, enabled = true) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['armor', profileId, projectId, ...key],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled: !!profileId && enabled,
  });
}

const ACTION_LABEL: Record<string, string> = {
  allow: 'Allow',
  'deny(403)': 'Deny 403',
  'deny(404)': 'Deny 404',
  'deny(502)': 'Deny 502',
  rate_based_ban: 'Rate-based ban',
  throttle: 'Throttle',
  redirect: 'Redirect',
};

function ActionGlyph({ action }: { action: string }) {
  if (action === 'allow') return <StatusGlyph kind="ok" label="Allow" />;
  if (action.startsWith('deny')) return <StatusGlyph kind="error" label={ACTION_LABEL[action] ?? action} />;
  return <StatusGlyph kind="warn" label={ACTION_LABEL[action] ?? action} />;
}

const matchText = (r: ArmorRule) => (r.match.kind === 'ip' ? r.match.srcIpRanges.join(', ') : (r.match.expression ?? 'Custom match'));
const policyHref = (projectId: string, p: Pick<ArmorPolicySummary, 'scope' | 'name'>) => `/p/${projectId}/armor/${p.scope}/${p.name}`;

/** Security policies and the backend services they protect (SPEC-0007 D-09, CA-09). */
export function ArmorPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<'policies' | 'targets'>('tab', 'policies', ['policies', 'targets']);
  const policies = useArmorQuery<{ items: ArmorPolicySummary[]; unreachable: string[] }>(
    projectId,
    ['policies'],
    `${base(projectId)}/policies`,
  );
  const targets = useArmorQuery<ArmorTarget[]>(projectId, ['targets'], `${base(projectId)}/targets`, tab === 'targets');
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState('global');
  const [type, setType] = useState<'CLOUD_ARMOR' | 'CLOUD_ARMOR_EDGE' | 'CLOUD_ARMOR_NETWORK'>('CLOUD_ARMOR');
  const create = useOperationMutation({
    mutationFn: (b: object) => api<OperationAccepted>(`${base(projectId)}/policies`, { body: b }),
    started: () => `Creating security policy ${name}`,
    onSuccess: () => setCreating(false),
  });
  useEffect(() => {
    document.title = 'Cloud Armor · Nephoscope';
  }, []);
  const columns: ResourceColumn<ArmorPolicySummary>[] = [
    {
      id: 'name',
      header: 'Policy',
      hideable: false,
      sortValue: (p) => p.name,
      cell: (p) => (
        <Link to={policyHref(projectId, p)} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {p.name}
        </Link>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      width: '9rem',
      sortValue: (p) => p.type,
      cell: (p) => (p.type === 'CLOUD_ARMOR_EDGE' ? 'Edge' : p.type === 'CLOUD_ARMOR_NETWORK' ? 'Network' : 'Backend'),
    },
    { id: 'scope', header: 'Scope', width: '9rem', sortValue: (p) => p.scope, cell: (p) => <Mono value={p.scope} /> },
    {
      id: 'rules',
      header: 'Rules',
      width: '5rem',
      align: 'right',
      sortValue: (p) => p.ruleCount,
      cell: (p) => <span className="tnum">{p.ruleCount}</span>,
    },
    {
      id: 'targets',
      header: 'Attached to',
      cell: (p) =>
        p.targets.length ? (
          <Mono value={p.targets.map((t) => t.split('/').pop()).join(', ')} />
        ) : (
          <span className="text-ink-3">Nothing</span>
        ),
    },
    { id: 'adaptive', header: 'Adaptive protection', width: '10rem', cell: (p) => (p.adaptiveProtection ? 'On' : 'Off') },
  ];
  const targetColumns: ResourceColumn<ArmorTarget>[] = [
    {
      id: 'name',
      header: 'Target',
      hideable: false,
      sortValue: (t) => t.name,
      cell: (t) => <span className="font-medium text-ink">{t.name}</span>,
    },
    { id: 'kind', header: 'Kind', width: '9rem', cell: (t) => (t.kind === 'backendBucket' ? 'Backend bucket' : 'Backend service') },
    { id: 'scope', header: 'Scope', width: '9rem', cell: (t) => <Mono value={t.scope} /> },
    {
      id: 'backend',
      header: 'Backend policy',
      cell: (t) =>
        t.securityPolicy ? (
          <Link
            to={
              `/p/${projectId}/armor/${t.securityPolicy.startsWith('regions/') ? t.securityPolicy.split('/')[1] : 'global'}/${t.securityPolicy.split('/').pop()}` as string
            }
          >
            {t.securityPolicy.split('/').pop()}
          </Link>
        ) : (
          <span className="text-ink-3">None</span>
        ),
    },
    {
      id: 'edge',
      header: 'Edge policy',
      cell: (t) =>
        t.edgeSecurityPolicy ? <Mono value={t.edgeSecurityPolicy.split('/').pop() ?? ''} /> : <span className="text-ink-3">None</span>,
    },
  ];
  return (
    <div className="pb-16">
      <TitleBlock
        title="Cloud Armor"
        subtitle="Security policies: ordered rules that allow, deny or limit traffic before it reaches a backend."
        actions={
          <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setCreating(true)}>
            Create policy
          </Button>
        }
      />
      <div role="tablist" aria-label="Cloud Armor sections" className="flex gap-4 border-b border-rule px-6">
        {(['policies', 'targets'] as const).map((k) => (
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
            {k === 'policies' ? 'Policies' : 'Effective policies by target'}
          </button>
        ))}
      </div>
      <Notes notes={partialNote(policies.data?.unreachable)} />
      <div className="pt-3">
        {tab === 'policies' ? (
          policies.isPending ? (
            <DelayedSkeleton />
          ) : policies.error instanceof ApiError ? (
            <ProblemState problem={policies.error.problem} onRetry={() => void policies.refetch()} />
          ) : (
            <ResourceTable
              tableId="armor-policies"
              label="Security policies"
              rows={policies.data?.items ?? []}
              columns={columns}
              getRowId={(p) => p.path}
              onOpen={(p) => void navigate({ to: policyHref(projectId, p) })}
              emptyTitle="No security policies"
              emptyText="A security policy holds rules evaluated by priority, from the lowest number up, for the backends it is attached to."
            />
          )
        ) : targets.isPending ? (
          <DelayedSkeleton />
        ) : targets.error instanceof ApiError ? (
          <ProblemState problem={targets.error.problem} onRetry={() => void targets.refetch()} />
        ) : (
          <ResourceTable
            tableId="armor-targets"
            label="Backend services and buckets"
            rows={targets.data ?? []}
            columns={targetColumns}
            getRowId={(t) => t.path}
            emptyTitle="No backend services"
          />
        )}
      </div>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Create security policy"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="commit"
              loading={create.isPending}
              disabled={!/^[a-z]([-a-z0-9]*[a-z0-9])?$/.test(name)}
              onClick={() => create.mutate({ name, scope, type })}
            >
              Create policy
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Name" required>
            <Input mono value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Type">
            <Select<'CLOUD_ARMOR' | 'CLOUD_ARMOR_EDGE' | 'CLOUD_ARMOR_NETWORK'>
              value={type}
              onValueChange={setType}
              options={[
                { value: 'CLOUD_ARMOR', label: 'Backend security policy' },
                { value: 'CLOUD_ARMOR_EDGE', label: 'Edge security policy' },
                { value: 'CLOUD_ARMOR_NETWORK', label: 'Network edge security policy' },
              ]}
            />
          </Field>
          <Field label="Scope" help="global, or a region for regional load balancers.">
            <Input mono value={scope} onChange={(e) => setScope(e.target.value)} />
          </Field>
          <EquivalentCommand
            gcloud={`gcloud compute security-policies create ${name || 'NAME'} --type=${type}${scope !== 'global' ? ` --region=${scope}` : ''} --project=${projectId}`}
          />
        </div>
      </Dialog>
    </div>
  );
}

function SortableRule({
  rule,
  onEdit,
  onDelete,
  disabled,
}: {
  rule: ArmorRule;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rule.priority, disabled });
  // Rows still follow the pointer; with reduced motion they no longer glide into place.
  const reduced = useReducedMotion();
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined,
        transition: reduced ? undefined : transition,
      }}
      className={`grid grid-cols-[2rem_6rem_9rem_1fr_6rem_5rem] items-center gap-3 border-b border-rule bg-sheet px-6 py-1 text-dense ${isDragging ? 'relative z-10 shadow-overlay' : ''}`}
    >
      <button
        type="button"
        aria-label={`Move rule ${rule.priority}`}
        className="flex size-6 cursor-grab items-center justify-center rounded-control text-ink-3 hover:bg-hover disabled:cursor-not-allowed"
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <DotsSixVerticalIcon size={16} aria-hidden />
      </button>
      <span className="tnum font-mono text-[12px]">{rule.priority}</span>
      <ActionGlyph action={rule.action} />
      <span className="min-w-0">
        <Mono value={matchText(rule)} />
        {rule.description ? <span className="block truncate text-meta text-ink-3">{rule.description}</span> : null}
      </span>
      <span>{rule.preview ? <StatusGlyph kind="pending" label="Preview" /> : null}</span>
      <span className="flex gap-1">
        <IconButton icon={PencilSimpleIcon} label={`Edit rule ${rule.priority}`} size="sm" onClick={onEdit} disabled={disabled} />
        <IconButton icon={TrashIcon} label={`Delete rule ${rule.priority}`} size="sm" onClick={onDelete} disabled={disabled} />
      </span>
    </li>
  );
}

function RuleSheet({
  projectId,
  policy,
  rule,
  open,
  onOpenChange,
  waf,
}: {
  projectId: string;
  policy: ArmorPolicyView;
  rule: ArmorRule | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  waf: WafExpressionSet[];
}) {
  const isDefault = rule?.priority === ARMOR_DEFAULT_PRIORITY;
  const [priority, setPriority] = useState('');
  const [action, setAction] = useState<(typeof armorActions)[number]>('deny(403)');
  const [description, setDescription] = useState('');
  const [preview, setPreview] = useState(false);
  const [mode, setMode] = useState<'ip' | 'expr'>('ip');
  const [ips, setIps] = useState('');
  const [expr, setExpr] = useState('');
  const [wafSet, setWafSet] = useState('');
  const [sensitivity, setSensitivity] = useState('1');
  const [rateLimit, setRateLimit] = useState('');
  const [redirect, setRedirect] = useState('');
  useEffect(() => {
    if (!open) return;
    const used = new Set(policy.rules.map((r) => r.priority));
    let next = 1000;
    while (used.has(next)) next += 10;
    setPriority(String(rule?.priority ?? next));
    setAction((rule?.action as (typeof armorActions)[number]) ?? 'deny(403)');
    setDescription(rule?.description ?? '');
    setPreview(rule?.preview ?? false);
    setMode(rule?.match.kind === 'expr' ? 'expr' : 'ip');
    setIps(rule?.match.srcIpRanges.join('\n') ?? '');
    setExpr(rule?.match.expression ?? '');
    setRateLimit(rule?.rateLimitOptions ? JSON.stringify(rule.rateLimitOptions, null, 2) : '');
    setRedirect(rule?.redirectOptions ? JSON.stringify(rule.redirectOptions, null, 2) : '');
  }, [open, rule, policy.rules]);
  const save = useOperationMutation({
    mutationFn: (b: SaveArmorRule) =>
      rule
        ? api<OperationAccepted>(`${policyApi(projectId, policy.scope, policy.name)}/rules/${rule.priority}`, { method: 'PUT', body: b })
        : api<OperationAccepted>(`${policyApi(projectId, policy.scope, policy.name)}/rules`, { body: b }),
    started: () => (rule ? `Updating rule ${rule.priority}` : `Adding rule ${priority}`),
    onSuccess: () => onOpenChange(false),
  });
  const parseJson = (text: string) => {
    if (!text.trim()) return { ok: true as const, value: undefined };
    try {
      const v = JSON.parse(text) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v)
        ? { ok: true as const, value: v as Record<string, unknown> }
        : { ok: false as const };
    } catch {
      return { ok: false as const };
    }
  };
  const rl = parseJson(rateLimit);
  const rd = parseJson(redirect);
  const ranges = ips.split(/[\s,]+/).filter(Boolean);
  const valid =
    isDefault ||
    ((mode === 'ip' ? ranges.length > 0 && ranges.length <= 10 : expr.trim().length > 0) &&
      rl.ok &&
      rd.ok &&
      Number.isInteger(Number(priority)));
  const body = (): SaveArmorRule => ({
    priority: Number(priority),
    action,
    description,
    preview,
    match: isDefault
      ? { kind: 'ip', srcIpRanges: ['*'] }
      : mode === 'ip'
        ? { kind: 'ip', srcIpRanges: ranges }
        : { kind: 'expr', expression: expr.trim() },
    rateLimitOptions: rl.ok ? rl.value : undefined,
    redirectOptions: rd.ok ? rd.value : undefined,
  });
  const wafSelected = waf.find((s) => s.id === wafSet);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={isDefault ? 'Default rule' : rule ? `Edit rule ${rule.priority}` : 'Add rule'}
      description={
        isDefault
          ? 'The default rule is evaluated last; only its action can change.'
          : 'Rules are evaluated from the lowest priority number up; the first match decides.'
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={save.isPending}
            disabled={!valid}
            disabledReason="Complete the match and fix the JSON"
            onClick={() => save.mutate(body())}
          >
            {rule ? 'Save rule' : 'Add rule'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority" help={rule ? 'Change the order by dragging the rules.' : 'Lower numbers are evaluated first.'}>
            <Input mono value={priority} onChange={(e) => setPriority(e.target.value.replace(/\D/g, ''))} disabled={!!rule} />
          </Field>
          <Field label="Action">
            <Select<(typeof armorActions)[number]>
              value={action}
              onValueChange={setAction}
              options={armorActions.map((a) => ({ value: a, label: ACTION_LABEL[a] ?? a }))}
            />
          </Field>
        </div>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {isDefault ? null : (
          <>
            <Switch
              checked={preview}
              onCheckedChange={setPreview}
              label="Preview"
              description="Evaluate and log the rule without enforcing it."
            />
            <Field label="Match">
              <Select<'ip' | 'expr'>
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: 'ip', label: 'Basic: source IP ranges' },
                  { value: 'expr', label: 'Advanced: CEL expression' },
                ]}
              />
            </Field>
            {mode === 'ip' ? (
              <Field label="Source IP ranges" help="Up to 10, one per line. * matches every address.">
                <Textarea mono rows={4} value={ips} onChange={(e) => setIps(e.target.value)} />
              </Field>
            ) : (
              <>
                {waf.length > 0 ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Preconfigured WAF rule set" className="w-64">
                      <Select<string>
                        value={wafSet}
                        onValueChange={setWafSet}
                        options={[{ value: '', label: 'Choose a set' }, ...waf.map((s) => ({ value: s.id, label: s.id }))]}
                      />
                    </Field>
                    <Field label="Sensitivity" className="w-28">
                      <Select<string>
                        value={sensitivity}
                        onValueChange={setSensitivity}
                        options={['1', '2', '3', '4'].map((v) => ({ value: v, label: v }))}
                      />
                    </Field>
                    <Button
                      disabled={!wafSelected}
                      onClick={() => setExpr(`evaluatePreconfiguredWaf('${wafSet}', {'sensitivity': ${sensitivity}})`)}
                    >
                      Use this set
                    </Button>
                  </div>
                ) : null}
                <Field label="Expression (CEL)">
                  <CodeEditor value={expr} onChange={setExpr} language="plaintext" height={100} label="Rule expression" />
                </Field>
              </>
            )}
            {action === 'throttle' || action === 'rate_based_ban' ? (
              <Field
                label="Rate limit options (JSON)"
                error={rl.ok ? undefined : 'Not a JSON object'}
                help="rateLimitThreshold, conformAction, exceedAction, enforceOnKey, banDurationSec."
              >
                <CodeEditor
                  value={
                    rateLimit ||
                    '{\n  "rateLimitThreshold": { "count": 100, "intervalSec": 60 },\n  "conformAction": "allow",\n  "exceedAction": "deny(429)",\n  "enforceOnKey": "IP"\n}'
                  }
                  onChange={setRateLimit}
                  language="json"
                  height={140}
                  label="Rate limit options"
                />
              </Field>
            ) : null}
            {action === 'redirect' ? (
              <Field label="Redirect options (JSON)" error={rd.ok ? undefined : 'Not a JSON object'}>
                <CodeEditor
                  value={redirect || '{\n  "type": "EXTERNAL_302",\n  "target": "https://example.com"\n}'}
                  onChange={setRedirect}
                  language="json"
                  height={100}
                  label="Redirect options"
                />
              </Field>
            ) : null}
          </>
        )}
        <EquivalentCommand
          gcloud={`gcloud compute security-policies rules ${rule ? 'update' : 'create'} ${priority || 'PRIORITY'} --security-policy=${policy.name}${policy.scope !== 'global' ? ` --region=${policy.scope}` : ''} --action=${action}${!isDefault && mode === 'ip' ? ` --src-ip-ranges=${ranges.join(',')}` : ''}${!isDefault && mode === 'expr' ? ` --expression=${sh(expr)}` : ''}${preview ? ' --preview' : ''} --project=${projectId}`}
        />
      </div>
    </Sheet>
  );
}

function PlanDialog({
  projectId,
  policy,
  order,
  onOpenChange,
}: {
  projectId: string;
  policy: ArmorPolicyView;
  order: number[] | null;
  onOpenChange: (o: boolean) => void;
}) {
  const plan = useMemo(
    () =>
      order
        ? reorderPlan(
            policy.rules.map((r) => r.priority),
            order,
          )
        : [],
    [order, policy.rules],
  );
  const [typed, setTyped] = useState('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new order invalidates the typed confirmation.
  useEffect(() => setTyped(''), [order]);
  const apply = useOperationMutation({
    mutationFn: () =>
      api<OperationAccepted>(`${policyApi(projectId, policy.scope, policy.name)}/reorder`, { body: { order, confirm: typed.trim() } }),
    started: () => `Reordering the rules of ${policy.name}`,
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog
      open={order !== null}
      onOpenChange={onOpenChange}
      title="Review the new rule order"
      width="lg"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Keep the current order</Button>
          <Button
            variant="danger"
            loading={apply.isPending}
            disabled={typed.trim() !== String(plan.length) || plan.length === 0}
            onClick={() => apply.mutate(undefined)}
          >
            Apply {plan.length} priority changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-dense text-ink">
          Priorities are the order Cloud Armor evaluates rules in, so each change can let traffic through or block it while the plan runs.
          Each step copies a rule to its new priority, then removes it from the old one.
        </p>
        <ol className="m-0 flex max-h-72 flex-col gap-0.5 overflow-y-auto pl-6 font-mono text-[12px]">
          {plan.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps are an ordered list with no ids.
            <li key={i}>
              Move rule {s.from} to {s.to}
              {s.temporary ? ' (temporary, to free its place)' : ''}
            </li>
          ))}
        </ol>
        <Field label={`Type ${plan.length} to apply the plan`}>
          <Input mono value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/** A security policy: ordered rules, attachments, adaptive protection, logs (SPEC-0007 D-09). */
export function ArmorPolicyPage() {
  const { projectId, scope, policy: name } = useParams({ strict: false }) as { projectId: string; scope: string; policy: string };
  const q = useArmorQuery<ArmorPolicyView>(projectId, ['policy', scope, name], policyApi(projectId, scope, name));
  const waf = useArmorQuery<WafExpressionSet[]>(projectId, ['waf'], `${base(projectId)}/waf`, scope === 'global');
  const targets = useArmorQuery<ArmorTarget[]>(projectId, ['targets'], `${base(projectId)}/targets`);
  const readOnly = useReadOnly();
  const navigate = useNavigate();
  const [order, setOrder] = useState<number[]>([]);
  const [planning, setPlanning] = useState<number[] | null>(null);
  const [editing, setEditing] = useState<ArmorRule | 'new' | null>(null);
  const [deletingRule, setDeletingRule] = useState<ArmorRule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [logView, setLogView] = useSearchState<'enforced' | 'preview'>('logs', 'enforced', ['enforced', 'preview']);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const adaptive = useOperationMutation({
    mutationFn: (enable: boolean) =>
      api<OperationAccepted>(`${policyApi(projectId, scope, name)}/adaptive`, { method: 'PATCH', body: { enable } }),
    started: (enable) => `${enable ? 'Turning on' : 'Turning off'} adaptive protection`,
  });
  const attach = useOperationMutation({
    mutationFn: (b: { target: string; slot: 'backend' | 'edge'; attach: boolean }) =>
      api<OperationAccepted>(`${policyApi(projectId, scope, name)}/attach`, { body: b }),
    started: (b) => `${b.attach ? 'Attaching to' : 'Detaching from'} ${b.target.split('/').pop()}`,
  });
  const removeRule = useOperationMutation({
    mutationFn: (v: { priority: number; confirm: string }) =>
      api<OperationAccepted>(`${policyApi(projectId, scope, name)}/rules/${v.priority}`, {
        method: 'DELETE',
        body: { confirm: v.confirm },
      }),
    started: (v) => `Deleting rule ${v.priority}`,
  });
  const p = q.data;
  const movable = useMemo(() => (p?.rules ?? []).filter((r) => r.priority !== ARMOR_DEFAULT_PRIORITY), [p]);
  useEffect(() => setOrder(movable.map((r) => r.priority)), [movable]);
  if (q.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (q.error instanceof ApiError || !p)
    return q.error instanceof ApiError ? <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} /> : null;
  const byPriority = new Map(p.rules.map((r) => [r.priority, r]));
  const defaultRule = byPriority.get(ARMOR_DEFAULT_PRIORITY);
  // The order is synced from the rules by an effect; until then it is empty, which is not a change.
  const changed = order.length === movable.length && order.join(',') !== movable.map((r) => r.priority).join(',');
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setOrder((o) => arrayMove(o, o.indexOf(Number(e.active.id)), o.indexOf(Number(e.over?.id))));
  };
  const slot = p.type === 'CLOUD_ARMOR_EDGE' ? 'edge' : 'backend';
  const compatible = (targets.data ?? []).filter((t) => t.scope === p.scope && (slot === 'edge' || t.kind === 'backendService'));
  const logFilter = `resource.type="http_load_balancer" jsonPayload.${logView === 'enforced' ? 'enforcedSecurityPolicy' : 'previewSecurityPolicy'}.name="${p.name}"`;
  return (
    <>
      <DetailLayout<'rules' | 'attachments' | 'adaptive' | 'logs' | 'json'>
        crumbs={[{ label: 'Cloud Armor', to: `/p/${projectId}/armor` }, { label: p.name }]}
        title={p.name}
        subtitle={p.description ?? undefined}
        actions={
          // While a new order waits for review, that review is the one commit of the page (SPEC-0002 D-18).
          <Button
            variant={changed ? 'secondary' : 'commit'}
            icon={PlusIcon}
            disabled={!!readOnly}
            disabledReason={readOnly}
            onClick={() => setEditing('new')}
          >
            Add rule
          </Button>
        }
        menu={
          <MenuItem onClick={() => setDeleting(true)} disabled={!!readOnly} className="text-redline-ink">
            Delete policy
          </MenuItem>
        }
        cells={[
          { label: 'Type', value: p.type },
          { label: 'Scope', value: p.scope, mono: true },
          { label: 'Rules', value: String(p.ruleCount) },
          { label: 'Attached to', value: p.targets.length ? p.targets.map((t) => t.split('/').pop()).join(', ') : 'Nothing' },
        ]}
        tabs={[
          { key: 'rules', label: 'Rules' },
          { key: 'attachments', label: 'Attachments' },
          { key: 'adaptive', label: 'Adaptive protection' },
          { key: 'logs', label: 'Logs' },
          { key: 'json', label: 'JSON' },
        ]}
        defaultTab="rules"
      >
        {(tab) => {
          if (tab === 'json') return <RawView value={p.raw} fileName={p.name} />;
          if (tab === 'logs') {
            return (
              <>
                <div className="flex px-6 pt-3">
                  <Field label="Requests" className="w-56">
                    <Select<'enforced' | 'preview'>
                      value={logView}
                      onValueChange={setLogView}
                      options={[
                        { value: 'enforced', label: 'Enforced by this policy' },
                        { value: 'preview', label: 'Matched preview rules' },
                      ]}
                    />
                  </Field>
                </div>
                <LogsPanel projectId={projectId} filter={logFilter} />
              </>
            );
          }
          if (tab === 'adaptive') {
            return (
              <Section
                title="Adaptive protection"
                description="Layer 7 DDoS defense: Cloud Armor learns normal traffic and proposes rules against attacks."
              >
                <div className="max-w-xl px-6">
                  <Switch
                    checked={p.adaptiveProtection}
                    onCheckedChange={(v) => adaptive.mutate(v)}
                    disabled={!!readOnly || adaptive.isPending}
                    label="Layer 7 DDoS defense"
                    description="Automatic deployment settings are shown in the JSON."
                  />
                </div>
              </Section>
            );
          }
          if (tab === 'attachments') {
            return (
              <Section
                title={slot === 'edge' ? 'Edge security policy of' : 'Backend security policy of'}
                description="Backends in the same scope as the policy."
              >
                {targets.isPending ? (
                  <DelayedSkeleton />
                ) : (
                  <ul className="m-0 flex list-none flex-col p-0">
                    {compatible.map((t) => {
                      const current = slot === 'edge' ? t.edgeSecurityPolicy : t.securityPolicy;
                      const here = current === p.path;
                      return (
                        <li
                          key={t.path}
                          className="grid grid-cols-[1fr_12rem_10rem] items-center gap-3 border-b border-rule px-6 py-1 text-dense"
                        >
                          <span className="min-w-0">
                            <span className="font-medium text-ink">{t.name}</span>{' '}
                            <span className="text-meta text-ink-3">
                              {t.kind === 'backendBucket' ? 'backend bucket' : 'backend service'}
                            </span>
                          </span>
                          <span className="text-meta text-ink-2">
                            {current ? (here ? 'Uses this policy' : `Uses ${current.split('/').pop()}`) : 'No policy'}
                          </span>
                          <Button
                            size="sm"
                            disabled={!!readOnly}
                            disabledReason={readOnly}
                            onClick={() => attach.mutate({ target: t.path, slot, attach: !here })}
                          >
                            {here ? 'Detach' : 'Attach'}
                          </Button>
                        </li>
                      );
                    })}
                    {compatible.length === 0 ? <li className="px-6 text-dense text-ink-3">No backend in this scope.</li> : null}
                  </ul>
                )}
              </Section>
            );
          }
          return (
            <div className="pt-3">
              {changed ? (
                <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-panel px-6 py-2">
                  <StatusGlyph kind="warn" label="The rule order changed" />
                  <span className="ml-auto flex gap-2">
                    <Button onClick={() => setOrder(movable.map((r) => r.priority))}>Discard order</Button>
                    <Button variant="commit" disabled={!!readOnly} disabledReason={readOnly} onClick={() => setPlanning(order)}>
                      Review priority plan
                    </Button>
                  </span>
                </div>
              ) : null}
              <p className="m-0 px-6 pb-2 text-meta text-ink-3">
                Drag a rule by its handle, or focus the handle and use Space and the arrow keys.
              </p>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={order} strategy={verticalListSortingStrategy}>
                  <ol aria-label="Rules in evaluation order" className="m-0 list-none border-t border-rule p-0">
                    {order.map((prio) => {
                      const rule = byPriority.get(prio);
                      return rule ? (
                        <SortableRule
                          key={prio}
                          rule={rule}
                          disabled={!!readOnly}
                          onEdit={() => setEditing(rule)}
                          onDelete={() => setDeletingRule(rule)}
                        />
                      ) : null;
                    })}
                  </ol>
                </SortableContext>
              </DndContext>
              {defaultRule ? (
                <div className="grid grid-cols-[2rem_6rem_9rem_1fr_6rem_5rem] items-center gap-3 border-b border-rule bg-well px-6 py-1 text-dense">
                  <span />
                  <span className="font-mono text-[12px] text-ink-2">Default</span>
                  <ActionGlyph action={defaultRule.action} />
                  <span className="text-meta text-ink-2">Every request no rule above matched</span>
                  <span />
                  <IconButton
                    icon={PencilSimpleIcon}
                    label="Edit the default rule"
                    size="sm"
                    disabled={!!readOnly}
                    onClick={() => setEditing(defaultRule)}
                  />
                </div>
              ) : null}
            </div>
          );
        }}
      </DetailLayout>
      <RuleSheet
        projectId={projectId}
        policy={p}
        rule={editing === 'new' ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        waf={waf.data ?? []}
      />
      <PlanDialog projectId={projectId} policy={p} order={planning} onOpenChange={(o) => !o && setPlanning(null)} />
      <ConfirmDestructive
        open={deletingRule !== null}
        onOpenChange={(o) => !o && setDeletingRule(null)}
        title="Delete rule"
        consequence={`Requests that rule ${deletingRule?.priority ?? ''} matched fall through to the next rules.`}
        expected={String(deletingRule?.priority ?? '')}
        confirmLabel="Delete rule"
        onConfirm={async (c) => {
          if (deletingRule) await removeRule.mutateAsync({ priority: deletingRule.priority, confirm: c });
        }}
      />
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete security policy"
        consequence="The policy is deleted. Google refuses while it is attached to a backend."
        expected={p.name}
        confirmLabel="Delete policy"
        command={`gcloud compute security-policies delete ${p.name}${p.scope !== 'global' ? ` --region=${p.scope}` : ''} --project=${projectId}`}
        onConfirm={async (c) => {
          await api<OperationAccepted>(policyApi(projectId, scope, name), { method: 'DELETE', body: { confirm: c } });
          void navigate({ to: `/p/${projectId}/armor` as string });
        }}
      />
    </>
  );
}
