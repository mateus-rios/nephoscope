import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** First tooltip waits 500 ms; others open at once for 300 ms after one closes (SPEC-0002 CA-14). */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider delay={500} closeDelay={0} timeout={300}>
      {children}
    </BaseTooltip.Provider>
  );
}

interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Mono content, for ids and paths. */
  mono?: boolean;
  disabled?: boolean;
}

export function Tooltip({ content, children, side = 'top', mono, disabled }: TooltipProps) {
  if (disabled || content === null || content === undefined || content === '') return children;
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-50">
          <BaseTooltip.Popup
            className={cn(
              'nb-tooltip max-w-80 rounded-control border border-rule-strong bg-ink px-2 py-1 text-meta text-ink-inverse shadow-overlay',
              mono && 'font-mono text-[11px] break-all',
            )}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
