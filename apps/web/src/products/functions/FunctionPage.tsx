import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Legend, type Note, Notes, Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { MenuItem } from '../../design/Overlays';
import { Chip, Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { InvokePanel } from '../../kit/InvokePanel';
import { LogsPanel } from '../../kit/LogsPanel';
import { MetricsPanel } from '../../kit/MetricsPanel';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { useOperations } from '../../state/operations';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { deleteFunction, functionLogFilter, invokeFunction, useFunction, useFunctionRaw } from './api';
import { FunctionStateGlyph, generationLabel } from './FunctionsPage';
import { SourceTab } from './SourceTab';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'source', label: 'Source' },
  { key: 'testing', label: 'Testing' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'logs', label: 'Logs' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** A Cloud Functions function, gen1 or gen2 (SPEC-0003 CA-15 to CA-17). */
export function FunctionPage() {
  const { projectId, location, fn: id } = useParams({ strict: false }) as { projectId: string; location: string; fn: string };
  const query = useFunction(projectId, location, id);
  const [tab] = useSearchState<Tab>(
    'tab',
    'overview',
    TABS.map((t) => t.key),
  );
  const raw = useFunctionRaw(projectId, location, id, tab === 'yaml');
  const [deleting, setDeleting] = useSearchState<'0' | '1'>('delete', '0', ['0', '1']);
  const navigate = useNavigate();
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);

  const f = query.data;
  if (query.isPending) return <DelayedSkeleton rows={8} className="p-6" />;
  if (query.error instanceof ApiError || !f)
    return query.error instanceof ApiError ? <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} /> : null;
  const runServiceId = f.runService?.split('/').pop() ?? null;
  const runServiceHref: string = `/p/${projectId}/run/services/${f.location}/${runServiceId}`;

  const notes: Note[] = f.stateMessages
    .filter((m) => m.message)
    .map((m, i) => ({ id: `m${i}`, tone: m.severity === 'ERROR' ? 'error' : m.severity === 'WARNING' ? 'warn' : 'info', text: m.message }));

  const facts: [string, React.ReactNode][] = [
    ['Trigger', f.trigger.kind === 'http' ? 'HTTP' : `${f.trigger.eventType}${f.trigger.resource ? ` on ${f.trigger.resource}` : ''}`],
    ['Retry on failure', f.trigger.kind === 'event' ? (f.trigger.retry ? 'Yes' : 'No') : null],
    ['Runtime', f.runtime ? <Mono value={f.runtime} /> : null],
    ['Entry point', f.entryPoint ? <Mono value={f.entryPoint} /> : null],
    ['Memory and CPU', `${f.memory ?? 'default'}${f.cpu ? `, ${f.cpu} CPU` : ''}`],
    ['Timeout', f.timeoutSeconds !== null ? `${f.timeoutSeconds} s` : null],
    ['Instances', `${f.minInstances ?? 0} to ${f.maxInstances ?? 'default'}`],
    ['Concurrency', f.concurrency],
    ['Service account', f.serviceAccount ? <Mono value={f.serviceAccount} copy /> : null],
    [
      'Ingress',
      f.ingress
        ?.replace(/^ALLOW_/, '')
        .replaceAll('_', ' ')
        .toLowerCase() ?? null,
    ],
    ['VPC connector', f.vpcConnector],
    ['Environment variables', Object.keys(f.environment).length > 0 ? Object.keys(f.environment).join(', ') : null],
    ['Secrets', f.secretEnvironment.length > 0 ? f.secretEnvironment.map((s) => `${s.key} from ${s.secret}`).join(', ') : null],
    ['Build', f.buildId ? <Mono value={f.buildId} /> : null],
    [
      'Source',
      f.source ? (
        'bucket' in f.source ? (
          <Mono value={`gs://${f.source.bucket}/${f.source.object}`} />
        ) : (
          <Mono value={f.source.repository} />
        )
      ) : null,
    ],
    ['Cloud Run service', runServiceId ? <Link to={runServiceHref}>{runServiceId}</Link> : null],
  ];

  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Functions', to: `/p/${projectId}/functions` }, { label: f.id }]}
        title={f.id}
        status={<FunctionStateGlyph state={f.state} />}
        subtitle={f.description}
        menu={
          <MenuItem onClick={() => setDeleting('1')} className="text-redline-ink" disabled={!!readOnly}>
            Delete function
          </MenuItem>
        }
        cells={[
          { label: 'Region', value: <Mono value={f.location} />, mono: true },
          { label: 'Generation', value: generationLabel[f.generation] },
          { label: 'URL', value: f.url ? <Mono value={f.url} copy /> : 'None', wide: true },
          { label: 'Last deployed', value: <Timestamp iso={f.updateTime} /> },
        ]}
        tabs={TABS}
        defaultTab="overview"
      >
        {(current) => {
          switch (current) {
            case 'overview':
              return (
                <>
                  <Notes notes={notes} title="Status" />
                  <Section title="Configuration">
                    <dl className="m-0 grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-6 gap-y-1.5 px-6">
                      {facts.map(([k, v]) => (
                        <div key={k} className="contents">
                          <Legend as="dt">{k}</Legend>
                          <dd className="m-0 min-w-0 text-dense text-ink">{v ?? <span className="text-ink-3">None</span>}</dd>
                        </div>
                      ))}
                    </dl>
                  </Section>
                  {Object.keys(f.labels).length > 0 ? (
                    <Section title="Labels">
                      <div className="flex flex-wrap gap-1 px-6">
                        {Object.entries(f.labels).map(([k, v]) => (
                          <Chip key={k} mono>
                            {k}={v}
                          </Chip>
                        ))}
                      </div>
                    </Section>
                  ) : null}
                </>
              );
            case 'source':
              return <SourceTab projectId={projectId} fn={f} readOnlyReason={readOnly} />;
            case 'testing':
              return f.trigger.kind === 'http' ? (
                <InvokePanel
                  baseUrl={f.url}
                  tags={[]}
                  send={(req) => invokeFunction(projectId, f.location, f.id, req)}
                  readOnlyReason={readOnly}
                />
              ) : (
                <Section
                  title="Test an event function"
                  description="Event functions run when their trigger fires. Send a test event from its source."
                >
                  <div className="px-6">
                    <EquivalentCommand
                      gcloud={
                        f.trigger.eventType?.includes('pubsub') && f.trigger.resource
                          ? `gcloud pubsub topics publish ${f.trigger.resource.split('/').pop()} --project=${projectId} --message='{"test":true}'`
                          : f.trigger.eventType?.includes('storage') && f.trigger.resource
                            ? `gcloud storage cp ./test-object.txt gs://${f.trigger.resource}/`
                            : `gcloud functions describe ${f.id} --region=${f.location} --project=${projectId}`
                      }
                    />
                  </div>
                </Section>
              );
            case 'metrics':
              return f.generation === 'gen1' ? (
                <MetricsPanel projectId={projectId} kind="function-gen1" labels={{ function_name: f.id, region: f.location }} />
              ) : (
                <MetricsPanel
                  projectId={projectId}
                  kind="run-service"
                  labels={{ service_name: runServiceId ?? f.id, location: f.location }}
                />
              );
            case 'logs':
              return <LogsPanel projectId={projectId} filter={functionLogFilter(f)} />;
            case 'yaml':
              return (
                <RawView value={raw.data} fileName={f.id} loading={raw.isPending} error={raw.error} onRetry={() => void raw.refetch()} />
              );
          }
        }}
      </DetailLayout>
      <ConfirmDestructive
        open={deleting === '1'}
        onOpenChange={(o) => setDeleting(o ? '1' : '0')}
        title="Delete function"
        consequence={`The function ${f.id}${runServiceId ? ` and its Cloud Run service ${runServiceId}` : ''} are deleted. Its URL and triggers stop working.`}
        expected={f.id}
        confirmLabel="Delete function"
        command={`gcloud functions delete ${f.id} --region=${f.location} --project=${projectId}${f.generation === 'gen2' ? ' --gen2' : ''}`}
        onConfirm={async (confirm) => {
          const { operation } = await deleteFunction(projectId, f.location, f.id, confirm);
          useOperations.getState().upsert(operation);
          void navigate({ to: `/p/${projectId}/functions` });
        }}
      />
    </>
  );
}
