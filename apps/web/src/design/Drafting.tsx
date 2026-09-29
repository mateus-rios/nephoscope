import { InfoIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { StatusGlyph, type StatusKind } from './Status';

/** The drafting lettering of title blocks and table headers (SPEC-0002 D-06). */
export function Legend({
  children,
  className,
  as: Tag = 'span',
}: {
  children: ReactNode;
  className?: string;
  as?: 'span' | 'div' | 'dt' | 'th' | 'h2' | 'p';
}) {
  return <Tag className={cn('legend', className)}>{children}</Tag>;
}

export interface TitleCell {
  label: string;
  value: ReactNode;
  mono?: boolean;
  /** Wider cells for long values. */
  wide?: boolean;
}

interface TitleBlockProps {
  title: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  cells?: TitleCell[];
  /** A short line under the title. */
  subtitle?: ReactNode;
}

/**
 * The title block of a sheet: what this is, under which facts (SPEC-0002 D-17). Cells are divided
 * by hairlines like a drawing's title block; one level only, never nested.
 */
export function TitleBlock({ title, status, actions, cells, subtitle }: TitleBlockProps) {
  return (
    <header className="border-b border-rule">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-6 pt-5 pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="m-0 text-page font-semibold tracking-[-0.01em] text-ink">{title}</h1>
            {status}
          </div>
          {subtitle ? <p className="mt-1 mb-0 max-w-[75ch] text-dense text-ink-2">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {cells && cells.length > 0 ? (
        <dl className="m-0 flex flex-wrap border-t border-rule">
          {cells.map((c) => (
            <div
              key={c.label}
              className={cn(
                'flex min-w-0 flex-col gap-0.5 border-r border-b border-rule px-6 py-2 last:border-r-0',
                c.wide ? 'min-w-64 flex-[2_1_16rem]' : 'flex-[1_1_9rem]',
              )}
            >
              <dt className="legend">{c.label}</dt>
              <dd className={cn('m-0 truncate text-dense text-ink', c.mono && 'font-mono text-[12px]')}>{c.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}

interface SectionProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
}

/** Dense inside a block, generous between blocks; never boxed (SPEC-0002 D-21). */
export function Section({ title, actions, children, className, description }: SectionProps) {
  return (
    <section className={cn('mt-9 first:mt-6', className)} aria-label={title}>
      <div className="mb-2 flex items-end justify-between gap-4 border-b border-rule px-6 pb-2">
        <div>
          <h2 className="m-0 text-section font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 mb-0 text-meta text-ink-3">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export interface Note {
  id: string;
  tone: Extract<StatusKind, 'ok' | 'warn' | 'error' | 'unknown'> | 'info';
  text: ReactNode;
  action?: ReactNode;
}

/**
 * General notes: numbered conditions of the sheet, in place of colored alert banners
 * (SPEC-0002 D-12, D-17).
 */
export function Notes({ notes, title = 'Notes' }: { notes: Note[]; title?: string }) {
  if (notes.length === 0) return null;
  return (
    <aside aria-label={title} className="border-b border-rule px-6 py-3">
      <Legend as="p" className="mt-0 mb-1.5">
        {title}
      </Legend>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {notes.map((n, i) => (
          <li key={n.id} className="grid grid-cols-[1.5rem_auto_1fr_auto] items-start gap-x-2 text-dense text-ink">
            <span className="tnum pt-px text-right font-mono text-[12px] text-ink-3">{i + 1}.</span>
            <span className="pt-px">
              {n.tone === 'info' ? (
                <span className="inline-flex text-ink-2" title="Note">
                  <InfoIcon size={16} aria-hidden />
                  <span className="sr-only">Note</span>
                </span>
              ) : (
                <StatusGlyph
                  kind={n.tone}
                  label={n.tone === 'error' ? 'Problem' : n.tone === 'warn' ? 'Warning' : n.tone === 'ok' ? 'OK' : 'Unknown'}
                  compact
                />
              )}
            </span>
            <span className="min-w-0">{n.text}</span>
            {n.action ? <span className="flex items-center">{n.action}</span> : <span />}
          </li>
        ))}
      </ol>
    </aside>
  );
}
