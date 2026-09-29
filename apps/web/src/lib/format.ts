import { formatDistanceToNowStrict } from 'date-fns';

/** "3 min ago" style relative time for tables (SPEC-0002 D-12). */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diff = Math.abs(now.getTime() - date.getTime());
  if (diff < 45_000) return date > now ? 'in a moment' : 'just now';
  const text = formatDistanceToNowStrict(date, { addSuffix: true })
    .replace(' minutes', ' min')
    .replace(' minute', ' min')
    .replace(' seconds', ' s')
    .replace(' second', ' s')
    .replace(' hours', ' h')
    .replace(' hour', ' h');
  return text;
}

/** Absolute time, local and UTC, for tooltips (SPEC-0002 D-12). */
export function absoluteTime(iso: string | null | undefined): { local: string; utc: string } | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const local = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
  const utc = `${date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '')
    .replace('Z', '')} UTC`;
  return { local, utc };
}

const IEC = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

/** Binary sizes with IEC labels (SPEC-0002 D-12). */
export function bytes(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  let v = n;
  let i = 0;
  while (v >= 1024 && i < IEC.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${IEC[i]}`;
}

/** Compact duration for tables: "1m 12s", "3h 4m", "850ms". */
export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${new Intl.NumberFormat().format(n)} ${n === 1 ? singular : plural}`;
}
