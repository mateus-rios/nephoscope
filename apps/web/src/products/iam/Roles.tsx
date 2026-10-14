import { type RoleDetail, type RoleSummary, roleStages } from '@nephoscope/contracts';
import { ArrowCounterClockwiseIcon, PlusIcon, TrashIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Legend } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Textarea } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono } from '../../design/Values';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { deleteRole, useRole, useRoleSearch, useSaveRole, useTestablePermissions, useUndeleteRole } from './api';
import { RolePicker } from './RolePicker';

/** Permissions only in A, only in B, and in both (SPEC-0007 D-03). */
export function compareRoles(a: readonly string[], b: readonly string[]): { onlyA: string[]; onlyB: string[]; both: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    onlyA: a.filter((p) => !sb.has(p)).sort(),
    onlyB: b.filter((p) => !sa.has(p)).sort(),
    both: a.filter((p) => sb.has(p)).sort(),
  };
}

function PermissionList({ title, permissions }: { title: string; permissions: string[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Legend>
        {title} <span className="tnum">({permissions.length})</span>
      </Legend>
      <ul className="m-0 max-h-72 list-none overflow-y-auto p-0 font-mono text-[12px] text-ink">
        {permissions.map((p) => (
          <li key={p} className="truncate border-b border-rule py-0.5">
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoleSheet({ projectId, name, onClose }: { projectId: string; name: string | null; onClose: () => void }) {
  const role = useRole(projectId, name);
  const [other, setOther] = useState<string | null>(null);
  const otherRole = useRole(projectId, other);
  const [filter, setFilter] = useState('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different role starts a fresh comparison.
  useEffect(() => {
    setOther(null);
    setFilter('');
  }, [name]);
  const r = role.data;
  const diff = r && otherRole.data ? compareRoles(r.includedPermissions, otherRole.data.includedPermissions) : null;
  return (
    <Sheet open={name !== null} onOpenChange={(o) => !o && onClose()} title={r?.title ?? name ?? ''} description={r?.description}>
      {role.isPending ? (
        <DelayedSkeleton rows={6} />
      ) : role.error instanceof ApiError ? (
        <ProblemState problem={role.error.problem} />
      ) : r ? (
        <div className="flex flex-col gap-4">
          <Mono value={r.name} copy />
          {diff ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-dense text-ink">
                  Compared with <span className="font-mono text-[12px]">{other}</span>
                </span>
                <IconButton icon={XIcon} label="Stop comparing" size="sm" onClick={() => setOther(null)} />
              </div>
              <PermissionList title={`Only in ${r.title}`} permissions={diff.onlyA} />
              <PermissionList title={`Only in ${otherRole.data?.title ?? other}`} permissions={diff.onlyB} />
              <PermissionList title="In both" permissions={diff.both} />
            </div>
          ) : (
            <>
              <RolePicker projectId={projectId} onPick={(x) => setOther(x.name)} label="Compare with another role" />
              <Field label="Filter permissions">
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} />
              </Field>
              <PermissionList title="Permissions" permissions={r.includedPermissions.filter((p) => p.includes(filter.trim()))} />
            </>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

function CustomRoleSheet({
  projectId,
  role,
  open,
  onOpenChange,
  readOnly,
}: {
  projectId: string;
  role: RoleDetail | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnly: string | null;
}) {
  const roleId = role?.name.split('/').pop() ?? null;
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stage, setStage] = useState<(typeof roleStages)[number]>('GA');
  const [perms, setPerms] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [base, setBase] = useState<string | null>(null);
  const testable = useTestablePermissions(projectId, open);
  const baseRole = useRole(projectId, base);
  const save = useSaveRole(projectId, roleId);
  useEffect(() => {
    if (!open) return;
    setId(roleId ?? '');
    setTitle(role?.title ?? '');
    setDescription(role?.description ?? '');
    setStage((role?.stage as (typeof roleStages)[number]) ?? 'GA');
    setPerms(role?.includedPermissions ?? []);
    setBase(null);
  }, [open, role, roleId]);
  useEffect(() => {
    if (baseRole.data) {
      const allowed = new Set((testable.data ?? []).map((p) => p.name));
      setPerms((p) =>
        [...new Set([...p, ...baseRole.data.includedPermissions.filter((x) => allowed.size === 0 || allowed.has(x))])].sort(),
      );
    }
  }, [baseRole.data, testable.data]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return (testable.data ?? []).filter((p) => p.name.toLowerCase().includes(q) && !perms.includes(p.name)).slice(0, 50);
  }, [search, testable.data, perms]);
  const ok = /^[a-zA-Z0-9_.]{3,64}$/.test(id) && title.trim() && perms.length > 0;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={role ? `Edit ${role.title}` : 'Create custom role'}
      description="Custom roles at the project level can use only permissions supported there."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={save.isPending}
            disabled={!!readOnly || !ok}
            disabledReason={readOnly ?? 'Id, title and at least one permission are required'}
            onClick={() =>
              save.mutate(
                { roleId: id, title: title.trim(), description, stage, includedPermissions: perms },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {role ? 'Save role' : 'Create role'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role id" required>
            <Input mono value={id} onChange={(e) => setId(e.target.value)} disabled={!!role} />
          </Field>
          <Field label="Launch stage">
            <Select<(typeof roleStages)[number]>
              value={stage}
              onValueChange={setStage}
              options={roleStages.map((s) => ({ value: s, label: s }))}
            />
          </Field>
        </div>
        <Field label="Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <RolePicker projectId={projectId} onPick={(r) => setBase(r.name)} label="Add the permissions of a role" />
        <Field label="Add a permission" help={testable.isPending ? 'Loading the permissions supported in custom roles' : undefined}>
          <Input mono value={search} onChange={(e) => setSearch(e.target.value)} placeholder="run.services" />
        </Field>
        {matches.length > 0 ? (
          <ul className="m-0 max-h-48 list-none overflow-y-auto rounded-control border border-rule p-0">
            {matches.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  className="block min-h-6 w-full px-2 py-0.5 text-left font-mono text-[12px] hover:bg-hover"
                  onClick={() => setPerms((x) => [...x, p.name].sort())}
                >
                  {p.name}
                  {p.supportLevel === 'TESTING' ? <span className="text-ink-2"> (testing)</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-col gap-1">
          <Legend>
            Included permissions <span className="tnum">({perms.length})</span>
          </Legend>
          <ul className="m-0 max-h-64 list-none overflow-y-auto p-0">
            {perms.map((p) => (
              <li key={p} className="flex items-center justify-between gap-2 border-b border-rule font-mono text-[12px]">
                {p}
                <IconButton icon={XIcon} label={`Remove ${p}`} size="sm" onClick={() => setPerms((x) => x.filter((y) => y !== p))} />
              </li>
            ))}
          </ul>
        </div>
        <EquivalentCommand
          gcloud={`gcloud iam roles ${role ? 'update' : 'create'} ${id || 'ROLE_ID'} --project=${projectId} --title="${title}" --stage=${stage} --permissions=${perms.slice(0, 5).join(',')}${perms.length > 5 ? ',...' : ''}`}
        />
      </div>
    </Sheet>
  );
}

/** Predefined and custom roles (SPEC-0007 D-03, CA-03). */
export function Roles({ projectId, readOnly }: { projectId: string; readOnly: string | null }) {
  const [q, setQ] = useSearchState<string>('rq', '');
  const [permission, setPermission] = useSearchState<string>('perm', '');
  const [kind, setKind] = useSearchState<'all' | 'custom' | 'predefined'>('kind', 'all', ['all', 'custom', 'predefined']);
  const [draft, setDraft] = useState({ q, permission });
  const roles = useRoleSearch(
    projectId,
    { q, permission: permission || undefined, custom: kind },
    q.length >= 2 || !!permission || kind === 'custom',
  );
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<RoleDetail | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RoleSummary | null>(null);
  const editRole = useRole(projectId, typeof editing === 'object' && editing ? editing.name : null);
  const undelete = useUndeleteRole(projectId);
  const columns: ResourceColumn<RoleSummary>[] = [
    {
      id: 'title',
      header: 'Role',
      hideable: false,
      sortValue: (r) => r.title,
      cell: (r) => <span className="truncate font-medium text-ink">{r.title}</span>,
    },
    { id: 'name', header: 'Name', cell: (r) => <Mono value={r.name} /> },
    {
      id: 'perms',
      header: 'Permissions',
      width: '8rem',
      align: 'right',
      sortValue: (r) => r.permissionCount,
      cell: (r) => <span className="tnum">{r.permissionCount}</span>,
    },
    {
      id: 'stage',
      header: 'Stage',
      width: '7rem',
      sortValue: (r) => r.stage,
      cell: (r) => (r.deleted ? <StatusGlyph kind="paused" label="Deleted" /> : r.stage),
    },
    {
      id: 'actions',
      header: 'Actions',
      width: '9rem',
      hideable: false,
      cell: (r) =>
        !r.custom ? null : r.deleted ? (
          <IconButton
            icon={ArrowCounterClockwiseIcon}
            label={`Restore ${r.title}`}
            size="sm"
            disabled={!!readOnly}
            onClick={() => undelete.mutate(r.name.split('/').pop() ?? '')}
          />
        ) : (
          <span className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={!!readOnly} disabledReason={readOnly} onClick={() => setEditing(r as RoleDetail)}>
              Edit
            </Button>
            <IconButton icon={TrashIcon} label={`Delete ${r.title}`} size="sm" disabled={!!readOnly} onClick={() => setDeleting(r)} />
          </span>
        ),
    },
  ];
  return (
    <div className="pt-3">
      <form
        className="flex flex-wrap items-end gap-3 px-6 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.q.trim());
          setPermission(draft.permission.trim());
        }}
      >
        <Field label="Name or title" className="w-64">
          <Input
            data-filter-input
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
            placeholder="secret accessor"
          />
        </Field>
        <Field label="Grants the permission" className="w-72" help="Roles that include it.">
          <Input
            mono
            value={draft.permission}
            onChange={(e) => setDraft((d) => ({ ...d, permission: e.target.value }))}
            placeholder="secretmanager.versions.access"
          />
        </Field>
        <Field label="Kind" className="w-40">
          <Select<'all' | 'custom' | 'predefined'>
            value={kind}
            onValueChange={setKind}
            options={[
              { value: 'all', label: 'All roles' },
              { value: 'predefined', label: 'Predefined' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
        </Field>
        <Button type="submit">Search roles</Button>
        <span className="ml-auto">
          <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setEditing('new')}>
            Create custom role
          </Button>
        </span>
      </form>
      {!(q.length >= 2 || permission || kind === 'custom') ? (
        <p className="m-0 px-6 text-dense text-ink-3">
          Search by name, by a permission the role grants, or list the custom roles of the project.
        </p>
      ) : roles.isPending ? (
        <DelayedSkeleton />
      ) : roles.error instanceof ApiError ? (
        <ProblemState problem={roles.error.problem} onRetry={() => void roles.refetch()} />
      ) : (
        <ResourceTable
          tableId="iam-roles"
          label="Roles"
          rows={roles.data ?? []}
          columns={columns}
          getRowId={(r) => r.name}
          onOpen={(r) => setOpen(r.name)}
          emptyTitle="No roles match"
          emptyText="Try another name, or a permission such as run.services.update."
        />
      )}
      <RoleSheet projectId={projectId} name={open} onClose={() => setOpen(null)} />
      <CustomRoleSheet
        projectId={projectId}
        role={editing === 'new' ? null : (editRole.data ?? null)}
        open={editing === 'new' || (editing !== null && !!editRole.data)}
        onOpenChange={(o) => !o && setEditing(null)}
        readOnly={readOnly}
      />
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete custom role"
        consequence="Bindings that use the role stop granting its permissions. It can be restored for 7 days."
        expected={deleting?.name.split('/').pop() ?? ''}
        confirmLabel="Delete role"
        command={deleting ? `gcloud iam roles delete ${deleting.name.split('/').pop()} --project=${projectId}` : undefined}
        onConfirm={async (c) => {
          if (deleting) await deleteRole(projectId, deleting.name.split('/').pop() ?? '', c);
          void roles.refetch();
        }}
      />
    </div>
  );
}
