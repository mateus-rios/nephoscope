import {
  CheckCircleIcon,
  CircleIcon,
  CircleNotchIcon,
  PauseCircleIcon,
  QuestionIcon,
  WarningIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Tooltip } from './Tooltip';

export type StatusKind = 'ok' | 'warn' | 'error' | 'running' | 'pending' | 'paused' | 'unknown';

const glyph: Record<StatusKind, { icon: typeof CheckCircleIcon; className: string }> = {
  ok: { icon: CheckCircleIcon, className: 'text-ok' },
  warn: { icon: WarningIcon, className: 'text-warn' },
  error: { icon: XCircleIcon, className: 'text-redline' },
  running: { icon: CircleNotchIcon, className: 'text-construct-ink nb-spin' },
  pending: { icon: CircleIcon, className: 'text-ink-3' },
  paused: { icon: PauseCircleIcon, className: 'text-ink-3' },
  unknown: { icon: QuestionIcon, className: 'text-ink-3' },
};

interface StatusGlyphProps {
  kind: StatusKind;
  label: string;
  /** Narrow status columns: the label moves to the tooltip and the accessible name (SPEC-0002 CA-20). */
  compact?: boolean;
  className?: string;
}

/** A state is a shape, a color and a word; never a pulsing dot (SPEC-0002 D-11). */
export function StatusGlyph({ kind, label, compact, className }: StatusGlyphProps) {
  const { icon: Icon, className: tone } = glyph[kind];
  const icon = (
    <Icon size={16} weight={kind === 'ok' || kind === 'error' ? 'fill' : 'regular'} className={cn('shrink-0', tone)} aria-hidden />
  );
  if (compact) {
    return (
      <Tooltip content={label}>
        <span role="img" aria-label={label} className={cn('inline-flex items-center', className)}>
          {icon}
        </span>
      </Tooltip>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-dense text-ink', className)}>
      {icon}
      <span>{label}</span>
    </span>
  );
}

export function Spinner({ label, className }: { label: string; className?: string }) {
  return <CircleNotchIcon size={16} className={cn('nb-spin text-ink-3', className)} role="img" aria-label={label} />;
}

type StampTone = 'neutral' | 'redline' | 'construct';

/** A drawing-sheet stamp carrying a real state: read-only, emulator (SPEC-0002 D-17). */
export function Stamp({ children, tone = 'neutral', title }: { children: ReactNode; tone?: StampTone; title?: string }) {
  const stamp = (
    <span
      className={cn(
        'legend inline-flex h-5 items-center rounded-[3px] border px-1.5 leading-none',
        tone === 'redline' && 'border-redline text-redline-ink',
        tone === 'construct' && 'border-construct text-construct-ink',
        tone === 'neutral' && 'border-rule-strong text-ink-2',
      )}
    >
      {children}
    </span>
  );
  return title ? <Tooltip content={title}>{stamp}</Tooltip> : stamp;
}

/** Revision triangle: marks an edited, unsaved field (SPEC-0002 D-17). */
export function RevisionMark({ label = 'Changed' }: { label?: string }) {
  return (
    <Tooltip content={label}>
      <svg width="12" height="11" viewBox="0 0 12 11" role="img" aria-label={label} className="inline-block shrink-0 text-redline">
        <path d="M6 1 L11 10 H1 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </Tooltip>
  );
}
