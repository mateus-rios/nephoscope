/** Time ranges shared by the Logs and Metrics tabs (SPEC-0002 CA-27, SPEC-0005 D-01). */
export const timeRanges = ['15m', '1h', '6h', '1d', '7d', '30d'] as const;
export type TimeRange = (typeof timeRanges)[number];

const MS: Record<TimeRange, number> = {
  '15m': 15 * 60_000,
  '1h': 3_600_000,
  '6h': 6 * 3_600_000,
  '1d': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000,
  '30d': 30 * 24 * 3_600_000,
};

export const timeRangeLabels: Record<TimeRange, string> = {
  '15m': 'Last 15 minutes',
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '1d': 'Last day',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

/** The start of a range ending at `anchor`, as RFC 3339. */
export function rangeStart(range: TimeRange, anchor: number): string {
  return new Date(anchor - MS[range]).toISOString();
}

export function rangeMs(range: TimeRange): number {
  return MS[range];
}
