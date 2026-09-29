import { ArrowsSplitIcon, RocketIcon } from '@phosphor-icons/react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { MenuItem } from '../../design/Overlays';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { InvokePanel } from '../../kit/InvokePanel';
import { LogsPanel } from '../../kit/LogsPanel';
import { MetricsPanel } from '../../kit/MetricsPanel';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { useOperations } from '../../state/operations';
import { useActiveProfile, useInstance } from '../../state/queries';
import { TriggersTab } from '../shared/TriggersTab';
import { deleteService, invokeService, useRevisions, useRunService, useRunServiceYaml } from './api';
import { RunStatusGlyph, readOnlyReason, runLogFilter, runRoutes } from './common';
import { DeploySheet } from './DeploySheet';
import { NetworkingTab, RevisionsTab, SecurityTab, ServiceOverview } from './ServiceTabs';
import { TrafficDialog } from './TrafficDialog';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'revisions', label: 'Revisions' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'logs', label: 'Logs' },
  { key: 'testing', label: 'Testing' },
  { key: 'triggers', label: 'Triggers' },
  { key: 'security', label: 'Security' },
  { key: 'networking', label: 'Networking' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** A Cloud Run service (SPEC-0003 CA-02 to CA-08). */
export function ServicePage() {
  const { projectId, location, service: id } = useParams({ strict: false }) as { projectId: string; location: string; service: string };
  const query = useRunService(projectId, location, id);
  const revisions = useRevisions(projectId, location, id);
  const [tab] = useSearchState<Tab>(
    'tab',
    'overview',
    TABS.map((t) => t.key),
  );
  const yaml = useRunServiceYaml(projectId, location, id, tab === 'yaml');
  const [deploying, setDeploying] = useState(false);
  const [trafficOpen, setTrafficOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  const routes = runRoutes(projectId);
  const revisionList = useMemo(() => revisions.data?.pages.flatMap((p) => p.items) ?? [], [revisions.data]);

  const s = query.data;
  if (query.isPending) return <DelayedSkeleton rows={8} className="p-6" />;
  if (query.error instanceof ApiError || !s) {
    return (
      <ProblemState
        problem={
          query.error instanceof ApiError
            ? query.error.problem
            : { type: '', title: 'Not found', status: 404, detail: 'The service was not found.', code: 'NOT_FOUND', retryable: false }
        }
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Cloud Run', to: routes.list }, { label: 'Services', to: routes.list }, { label: s.id }]}
        title={s.id}
        status={<RunStatusGlyph status={s.status} message={s.statusMessage} />}
        subtitle={s.functionTarget ? `Deployed from function source, entry point ${s.functionTarget}.` : s.description}
        actions={
          <>
            <Button icon={ArrowsSplitIcon} onClick={() => setTrafficOpen(true)} disabled={!!readOnly} disabledReason={readOnly}>
              Edit traffic
            </Button>
            <Button variant="commit" icon={RocketIcon} onClick={() => setDeploying(true)} disabled={!!readOnly} disabledReason={readOnly}>
              Deploy revision
            </Button>
          </>
        }
        menu={
          <MenuItem onClick={() => setDeleting(true)} className="text-redline-ink" disabled={!!readOnly}>
            Delete service
          </MenuItem>
        }
        cells={[
          { label: 'Region', value: <Mono value={s.location} />, mono: true },
          { label: 'URL', value: s.uri ? <Mono value={s.uri} copy /> : 'None', wide: true },
          { label: 'Latest ready', value: s.latestReadyRevision ?? 'None', mono: true },
          { label: 'Last deployed', value: <Timestamp iso={s.updateTime} /> },
          { label: 'Deployed by', value: s.lastModifier ?? '' },
        ]}
        tabs={TABS.map((t) => (t.key === 'revisions' ? { ...t, count: revisionList.length || null } : t))}
        defaultTab="overview"
      >
        {(current) => {
          switch (current) {
            case 'overview':
              return <ServiceOverview service={s} />;
            case 'revisions':
              return (
                <RevisionsTab
                  projectId={projectId}
                  service={s}
                  revisions={revisionList}
                  loading={revisions.isPending}
                  error={revisions.error}
                  onRetry={() => void revisions.refetch()}
                  readOnlyReason={readOnly}
                />
              );
            case 'metrics':
              return <MetricsPanel projectId={projectId} kind="run-service" labels={{ service_name: s.id, location: s.location }} />;
            case 'logs':
              return <LogsPanel projectId={projectId} filter={runLogFilter.service(s.id, s.location)} />;
            case 'testing':
              return (
                <InvokePanel
                  baseUrl={s.uri}
                  tags={s.trafficStatuses.filter((t) => t.tag).map((t) => ({ tag: t.tag as string, url: t.uri }))}
                  send={(req) => invokeService(projectId, s.location, s.id, req)}
                  readOnlyReason={readOnly}
                />
              );
            case 'triggers':
              return (
                <TriggersTab
                  projectId={projectId}
                  match={{ kind: 'runService', id: s.id, location: s.location, urls: [s.uri ?? '', ...s.urls] }}
                />
              );
            case 'security':
              return <SecurityTab projectId={projectId} service={s} readOnlyReason={readOnly} />;
            case 'networking':
              return <NetworkingTab service={s} />;
            case 'yaml':
              return (
                <RawView
                  value={yaml.data}
                  fileName={s.id}
                  loading={yaml.isPending}
                  error={yaml.error}
                  onRetry={() => void yaml.refetch()}
                />
              );
          }
        }}
      </DetailLayout>
      <DeploySheet projectId={projectId} open={deploying} onOpenChange={setDeploying} service={s} readOnlyReason={readOnly} />
      <TrafficDialog
        projectId={projectId}
        service={s}
        revisions={revisionList}
        open={trafficOpen}
        onOpenChange={setTrafficOpen}
        readOnlyReason={readOnly}
      />
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete service"
        consequence={`The service ${s.id}, its revisions and its URL are deleted. Requests to it fail from then on.`}
        expected={s.id}
        confirmLabel="Delete service"
        command={`gcloud run services delete ${s.id} --region=${s.location} --project=${projectId}`}
        onConfirm={async (confirm) => {
          const { operation } = await deleteService(projectId, s.location, s.id, confirm);
          useOperations.getState().upsert(operation);
          void navigate({ to: routes.list });
        }}
      />
    </>
  );
}
