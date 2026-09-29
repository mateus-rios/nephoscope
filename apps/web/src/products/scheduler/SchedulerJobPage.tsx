import { PauseIcon, PencilSimpleIcon, PlayIcon } from '@phosphor-icons/react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Legend, type Note, Notes, Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { MenuItem } from '../../design/Overlays';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { LogsPanel } from '../../kit/LogsPanel';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { deleteSchedulerJob, schedulerLogFilter, targetSummary, useSchedulerAction, useSchedulerJob, useSchedulerJobRaw } from './api';
import { formatInZone, previewCron } from './cron';
import { JobSheet } from './JobSheet';
import { LastRunGlyph, SchedulerStateGlyph } from './SchedulerPage';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'logs', label: 'Logs' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** One Scheduler job (SPEC-0003 CA-24 to CA-26). */
export function SchedulerJobPage() {
  const { projectId, location, job: id } = useParams({ strict: false }) as { projectId: string; location: string; job: string };
  const query = useSchedulerJob(projectId, location, id);
  const [tab] = useSearchState<Tab>(
    'tab',
    'overview',
    TABS.map((t) => t.key),
  );
  const raw = useSchedulerJobRaw(projectId, location, id, tab === 'yaml');
  const action = useSchedulerAction(projectId);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);

  const j = query.data;
  if (query.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (query.error instanceof ApiError || !j)
    return query.error instanceof ApiError ? <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} /> : null;
  const preview = previewCron(j.schedule, j.timeZone);
  const t = j.target;
  const notes: Note[] = [];
  if (j.lastAttemptStatus && j.lastAttemptStatus.code !== 0)
    notes.push({
      id: 'last',
      tone: 'error',
      text: `The last attempt failed: ${j.lastAttemptStatus.message ?? `code ${j.lastAttemptStatus.code}`}`,
    });
  if (j.binaryPayload)
    notes.push({ id: 'binary', tone: 'info', text: 'The payload is binary and shown as base64; saving from Nephoscope sends it as text.' });

  const facts: [string, React.ReactNode][] = [
    ['Target', <Mono key="t" value={targetSummary(t)} />],
    ...(t.kind === 'http'
      ? ([
          [
            'Authentication',
            t.auth.kind === 'none' ? 'None' : `${t.auth.kind === 'oidc' ? 'OIDC' : 'OAuth'} token as ${t.auth.serviceAccount}`,
          ],
          [
            'Headers',
            Object.keys(t.headers).length
              ? Object.entries(t.headers)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')
              : null,
          ],
        ] as [string, React.ReactNode][])
      : []),
    ...(t.kind === 'pubsub'
      ? ([
          [
            'Attributes',
            Object.keys(t.attributes).length
              ? Object.entries(t.attributes)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ')
              : null,
          ],
        ] as [string, React.ReactNode][])
      : []),
    [
      'Payload',
      (t.kind === 'pubsub' ? t.data : t.body) ? (
        <pre className="m-0 max-h-40 overflow-auto rounded-control bg-well p-2 font-mono text-[11px] whitespace-pre-wrap">
          {t.kind === 'pubsub' ? t.data : t.body}
        </pre>
      ) : null,
    ],
    ['Retries', `${j.retry.retryCount ?? 0}${j.retry.minBackoffSeconds ? `, backoff from ${j.retry.minBackoffSeconds} s` : ''}`],
    ['Attempt deadline', j.attemptDeadlineSeconds ? `${j.attemptDeadlineSeconds} s` : 'Default'],
  ];

  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Cloud Scheduler', to: `/p/${projectId}/scheduler` }, { label: j.id }]}
        title={j.id}
        status={<SchedulerStateGlyph state={j.state} />}
        subtitle={j.description}
        actions={
          <>
            <Button icon={PencilSimpleIcon} onClick={() => setEditing(true)} disabled={!!readOnly} disabledReason={readOnly}>
              Edit
            </Button>
            {j.state === 'paused' ? (
              <Button
                disabled={!!readOnly}
                disabledReason={readOnly}
                onClick={() => action.mutate({ location: j.location, id: j.id, action: 'resume' })}
              >
                Resume
              </Button>
            ) : (
              <Button
                icon={PauseIcon}
                disabled={!!readOnly}
                disabledReason={readOnly}
                onClick={() => action.mutate({ location: j.location, id: j.id, action: 'pause' })}
              >
                Pause
              </Button>
            )}
            <Button
              variant="commit"
              icon={PlayIcon}
              loading={action.isPending}
              disabled={!!readOnly}
              disabledReason={readOnly}
              onClick={() => action.mutate({ location: j.location, id: j.id, action: 'run' })}
            >
              Run now
            </Button>
          </>
        }
        menu={
          <MenuItem onClick={() => setDeleting(true)} className="text-redline-ink" disabled={!!readOnly}>
            Delete job
          </MenuItem>
        }
        cells={[
          { label: 'Schedule', value: <Mono value={j.schedule} />, mono: true },
          { label: 'Time zone', value: j.timeZone },
          { label: 'Next run', value: j.state === 'enabled' ? <Timestamp iso={j.nextRunTime} /> : 'Paused' },
          { label: 'Last run', value: <LastRunGlyph job={j} /> },
          { label: 'Location', value: <Mono value={j.location} />, mono: true },
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
                  <Section title="Schedule" description={preview.description ?? undefined}>
                    <ol className="m-0 flex list-none flex-col gap-0.5 px-6 font-mono text-[12px] text-ink-2">
                      {preview.next.map((d) => (
                        <li key={d.toISOString()}>{formatInZone(d, j.timeZone)}</li>
                      ))}
                    </ol>
                  </Section>
                  <Section title="Target">
                    <dl className="m-0 grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-6 gap-y-1.5 px-6">
                      {facts.map(([k, v]) => (
                        <div key={k} className="contents">
                          <Legend as="dt">{k}</Legend>
                          <dd className="m-0 min-w-0 text-dense break-all text-ink">{v ?? <span className="text-ink-3">None</span>}</dd>
                        </div>
                      ))}
                    </dl>
                  </Section>
                </>
              );
            case 'logs':
              return <LogsPanel projectId={projectId} filter={schedulerLogFilter(j.id, j.location)} />;
            case 'yaml':
              return (
                <RawView value={raw.data} fileName={j.id} loading={raw.isPending} error={raw.error} onRetry={() => void raw.refetch()} />
              );
          }
        }}
      </DetailLayout>
      <JobSheet projectId={projectId} open={editing} onOpenChange={setEditing} job={j} readOnlyReason={readOnly} />
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete job"
        consequence={`The job ${j.id} stops running and is deleted. Its target is not changed.`}
        expected={j.id}
        confirmLabel="Delete job"
        command={`gcloud scheduler jobs delete ${j.id} --location=${j.location} --project=${projectId}`}
        onConfirm={async (confirm) => {
          await deleteSchedulerJob(projectId, j.location, j.id, confirm);
          void navigate({ to: `/p/${projectId}/scheduler` as string });
        }}
      />
    </>
  );
}
