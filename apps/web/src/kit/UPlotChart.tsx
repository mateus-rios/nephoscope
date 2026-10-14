import type { SeriesView } from '@nephoscope/contracts';
import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useTokenColors } from '../lib/color';
import { alignSeries, seriesLabels, seriesToken } from './series';

export { seriesLabels };

const COLORS = ['ink', 'ink-2', 'ink-3', 'construct-ink', 'ok', 'warn', 'redline', 'rule', 'panel'] as const;

interface UPlotChartProps {
  series: SeriesView[];
  height?: number;
  label: string;
  /** Formats axis and legend values. */
  format?: (v: number) => string;
  /** Horizontal threshold line, for alert conditions. */
  threshold?: number | null;
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 });
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** Time ticks in the app's 24-hour format; dates once the range spans days (SPEC-0002 D-12). */
function timeTicks(_u: uPlot, ticks: number[]): string[] {
  const span = (ticks.at(-1) ?? 0) - (ticks[0] ?? 0);
  return ticks.map((t) => (span > 2 * 86_400 ? day.format(t * 1000) : clock.format(t * 1000)));
}

/**
 * Dense time series on canvas for the Metrics Explorer (SPEC-0002 D-14, SPEC-0005 D-08): many series,
 * thousands of points. Colors come from the tokens, like the Recharts charts.
 */
export function UPlotChart({ series, height = 280, label, format = (v) => compact.format(v), threshold }: UPlotChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const colors = useTokenColors(COLORS);
  const labels = useMemo(() => seriesLabels(series), [series]);
  const data = useMemo(() => alignSeries(series) as uPlot.AlignedData, [series]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const axis = {
      stroke: colors['ink-2'],
      grid: { stroke: colors.rule, width: 1 },
      ticks: { stroke: colors.rule, width: 1 },
      font: '11px Archivo Variable, sans-serif',
    };
    const opts: uPlot.Options = {
      width: el.clientWidth || 600,
      height,
      cursor: { focus: { prox: 16 }, drag: { x: true, y: false } },
      focus: { alpha: 0.25 },
      legend: { show: true, live: true },
      scales: { x: { time: true } },
      axes: [
        { ...axis, values: timeTicks },
        { ...axis, size: 64, values: (_u, ticks) => ticks.map((t) => format(t)) },
      ],
      series: [
        { label: 'Time' },
        ...labels.map((l, i) => ({
          label: l,
          stroke: colors[seriesToken(l, i)],
          width: 1.5,
          points: { show: false },
          value: (_u: uPlot, v: number | null) => (v === null || v === undefined ? '' : format(v)),
        })),
      ],
      hooks:
        threshold === null || threshold === undefined
          ? {}
          : {
              draw: [
                (u: uPlot) => {
                  const y = u.valToPos(threshold, 'y', true);
                  const ctx = u.ctx;
                  ctx.save();
                  ctx.strokeStyle = colors.redline;
                  ctx.setLineDash([6, 4]);
                  ctx.lineWidth = 1.5;
                  ctx.beginPath();
                  ctx.moveTo(u.bbox.left, y);
                  ctx.lineTo(u.bbox.left + u.bbox.width, y);
                  ctx.stroke();
                  ctx.restore();
                },
              ],
            },
    };
    plot.current?.destroy();
    plot.current = new uPlot(opts, data, el);
    const resize = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height }));
    resize.observe(el);
    return () => {
      resize.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [data, labels, colors, height, format, threshold]);

  return <div ref={host} role="group" aria-label={`${label}: ${series.length} series`} className="nb-uplot w-full text-meta text-ink-2" />;
}
