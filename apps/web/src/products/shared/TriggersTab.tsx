import type { EventarcTrigger, SchedulerJob } from '@nephoscope/contracts';
import { Link } from '@tanstack/react-router';
import { Section } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Mono } from '../../design/Values';
import { ApiError } from '../../lib/api';
import { useTriggers } from '../eventarc/api';
import { targetSummary, useSchedulerJobs } from '../scheduler/api';
import { SchedulerStateGlyph } from '../scheduler/SchedulerPage';

/** What the triggers must point at to belong to this resource. */
export type TriggerMatch =
  | { kind: 'runService'; id: string; location: string; urls: string[] }
  | { kind: 'runJob'; name: string }
  | { kind: 'workflow'; name: string };

function schedulerMatches(job: SchedulerJob, m: TriggerMatch): boolean {
  if (job.target.kind !== 'http') return false;
  const uri = job.target.uri;
  if (m.kind === 'runService') return m.urls.some((u) => u && uri.startsWith(u));
  if (m.kind === 'runJob') return uri.includes(`${m.name}:run`);
  return uri.includes(`${m.name}/executions`);
}

function eventarcMatches(t: EventarcTrigger, m: TriggerMatch): boolean {
  const d = t.destination;
  if (m.kind === 'runService') return d.kind === 'cloudRun' && d.service === m.id && d.region === m.location;
  if (m.kind === 'workflow') return d.kind === 'workflow' && d.workflow === m.name;
  return false;
}

/** Scheduler jobs and Eventarc triggers that target a resource (SPEC-0003 CA-02, CA-19). */
export function TriggersTab({ projectId, match }: { projectId: string; match: TriggerMatch }) {
  const scheduler = useSchedulerJobs(projectId);
  const eventarc = useTriggers(projectId, match.kind !== 'runJob');
  const jobs = (scheduler.data?.items ?? []).filter((j) => schedulerMatches(j, match));
  const triggers = (eventarc.data?.items ?? []).filter((t) => eventarcMatches(t, match));
  return (
    <div className="flex flex-col">
      <Section title="Cloud Scheduler" description="Jobs that call this resource on a schedule.">
        {scheduler.isPending ? (
          <DelayedSkeleton rows={2} />
        ) : scheduler.error instanceof ApiError ? (
          <ProblemState problem={scheduler.error.problem} onRetry={() => void scheduler.refetch()} />
        ) : jobs.length === 0 ? (
          <EmptyState title="No schedule">No Scheduler job calls this resource.</EmptyState>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 px-6">
            {jobs.map((j) => (
              <li key={j.name} className="flex flex-wrap items-center gap-3 text-dense">
                <Link to={`/p/${projectId}/scheduler/${j.location}/${j.id}` as string} className="font-medium">
                  {j.id}
                </Link>
                <SchedulerStateGlyph state={j.state} />
                <Mono value={j.schedule} />
                <span className="text-meta text-ink-3">{j.timeZone}</span>
                <span className="truncate text-meta text-ink-3">{targetSummary(j.target)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {match.kind !== 'runJob' ? (
        <Section title="Eventarc" description="Triggers that deliver events to this resource.">
          {eventarc.isPending ? (
            <DelayedSkeleton rows={2} />
          ) : eventarc.error instanceof ApiError ? (
            <ProblemState problem={eventarc.error.problem} onRetry={() => void eventarc.refetch()} />
          ) : triggers.length === 0 ? (
            <EmptyState title="No event triggers">No Eventarc trigger delivers events here.</EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 px-6">
              {triggers.map((t) => (
                <li key={t.name} className="flex flex-wrap items-center gap-3 text-dense">
                  <span className="font-medium text-ink">{t.id}</span>
                  <span className="font-mono text-[12px] text-ink-2">{t.eventType}</span>
                  <span className="text-meta text-ink-3">
                    {t.filters
                      .filter((f) => f.attribute !== 'type')
                      .map((f) => `${f.attribute}=${f.value}`)
                      .join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
    </div>
  );
}
