import {
  type AuditConfigView,
  type AuditLogType,
  auditLogTypes,
  type ProjectIamView,
  products,
  type TroubleshootView,
} from '@nephoscope/contracts';
import { MagnifyingGlassIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton } from '../../design/Button';
import { Legend, Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Textarea } from '../../design/Form';
import { StatusGlyph } from '../../design/Status';
import { Mono } from '../../design/Values';
import { FactList } from '../../kit/FactList';
import { ApiError } from '../../lib/api';
import { useCan, useRefreshCapabilities } from '../../state/queries';
import { testPermissions, troubleshoot, useSetProjectPolicy } from './api';

/** What the active key can do, product by product, from the capability probe (SPEC-0007 D-04). */
function Matrix({ projectId }: { projectId: string }) {
  const can = useCan(projectId);
  const refresh = useRefreshCapabilities(projectId);
  const rows = products.filter((p) => p.permissions.length > 0);
  return (
    <Section
      title="What this key can do"
      description="From the capability probe: testIamPermissions on the project. Resource-level grants, conditions and deny policies can change the answer."
      actions={
        <Button loading={refresh.isPending} onClick={() => refresh.mutate()}>
          Check again
        </Button>
      }
    >
      {!can.loaded ? (
        <DelayedSkeleton rows={6} />
      ) : (
        <div className="flex flex-col">
          {rows.map((p) => {
            const results = p.permissions.map((perm) => can.permission(perm));
            const granted = results.filter((r) => r.allowed === true).length;
            const known = results.filter((r) => r.allowed !== null).length;
            return (
              <details key={p.id} className="border-b border-rule px-6 py-1">
                <summary className="flex min-h-6 cursor-pointer items-center gap-3 text-dense">
                  <span className="w-56 truncate font-medium text-ink">{p.name}</span>
                  {known === 0 ? (
                    <StatusGlyph kind="unknown" label="Not checked" />
                  ) : granted === results.length ? (
                    <StatusGlyph kind="ok" label="Every action" />
                  ) : granted === 0 ? (
                    <StatusGlyph kind="error" label="No action" />
                  ) : (
                    <StatusGlyph kind="warn" label={`${granted} of ${results.length} actions`} />
                  )}
                </summary>
                <ul className="m-0 grid list-none gap-x-6 p-0 pb-2 pl-4 md:grid-cols-2">
                  {results.map((r) => (
                    <li key={r.permission} className="flex items-center gap-2 font-mono text-[12px]">
                      <StatusGlyph
                        kind={r.allowed === null ? 'unknown' : r.allowed ? 'ok' : 'error'}
                        label={r.allowed === null ? 'Unknown' : r.allowed ? 'Granted' : 'Missing'}
                        compact
                      />
                      {r.permission}
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function TestBox({ projectId }: { projectId: string }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ granted: string[]; denied: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = list.every((p) => /^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+){2}$/.test(p));
  return (
    <Section title="Test permissions" description="Asks Google which of these permissions the active key holds on the project.">
      <div className="flex flex-col gap-3 px-6">
        <Field
          label="Permissions"
          help="One per line or separated by commas."
          error={list.length && !valid ? 'Permissions look like run.services.get' : undefined}
        >
          <Textarea mono rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div>
          <Button
            icon={MagnifyingGlassIcon}
            loading={busy}
            disabled={list.length === 0 || !valid}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setResult(await testPermissions(projectId, list));
              } catch (err) {
                setError(err instanceof ApiError ? err.problem.detail : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Test permissions
          </Button>
        </div>
        {error ? <p className="m-0 text-dense text-redline-ink">{error}</p> : null}
        {result ? (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {[...result.granted.map((p) => [p, true] as const), ...result.denied.map((p) => [p, false] as const)].map(([p, ok]) => (
              <li key={p} className="flex items-center gap-2 font-mono text-[12px]">
                <StatusGlyph kind={ok ? 'ok' : 'error'} label={ok ? 'Granted' : 'Missing'} compact />
                {p}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Section>
  );
}

function Troubleshooter({ projectId, self }: { projectId: string; self: string | null }) {
  const [principal, setPrincipal] = useState(self?.replace(/^\w+:/, '') ?? '');
  const [resource, setResource] = useState('');
  const [permission, setPermission] = useState('');
  const [result, setResult] = useState<TroubleshootView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Section
      title="Why can or can't a principal do this?"
      description="The Policy Troubleshooter explains access with the bindings that grant it or would grant it."
    >
      <div className="flex flex-col gap-3 px-6">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Principal email">
            <Input mono value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          </Field>
          <Field label="Permission">
            <Input mono value={permission} onChange={(e) => setPermission(e.target.value)} placeholder="run.services.update" />
          </Field>
          <Field label="Resource" help="Full resource name; empty means the project.">
            <Input
              mono
              value={resource}
              onChange={(e) => setResource(e.target.value)}
              placeholder={`//cloudresourcemanager.googleapis.com/projects/${projectId}`}
            />
          </Field>
        </div>
        <div>
          <Button
            icon={MagnifyingGlassIcon}
            loading={busy}
            disabled={!principal.trim() || !/^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+){2}$/.test(permission.trim())}
            onClick={async () => {
              setBusy(true);
              setError(null);
              setResult(null);
              try {
                setResult(
                  await troubleshoot(projectId, {
                    principal: principal.trim(),
                    permission: permission.trim(),
                    fullResourceName: resource.trim() || undefined,
                  }),
                );
              } catch (err) {
                setError(err instanceof ApiError ? err : null);
              } finally {
                setBusy(false);
              }
            }}
          >
            Explain access
          </Button>
        </div>
        {error ? <ProblemState problem={error.problem} className="px-0 py-2" /> : null}
        {result ? (
          <div className="flex flex-col gap-3">
            <StatusGlyph
              kind={
                /GRANTED/.test(result.access) && !/NOT/.test(result.access) ? 'ok' : /UNKNOWN/.test(result.access) ? 'unknown' : 'error'
              }
              label={result.access.replace(/_/g, ' ').toLowerCase()}
            />
            {result.denyAccess ? (
              <p className="m-0 text-dense text-ink-2">Deny policies: {result.denyAccess.replace(/_/g, ' ').toLowerCase()}</p>
            ) : null}
            {result.explanations.map((e) => (
              <div key={e.resource} className="flex flex-col gap-1">
                <Legend>{e.resource}</Legend>
                {e.bindings
                  .filter((b) => b.relevance !== 'NORMAL' || b.granted === 'ROLE_PERMISSION_INCLUDED')
                  .slice(0, 40)
                  .map((b) => (
                    <div
                      key={`${b.role}-${b.condition ?? ''}`}
                      className="grid grid-cols-[minmax(12rem,1fr)_1fr_1fr] gap-3 border-b border-rule py-0.5 text-meta"
                    >
                      <Mono value={b.role} />
                      <span>{b.granted === 'ROLE_PERMISSION_INCLUDED' ? 'Role includes the permission' : 'Role lacks the permission'}</span>
                      <span>
                        {b.membership === 'MEMBERSHIP_MATCHED_PRINCIPAL' || b.membership === 'MEMBERSHIP_INCLUDED'
                          ? 'Principal is a member'
                          : 'Principal is not a member'}
                      </span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/** "What this key can do", permission tests and the troubleshooter (SPEC-0007 D-04, CA-04). */
export function Access({ projectId, self }: { projectId: string; self: string | null }) {
  return (
    <>
      <Matrix projectId={projectId} />
      <TestBox projectId={projectId} />
      <Troubleshooter projectId={projectId} self={self} />
    </>
  );
}

/** Data Access audit log configuration, saved through the project policy (SPEC-0007 D-05). */
export function AuditConfig({
  projectId,
  view,
  readOnly,
  onReload,
}: {
  projectId: string;
  view: ProjectIamView;
  readOnly: string | null;
  onReload: () => void;
}) {
  const [configs, setConfigs] = useState<AuditConfigView[]>(view.policy.auditConfigs);
  const [service, setService] = useState('');
  const save = useSetProjectPolicy(projectId);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => setConfigs(view.policy.auditConfigs), [view.policy.auditConfigs]);
  const changed = useMemo(() => JSON.stringify(configs) !== JSON.stringify(view.policy.auditConfigs), [configs, view.policy.auditConfigs]);
  const toggle = (svc: string, type: AuditLogType) =>
    setConfigs((list) =>
      list.map((c) =>
        c.service !== svc
          ? c
          : {
              ...c,
              logTypes: c.logTypes.some((t) => t.logType === type)
                ? c.logTypes.filter((t) => t.logType !== type)
                : [...c.logTypes, { logType: type, exemptedMembers: [] }],
            },
      ),
    );
  const LABEL: Record<AuditLogType, string> = { ADMIN_READ: 'Admin read', DATA_READ: 'Data read', DATA_WRITE: 'Data write' };
  return (
    <Section
      title="Data Access audit logs"
      description="Which services write Data Access logs, and who is exempt. Saved into the project policy with its etag."
    >
      <div className="flex flex-col gap-3 px-6">
        {configs.length === 0 ? (
          <p className="m-0 text-dense text-ink-3">No service has Data Access logs turned on beyond the defaults.</p>
        ) : null}
        {configs.map((c) => (
          <div
            key={c.service}
            className="grid grid-cols-[minmax(14rem,1fr)_auto_auto_auto_auto] items-center gap-4 border-b border-rule py-1"
          >
            <Mono value={c.service} />
            {auditLogTypes.map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-dense">
                <input
                  type="checkbox"
                  checked={c.logTypes.some((x) => x.logType === t)}
                  onChange={() => toggle(c.service, t)}
                  disabled={!!readOnly}
                />
                {LABEL[t]}
              </label>
            ))}
            <IconButton
              icon={TrashIcon}
              label={`Remove ${c.service}`}
              size="sm"
              disabled={!!readOnly}
              onClick={() => setConfigs((l) => l.filter((x) => x.service !== c.service))}
            />
          </div>
        ))}
        <div className="flex items-end gap-2">
          <Field label="Add a service" className="w-80" help="allServices applies to every service.">
            <Input mono value={service} onChange={(e) => setService(e.target.value.trim())} placeholder="storage.googleapis.com" />
          </Field>
          <Button
            icon={PlusIcon}
            disabled={!!readOnly || !service || configs.some((c) => c.service === service)}
            onClick={() => {
              setConfigs((l) => [...l, { service, logTypes: [{ logType: 'DATA_READ', exemptedMembers: [] }] }]);
              setService('');
            }}
          >
            Add service
          </Button>
        </div>
        {error ? (
          <div role="alert" className="flex items-center gap-2 text-dense text-redline-ink">
            {error.problem.code === 'CONFLICT' ? 'The policy changed since it was loaded.' : error.problem.detail}
            {error.problem.code === 'CONFLICT' ? (
              <Button size="sm" onClick={onReload}>
                Reload policy
              </Button>
            ) : null}
          </div>
        ) : null}
        <FactList facts={[['Note', 'Data Access logs can be large and are billed when they exceed the free allotment.']]} />
        <div>
          <Button
            variant="commit"
            disabled={!!readOnly || !changed}
            disabledReason={readOnly ?? 'No changes'}
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                {
                  etag: view.policy.etag,
                  bindings: view.policy.bindings,
                  auditConfigs: configs,
                  confirmSelf: false,
                  confirmLastOwner: false,
                },
                { onError: (err) => setError(err instanceof ApiError ? err : null), onSuccess: () => setError(null) },
              )
            }
          >
            Save audit configuration
          </Button>
        </div>
      </div>
    </Section>
  );
}
