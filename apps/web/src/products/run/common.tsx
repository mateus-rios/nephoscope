import type { ExecutionOutcome, Ingress, RunStatus, TrafficStatus, TrafficTarget } from '@nephoscope/contracts';
import { StatusGlyph } from '../../design/Status';
import { Tooltip } from '../../design/Tooltip';

export function RunStatusGlyph({ status, message, compact }: { status: RunStatus; message?: string | null; compact?: boolean }) {
  switch (status) {
    case 'ready':
      return <StatusGlyph kind="ok" label="Ready" compact={compact} />;
    case 'deploying':
      return <StatusGlyph kind="running" label="Deploying" compact={compact} />;
    case 'failed':
      return message ? (
        <Tooltip content={message}>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focus target so keyboard users can read the tooltip. */}
          <span className="inline-flex" tabIndex={0}>
            <StatusGlyph kind="error" label="Failed" compact={compact} />
          </span>
        </Tooltip>
      ) : (
        <StatusGlyph kind="error" label="Failed" compact={compact} />
      );
    default:
      return <StatusGlyph kind="unknown" label="Unknown" compact={compact} />;
  }
}

export const outcomeLabel: Record<ExecutionOutcome, string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  running: 'Running',
  cancelled: 'Cancelled',
  pending: 'Pending',
  unknown: 'Unknown',
};

export function OutcomeGlyph({ outcome, compact }: { outcome: ExecutionOutcome; compact?: boolean }) {
  const kind = {
    succeeded: 'ok',
    failed: 'error',
    running: 'running',
    cancelled: 'paused',
    pending: 'pending',
    unknown: 'unknown',
  } as const;
  return <StatusGlyph kind={kind[outcome]} label={outcomeLabel[outcome]} compact={compact} />;
}

export const ingressLabel: Record<Ingress, string> = {
  ALL: 'All',
  INTERNAL_ONLY: 'Internal',
  INTERNAL_LOAD_BALANCER: 'Internal and load balancing',
  NONE: 'None',
  UNSPECIFIED: 'Unknown',
};

/** "100% latest", "2 revisions" (SPEC-0003 CA-01). */
export function trafficSummary(traffic: (TrafficStatus | TrafficTarget)[]): string {
  const serving = traffic.filter((t) => t.percent > 0);
  if (serving.length === 0) return 'No traffic';
  if (serving.length === 1) {
    const t = serving[0] as TrafficTarget;
    return t.type === 'LATEST' ? `${t.percent}% latest` : `${t.percent}% ${t.revision}`;
  }
  return `${serving.length} revisions`;
}

/** Base log filters of SPEC-0003 CA-30. */
export const runLogFilter = {
  service: (id: string, location: string) =>
    `resource.type="cloud_run_revision" resource.labels.service_name="${id}" resource.labels.location="${location}"`,
  revision: (id: string, location: string, revision: string) =>
    `${runLogFilter.service(id, location)} resource.labels.revision_name="${revision}"`,
  job: (id: string, location: string) =>
    `resource.type="cloud_run_job" resource.labels.job_name="${id}" resource.labels.location="${location}"`,
  execution: (id: string, location: string, execution: string) =>
    `${runLogFilter.job(id, location)} labels."run.googleapis.com/execution_name"="${execution}"`,
};

export function runRoutes(projectId: string) {
  return {
    list: `/p/${projectId}/run`,
    service: (location: string, id: string) => `/p/${projectId}/run/services/${location}/${id}`,
    job: (location: string, id: string) => `/p/${projectId}/run/jobs/${location}/${id}`,
    execution: (location: string, job: string, execution: string) => `/p/${projectId}/run/jobs/${location}/${job}/executions/${execution}`,
  };
}

/** Read-only state of this tab, the reason controls are disabled (SPEC-0001 D-12). */
export function readOnlyReason(instanceReadOnly: boolean | undefined, profileReadOnly: boolean | undefined): string | null {
  if (instanceReadOnly) return 'This Nephoscope instance is read-only';
  if (profileReadOnly) return 'The active profile is read-only';
  return null;
}
