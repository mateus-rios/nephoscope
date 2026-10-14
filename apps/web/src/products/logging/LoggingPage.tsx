import { useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { TitleBlock } from '../../design/Drafting';
import { TabNav } from '../../design/TabNav';
import { useSearchState } from '../../kit/urlState';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { AuditLogs } from './AuditLogs';
import { Explorer } from './Explorer';
import { LogMetrics } from './LogMetrics';
import { LogsSql } from './LogsSql';
import { Router } from './Router';
import { Storage } from './Storage';

const TABS = [
  { key: 'explorer', label: 'Logs Explorer' },
  { key: 'sql', label: 'SQL' },
  { key: 'audit', label: 'Audit logs' },
  { key: 'router', label: 'Log Router' },
  { key: 'storage', label: 'Log storage' },
  { key: 'metrics', label: 'Log-based metrics' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** Logging: Logs Explorer, audit logs, Log Router, buckets and log-based metrics (SPEC-0005 M3). */
export function LoggingPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<Tab>(
    'tab',
    'explorer',
    TABS.map((t) => t.key),
  );
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  useEffect(() => {
    document.title = 'Logging · Nephoscope';
  }, []);
  return (
    <div className="pb-16">
      <TitleBlock title="Logging" subtitle="Query log entries, follow them live, and decide where they are stored." />
      <TabNav label="Logging sections" active={tab} onSelect={(k) => setTab(k as Tab)} items={[...TABS]} />
      {tab === 'explorer' ? <Explorer projectId={projectId} /> : null}
      {tab === 'sql' ? <LogsSql projectId={projectId} /> : null}
      {tab === 'audit' ? <AuditLogs projectId={projectId} /> : null}
      {tab === 'router' ? <Router projectId={projectId} readOnly={readOnly} /> : null}
      {tab === 'storage' ? <Storage projectId={projectId} readOnly={readOnly} /> : null}
      {tab === 'metrics' ? <LogMetrics projectId={projectId} readOnly={readOnly} /> : null}
    </div>
  );
}
