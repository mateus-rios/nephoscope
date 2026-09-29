import { Select as BaseSelect } from '@base-ui/react/select';
import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { CaretUpDownIcon, CheckIcon } from '@phosphor-icons/react';
import {
  cloneElement,
  forwardRef,
  type InputHTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { cn } from '../lib/cn';

interface FieldProps {
  label: string;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  /** The control; receives id, aria-describedby and aria-invalid. */
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
  className?: string;
}

/** Label above, help below, error below in place of help (SPEC-0002 CA-11). */
export function Field({ label, help, error, required, children, className }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-describedby': error || help ? helpId : undefined,
        'aria-invalid': error ? true : undefined,
      })
    : children;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-dense font-medium text-ink">
        {label}
        {required ? (
          <span className="ml-1 text-ink-3" aria-hidden>
            required
          </span>
        ) : null}
      </label>
      {control}
      {error ? (
        <p id={helpId} className="m-0 text-meta text-redline-ink">
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="m-0 text-meta text-ink-3">
          {help}
        </p>
      ) : null}
    </div>
  );
}

const controlBase =
  'w-full rounded-control border border-rule-strong bg-sheet px-2.5 text-dense text-ink placeholder:text-ink-3 transition-[border-color] duration-150 ease-out hover:border-ink-3 aria-[invalid=true]:border-redline disabled:cursor-not-allowed disabled:bg-well disabled:text-ink-3';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(function Input(
  { className, mono, ...props },
  ref,
) {
  return <input ref={ref} className={cn(controlBase, 'h-(--control-h)', mono && 'font-mono text-[12px]', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(function Textarea(
  { className, mono, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(controlBase, 'min-h-24 resize-y py-2 leading-5', mono && 'font-mono text-[12px]', className)}
      {...props}
    />
  );
});

export interface SelectOption<V extends string> {
  value: V;
  label: string;
}

interface SelectProps<V extends string> {
  value: V;
  onValueChange: (value: V) => void;
  options: SelectOption<V>[];
  id?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
  disabled?: boolean;
  className?: string;
}

export function Select<V extends string>({ value, onValueChange, options, id, disabled, className, ...aria }: SelectProps<V>) {
  return (
    <BaseSelect.Root
      value={value}
      onValueChange={(v) => {
        if (v !== null) onValueChange(v as V);
      }}
      items={options}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        id={id}
        aria-describedby={aria['aria-describedby']}
        aria-label={aria['aria-label']}
        className={cn(controlBase, 'flex h-(--control-h) items-center justify-between gap-2 text-left', className)}
      >
        <BaseSelect.Value />
        <BaseSelect.Icon className="text-ink-3">
          <CaretUpDownIcon size={14} aria-hidden />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50 outline-none">
          <BaseSelect.Popup className="nb-popup max-h-80 min-w-(--anchor-width) overflow-y-auto rounded-menu border border-rule-strong bg-sheet p-1 text-dense shadow-overlay outline-none">
            <BaseSelect.List>
              {options.map((o) => (
                <BaseSelect.Item
                  key={o.value}
                  value={o.value}
                  className="grid h-8 cursor-default grid-cols-[16px_1fr] items-center gap-2 rounded-control px-2 text-ink outline-none select-none data-[highlighted]:bg-hover"
                >
                  <BaseSelect.ItemIndicator className="col-start-1">
                    <CheckIcon size={14} aria-hidden />
                  </BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText className="col-start-2">{o.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Switch({ checked, onCheckedChange, label, description, disabled }: SwitchProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="text-dense font-medium text-ink">{label}</span>
        {description ? <span className="text-meta text-ink-3">{description}</span> : null}
      </label>
      <BaseSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={(c) => onCheckedChange(c)}
        disabled={disabled}
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill border border-rule-strong bg-well transition-[background-color,border-color] duration-150 ease-out data-[checked]:border-ink data-[checked]:bg-ink data-[disabled]:opacity-60"
      >
        <BaseSwitch.Thumb className="block size-3.5 translate-x-0.5 rounded-pill bg-sheet shadow-overlay transition-transform duration-150 ease-out data-[checked]:translate-x-[17px]" />
      </BaseSwitch.Root>
    </div>
  );
}
