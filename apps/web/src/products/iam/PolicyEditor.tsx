import {
  type BindingChange,
  type IamPolicyView,
  type InheritedPolicy,
  owners,
  type PolicyBinding,
  type PolicyCondition,
  policyDiff,
  type SetIamPolicy,
} from '@nephoscope/contracts';
import { PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton } from '../../design/Button';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Notes, Section } from '../../design/Drafting';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Dialog, Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Chip, Mono } from '../../design/Values';
import { EquivalentCommand, sh } from '../../kit/EquivalentCommand';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { type Assignment, conditionTemplates, memberName, membersOf, memberType, withMember } from './policy';
import { RolePicker } from './RolePicker';

const shortRole = (role: string) => role.replace(/^roles\//, '').replace(/^projects\/[^/]+\/roles\//, 'custom: ');

function AssignmentChip({ a, onRemove }: { a: Assignment; onRemove?: () => void }) {
  return (
    <Chip mono onRemove={onRemove}>
      {shortRole(a.role)}
      {a.condition ? <span className="text-ink-3"> if {a.condition.title}</span> : null}
    </Chip>
  );
}

function MemberSheet({
  projectId,
  open,
  onOpenChange,
  member: initialMember,
  assignments: initial,
  onApply,
  suggested,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  member: string | null;
  assignments: Assignment[];
  onApply: (member: string, assignments: Assignment[]) => void;
  suggested?: string[];
}) {
  const [member, setMember] = useState('');
  const [list, setList] = useState<Assignment[]>([]);
  const [useCondition, setUseCondition] = useState(false);
  const [condition, setCondition] = useState<PolicyCondition>({ title: '', description: null, expression: '' });
  useEffect(() => {
    if (!open) return;
    setMember(initialMember ?? '');
    setList(initial);
    setUseCondition(false);
    setCondition({ title: '', description: null, expression: '' });
  }, [open, initialMember, initial]);
  const memberOk = /^(user|serviceAccount|group|domain|principal|principalSet):\S+$|^allUsers$|^allAuthenticatedUsers$/.test(member.trim());
  const add = (role: string) => {
    const c = useCondition && condition.title.trim() && condition.expression.trim() ? { ...condition } : null;
    setList((p) =>
      p.some((x) => x.role === role && JSON.stringify(x.condition) === JSON.stringify(c)) ? p : [...p, { role, condition: c }],
    );
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={initialMember ? `Edit ${memberName(initialMember)}` : 'Grant access'}
      description="Changes stay in this page until you review and save the policy."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            disabled={!memberOk}
            disabledReason="A member such as user:ana@example.com or serviceAccount:x@p.iam.gserviceaccount.com"
            onClick={() => {
              onApply(member.trim(), list);
              onOpenChange(false);
            }}
          >
            Apply to the policy
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Member"
          required
          help="user:, serviceAccount:, group:, domain:, or allUsers and allAuthenticatedUsers."
          error={member && !memberOk ? 'Prefix the member with its type, such as user:' : undefined}
        >
          <Input mono value={member} onChange={(e) => setMember(e.target.value)} disabled={!!initialMember} />
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-dense font-medium text-ink">Roles</span>
          {list.length === 0 ? <p className="m-0 text-meta text-ink-3">No roles. A member with no roles leaves the policy.</p> : null}
          <div className="flex flex-wrap gap-1">
            {list.map((a, i) => (
              <AssignmentChip
                key={`${a.role}-${a.condition?.title ?? ''}`}
                a={a}
                onRemove={() => setList((p) => p.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </div>
        {suggested?.length ? (
          <div className="flex flex-wrap gap-1">
            {suggested.map((r) => (
              <Button key={r} size="sm" icon={PlusIcon} onClick={() => add(r)}>
                {shortRole(r)}
              </Button>
            ))}
          </div>
        ) : null}
        <Switch
          checked={useCondition}
          onCheckedChange={setUseCondition}
          label="Add the next roles with a condition"
          description="Conditions use CEL and need policy version 3."
        />
        {useCondition ? (
          <div className="flex flex-col gap-3 rounded-control border border-rule p-3">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  setCondition(conditionTemplates.expiry(new Date(Date.now() + 30 * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z')))
                }
              >
                Expires in 30 days
              </Button>
              <Button size="sm" onClick={() => setCondition(conditionTemplates.prefix(`projects/_/buckets/`))}>
                Resource name prefix
              </Button>
            </div>
            <Field label="Title" required>
              <Input value={condition.title} onChange={(e) => setCondition((c) => ({ ...c, title: e.target.value }))} />
            </Field>
            <Field label="Expression (CEL)" required>
              <CodeEditor
                value={condition.expression}
                onChange={(v) => setCondition((c) => ({ ...c, expression: v }))}
                language="plaintext"
                height={80}
                label="Condition expression"
              />
            </Field>
          </div>
        ) : null}
        <RolePicker projectId={projectId} onPick={(r) => add(r.name)} label="Add a role" />
      </div>
    </Sheet>
  );
}

function DiffDialog({
  open,
  onOpenChange,
  changes,
  removesSelf,
  removesLastOwner,
  saving,
  error,
  onSave,
  onReload,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  changes: BindingChange[];
  removesSelf: boolean;
  removesLastOwner: boolean;
  saving: boolean;
  error: ApiError | null;
  onSave: (confirm: { self: boolean; owner: boolean }) => void;
  onReload: () => void;
}) {
  const [self, setSelf] = useState(false);
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    if (open) {
      setSelf(false);
      setOwner(false);
    }
  }, [open]);
  const blocked = (removesSelf && !self) || (removesLastOwner && !owner);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Review policy changes"
      width="lg"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Keep editing</Button>
          <Button
            variant={removesSelf || removesLastOwner ? 'danger' : 'commit'}
            loading={saving}
            disabled={blocked || changes.length === 0}
            disabledReason={blocked ? 'Confirm the risks above' : 'No changes'}
            onClick={() => onSave({ self, owner })}
          >
            Save policy
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ul className="m-0 flex max-h-80 list-none flex-col gap-1 overflow-y-auto p-0">
          {changes.map((c) => (
            <li
              key={`${c.kind}-${c.role}-${c.member}-${c.condition ?? ''}`}
              className="grid grid-cols-[5rem_1fr] items-baseline gap-2 font-mono text-[12px]"
            >
              <span className={c.kind === 'add' ? 'text-ok-ink' : 'text-redline-ink'}>{c.kind === 'add' ? '+ grant' : '- revoke'}</span>
              <span className="min-w-0 break-all text-ink">
                {shortRole(c.role)} to {c.member}
                {c.condition ? ` (if ${c.condition})` : ''}
              </span>
            </li>
          ))}
        </ul>
        {removesSelf ? (
          <label className="flex items-start gap-2 text-dense text-redline-ink">
            <input type="checkbox" checked={self} onChange={(e) => setSelf(e.target.checked)} />
            You are removing your own access to this project. Nephoscope may lose access in the middle of the session.
          </label>
        ) : null}
        {removesLastOwner ? (
          <label className="flex items-start gap-2 text-dense text-redline-ink">
            <input type="checkbox" checked={owner} onChange={(e) => setOwner(e.target.checked)} />
            This removes the last owner of the project. Only an organization admin could restore ownership.
          </label>
        ) : null}
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-dense text-redline-ink">
            {error.problem.code === 'CONFLICT'
              ? 'The policy changed since it was loaded. Reload it, then edit again.'
              : error.problem.detail}
            {error.problem.code === 'CONFLICT' ? (
              <Button size="sm" onClick={onReload}>
                Reload policy
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

interface PolicyEditorProps {
  projectId: string;
  policy: IamPolicyView;
  inherited?: InheritedPolicy[];
  inheritedError?: string | null;
  self: string | null;
  readOnly: string | null;
  save: (body: SetIamPolicy) => Promise<unknown>;
  onReload: () => void;
  /** Roles offered as one-click choices, such as for a service account. */
  suggested?: string[];
  /** The gcloud resource for the equivalent command. */
  gcloudTarget: string;
}

/**
 * The allow policy by principal or by role, edited locally and saved with a diff, the etag and the
 * self and last-owner checks (SPEC-0007 D-01, CA-01).
 */
export function PolicyEditor({
  projectId,
  policy,
  inherited,
  inheritedError,
  self,
  readOnly,
  save,
  onReload,
  suggested,
  gcloudTarget,
}: PolicyEditorProps) {
  const [view, setView] = useSearchState<'principal' | 'role'>('view', 'principal', ['principal', 'role']);
  const [bindings, setBindings] = useState<PolicyBinding[]>(policy.bindings);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{ member: string | null; assignments: Assignment[] } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => setBindings(policy.bindings), [policy]);
  const changes = useMemo(() => policyDiff(policy.bindings, bindings), [policy.bindings, bindings]);
  const members = useMemo(() => membersOf(bindings), [bindings]);
  const q = filter.trim().toLowerCase();
  const memberRows = members.filter(
    (m) => !q || m.member.toLowerCase().includes(q) || m.assignments.some((a) => a.role.toLowerCase().includes(q)),
  );
  const roleRows = bindings
    .map((b, i) => ({ ...b, id: `${b.role}-${b.condition?.title ?? ''}-${i}` }))
    .filter((b) => !q || b.role.toLowerCase().includes(q) || b.members.some((m) => m.toLowerCase().includes(q)));
  const removesSelf = !!self && policy.bindings.some((b) => b.members.includes(self)) && !bindings.some((b) => b.members.includes(self));
  const removesLastOwner = owners(policy.bindings).length > 0 && owners(bindings).length === 0;

  const memberColumns: ResourceColumn<(typeof members)[number]>[] = [
    {
      id: 'member',
      header: 'Principal',
      hideable: false,
      sortValue: (m) => m.member,
      cell: (m) => (
        <span className="flex min-w-0 items-center gap-2">
          <Mono value={memberName(m.member)} />
          {m.member === self ? <span className="shrink-0 text-meta text-ink-3">This profile</span> : null}
        </span>
      ),
    },
    { id: 'type', header: 'Type', width: '9rem', sortValue: (m) => memberType(m.member), cell: (m) => memberType(m.member) },
    {
      id: 'roles',
      header: 'Roles',
      cell: (m) => (
        <span className="flex flex-wrap gap-1 py-0.5">
          {m.assignments.map((a) => (
            <AssignmentChip key={`${a.role}-${a.condition?.title ?? ''}`} a={a} />
          ))}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      width: '6rem',
      hideable: false,
      cell: (m) => (
        <span className="flex gap-1">
          <IconButton
            icon={PencilSimpleIcon}
            label={`Edit ${memberName(m.member)}`}
            size="sm"
            disabled={!!readOnly}
            onClick={() => setEditing({ member: m.member, assignments: m.assignments })}
          />
          <IconButton
            icon={TrashIcon}
            label={`Remove ${memberName(m.member)}`}
            size="sm"
            disabled={!!readOnly}
            onClick={() => setBindings((b) => withMember(b, m.member, []))}
          />
        </span>
      ),
    },
  ];
  const roleColumns: ResourceColumn<(typeof roleRows)[number]>[] = [
    { id: 'role', header: 'Role', hideable: false, sortValue: (b) => b.role, cell: (b) => <Mono value={b.role} /> },
    {
      id: 'condition',
      header: 'Condition',
      width: '12rem',
      cell: (b) =>
        b.condition ? <span title={b.condition.expression}>{b.condition.title}</span> : <span className="text-ink-3">None</span>,
    },
    {
      id: 'count',
      header: 'Members',
      width: '6rem',
      align: 'right',
      sortValue: (b) => b.members.length,
      cell: (b) => <span className="tnum">{b.members.length}</span>,
    },
    { id: 'members', header: 'Who', cell: (b) => <Mono value={b.members.map(memberName).join(', ')} /> },
  ];

  const toolbar = (
    <div className="flex flex-wrap items-end gap-3">
      <Input
        data-filter-input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by principal or role"
        aria-label="Filter the policy"
        className="w-72"
      />
      <Field label="View" className="w-44">
        <Select<'principal' | 'role'>
          value={view}
          onValueChange={setView}
          options={[
            { value: 'principal', label: 'By principal' },
            { value: 'role', label: 'By role' },
          ]}
        />
      </Field>
      <span className="ml-auto">
        <Button
          variant={changes.length > 0 ? 'secondary' : 'commit'}
          icon={PlusIcon}
          disabled={!!readOnly}
          disabledReason={readOnly}
          onClick={() => setEditing({ member: null, assignments: [] })}
        >
          Grant access
        </Button>
      </span>
    </div>
  );
  const notes = inheritedError ? [{ id: 'inherited', tone: 'unknown' as const, text: inheritedError }] : [];
  return (
    <>
      {changes.length > 0 ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-rule bg-panel px-6 py-2">
          <StatusGlyph kind="warn" label={`${changes.length} unsaved ${changes.length === 1 ? 'change' : 'changes'}`} />
          <span className="ml-auto flex gap-2">
            <Button onClick={() => setBindings(policy.bindings)}>Discard changes</Button>
            <Button variant="commit" disabled={!!readOnly} disabledReason={readOnly} onClick={() => setReviewing(true)}>
              Review and save
            </Button>
          </span>
        </div>
      ) : null}
      <div className="pt-3">
        {view === 'principal' ? (
          <ResourceTable
            tableId="iam-by-principal"
            label="Principals"
            rows={memberRows}
            columns={memberColumns}
            getRowId={(r) => r.member}
            onOpen={(r) => {
              if (!readOnly) setEditing({ member: r.member, assignments: r.assignments });
            }}
            filtered={q.length > 0}
            emptyTitle="No bindings"
            emptyText="Grant a role to a principal to give it access."
            toolbar={toolbar}
          />
        ) : (
          <ResourceTable
            tableId="iam-by-role"
            label="Roles"
            rows={roleRows}
            columns={roleColumns}
            getRowId={(r) => r.id}
            filtered={q.length > 0}
            emptyTitle="No bindings"
            emptyText="Grant a role to a principal to give it access."
            toolbar={toolbar}
          />
        )}
      </div>
      {inherited ? (
        <Section
          title="Inherited"
          description="Bindings on folders and the organization above the project also apply here. They are changed where they are set."
        >
          <Notes notes={notes} />
          {inherited.length === 0 && !inheritedError ? (
            <p className="m-0 px-6 text-dense text-ink-3">No folder or organization policy grants access here.</p>
          ) : null}
          {inherited.map((p) => (
            <div key={p.resource} className="px-6 pb-3">
              <h3 className="m-0 mb-1 text-dense font-semibold text-ink">
                {p.displayName ?? p.resource} <span className="font-mono text-[11px] text-ink-3">{p.resource}</span>
              </h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {membersOf(p.bindings).map((m) => (
                  <li key={m.member} className="grid grid-cols-[minmax(14rem,1fr)_2fr] gap-3 border-b border-rule py-1 text-dense">
                    <Mono value={memberName(m.member)} />
                    <span className="flex flex-wrap gap-1">
                      {m.assignments.map((a) => (
                        <AssignmentChip key={`${a.role}-${a.condition?.title ?? ''}`} a={a} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Section>
      ) : null}
      <MemberSheet
        projectId={projectId}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        member={editing?.member ?? null}
        assignments={editing?.assignments ?? []}
        suggested={suggested}
        onApply={(member, assignments) => setBindings((b) => withMember(b, member, assignments))}
      />
      <DiffDialog
        open={reviewing}
        onOpenChange={setReviewing}
        changes={changes}
        removesSelf={removesSelf}
        removesLastOwner={removesLastOwner}
        saving={saving}
        error={error}
        onReload={() => {
          setReviewing(false);
          setError(null);
          onReload();
        }}
        onSave={async (confirm) => {
          setSaving(true);
          setError(null);
          try {
            await save({ etag: policy.etag, bindings, confirmSelf: confirm.self, confirmLastOwner: confirm.owner });
            setReviewing(false);
          } catch (err) {
            setError(err instanceof ApiError ? err : null);
          } finally {
            setSaving(false);
          }
        }}
      />
      {changes.length > 0 ? (
        <div className="px-6 pt-4">
          <EquivalentCommand
            gcloud={changes
              .slice(0, 20)
              .map(
                (c) =>
                  `gcloud ${gcloudTarget} ${c.kind === 'add' ? 'add' : 'remove'}-iam-policy-binding --member=${sh(c.member)} --role=${c.role}${c.condition ? ' --condition=...' : ''}`,
              )
              .join('\n')}
          />
        </div>
      ) : null}
    </>
  );
}
