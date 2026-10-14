import type { BqField, BqValue } from '@nephoscope/contracts';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../design/Button';
import { JsonTree } from '../../design/JsonTree';
import { Dialog } from '../../design/Overlays';

const ROW_H = 28;
const OVERSCAN = 12;

const nested = (f: BqField) => f.mode === 'REPEATED' || f.type === 'STRUCT' || f.type === 'JSON';

function Cell({ field, value, onOpen }: { field: BqField; value: BqValue; onOpen: () => void }) {
  if (value === null) return <span className="text-ink-3">NULL</span>;
  if (nested(field) && typeof value !== 'string') {
    const size = Array.isArray(value) ? `${value.length} items` : field.type === 'JSON' ? 'JSON' : `${Object.keys(value).length} fields`;
    return (
      <Button size="sm" variant="ghost" onClick={onOpen}>
        {size}
      </Button>
    );
  }
  // Values are text exactly as BigQuery returned them (D-03, SPEC-0001 D-22).
  return <span className="font-mono text-[12px] whitespace-pre">{String(value)}</span>;
}

interface ResultsGridProps {
  schema: BqField[];
  rows: BqValue[][];
  label: string;
  /** All rows of the result, when more can be loaded. */
  total?: number | null;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  height?: number;
}

/**
 * Typed results in a windowed grid (SPEC-0008 D-03, NFR-02): only the rows in view are drawn, so
 * scrolling 100,000 loaded rows stays smooth. STRUCT, ARRAY and JSON values open as a tree.
 */
export function ResultsGrid({ schema, rows, label, total, hasMore, loadingMore, onLoadMore, height = 420 }: ResultsGridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [open, setOpen] = useState<{ field: BqField; value: BqValue; row: number } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new result (new schema) starts at the top.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    setTop(0);
  }, [schema]);
  const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((top + height) / ROW_H) + OVERSCAN);
  const nearEnd = last >= rows.length - OVERSCAN;
  useEffect(() => {
    if (nearEnd && hasMore && !loadingMore) onLoadMore?.();
  }, [nearEnd, hasMore, loadingMore, onLoadMore]);
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={scroller}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
        className="overflow-auto border-y border-rule"
        style={{ height }}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the scroll region must be reachable by keyboard (WCAG 2.1.1).
        tabIndex={0}
        role="region"
        aria-label={`${label}, scrollable`}
      >
        <table className="w-max min-w-full border-collapse text-dense" aria-label={label} aria-rowcount={(total ?? rows.length) + 1}>
          <thead className="sticky top-0 z-10 bg-sheet">
            <tr aria-rowindex={1}>
              <th scope="col" className="h-8 border-b border-rule px-2 text-right text-meta font-medium text-ink-3">
                Row
              </th>
              {schema.map((f) => (
                <th key={f.name} scope="col" className="h-8 border-b border-rule px-2 text-left font-medium text-ink">
                  <span className="flex flex-col">
                    <span className="font-mono text-[12px]">{f.name}</span>
                    <span className="text-[10px] font-normal text-ink-3">{f.mode === 'REPEATED' ? `ARRAY<${f.type}>` : f.type}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {first > 0 ? (
              <tr>
                <td style={{ height: first * ROW_H }} colSpan={schema.length + 1} />
              </tr>
            ) : null}
            {rows.slice(first, last).map((row, i) => {
              const index = first + i;
              return (
                <tr key={index} aria-rowindex={index + 2} className="border-b border-rule hover:bg-well" style={{ height: ROW_H }}>
                  <td className="px-2 text-right font-mono text-[11px] text-ink-3">{index + 1}</td>
                  {schema.map((f, c) => (
                    <td key={f.name} className="max-w-[28rem] truncate px-2">
                      <Cell field={f} value={row[c] ?? null} onOpen={() => setOpen({ field: f, value: row[c] ?? null, row: index + 1 })} />
                    </td>
                  ))}
                </tr>
              );
            })}
            {last < rows.length ? (
              <tr>
                <td style={{ height: (rows.length - last) * ROW_H }} colSpan={schema.length + 1} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <span className="px-6 text-meta text-ink-2" aria-live="polite">
        {rows.length.toLocaleString()} {total ? `of ${Number(total).toLocaleString()} ` : ''}rows loaded
        {loadingMore ? '; loading more…' : ''}
      </span>
      <Dialog
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open ? `${open.field.name}, row ${open.row}` : ''}
        width="lg"
        footer={<Button onClick={() => setOpen(null)}>Close</Button>}
      >
        {open ? <JsonTree value={open.value} label={`${open.field.name}, row ${open.row}`} height={420} /> : null}
      </Dialog>
    </div>
  );
}
