import { CircleNotchIcon, type Icon } from '@phosphor-icons/react';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Tooltip } from './Tooltip';
import { useCommitRegistration } from './ViewScope';

const button = cva(
  'press inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-control border font-medium select-none transition-[background-color,border-color,color] duration-150 ease-out disabled:cursor-not-allowed data-[disabled]:cursor-not-allowed',
  {
    variants: {
      variant: {
        /** The one action that commits, once per view (SPEC-0002 D-18). */
        commit:
          'border-commit bg-commit text-commit-ink disabled:border-rule disabled:bg-well disabled:text-ink-3 hover:enabled:border-commit-hover hover:enabled:bg-commit-hover',
        /** A commit that destroys, in redline. */
        danger:
          'border-redline bg-redline text-commit-ink disabled:border-rule disabled:bg-well disabled:text-ink-3 hover:enabled:border-redline-hover hover:enabled:bg-redline-hover',
        secondary: 'border-rule-strong bg-sheet text-ink disabled:text-ink-3 hover:enabled:border-ink-3 hover:enabled:bg-hover',
        ghost: 'border-transparent bg-transparent text-ink-2 disabled:text-ink-3 hover:enabled:bg-hover hover:enabled:text-ink',
      },
      size: {
        sm: 'h-(--control-h-sm) px-2 text-meta',
        md: 'h-(--control-h) px-3 text-dense',
        lg: 'h-(--control-h-lg) px-4 text-body',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

/** Button styling for a link that navigates; a button nested in a link is invalid HTML. */
export function buttonClass(options: VariantProps<typeof button> = {}, className?: string): string {
  return cn(button(options), 'no-underline', className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  icon?: Icon;
  loading?: boolean;
  /** Shown as a tooltip when the button is disabled for a known reason (SPEC-0002 CA-10). */
  disabledReason?: string | null;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon: IconComponent, loading, disabledReason, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  const isCommit = variant === 'commit' || variant === 'danger';
  useCommitRegistration(isCommit, typeof children === 'string' ? children : 'commit');
  const isDisabled = disabled || loading;
  const iconSize = size === 'lg' ? 18 : 16;
  const content = (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(button({ variant, size }), className)}
      {...rest}
    >
      {loading ? (
        <CircleNotchIcon size={iconSize} className="nb-spin" aria-hidden />
      ) : IconComponent ? (
        <IconComponent size={iconSize} aria-hidden />
      ) : null}
      {children}
    </button>
  );
  if (disabled && disabledReason) {
    // Disabled buttons receive no pointer events; the wrapper carries the tooltip.
    return (
      <Tooltip content={disabledReason}>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: keeps the reason reachable by keyboard while the button is disabled. */}
        <span className="inline-flex" tabIndex={0}>
          {content}
        </span>
      </Tooltip>
    );
  }
  return content;
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: Icon;
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
  tooltip?: boolean;
}

/** Square ghost button with a required accessible name; at least 24 px (SPEC-0002 D-15). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: IconComponent, label, size = 'md', active, tooltip = true, className, type = 'button', ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'press inline-flex shrink-0 items-center justify-center rounded-control text-ink-2 transition-[background-color,color] duration-150 ease-out disabled:text-ink-3 hover:enabled:bg-hover hover:enabled:text-ink',
        size === 'sm' ? 'size-6' : 'size-8',
        active && 'bg-construct-tint text-ink',
        className,
      )}
      {...rest}
    >
      <IconComponent size={size === 'sm' ? 14 : 16} aria-hidden />
    </button>
  );
  return tooltip ? <Tooltip content={label}>{btn}</Tooltip> : btn;
});
