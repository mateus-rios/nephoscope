import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface TabNavItem {
  key: string;
  label: ReactNode;
  count?: number | null;
}

interface TabNavProps {
  items: TabNavItem[];
  active: string;
  onSelect: (key: string) => void;
  label: string;
}

/**
 * Tabs whose state lives in the URL. Switching never animates (F1, SPEC-0002 CA-18); the
 * active tab has a bottom indicator.
 */
export function TabNav({ items, active, onSelect, label }: TabNavProps) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-4 border-b border-rule px-6">
      {items.map((item) => {
        const selected = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(item.key)}
            className={cn(
              '-mb-px flex h-9 items-center gap-1.5 border-b-2 text-dense',
              selected ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink',
            )}
          >
            {item.label}
            {item.count !== undefined && item.count !== null ? (
              <span className="tnum font-mono text-[11px] text-ink-3">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
