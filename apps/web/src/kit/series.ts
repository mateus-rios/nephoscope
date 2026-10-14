import type { SeriesView } from '@nephoscope/contracts';

/** A series label from its labels, skipping ones every series shares. */
export function seriesLabels(series: SeriesView[]): string[] {
  const keys = [...new Set(series.flatMap((s) => Object.keys(s.labels)))].filter((k) => k !== '__name__');
  const varying = keys.filter((k) => new Set(series.map((s) => s.labels[k] ?? '')).size > 1);
  return series.map((s, i) => {
    const parts = (varying.length ? varying : keys.slice(0, 2)).map((k) => s.labels[k]).filter(Boolean);
    return parts.join(' · ') || `Series ${i + 1}`;
  });
}

/** Aligns series on one time axis (seconds), with nulls where a series has no point. */
export function alignSeries(series: SeriesView[]): (number | null)[][] {
  const times = [...new Set(series.flatMap((s) => s.points.map(([t]) => t)))].sort((a, b) => a - b);
  const index = new Map(times.map((t, i) => [t, i]));
  const ys = series.map((s) => {
    const y: (number | null)[] = new Array(times.length).fill(null);
    for (const [t, v] of s.points) y[index.get(t) as number] = v;
    return y;
  });
  return [times.map((t) => t / 1000), ...ys];
}

export type SeriesToken = 'ink' | 'ink-2' | 'ink-3' | 'construct-ink' | 'ok' | 'warn' | 'redline';

/** Series colors by meaning (SPEC-0002 D-20): states keep their color; everything else is ink. */
export function seriesToken(label: string, index: number): SeriesToken {
  const l = label.toLowerCase();
  if (/^2xx$|^succeeded$|^success$|^ok$|^active$/.test(l)) return 'ok';
  if (/^4xx$|^retry/.test(l)) return 'warn';
  if (/^5xx$|^failed$|^failure$|^error|^crash|^timeout/.test(l)) return 'redline';
  const neutral: SeriesToken[] = ['ink', 'construct-ink', 'ink-2', 'ink-3'];
  return neutral[index % neutral.length] as SeriesToken;
}
