import { useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { TabNav } from '../../design/TabNav';
import { Mono } from '../../design/Values';
import { FactList } from '../../kit/FactList';
import { KitTable } from '../../kit/resource/KitTable';
import { useKitItem } from '../../kit/resource/kitApi';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';

interface DispatchRule {
  domain?: string;
  path?: string;
  service?: string;
}

const TABS = [
  { key: 'services', label: 'Services' },
  { key: 'firewall', label: 'Firewall rules' },
  { key: 'dispatch', label: 'Dispatch rules' },
  { key: 'cron', label: 'Cron jobs' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** App Engine (SPEC-0003 D-15): the application, services and versions, and the L1 lists. */
export function AppEnginePage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [tab, setTab] = useSearchState<Tab>(
    'tab',
    'services',
    TABS.map((t) => t.key),
  );
  const app = useKitItem(projectId, 'appengine/application', 'app');
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  useEffect(() => {
    document.title = 'App Engine · Nephoscope';
  }, []);
  const title = <TitleBlock title="App Engine" subtitle="The project's App Engine application: services, versions and traffic." />;
  if (app.isPending)
    return (
      <div className="pb-16">
        {title}
        <DelayedSkeleton rows={6} className="p-6" />
      </div>
    );
  if (app.error instanceof ApiError) {
    return (
      <div className="pb-16">
        {title}
        {app.error.problem.code === 'NOT_FOUND' ? (
          <EmptyState title="No App Engine application">
            This project has no App Engine application. One is created once per project, in a region that cannot change, with gcloud app
            create.
          </EmptyState>
        ) : (
          <ProblemState problem={app.error.problem} onRetry={() => void app.refetch()} />
        )}
      </div>
    );
  }
  const a: Record<string, unknown> = app.data ?? {};
  const rules = ((a as { dispatchRules?: DispatchRule[] }).dispatchRules ?? []).map((r, i) => ({ ...r, order: i + 1 }));
  const dispatchColumns: ResourceColumn<DispatchRule & { order: number }>[] = [
    { id: 'order', header: 'Order', width: '5rem', sortValue: (r) => r.order, cell: (r) => r.order },
    { id: 'domain', header: 'Domain', cell: (r) => <Mono value={r.domain ?? '*'} /> },
    { id: 'path', header: 'Path', cell: (r) => <Mono value={r.path ?? '/*'} /> },
    { id: 'service', header: 'Service', width: '12rem', cell: (r) => <Mono value={r.service ?? ''} /> },
  ];
  const serving = String(a.servingStatus ?? '');
  return (
    <div className="pb-16">
      {title}
      <div className="px-6 pb-4">
        <FactList
          facts={[
            [
              'Serving',
              <StatusGlyph
                key="s"
                kind={serving === 'SERVING' ? 'ok' : 'paused'}
                label={serving.toLowerCase().replace(/_/g, ' ') || 'unknown'}
              />,
            ],
            ['Location', <Mono key="l" value={String(a.locationId ?? '')} />],
            ['Default hostname', <Mono key="h" value={String(a.defaultHostname ?? '')} copy />],
            [
              'Database',
              String(a.databaseType ?? '')
                .replace(/_/g, ' ')
                .toLowerCase() || 'None',
            ],
            ['Service account', <Mono key="sa" value={String(a.serviceAccount ?? '')} />],
            ['Default bucket', <Mono key="b" value={String(a.defaultBucket ?? '')} />],
          ]}
        />
      </div>
      <TabNav label="App Engine sections" active={tab} onSelect={(k) => setTab(k as Tab)} items={[...TABS]} />
      {tab === 'services' ? <KitTable projectId={projectId} collectionKey="appengine/services" readOnly={readOnly} /> : null}
      {tab === 'firewall' ? <KitTable projectId={projectId} collectionKey="appengine/firewall" readOnly={readOnly} /> : null}
      {tab === 'cron' ? <KitTable projectId={projectId} collectionKey="appengine/cron" readOnly={readOnly} /> : null}
      {tab === 'dispatch' ? (
        <div className="pt-3">
          <ResourceTable
            tableId="appengine-dispatch"
            label="Dispatch rules"
            rows={rules}
            columns={dispatchColumns}
            getRowId={(r) => String(r.order)}
            emptyTitle="No dispatch rules"
            emptyText="Requests go to the service their hostname names, or to default. Rules are deployed from dispatch.yaml."
          />
        </div>
      ) : null}
    </div>
  );
}
