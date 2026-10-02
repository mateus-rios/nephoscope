import {
  COLAB_REGIONS,
  type ColabExecution,
  type ColabJobSource,
  type ColabJobState,
  type ColabJobView,
  type ColabMachine,
  type ColabRuntimeState,
  type ColabScheduleState,
} from '@nephoscope/contracts';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { Legend } from '../../design/Drafting';
import { Field, Select } from '../../design/Form';
import { StatusGlyph } from '../../design/Status';
import { Tooltip } from '../../design/Tooltip';
import { Mono } from '../../design/Values';
import { duration } from '../../lib/format';
import { useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import { colabHref, locationOf, shortName, useColabRegion } from './api';

export function useColabReadOnly(): string | null {
  const instance = useInstance();
  const { profile } = useActiveProfile();
  return readOnlyReason(instance.data?.readOnly, profile?.readOnly);
}

/** The region filter of every Colab list: all regions fan out, one region is one call per list (SPEC-0010 D-03). */
export function RegionPicker() {
  const [region, setRegion] = useColabRegion();
  const options = [
    { value: 'all', label: 'All regions' },
    ...(region !== 'all' && !(COLAB_REGIONS as readonly string[]).includes(region) ? [{ value: region, label: region }] : []),
    ...COLAB_REGIONS.map((r) => ({ value: r, label: r })),
  ];
  return (
    <Field label="Region" className="w-52">
      <Select<string> value={region} onValueChange={setRegion} options={options} />
    </Field>
  );
}

export function RuntimeStateGlyph({ state, compact }: { state: ColabRuntimeState; compact?: boolean }) {
  switch (state) {
    case 'running':
      return <StatusGlyph kind="ok" label="Running" compact={compact} />;
    case 'starting':
      return <StatusGlyph kind="running" label="Starting" compact={compact} />;
    case 'stopping':
      return <StatusGlyph kind="running" label="Stopping" compact={compact} />;
    case 'upgrading':
      return <StatusGlyph kind="running" label="Upgrading" compact={compact} />;
    case 'stopped':
      return <StatusGlyph kind="paused" label="Stopped" compact={compact} />;
    case 'error':
      return <StatusGlyph kind="error" label="Error" compact={compact} />;
    case 'invalid':
      return <StatusGlyph kind="error" label="Invalid" compact={compact} />;
    default:
      return <StatusGlyph kind="unknown" label="Unknown" compact={compact} />;
  }
}

const JOB_LABEL: Record<ColabJobState, string> = {
  queued: 'Queued',
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelling: 'Cancelling',
  cancelled: 'Cancelled',
  paused: 'Paused',
  expired: 'Expired',
  updating: 'Updating',
  partially_succeeded: 'Partially succeeded',
  unknown: 'Unknown',
};

export const jobStateLabel = (s: ColabJobState) => JOB_LABEL[s];
export const isJobDone = (s: ColabJobState) => ['succeeded', 'failed', 'cancelled', 'expired', 'partially_succeeded'].includes(s);

export function JobStateGlyph({ state, message, compact }: { state: ColabJobState; message?: string | null; compact?: boolean }) {
  const kind =
    state === 'succeeded'
      ? 'ok'
      : state === 'failed' || state === 'expired'
        ? 'error'
        : state === 'partially_succeeded'
          ? 'warn'
          : state === 'running' || state === 'cancelling' || state === 'updating'
            ? 'running'
            : state === 'queued' || state === 'pending'
              ? 'pending'
              : state === 'cancelled' || state === 'paused'
                ? 'paused'
                : 'unknown';
  const glyph = <StatusGlyph kind={kind} label={JOB_LABEL[state]} compact={compact} />;
  if (!message) return glyph;
  return (
    <Tooltip content={message}>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focus target so keyboard users can read the tooltip. */}
      <span className="inline-flex" tabIndex={0}>
        {glyph}
      </span>
    </Tooltip>
  );
}

export function ScheduleStateGlyph({ state }: { state: ColabScheduleState }) {
  if (state === 'active') return <StatusGlyph kind="ok" label="Active" />;
  if (state === 'paused') return <StatusGlyph kind="paused" label="Paused" />;
  if (state === 'completed') return <StatusGlyph kind="pending" label="Completed" />;
  return <StatusGlyph kind="unknown" label="Unknown" />;
}

/** "e2-standard-4 with 1 NVIDIA_L4" */
export function machineSummary(m: ColabMachine | null): string {
  if (!m?.machineType) return 'Default machine';
  const gpu = m.acceleratorType ? ` with ${m.acceleratorCount ?? 1} ${m.acceleratorType}` : '';
  return `${m.machineType}${gpu}`;
}

