import type { ColabJobSpec, ColabSchedule } from '@nephoscope/contracts';
import { PauseIcon, PencilSimpleIcon, PlayIcon } from '@phosphor-icons/react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { type Note, Notes, Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Switch } from '../../design/Form';
import { Dialog, MenuItem } from '../../design/Overlays';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { RawView } from '../../kit/RawView';
import { useSearchState } from '../../kit/urlState';
import { ApiError } from '../../lib/api';
import { formatInZone, previewCron } from '../scheduler/cron';
import {
  colabHref,
  deleteSchedule,
  useCreateExecution,
  useNotebooks,
  useRaw,
  useSchedule,
  useScheduleRuns,
  useScheduleState,
  useTemplates,
} from './api';
import { FactList, jobFacts, namesOf, ScheduleStateGlyph, useColabReadOnly } from './common';
import { RunSheet, splitCron } from './RunSheet';
import { RunsTable } from './RunsTable';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'runs', label: 'Runs' },
  { key: 'yaml', label: 'YAML' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** The schedule's run as a request for one execution now, when Google reported every part of it. */
function runNow(s: ColabSchedule): ColabJobSpec | null {
  const j = s.job;
  if (!j.template || !j.outputUri || j.identity.kind === 'unknown' || !j.identity.email) return null;
  const source =
    j.source.kind === 'notebook'
      ? { kind: 'notebook' as const, repository: j.source.repository, ...(j.source.commitSha ? { commitSha: j.source.commitSha } : {}) }
      : j.source.kind === 'gcs'
        ? { kind: 'gcs' as const, uri: j.source.uri }
        : null;
  if (!source) return null;
  return {
    displayName: j.displayName || s.displayName,
    source,
    template: j.template,
    outputUri: j.outputUri,
    identity: { kind: j.identity.kind, email: j.identity.email },
    timeoutSeconds: j.timeoutSeconds ?? 86_400,
    kernelName: j.kernelName ?? '',
  };
}

/** One notebook schedule (SPEC-0010 D-08, CA-06). */
export function SchedulePage() {
  const { projectId, location, schedule: id } = useParams({ strict: false }) as { projectId: string; location: string; schedule: string };
  const [tab] = useSearchState<Tab>(
    'tab',
    'overview',
    TABS.map((t) => t.key),
  );
  const query = useSchedule(projectId, location, id);
  const runs = useScheduleRuns(projectId, location, id, tab === 'runs');
  const raw = useRaw(projectId, 'schedules', location, id, tab === 'yaml');
  const action = useScheduleState(projectId);
  const run = useCreateExecution(projectId);
  const readOnly = useColabReadOnly();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'edit' | 'resume' | 'delete' | null>(null);
  const [catchUp, setCatchUp] = useState(false);
  const notebooks = useNotebooks(projectId, location);
  const templates = useTemplates(projectId, location);
  const names = useMemo(
    () => ({ notebooks: namesOf(notebooks.data?.items), templates: namesOf(templates.data?.items) }),
    [notebooks.data, templates.data],
  );

  const s = query.data;
  if (query.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (query.error instanceof ApiError || !s)
    return query.error instanceof ApiError ? <ProblemState problem={query.error.problem} onRetry={() => void query.refetch()} /> : null;
  const cron = splitCron(s.cron);
  const zone = cron.zone ?? 'Etc/UTC';
  const preview = previewCron(cron.expression, zone);
  const now = runNow(s);
  const notes: Note[] = [];
  if (s.state === 'completed')
    notes.push({ id: 'done', tone: 'info', text: 'The schedule reached its end time or run limit and starts no more runs.' });
  if (s.lastRun?.response && !s.lastRun.response.includes('/notebookExecutionJobs/'))
    notes.push({ id: 'last', tone: 'warn', text: `The last scheduled run answered: ${s.lastRun.response}` });

  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Colab Enterprise', to: colabHref.list(projectId, 'schedules') }, { label: s.displayName }]}
        title={s.displayName}
        status={<ScheduleStateGlyph state={s.state} />}
        actions={
          <>
            <Button icon={PencilSimpleIcon} onClick={() => setDialog('edit')} disabled={!!readOnly} disabledReason={readOnly}>
              Edit
            </Button>
            {s.state === 'paused' ? (
              <Button
                disabled={!!readOnly}
                disabledReason={readOnly}
                onClick={() => {
                  setCatchUp(false);
                  setDialog('resume');
                }}
              >
                Resume
              </Button>
            ) : s.state === 'active' ? (
              <Button
                icon={PauseIcon}
                loading={action.isPending}
                disabled={!!readOnly}
                disabledReason={readOnly}
                onClick={() => action.mutate({ location, id, action: 'pause' })}
              >
                Pause
              </Button>
            ) : null}
            <Button
              variant="commit"
              icon={PlayIcon}
              loading={run.isPending}
              disabled={!!readOnly || !now}
              disabledReason={readOnly ?? (now ? null : 'Google did not report every setting of the run; edit the schedule first.')}
              onClick={() => now && run.mutate({ ...now, region: location })}
            >
              Run now
            </Button>
          </>
        }
        menu={
          <MenuItem onClick={() => setDialog('delete')} className="text-redline-ink" disabled={!!readOnly}>
            Delete schedule
          </MenuItem>
        }
        cells={[
          { label: 'Cron', value: <Mono value={cron.expression} />, mono: true },
          { label: 'Time zone', value: cron.zone ?? 'UTC' },
          { label: 'Next run', value: s.state === 'active' ? <Timestamp iso={s.nextRunTime} /> : s.state === 'paused' ? 'Paused' : 'None' },
          { label: 'Runs started', value: `${s.startedRunCount}${s.maxRunCount ? ` of ${s.maxRunCount}` : ''}` },
          { label: 'Region', value: <Mono value={s.location} />, mono: true },
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
                    {s.state === 'active' && preview.valid ? (
                      <ol className="m-0 mb-4 flex list-none flex-col gap-0.5 px-6 font-mono text-[12px] text-ink-2">
                        {preview.next.map((d) => (
                          <li key={d.toISOString()}>{formatInZone(d, zone)}</li>
                        ))}
                      </ol>
                    ) : null}
                    <FactList
                      facts={[
                        ['Starts', s.startTime ? <Timestamp iso={s.startTime} /> : 'When created'],
                        ['Ends', s.endTime ? <Timestamp iso={s.endTime} /> : 'Never'],
                        ['Concurrent runs', String(s.maxConcurrentRunCount)],
                        ['Over the limit', s.allowQueueing ? 'Queued' : 'Skipped'],
                        ['Missed runs on resume', s.catchUp ? 'Run' : 'Skipped'],
                        ['Last scheduled run', <Timestamp key="l" iso={s.lastRun?.scheduledRunTime} />],
                        ['Last paused', s.lastPauseTime ? <Timestamp iso={s.lastPauseTime} /> : 'Never'],
                      ]}
                    />
                  </Section>
                  <Section title="Each run">
                    <FactList facts={jobFacts(projectId, s.job, names)} />
                  </Section>
                </>
              );
            case 'runs':
              return (
                <RunsTable projectId={projectId} query={runs} location={location} empty="Executions this schedule started appear here." />
              );
            case 'yaml':
              return (
                <RawView value={raw.data} fileName={s.id} loading={raw.isPending} error={raw.error} onRetry={() => void raw.refetch()} />
              );
          }
        }}
      </DetailLayout>
      <RunSheet
        projectId={projectId}
        mode="schedule"
        schedule={s}
        open={dialog === 'edit'}
        onOpenChange={(o) => !o && setDialog(null)}
        readOnlyReason={readOnly}
      />
      <Dialog
        open={dialog === 'resume'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Resume ${s.displayName}`}
        width="sm"
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              variant="commit"
              loading={action.isPending}
              onClick={() => action.mutate({ location, id, action: 'resume', catchUp }, { onSuccess: () => setDialog(null) })}
            >
              Resume
            </Button>
          </>
        }
      >
        <Switch
          checked={catchUp}
          onCheckedChange={setCatchUp}
          label="Run the missed runs"
          description={`Every run skipped since ${s.lastPauseTime ? 'the pause' : 'it stopped'} starts first, then the schedule continues.`}
        />
      </Dialog>
      <ConfirmDestructive
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Delete schedule"
        consequence={`The schedule ${s.displayName} starts no more runs. Past executions and the notebook stay.`}
        expected={s.displayName}
        confirmLabel="Delete schedule"
        onConfirm={async (confirm) => {
          await deleteSchedule(projectId, location, id, confirm);
          toast('Deleting the schedule', { description: 'Follow it in the operations tray.' });
          void navigate({ to: `/p/${projectId}/colab` as string, search: { tab: 'schedules' } });
        }}
      />
    </>
  );
}
