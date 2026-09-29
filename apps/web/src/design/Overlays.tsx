import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { XIcon } from '@phosphor-icons/react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { IconButton } from './Button';
import { ViewScope } from './ViewScope';

/* ------------------------------------------------------------------ Menu */

interface MenuProps {
  trigger: ReactElement;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

/** Menus scale from their trigger in 150 ms and leave in 100 ms (SPEC-0002 CA-13). */
export function Menu({ trigger, children, align = 'start', side = 'bottom', className }: MenuProps) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner side={side} align={align} sideOffset={4} className="z-50 outline-none">
          <BaseMenu.Popup
            className={cn(
              'nb-popup min-w-48 rounded-menu border border-rule-strong bg-sheet p-1 text-dense shadow-overlay outline-none',
              className,
            )}
          >
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<typeof BaseMenu.Item>) {
  return (
    <BaseMenu.Item
      className={cn(
        'flex h-8 cursor-default items-center gap-2 rounded-control px-2 text-ink outline-none select-none data-[highlighted]:bg-hover data-[disabled]:text-ink-3',
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="my-1 h-px bg-rule" />;
}

export function MenuGroupLabel({ children }: { children: ReactNode }) {
  return <BaseMenu.GroupLabel className="legend px-2 pt-2 pb-1">{children}</BaseMenu.GroupLabel>;
}

export const MenuGroup = BaseMenu.Group;
export const MenuRadioGroup = BaseMenu.RadioGroup;

export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof BaseMenu.RadioItem>) {
  return (
    <BaseMenu.RadioItem
      className={cn(
        'grid h-8 cursor-default grid-cols-[16px_1fr] items-center gap-2 rounded-control px-2 text-ink outline-none select-none data-[highlighted]:bg-hover',
        className,
      )}
      {...props}
    >
      <BaseMenu.RadioItemIndicator className="col-start-1 size-1.5 rounded-pill bg-ink" keepMounted={false} />
      <span className="col-start-2">{children as ReactNode}</span>
    </BaseMenu.RadioItem>
  );
}

/* --------------------------------------------------------------- Popover */

interface PopoverProps {
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  /** Accessible name when the popover has no visible title. */
  label?: string;
}

export function Popover({ trigger, children, open, onOpenChange, align = 'start', side = 'bottom', className, label }: PopoverProps) {
  return (
    <BasePopover.Root open={open} onOpenChange={(o) => onOpenChange?.(o)}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner side={side} align={align} sideOffset={4} className="z-50 outline-none">
          <BasePopover.Popup
            aria-label={label}
            className={cn('nb-popup rounded-menu border border-rule-strong bg-sheet text-dense shadow-overlay outline-none', className)}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

/* ---------------------------------------------------------------- Dialog */

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
}

/** Centered, focus-trapped, closes on Escape, returns focus (SPEC-0002 CA-15). Its own view (D-18). */
export function Dialog({ open, onOpenChange, title, description, children, footer, width = 'md' }: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="nb-backdrop fixed inset-0 z-40 bg-overlay" />
        <BaseDialog.Popup
          className={cn(
            'nb-dialog fixed top-[18vh] left-1/2 z-50 -translate-x-1/2 rounded-dialog border border-rule-strong bg-sheet shadow-overlay outline-none',
            'w-[calc(100vw-32px)]',
            width === 'sm'
              ? 'max-w-[420px]'
              : width === 'lg'
                ? 'max-w-[720px]'
                : width === 'xl'
                  ? 'max-w-[min(1200px,94vw)]'
                  : 'max-w-[540px]',
          )}
        >
          <ViewScope name={title}>
            <div className="flex items-start justify-between gap-4 border-b border-rule px-5 pt-4 pb-3">
              <div className="min-w-0">
                <BaseDialog.Title className="m-0 text-section font-semibold text-ink">{title}</BaseDialog.Title>
                {description ? (
                  <BaseDialog.Description className="mt-1 mb-0 text-dense text-ink-2">{description}</BaseDialog.Description>
                ) : null}
              </div>
              <BaseDialog.Close render={<IconButton icon={XIcon} label="Close" size="sm" tooltip={false} />} />
            </div>
            {children ? <div className="px-5 py-4">{children}</div> : null}
            {footer ? <div className="flex justify-end gap-2 border-t border-rule px-5 py-3">{footer}</div> : null}
          </ViewScope>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/* ----------------------------------------------------------------- Sheet */

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Side panel from the right, 250 ms on the drawer curve, 200 ms out (SPEC-0002 CA-16). */
export function Sheet({ open, onOpenChange, title, description, children, footer }: SheetProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="nb-backdrop fixed inset-0 z-40 bg-overlay" />
        <BaseDialog.Popup className="nb-sheet fixed inset-y-0 right-0 z-50 flex w-[min(560px,100vw)] flex-col border-l border-rule-strong bg-sheet shadow-overlay outline-none">
          <ViewScope name={title}>
            <div className="flex items-start justify-between gap-4 border-b border-rule px-5 pt-4 pb-3">
              <div className="min-w-0">
                <BaseDialog.Title className="m-0 text-section font-semibold text-ink">{title}</BaseDialog.Title>
                {description ? (
                  <BaseDialog.Description className="mt-1 mb-0 text-dense text-ink-2">{description}</BaseDialog.Description>
                ) : null}
              </div>
              <BaseDialog.Close render={<IconButton icon={XIcon} label="Close" size="sm" tooltip={false} />} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer ? <div className="flex justify-end gap-2 border-t border-rule px-5 py-3">{footer}</div> : null}
          </ViewScope>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
