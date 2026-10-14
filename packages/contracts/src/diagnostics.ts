import { z } from 'zod';

/** Error Reporting and Cloud Trace (SPEC-0005 D-11, D-12). */

export const errorPeriods = ['PERIOD_1_HOUR', 'PERIOD_6_HOURS', 'PERIOD_1_DAY', 'PERIOD_1_WEEK', 'PERIOD_30_DAYS'] as const;
export type ErrorPeriod = (typeof errorPeriods)[number];

export const errorResolutions = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'MUTED'] as const;
export type ErrorResolution = (typeof errorResolutions)[number];

export interface ErrorGroupView {
  groupId: string;
  name: string;
  resolutionStatus: ErrorResolution;
  message: string;
  count: number;
  affectedUsers: number;
  firstSeen: string | null;
  lastSeen: string | null;
  services: { service: string; version: string | null }[];
  /** Occurrences per bucket of the chart: `[start epoch ms, count]`. */
  timedCounts: [number, number][];
  trackingIssues: string[];
}

export interface ErrorEventView {
  eventTime: string | null;
  service: string | null;
  version: string | null;
  message: string;
  httpRequest: { method: string | null; url: string | null; status: number | null; userAgent: string | null } | null;
  user: string | null;
  reportLocation: { filePath: string | null; lineNumber: number | null; functionName: string | null } | null;
}

export const ErrorListQuerySchema = z.object({
  period: z.enum(errorPeriods).default('PERIOD_1_DAY'),
  service: z.string().max(256).optional(),
  pageToken: z.string().max(4096).optional(),
});
export type ErrorListQuery = z.infer<typeof ErrorListQuerySchema>;

export const UpdateErrorGroupSchema = z.object({ resolutionStatus: z.enum(errorResolutions) });

// ---- trace -----------------------------------------------------------------------------------

export interface TraceSpanView {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string | null;
  start: string | null;
  end: string | null;
  labels: Record<string, string>;
}

export interface TraceSummary {
  traceId: string;
  rootName: string;
  start: string | null;
  durationMs: number | null;
  spanCount: number;
}

export interface TraceView {
  traceId: string;
  spans: TraceSpanView[];
}

export const TraceListQuerySchema = z.object({
  since: z.string().datetime({ offset: true }),
  until: z.string().datetime({ offset: true }).optional(),
  filter: z.string().max(2000).optional(),
  orderBy: z.enum(['duration desc', 'start desc', 'start']).default('start desc'),
  pageToken: z.string().max(4096).optional(),
});
export type TraceListQuery = z.infer<typeof TraceListQuerySchema>;

/** A Cloud Trace id: 32 hexadecimal characters. */
export const TraceIdSchema = z.string().regex(/^[0-9a-fA-F]{1,32}$/, 'A trace id');

/** The trace id of a log entry's `trace` field, `projects/{p}/traces/{id}` (SPEC-0005 D-12). */
export function traceIdOf(trace: string | null | undefined): string | null {
  const m = trace ? /(?:^|\/traces\/)([0-9a-fA-F]{1,32})$/.exec(trace) : null;
  return m ? (m[1] as string) : null;
}
