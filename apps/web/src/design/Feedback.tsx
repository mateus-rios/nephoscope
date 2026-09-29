import type { Problem } from '@nephoscope/contracts';
import type { Icon } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { Legend } from './Drafting';
import { StatusGlyph } from './Status';
import { CopyButton } from './Values';

/** Skeletons appear only after 300 ms, shaped like the content, without shimmer (SPEC-0002 CA-21). */
export function DelayedSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(t);
  }, []);
  if (!show) return <div aria-busy="true" className={cn('min-h-24', className)} />;
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className={cn('flex flex-col', className)}>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity and never reorder.
        <div key={i} className="flex h-(--row-h) items-center gap-4 border-b border-rule px-6">
          <span className="h-2.5 w-24 rounded-[2px] bg-well" />
          <span className="h-2.5 rounded-[2px] bg-well" style={{ width: `${30 + ((i * 17) % 35)}%` }} />
          <span className="ml-auto h-2.5 w-16 rounded-[2px] bg-well" />
        </div>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon?: Icon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** One icon at most, a title, one sentence, the primary action (SPEC-0002 CA-22). */
export function EmptyState({ icon: IconComponent, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-start gap-2 px-6 py-10', className)}>
      {IconComponent ? <IconComponent size={24} className="text-ink-3" aria-hidden /> : null}
      <h3 className="m-0 text-section font-semibold text-ink">{title}</h3>
      {children ? <p className="m-0 max-w-[60ch] text-dense text-ink-2">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

interface ProblemStateProps {
  problem: Problem;
  onRetry?: () => void;
  /** Offered for API_DISABLED when the key may enable services (SPEC-0002 CA-23). */
  enableAction?: ReactNode;
  className?: string;
}

/** Renders a problem with the fix it allows (SPEC-0002 CA-23). */
export function ProblemState({ problem, onRetry, enableAction, className }: ProblemStateProps) {
  const serviceName = problem.serviceTitle ?? problem.service;
  return (
    <div role="alert" className={cn('flex flex-col gap-3 px-6 py-8', className)}>
      <div className="flex items-center gap-2">
        <StatusGlyph kind={problem.code === 'API_DISABLED' ? 'warn' : 'error'} label={problem.title} />
      </div>
      <p className="m-0 max-w-[75ch] text-dense text-ink-2">{problem.detail}</p>
      {problem.code === 'API_DISABLED' && serviceName ? (
        <dl className="m-0 grid max-w-xl grid-cols-[8rem_1fr] gap-x-4 gap-y-1">
          <Legend as="dt">API</Legend>
          <dd className="m-0 font-mono text-[12px] text-ink">{problem.service}</dd>
          {problem.consumer ? (
            <>
              <Legend as="dt">Needed in</Legend>
              <dd className="m-0 font-mono text-[12px] text-ink">{problem.consumer}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {problem.permission ? (
        <div className="flex items-center gap-2">
          <Legend>Missing permission</Legend>
          <code className="font-mono text-[12px] text-ink">{problem.permission}</code>
          <CopyButton value={problem.permission} label="Copy permission" />
        </div>
      ) : null}
      {problem.help && problem.help.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-dense">
          {problem.help.map((h) => (
            <li key={h.url}>
              <a href={h.url} target="_blank" rel="noreferrer noopener">
                {h.description || h.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {problem.code === 'API_DISABLED' ? enableAction : null}
        {onRetry && (problem.retryable || problem.code === 'API_DISABLED' || problem.code === 'PERMISSION_DENIED') ? (
          <Button onClick={onRetry}>Try again</Button>
        ) : null}
      </div>
    </div>
  );
}
