import type { ReactNode } from 'react';
import { Legend } from '../design/Drafting';

/** A two-column list of facts; empty values read "None". */
export function FactList({ facts }: { facts: [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-6 gap-y-1.5 px-6">
      {facts.map(([k, v]) => (
        <div key={k} className="contents">
          <Legend as="dt">{k}</Legend>
          <dd className="m-0 min-w-0 text-dense break-words text-ink">{v ?? <span className="text-ink-3">None</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
