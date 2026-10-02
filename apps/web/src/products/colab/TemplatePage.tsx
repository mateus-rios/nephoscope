import { CpuIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { MenuItem } from '../../design/Overlays';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { colabHref, deleteTemplate, useRaw, useTemplate } from './api';
import { diskSummary, FactList, machineSummary, useColabReadOnly } from './common';
import { RuntimeSheet, TemplateSheet } from './TemplateSheets';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** One runtime template (SPEC-0010 D-07, CA-03). */
export function TemplatePage() {
  const { projectId, location, template: id } = useParams({ strict: false }) as { projectId: string; location: string; template: string };
  const [tab] = useSearchState<Tab>(
    'tab',
    'overview',
    TABS.map((t) => t.key),
  );
  const query = useTemplate(projectId, location, id);
  const raw = useRaw(projectId, 'templates', location, id, tab === 'yaml');
  const readOnly = useColabReadOnly();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'edit' | 'runtime' | 'delete' | null>(null);

  const t = query.data;
  if (query.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (query.error instanceof ApiError || !t)
    return query.error instanceof ApiError ? <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} /> : null;
  const script = t.postStartupScript;

  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Colab Enterprise', to: colabHref.list(projectId, 'templates') }, { label: t.displayName }]}
        title={t.displayName}
        subtitle={t.description}
        actions={
          <>
            <Button icon={PencilSimpleIcon} onClick={() => setDialog('edit')} disabled={!!readOnly} disabledReason={readOnly}>
              Edit
            </Button>
            <Button variant="commit" icon={CpuIcon} onClick={() => setDialog('runtime')} disabled={!!readOnly} disabledReason={readOnly}>
              Create runtime
            </Button>
          </>
        }
        menu={
          <MenuItem onClick={() => setDialog('delete')} className="text-redline-ink" disabled={!!readOnly}>
            Delete template
          </MenuItem>
        }
        cells={[
          { label: 'Machine', value: machineSummary(t.machine), mono: true, wide: true },
          { label: 'Data disk', value: diskSummary(t.machine) ?? 'Default' },
          { label: 'Idle shutdown', value: t.idleShutdown.disabled ? 'Off' : `${t.idleShutdown.timeoutMinutes ?? '?'} min` },
          { label: 'Region', value: <Mono value={t.location} />, mono: true },
          { label: 'ID', value: <Mono value={t.id} copy />, mono: true },
        ]}
        tabs={TABS}
        defaultTab="overview"
      >
        {(current) =>
          current === 'overview' ? (
            <>
              <Section title="Network and access">
                <FactList
                  facts={[
                    ['Internet access', t.network.internetAccess ? 'Yes' : 'No'],
                    ['Network', t.network.network ? <Mono key="n" value={t.network.network} /> : 'Default'],
                    ['Subnetwork', t.network.subnetwork ? <Mono key="s" value={t.network.subnetwork} /> : null],
                    ['Network tags', t.network.tags.length ? t.network.tags.join(', ') : null],
                    ['End-user credentials', t.euc === null ? 'Not reported' : t.euc ? 'On' : 'Off'],
                    ['Secure Boot', t.secureBoot ? 'On' : 'Off'],
                    ['Encryption', t.kmsKeyName ? <Mono key="k" value={t.kmsKeyName} /> : 'Google-managed'],
                  ]}
                />
              </Section>
              <Section title="Software">
                <FactList
                  facts={[
                    ['Colab image', t.colabImage.description ?? t.colabImage.releaseName ?? 'Latest'],
                    ['Script URL', script.url ? <Mono key="u" value={script.url} /> : null],
                    ['Script behavior', script.behavior],
                    [
                      'Post-startup script',
                      script.script ? (
                        <pre
                          key="p"
                          className="m-0 max-h-60 overflow-auto rounded-control bg-well p-2 font-mono text-[11px] whitespace-pre-wrap"
                        >
                          {script.script}
                        </pre>
                      ) : null,
                    ],
                    [
                      'Environment',
                      Object.keys(t.env).length
                        ? Object.entries(t.env)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(', ')
                        : null,
                    ],
                  ]}
                />
              </Section>
              <Section title="Details">
                <FactList
                  facts={[
                    ['Type', t.type === 'one_click' ? 'Default template' : t.type === 'user_defined' ? 'Custom' : 'Unknown'],
                    [
                      'Labels',
                      Object.keys(t.labels).length
                        ? Object.entries(t.labels)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(', ')
                        : null,
                    ],
                    ['Created', <Timestamp key="c" iso={t.createTime} />],
                    ['Updated', <Timestamp key="u" iso={t.updateTime} />],
                  ]}
                />
              </Section>
            </>
          ) : (
            <RawView value={raw.data} fileName={t.id} loading={raw.isPending} error={raw.error} onRetry={() => void raw.refetch()} />
          )
        }
      </DetailLayout>
      <TemplateSheet
        projectId={projectId}
        template={t}
        open={dialog === 'edit'}
        onOpenChange={(o) => !o && setDialog(null)}
        readOnlyReason={readOnly}
      />
      <RuntimeSheet
        projectId={projectId}
        template={t}
        open={dialog === 'runtime'}
        onOpenChange={(o) => !o && setDialog(null)}
        readOnlyReason={readOnly}
      />
      <ConfirmDestructive
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Delete template"
        consequence={`The template ${t.displayName} is deleted. Runtimes made from it keep running; schedules that use it fail their next runs.`}
        expected={t.displayName}
        confirmLabel="Delete template"
        onConfirm={async (confirm) => {
          await deleteTemplate(projectId, location, id, confirm);
          void navigate({ to: `/p/${projectId}/colab` as string, search: { tab: 'templates' } });
        }}
      />
    </>
  );
}