export function diskSummary(m: ColabMachine): string | null {
  if (!m.diskSizeGb && !m.diskType) return null;
  return `${m.diskSizeGb ?? '?'} GB ${m.diskType ?? ''}`.trim();
}

/** Where a run reads its notebook, linked when it is a notebook of this project. */
export function SourceLink({ projectId, source, names }: { projectId: string; source: ColabJobSource; names?: Map<string, string> }) {
  if (source.kind === 'notebook') {
    const id = shortName(source.repository);
    const label = names?.get(id) ?? id;
    return (
      <span className="inline-flex min-w-0 items-center gap-2">
        <Link to={colabHref.notebook(projectId, locationOf(source.repository), id) as string} className="truncate text-ink">
          {label}
        </Link>
        {source.commitSha ? <span className="font-mono text-[11px] text-ink-3">at {source.commitSha.slice(0, 7)}</span> : null}
      </span>
    );
  }
  if (source.kind === 'gcs') return <Mono value={source.uri} />;
  if (source.kind === 'inline') return <span className="text-ink-2">Notebook sent with the request</span>;
  return <span className="text-ink-3">Unknown</span>;
}

/** A template by display name when it is known, by id otherwise. */
export function TemplateLink({ projectId, name, names }: { projectId: string; name: string | null; names?: Map<string, string> }) {
  if (!name) return <span className="text-ink-3">Custom machine</span>;
  const id = shortName(name);
  return (
    <Link to={colabHref.template(projectId, locationOf(name), id) as string} className="truncate text-ink">
      {names?.get(id) ?? id}
    </Link>
  );
}

export function durationLabel(seconds: number | null): string {
  if (seconds === null) return 'Default';
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

/** A two-column list of facts; empty values read "None". */
export function FactList({ facts }: { facts: [string, React.ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-6 gap-y-1.5 px-6">
      {facts.map(([k, v]) => (
        <div key={k} className="contents">
          <Legend as="dt">{k}</Legend>
          <dd className="m-0 min-w-0 text-dense break-words text-ink">{v ?? <span className="text-ink-3">None</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The output folder of a run, linked to the Cloud Storage browser. */
export function StorageLink({ projectId, uri }: { projectId: string; uri: string | null }) {
  const m = uri ? /^gs:\/\/([^/]+)\/?(.*)$/.exec(uri) : null;
  if (!uri || !m) return <span className="text-ink-3">None</span>;
  const prefix = m[2] ? `${m[2].replace(/\/+$/, '')}/` : '';
  return (
    <Link
      to={`/p/${projectId}/storage/${encodeURIComponent(m[1] ?? '')}` as string}
      search={prefix ? { prefix } : {}}
      className="font-mono text-[12px] break-all text-ink"
    >
      {uri}
    </Link>
  );
}

/** What a run does, for executions and schedules alike (SPEC-0010 D-08). */
export function jobFacts(
  projectId: string,
  job: ColabJobView,
  names?: { notebooks?: Map<string, string>; templates?: Map<string, string> },
) {
  return [
    ['Notebook', <SourceLink key="s" projectId={projectId} source={job.source} names={names?.notebooks} />],
    [
      'Runtime',
      job.template ? (
        <TemplateLink key="t" projectId={projectId} name={job.template} names={names?.templates} />
      ) : (
        <span key="t">{machineSummary(job.customMachine)}</span>
      ),
    ],
    ['Output', <StorageLink key="o" projectId={projectId} uri={job.outputUri} />],
    ['Run as', job.identity.email ? `${job.identity.kind === 'user' ? 'User' : 'Service account'} ${job.identity.email}` : null],
    ['Timeout', durationLabel(job.timeoutSeconds)],
    ['Kernel', job.kernelName ?? 'Notebook default'],
  ] as [string, React.ReactNode][];
}

/** Elapsed time of a run: to its last update when done, to now while it runs. */
export function runDuration(e: ColabExecution): string {
  if (!e.createTime) return '';
  const end = isJobDone(e.state) ? Date.parse(e.updateTime ?? e.createTime) : Date.now();
  return duration(end - Date.parse(e.createTime));
}

/** Display names by id, for linking resources Google names by id only. */
export function namesOf(items: { id: string; displayName: string }[] | undefined): Map<string, string> {
  return new Map((items ?? []).map((i) => [i.id, i.displayName]));
}

/**
 * Runs `reset` when a sheet opens, and not again while it stays open: a parent that re-renders
 * with new props must not wipe what the user is typing.
 */
export function useOnOpen(open: boolean, reset: () => void): void {
  const wasOpen = useRef(false);
  const latest = useRef(reset);
  latest.current = reset;
  useEffect(() => {
    if (open && !wasOpen.current) latest.current();
    wasOpen.current = open;
  }, [open]);
}
