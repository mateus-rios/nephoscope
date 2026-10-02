import { ArrowCircleUpIcon, PlayIcon, StopIcon } from '@phosphor-icons/react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { type Note, Notes, Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { MenuItem } from '../../design/Overlays';
import { StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { useActiveProfile } from '../../state/queries';
import { colabHref, deleteRuntime, useRaw, useRuntime, useRuntimeAction, useTemplates } from './api';
import { diskSummary, FactList, machineSummary, namesOf, RuntimeStateGlyph, TemplateLink, useColabReadOnly } from './common';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** One runtime (SPEC-0010 D-09, CA-04). */
export function RuntimePage() {
  const { projectId, location, runtime: id } = useParams({ strict: false }) as { projectId: string; location: string; runtime: string };
  const [tab] = useSearchState<Tab>(
    'tab',
    'overview',
    TABS.map((t) => t.key),
  );
  const query = useRuntime(projectId, location, id);
  const raw = useRaw(projectId, 'runtimes', location, id, tab === 'yaml');
  const action = useRuntimeAction(projectId);
  const readOnly = useColabReadOnly();
  const { profile } = useActiveProfile();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const templates = useTemplates(projectId, location);
  const templateNames = useMemo(() => namesOf(templates.data?.items), [templates.data]);

  const r = query.data;
  if (query.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (query.error instanceof ApiError || !r)
    return query.error instanceof ApiError ? <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} /> : null;
  const busy = ['starting', 'stopping', 'upgrading'].includes(r.state);
  const act = (a: 'start' | 'stop' | 'upgrade') => action.mutate({ location, id, action: a, label: r.displayName });
  const notes: Note[] = [
    {
      id: 'connect',
      tone: 'info',
      text: 'Notebooks connect to a runtime from Colab Enterprise in the Google Cloud console. Nephoscope manages runtimes but does not run kernels.',
    },
  ];
  if (r.runtimeUser && profile?.principal && r.runtimeUser !== profile.principal)
    notes.push({
      id: 'owner',
      tone: 'warn',
      text: `This runtime belongs to ${r.runtimeUser}; only that identity can connect notebooks to it.`,
    });
  if (r.upgradable)
    notes.push({ id: 'upgrade', tone: 'warn', text: 'A newer runtime image is available. Upgrading restarts the runtime.' });
  if (r.health === 'unhealthy') notes.push({ id: 'health', tone: 'error', text: 'Google reports the runtime as unhealthy.' });

  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Colab Enterprise', to: colabHref.list(projectId, 'runtimes') }, { label: r.displayName }]}
        title={r.displayName}
        status={<RuntimeStateGlyph state={r.state} />}
        subtitle={r.description}
        actions={
          <>
            <Button onClick={() => void query.refetch()} loading={query.isRefetching}>
              Refresh
            </Button>
            {r.upgradable ? (
              <Button icon={ArrowCircleUpIcon} onClick={() => act('upgrade')} disabled={!!readOnly || busy} disabledReason={readOnly}>
                Upgrade
              </Button>
            ) : null}
            {r.state === 'running' ? (
              <Button
                icon={StopIcon}
                onClick={() => act('stop')}
                disabled={!!readOnly}
                disabledReason={readOnly}
                loading={action.isPending}
              >
                Stop
              </Button>
            ) : (
              <Button
                variant="commit"
                icon={PlayIcon}
                onClick={() => act('start')}
                disabled={!!readOnly || busy}
                disabledReason={readOnly ?? (busy ? 'Wait for the current change to finish.' : null)}
                loading={action.isPending}
              >
                Start
              </Button>
            )}
          </>
        }
        menu={
          <MenuItem onClick={() => setDeleting(true)} className="text-redline-ink" disabled={!!readOnly}>
            Delete runtime
          </MenuItem>
        }
        cells={[
          { label: 'Machine', value: machineSummary(r.machine), mono: true, wide: true },
          { label: 'Template', value: <TemplateLink projectId={projectId} name={r.template} names={templateNames} /> },
          { label: 'User', value: <Mono value={r.runtimeUser ?? 'Unknown'} />, wide: true },
          { label: 'Region', value: <Mono value={r.location} />, mono: true },
          { label: 'Expires', value: <Timestamp iso={r.expirationTime} /> },
        ]}
        tabs={TABS}
        defaultTab="overview"
      >
        {(current) =>
          current === 'overview' ? (
            <>
              <Notes notes={notes} />
              <Section title="Runtime">
                <FactList
                  facts={[
                    [
                      'Health',
                      r.health === 'healthy' ? (
                        <StatusGlyph kind="ok" label="Healthy" />
                      ) : r.health === 'unhealthy' ? (
                        <StatusGlyph kind="error" label="Unhealthy" />
                      ) : (
                        'Unknown'
                      ),
                    ],
                    ['Image', r.colabImage],
                    ['Version', r.version],
                    ['Data disk', diskSummary(r.machine)],
                    ['Network', r.network.network ? <Mono key="n" value={r.network.network} /> : 'Default'],
                    ['Subnetwork', r.network.subnetwork ? <Mono key="s" value={r.network.subnetwork} /> : null],
                    ['Internet access', r.network.internetAccess ? 'Yes' : 'No'],
                    [
                      'Idle shutdown',
                      r.idleShutdown.disabled
                        ? 'Off'
                        : r.idleShutdown.timeoutMinutes
                          ? `After ${r.idleShutdown.timeoutMinutes} min`
                          : 'Default',
                    ],
                    ['Opened from', r.entryService === 'bigquery' ? 'BigQuery Studio' : 'Colab Enterprise'],
                    ['Created', <Timestamp key="c" iso={r.createTime} />],
                    ['Updated', <Timestamp key="u" iso={r.updateTime} />],
                  ]}
                />
              </Section>
            </>
          ) : (
            <RawView value={raw.data} fileName={r.id} loading={raw.isPending} error={raw.error} onRetry={() => void raw.refetch()} />
          )
        }
      </DetailLayout>
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete runtime"
        consequence={`The runtime ${r.displayName} and its data disk are deleted. Notebooks stay; they need another runtime to run.`}
        expected={r.displayName}
        confirmLabel="Delete runtime"
        onConfirm={async (confirm) => {
          await deleteRuntime(projectId, location, id, confirm);
          void navigate({ to: `/p/${projectId}/colab` as string, search: { tab: 'runtimes' } });
        }}
      />
    </>
  );
}
