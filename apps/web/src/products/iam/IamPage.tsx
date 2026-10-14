import { useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { TabNav } from '../../design/TabNav';
import { KitTable } from '../../kit/resource/KitTable';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { Access, AuditConfig } from './Access';
import { useProjectPolicy, useSetProjectPolicy } from './api';
import { PolicyEditor } from './PolicyEditor';
import { Roles } from './Roles';
import { ServiceAccounts } from './ServiceAccounts';

const TABS = [
  { key: 'policy', label: 'Allow policy' },
  { key: 'serviceaccounts', label: 'Service accounts' },
  { key: 'roles', label: 'Roles' },
  { key: 'access', label: 'What this key can do' },
  { key: 'audit', label: 'Audit configuration' },
  { key: 'deny', label: 'Deny policies' },
  { key: 'workload', label: 'Workload identity' },
] as const;
type Tab = (typeof TABS)[number]['key'];

function PolicyTab({ projectId, readOnly, audit }: { projectId: string; readOnly: string | null; audit?: boolean }) {
  const q = useProjectPolicy(projectId);
  const save = useSetProjectPolicy(projectId);
  if (q.isPending) return <DelayedSkeleton rows={8} />;
  if (q.error instanceof ApiError) return <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  if (audit) return <AuditConfig projectId={projectId} view={q.data} readOnly={readOnly} onReload={() => void q.refetch()} />;
  return (
    <PolicyEditor
      projectId={projectId}
      policy={q.data.policy}
      inherited={q.data.inherited}
      inheritedError={q.data.inheritedError}
      self={q.data.self}
      readOnly={readOnly}
      save={(body) => save.mutateAsync(body)}
      onReload={() => void q.refetch()}
      gcloudTarget={`projects ${projectId}`}
    />
  );
}

/** IAM (SPEC-0007 M5.1): policy, service accounts, roles, access checks, audit config, deny and workload identity. */
export function IamPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<Tab>(
    'tab',
    'policy',
    TABS.map((t) => t.key),
  );
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  const self = profile?.principal
    ? /\.gserviceaccount\.com$/.test(profile.principal)
      ? `serviceAccount:${profile.principal}`
      : `user:${profile.principal}`
    : null;
  useEffect(() => {
    document.title = 'IAM · Nephoscope';
  }, []);
  return (
    <div className="pb-16">
      <TitleBlock title="IAM" subtitle="Who has access to what in this project, and why." />
      <TabNav label="IAM sections" active={tab} onSelect={(k) => setTab(k as Tab)} items={[...TABS]} />
      {tab === 'policy' ? <PolicyTab projectId={projectId} readOnly={readOnly} /> : null}
      {tab === 'serviceaccounts' ? <ServiceAccounts projectId={projectId} readOnly={readOnly} /> : null}
      {tab === 'roles' ? <Roles projectId={projectId} readOnly={readOnly} /> : null}
      {tab === 'access' ? <Access projectId={projectId} self={self} /> : null}
      {tab === 'audit' ? <PolicyTab projectId={projectId} readOnly={readOnly} audit /> : null}
      {tab === 'deny' ? <KitTable projectId={projectId} collectionKey="iam/denypolicies" readOnly={readOnly} /> : null}
      {tab === 'workload' ? <KitTable projectId={projectId} collectionKey="iam/wipools" readOnly={readOnly} /> : null}
    </div>
  );
}
