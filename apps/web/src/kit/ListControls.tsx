import { ArrowClockwiseIcon } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { Button } from '../design/Button';
import { type Note, Notes } from '../design/Drafting';
import { Field, Select } from '../design/Form';
import { useSearchState } from './urlState';

export const refreshIntervals = ['off', '10', '30', '60'] as const;
export type RefreshInterval = (typeof refreshIntervals)[number];

/** Manual and automatic refresh of a list (SPEC-0001 CA-62). */
export function RefreshControl({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  const [interval, setInterval_] = useSearchState<RefreshInterval>('refresh', 'off', refreshIntervals);
  useEffect(() => {
    if (interval === 'off') return;
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') onRefresh();
    }, Number(interval) * 1000);
    return () => window.clearInterval(t);
  }, [interval, onRefresh]);
  return (
    <div className="flex items-end gap-2">
      <Field label="Auto refresh" className="w-32">
        <Select<RefreshInterval>
          value={interval}
          onValueChange={setInterval_}
          options={[
            { value: 'off', label: 'Off' },
            { value: '10', label: 'Every 10 s' },
            { value: '30', label: 'Every 30 s' },
            { value: '60', label: 'Every minute' },
          ]}
        />
      </Field>
      <Button icon={ArrowClockwiseIcon} onClick={onRefresh} loading={refreshing}>
        Refresh
      </Button>
    </div>
  );
}

/** A facet over the loaded rows: "All" plus each distinct value with its count. */
export function Facet<T>({
  label,
  param,
  rows,
  valueFor,
  labelOf,
  className,
}: {
  label: string;
  param: string;
  rows: T[];
  valueFor: (row: T) => string;
  labelOf?: (value: string) => string;
  className?: string;
}) {
  const [value, setValue] = useSearchState<string>(param, 'all');
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(valueFor(r), (counts.get(valueFor(r)) ?? 0) + 1);
  const options = [
    { value: 'all', label: `All (${rows.length})` },
    ...[...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([v, n]) => ({ value: v, label: `${labelOf ? labelOf(v) : v || 'None'} (${n})` })),
  ];
  if (value !== 'all' && !counts.has(value)) options.push({ value, label: `${labelOf ? labelOf(value) : value} (0)` });
  return (
    <Field label={label} className={className ?? 'w-44'}>
      <Select<string> value={value} onValueChange={setValue} options={options} />
    </Field>
  );
}

/** Reads a facet's value to filter rows. */
export function useFacet(param: string): string {
  return useSearchState<string>(param, 'all')[0];
}

/** The partial-result note of SPEC-0001 D-17: a list is shown even when some regions failed. */
export function partialNote(unreachable: string[] | undefined): Note[] {
  if (!unreachable || unreachable.length === 0) return [];
  return [
    {
      id: 'partial',
      tone: 'warn',
      text: `Partial results: ${unreachable.length === 1 ? 'one location' : `${unreachable.length} locations`} did not answer (${unreachable.slice(0, 8).join(', ')}${unreachable.length > 8 ? ', and more' : ''}).`,
    },
  ];
}

export { Notes };
