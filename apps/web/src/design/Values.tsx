import { CheckIcon, CopyIcon, XIcon } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { absoluteTime, relativeTime } from '../lib/format';
import { Tooltip } from './Tooltip';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Tooltip content={copied ? 'Copied' : label}>
      <button
        type="button"
        aria-label={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
        className="press inline-flex size-6 shrink-0 items-center justify-center rounded-control text-ink-3 hover:bg-hover hover:text-ink"
      >
        {copied ? <CheckIcon size={14} className="text-ok" aria-hidden /> : <CopyIcon size={14} aria-hidden />}
      </button>
    </Tooltip>
  );
}

/** Mono value, truncated with the full text in a tooltip, and optional copy (SPEC-0002 CA-08, CA-19). */
export function Mono({ value, copy, className }: { value: string; copy?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <Tooltip content={value} mono>
        <span className="truncate font-mono text-[12px] text-ink">{value}</span>
      </Tooltip>
      {copy ? <CopyButton value={value} label={`Copy ${value}`} /> : null}
    </span>
  );
}

/** Relative time with the absolute time, local and UTC, on hover (SPEC-0002 D-12). */
export function Timestamp({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const abs = absoluteTime(iso);
  if (!iso || !abs) return <span className="text-ink-3">Never</span>;
  return (
    <Tooltip
      content={
        <span className="flex flex-col">
          <span>{abs.local}</span>
          <span className="tnum opacity-80">{abs.utc}</span>
        </span>
      }
    >
      <time dateTime={iso} className={cn('tnum whitespace-nowrap text-ink-2', className)}>
        {relativeTime(iso)}
      </time>
    </Tooltip>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[3px] border border-rule-strong bg-sheet px-1 font-mono text-[11px] text-ink-2">
      {children}
    </kbd>
  );
}

/** Neutral label chip (resource labels) or a removable filter chip (SPEC-0002 CA-28). */
export function Chip({ children, onRemove, mono }: { children: ReactNode; onRemove?: () => void; mono?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-pill border border-rule-strong bg-sheet pr-1 pl-2 text-meta text-ink-2',
        mono && 'font-mono text-[11px]',
        !onRemove && 'pr-2',
      )}
    >
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove filter"
          className="inline-flex size-4 items-center justify-center rounded-pill text-ink-3 hover:bg-hover hover:text-ink"
        >
          <XIcon size={10} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
