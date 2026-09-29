import { useParams } from '@tanstack/react-router';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Stamp } from '../../design/Status';
import { DetailLayout } from '../../kit/DetailLayout';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { type AdminContext, BackupsTab, IndexesTab, SettingsTab, TransferTab, TtlTab, UsageTab } from './Admin';
import { useDatabases } from './api';
import { DataBrowser } from './DataBrowser';
import { DatastoreBrowser } from './DatastoreBrowser';
import { QueryPanel } from './QueryPanel';
import { RulesTab } from './RulesTab';

const NATIVE_TABS = [
  { key: 'data', label: 'Data' },
  { key: 'query', label: 'Query' },
  { key: 'indexes', label: 'Indexes' },
  { key: 'ttl', label: 'TTL' },
  { key: 'rules', label: 'Rules' },
  { key: 'transfer', label: 'Import and export' },
  { key: 'backups', label: 'Backups' },
  { key: 'usage', label: 'Usage' },
  { key: 'settings', label: 'Settings' },
] as const;
type Tab = (typeof NATIVE_TABS)[number]['key'];

const DATASTORE_TABS = NATIVE_TABS.filter((t) => t.key !== 'query' && t.key !== 'rules' && t.key !== 'ttl');

/** One Firestore database (SPEC-0004): data, queries and administration in tabs. */
export function DatabasePage() {
  const { projectId, database } = useParams({ strict: false }) as { projectId: string; database: string };
  const databases = useDatabases(projectId);
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  const [, setPath] = useSearchState<string>('path', '');
  const [, setTab] = useSearchState<Tab>('tab', 'data');

  if (databases.isPending) return <DelayedSkeleton rows={10} className="p-6" />;
  if (databases.error instanceof ApiError)
    return <ProblemState problem={databases.error.problem} onRetry={() => void databases.refetch()} />;
  const db =
    databases.data?.find((d) => d.id === database) ??
    // The emulator accepts any database id, so an unlisted one is still reachable there.
    (databases.data?.[0]?.emulator
      ? { ...databases.data[0], id: database, name: `projects/${projectId}/databases/${database}` }
      : undefined);
  if (!db)
    return (
      <EmptyState title="Database not found">
        No database named {database} exists in {projectId}.
      </EmptyState>
    );

  const ctx: AdminContext = { projectId, databaseId: db.id, readOnly, database: db };
  const openPath = (path: string) => {
    setTab('data');
    setPath(path);
  };
  const tabs = db.type === 'datastore' ? DATASTORE_TABS : NATIVE_TABS;
  return (
    <DetailLayout<Tab>
      crumbs={[{ label: 'Firestore', to: `/p/${projectId}/firestore` }, { label: db.id }]}
      title={db.id}
      status={db.emulator ? <Stamp tone="construct">Emulator</Stamp> : db.type === 'datastore' ? <Stamp>Datastore mode</Stamp> : undefined}
      cells={[
        { label: 'Mode', value: db.type === 'datastore' ? 'Datastore' : 'Native' },
        { label: 'Edition', value: db.edition === 'enterprise' ? 'Enterprise' : 'Standard' },
        { label: 'Location', value: db.locationId ?? (db.emulator ? 'Local emulator' : ''), mono: true },
        { label: 'Recovery', value: db.emulator ? '' : db.pointInTimeRecovery ? '7 days' : 'Off' },
      ]}
      tabs={tabs}
      defaultTab="data"
    >
      {(tab) => {
        switch (tab) {
          case 'data':
            return db.type === 'datastore' ? <DatastoreBrowser ctx={ctx} /> : <DataBrowser ctx={ctx} />;
          case 'query':
            return <QueryPanel ctx={ctx} openPath={openPath} />;
          case 'indexes':
            return <IndexesTab ctx={ctx} />;
          case 'ttl':
            return <TtlTab ctx={ctx} />;
          case 'rules':
            return <RulesTab ctx={ctx} />;
          case 'transfer':
            return <TransferTab ctx={ctx} />;
          case 'backups':
            return <BackupsTab ctx={ctx} />;
          case 'usage':
            return <UsageTab ctx={ctx} />;
          case 'settings':
            return <SettingsTab ctx={ctx} />;
        }
      }}
    </DetailLayout>
  );
}
