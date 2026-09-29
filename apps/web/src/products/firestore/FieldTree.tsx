import { previewValue, WIRE_TYPE_LABELS, type WireFields, type WireValue } from '@nephoscope/contracts/firestore-value';
import { CaretDownIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { cn } from '../../lib/cn';

interface FieldTreeProps {
  fields: WireFields;
  documentsRoot: string;
  /** Opens a referenced document (CA-07); other databases open in their own view. */
  onOpenReference?: (name: string) => void;
  label: string;
}

const isContainer = (v: WireValue) => v.t === 'map' || v.t === 'array' || v.t === 'special';

function entries(v: WireValue): [string, WireValue][] {
  if (v.t === 'map' || v.t === 'special') return Object.entries(v.v).sort(([a], [b]) => a.localeCompare(b));
  if (v.t === 'array') return v.v.map((x, i) => [String(i), x]);
  return [];
}

function Row({ name, value, depth, props }: { name: string; value: WireValue; depth: number; props: FieldTreeProps }) {
  const container = isContainer(value);
  const [open, setOpen] = useState(depth < 1);
  const preview = previewValue(value, props.documentsRoot, 200);
  const typeLabel = value.t === 'special' ? value.kind : WIRE_TYPE_LABELS[value.t];
  return (
    <li>
      <div
        className="grid grid-cols-[minmax(8rem,16rem)_minmax(0,1fr)_6rem] items-baseline gap-x-3 border-b border-rule py-1 pr-6 hover:bg-hover"
        style={{ paddingLeft: `${1.5 + depth * 1.25}rem` }}
      >
        <span className="flex min-w-0 items-center gap-1">
          {container ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
              className="inline-flex text-ink-3 hover:text-ink"
            >
              {open ? <CaretDownIcon size={12} aria-hidden /> : <CaretRightIcon size={12} aria-hidden />}
            </button>
          ) : (
            <span className="w-3" />
          )}
          <span className="truncate font-mono text-[12px] text-ink">{name}</span>
        </span>
        <span
          className={cn(
            'min-w-0 font-mono text-[12px]',
            // Strings wrap; timestamps and other scalars stay on one line.
            value.t === 'string' ? 'break-words' : 'truncate whitespace-nowrap',
            value.t === 'string' ? 'text-ink' : 'text-ink-2',
            value.t === 'null' && 'text-ink-3',
          )}
        >
          {value.t === 'reference' && props.onOpenReference ? (
            <button
              type="button"
              className="text-left text-construct-ink underline decoration-rule-strong underline-offset-2 hover:decoration-construct"
              onClick={() => props.onOpenReference?.(value.v)}
            >
              {preview}
            </button>
          ) : value.t === 'string' ? (
            // Data is text, never markup (SPEC-0001 D-22, T-22).
            <span className="whitespace-pre-wrap">{preview}</span>
          ) : container && open ? null : (
            preview
          )}
        </span>
        <span className="text-right font-mono text-[11px] text-ink-3">{typeLabel}</span>
      </div>
      {container && open ? (
        <ul className="m-0 list-none p-0">
          {entries(value).map(([k, v]) => (
            <Row key={k} name={k} value={v} depth={depth + 1} props={props} />
          ))}
          {entries(value).length === 0 ? (
            <li className="border-b border-rule py-1 text-meta text-ink-3" style={{ paddingLeft: `${3 + depth * 1.25}rem` }}>
              {value.t === 'array' ? 'Empty array' : 'Empty map'}
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

/** A document's fields with their exact types (SPEC-0004 D-04). */
export function FieldTree(props: FieldTreeProps) {
  const keys = Object.keys(props.fields).sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) return <p className="m-0 px-6 py-3 text-meta text-ink-3">This document has no fields.</p>;
  return (
    <ul aria-label={props.label} className="m-0 list-none border-t border-rule p-0">
      {keys.map((k) => (
        <Row key={k} name={k} value={props.fields[k] as WireValue} depth={0} props={props} />
      ))}
    </ul>
  );
}
