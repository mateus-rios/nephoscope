import { type KitColumn, type KitItem, type KitState, readPath } from '@nephoscope/contracts';
import type { ReactNode } from 'react';
import { StatusGlyph, type StatusKind } from '../../design/Status';
import { Chip, Mono, Timestamp } from '../../design/Values';
import { bytes } from '../../lib/format';

const PREFIXES = /^(JOB_STATE_|PIPELINE_STATE_|CONDITION_|STATE_)/;

/** "STANDARD_HA" to "Standard ha"; Google enum values read as words (SPEC-0002 D-12). */
export function humanize(value: string): string {
  const words = value.replace(PREFIXES, '').replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function stateKind(state: KitState | undefined, value: string): StatusKind {
  if (!state) return 'unknown';
  for (const kind of ['ok', 'warn', 'error', 'running', 'paused', 'pending'] as const) {
    if (state[kind]?.includes(value)) return kind;
  }
  return 'unknown';
}

const DAY = 86_400_000;

/** Renders a value the way its column says; everything from Google is text (SPEC-0001 D-22). */
export function KitValue({ column, item, state }: { column: KitColumn; item: KitItem; state?: KitState }): ReactNode {
  const v = readPath(item, column.path);
  const none = <span className="text-ink-3">None</span>;
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0 && column.kind !== 'count')) return none;
  switch (column.kind) {
    case 'mono':
      return <Mono value={String(v)} />;
    case 'short':
      return <Mono value={String(v).split('/').pop() ?? String(v)} />;
    case 'time':
      return <Timestamp iso={String(v)} />;
    case 'expiry': {
      const ms = Date.parse(String(v)) - Date.now();
      const soon = Number.isFinite(ms) && ms < 30 * DAY;
      return (
        <span className="inline-flex items-center gap-1.5">
          {soon ? <StatusGlyph kind={ms < 0 ? 'error' : 'warn'} label={ms < 0 ? 'Expired' : 'Expires within 30 days'} compact /> : null}
          <Timestamp iso={String(v)} />
        </span>
      );
    }
    case 'state': {
      const text = String(v);
      return <StatusGlyph kind={stateKind(state, text)} label={humanize(text)} />;
    }
    case 'bytes':
      return <span className="tnum">{bytes(Number(v))}</span>;
    case 'number':
    case 'count':
      return <span className="tnum">{typeof v === 'number' || typeof v === 'string' ? String(v) : Array.isArray(v) ? v.length : ''}</span>;
    case 'bool':
      return <span>{v ? 'Yes' : 'No'}</span>;
    case 'labels': {
      if (typeof v !== 'object') return <Mono value={String(v)} />;
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length === 0) return none;
      return (
        <span className="flex flex-wrap gap-1">
          {entries.slice(0, 6).map(([k, val]) => (
            <Chip key={k} mono>
              {typeof val === 'string' && val ? `${k}: ${val}` : k}
            </Chip>
          ))}
          {entries.length > 6 ? <span className="text-meta text-ink-3">+{entries.length - 6}</span> : null}
        </span>
      );
    }
    case 'list': {
      const list = (Array.isArray(v) ? v : [v]).map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)));
      return <Mono value={list.join(', ')} />;
    }
    default:
      return typeof v === 'object' ? <Mono value={JSON.stringify(v)} /> : <span className="truncate">{String(v)}</span>;
  }
}

/** Sort key of a column value. */
export function kitSortValue(column: KitColumn, item: KitItem): string | number | null {
  const v = readPath(item, column.path);
  if (v === undefined || v === null) return null;
  if (column.kind === 'number' || column.kind === 'bytes' || column.kind === 'count') return Number(Array.isArray(v) ? v.length : v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** The display name of an item: its title field, or the last path segment. */
export function kitTitle(titlePath: string | undefined, item: KitItem): string {
  const t = titlePath ? readPath(item, titlePath) : undefined;
  return typeof t === 'string' && t ? t : (item._path.split('/').pop() ?? item._path);
}
