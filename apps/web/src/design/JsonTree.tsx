import { CaretDownIcon, CaretRightIcon, FunnelSimpleIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { cn } from '../lib/cn';
import { Input } from './Form';
import { CopyButton } from './Values';

type Kind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

interface Line {
  path: string;
  key: string | null;
  depth: number;
  kind: Kind;
  value: unknown;
  size: number;
}

function kindOf(v: unknown): Kind {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'number' || typeof v === 'bigint') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'string';
}

function childEntries(v: unknown): [string, unknown][] {
  if (Array.isArray(v)) return v.map((x, i) => [String(i), x]);
  if (v && typeof v === 'object') return Object.entries(v as Record<string, unknown>);
  return [];
}

function flatten(value: unknown, collapsed: ReadonlySet<string>): Line[] {
  const out: Line[] = [];
  const walk = (v: unknown, key: string | null, path: string, depth: number) => {
    const kind = kindOf(v);
    const children = kind === 'object' || kind === 'array' ? childEntries(v) : [];
    out.push({ path, key, depth, kind, value: v, size: children.length });
    if (children.length > 0 && !collapsed.has(path)) {
      for (const [k, child] of children) walk(child, k, `${path}/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`, depth + 1);
    }
  };
  walk(value, null, '', 0);
  return out;
}

const TYPE_LABEL: Record<Kind, string> = {
  object: 'map',
  array: 'array',
  string: 'str',
  number: 'num',
  boolean: 'bool',
  null: 'null',
};

function preview(line: Line): string {
  switch (line.kind) {
    case 'string': {
      const s = String(line.value);
      return JSON.stringify(s.length > 300 ? `${s.slice(0, 300)}…` : s);
    }
    case 'object':
      return `{ ${line.size} }`;
    case 'array':
      return `[ ${line.size} ]`;
    case 'null':
      return 'null';
    default:
      return String(line.value);
  }
}

interface JsonTreeProps {
  value: unknown;
  label: string;
  /** Depth expanded on first render. */
  expandDepth?: number;
  /** Maximum height; shorter documents shrink to fit. */
  height?: number;
  searchable?: boolean;
  /** Offered on leaf values: filter by this field (SPEC-0005 D-01 "Show matching"). */
  onShowMatching?: (pointer: string, value: unknown) => void;
}

const ROW = 24;

/**
 * Collapsible, searchable, virtualized JSON (SPEC-0002 CA-25). Types are marked by a label and ink
 * tone, never by state colors (D-20). Every value is text (SPEC-0001 D-22).
 */
export function JsonTree({ value, label, expandDepth = 2, height = 480, searchable = true, onShowMatching }: JsonTreeProps) {
  const initialCollapsed = useMemo(() => {
    const set = new Set<string>();
    const walk = (v: unknown, path: string, depth: number) => {
      const k = kindOf(v);
      if (k !== 'object' && k !== 'array') return;
      if (depth >= expandDepth) set.add(path);
      for (const [key, child] of childEntries(v)) walk(child, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, depth + 1);
    };
    walk(value, '', 0);
    return set;
  }, [value, expandDepth]);
  const [collapsed, setCollapsed] = useState<Set<string>>(initialCollapsed);
  const [query, setQuery] = useState('');
  const lines = useMemo(() => flatten(value, query ? new Set() : collapsed), [value, collapsed, query]);
  const visible = useMemo(() => {
    if (!query) return lines;
    const q = query.toLowerCase();
    return lines.filter(
      (l) => (l.key ?? '').toLowerCase().includes(q) || (l.kind !== 'object' && l.kind !== 'array' && preview(l).toLowerCase().includes(q)),
    );
  }, [lines, query]);
  const boxHeight = Math.min(height, Math.max(ROW, visible.length * ROW) + 2);

  return (
    <section className="flex flex-col gap-2" aria-label={label}>
      {searchable ? (
        <div className="relative max-w-sm">
          <MagnifyingGlassIcon
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a key or value"
            aria-label={`Search ${label}`}
            className="pl-7"
          />
        </div>
      ) : null}
      <div className="rounded-control border border-rule bg-well" style={{ height: boxHeight }}>
        <Virtuoso
          data={visible}
          style={{ height: boxHeight - 2 }}
          computeItemKey={(_i, l) => l.path || 'root'}
          itemContent={(_i, line) => {
            const container = line.kind === 'object' || line.kind === 'array';
            const isCollapsed = collapsed.has(line.path);
            return (
              <div
                className="group flex h-6 items-center gap-1 pr-2 font-mono text-[12px] hover:bg-hover"
                style={{ paddingLeft: 8 + line.depth * 16 }}
              >
                {container && line.size > 0 && !query ? (
                  <button
                    type="button"
                    aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(line.path)) next.delete(line.path);
                        else next.add(line.path);
                        return next;
                      })
                    }
                    className="inline-flex size-4 items-center justify-center rounded-[2px] text-ink-3 hover:text-ink"
                  >
                    {isCollapsed ? <CaretRightIcon size={10} aria-hidden /> : <CaretDownIcon size={10} aria-hidden />}
                  </button>
                ) : (
                  <span className="inline-block size-4" />
                )}
                {line.key !== null ? <span className="shrink-0 text-ink-2">{line.key}:</span> : null}
                <span
                  className={cn(
                    'min-w-0 truncate',
                    line.kind === 'null' && 'text-ink-3 italic',
                    line.kind === 'boolean' && 'italic',
                    line.kind === 'number' && 'tnum',
                    container ? 'text-ink-3' : 'text-ink',
                  )}
                >
                  {preview(line)}
                </span>
                <span className="legend ml-1 shrink-0 opacity-70">{TYPE_LABEL[line.kind]}</span>
                <span className="ml-auto flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                  {onShowMatching && !container && line.path ? (
                    <button
                      type="button"
                      onClick={() => onShowMatching(line.path, line.value)}
                      className="inline-flex h-5 items-center gap-1 rounded-[2px] px-1 font-sans text-meta text-ink-2 hover:bg-well hover:text-ink"
                    >
                      <FunnelSimpleIcon size={12} aria-hidden />
                      Show matching
                    </button>
                  ) : null}
                  <CopyButton value={line.path || '/'} label="Copy path" />
                  <CopyButton
                    value={
                      container ? JSON.stringify(line.value, null, 2) : line.kind === 'string' ? String(line.value) : String(line.value)
                    }
                    label="Copy value"
                  />
                </span>
              </div>
            );
          }}
        />
      </div>
    </section>
  );
}
