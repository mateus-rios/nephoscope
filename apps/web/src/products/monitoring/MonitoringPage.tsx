import { useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { TitleBlock } from '../../design/Drafting';
import { TabNav } from '../../design/TabNav';
import { KitTable } from '../../kit/resource/KitTable';
import { useSearchState } from '../../kit/urlState';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { Alerts } from './Alerts';
import { Dashboards } from './Dashboards';
import { MetricsExplorer } from './MetricsExplorer';
import { Channels, Uptime } from './UptimeChannels';

const TABS = [
  { key: 'explorer', label: 'Metrics Explorer' },
  { key: 'dashboards', label: 'Dashboards' },
  { key: 'alerts', label: 'Alerting' },
  { key: 'uptime', label: 'Uptime checks' },
  { key: 'channels', label: 'Channels' },
  { key: 'services', label: 'Services and SLOs' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** Cloud Monitoring (SPEC-0005 D-08 to D-10, M3). */
export function MonitoringPage() {
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
    document.title = 'Monitoring · Nephoscope';
  }, []);
  return (
    <div className="pb-16">
      <TitleBlock title="Monitoring" subtitle="Chart any metric with PromQL, and manage dashboards, alerts, uptime checks and channels." />
      <TabNav label="Monitoring sections" active={tab} onSelect={(k) => setTab(k as Tab)} items={[...TABS]} />
      {tab === 'explorer' ? <MetricsExplorer projectId={projectId} /> : null}
      {tab === 'dashboards' ? <Dashboards projectId={projectId} /> : null}
      {tab === 'alerts' ? <Alerts projectId={projectId} readOnly={readOnly} /> : null}
      {tab === 'uptime' ? <Uptime projectId={projectId} readOnly={readOnly} /> : null}
      {tab === 'channels' ? <Channels projectId={projectId} readOnly={readOnly} /> : null}
      {tab === 'services' ? <KitTable projectId={projectId} collectionKey="monitoring/services" readOnly={readOnly} /> : null}
    </div>
  );
}
