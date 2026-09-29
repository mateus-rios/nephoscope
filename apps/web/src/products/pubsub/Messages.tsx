import type { PubSubMessage } from '@nephoscope/contracts';
import { CaretDownIcon, CaretRightIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Legend } from '../../design/Drafting';
import { Field, Input, Select, Textarea } from '../../design/Form';
import { Dialog } from '../../design/Overlays';
import { Timestamp } from '../../design/Values';
import { EquivalentCommand, sh } from '../../kit/EquivalentCommand';
import { KeyValueEditor, labelRowsFrom } from '../../kit/KeyValueEditor';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { publish } from './api';

/** Messages as text only, never markup (SPEC-0006 CA-09, SPEC-0001 D-22). */

const utf8 = new TextEncoder();
export const toBase64 = (text: string) => {
  let bin = '';
  for (const b of utf8.encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
};
const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const hex = (b64: string) => [...bytesOf(b64).slice(0, 4096)].map((b) => b.toString(16).padStart(2, '0')).join(' ');

function prettyJson(text: string | null): string | null {
  if (text === null) return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

type View = 'text' | 'base64' | 'hex';

function MessageRow({
  m,
  index,
  selectable,
  selected,
  onSelect,
}: {
  m: PubSubMessage;
  index: number;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const json = prettyJson(m.text);
  const [view, setView] = useState<View>(m.text === null ? 'base64' : 'text');
  const size = bytesOf(m.data).length;
  const summary = m.text === null ? `${size} bytes of binary data` : m.text.replace(/\s+/g, ' ').slice(0, 160);
  const attrs = Object.entries(m.attributes);
  return (
    <li className="border-b border-rule">
      <div className="grid grid-cols-[auto_1rem_3rem_minmax(0,1fr)_9rem_6rem] items-center gap-x-2 px-6 py-1.5 text-dense hover:bg-hover">
        {selectable ? (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={(e) => onSelect?.(e.target.checked)}
            aria-label={`Select message ${m.messageId}`}
          />
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Hide message' : 'Show message'}
          className="inline-flex text-ink-3 hover:text-ink"
        >
          {open ? <CaretDownIcon size={12} aria-hidden /> : <CaretRightIcon size={12} aria-hidden />}
        </button>
        <span className="tnum font-mono text-[11px] text-ink-3">{index + 1}.</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn('truncate text-left font-mono text-[12px]', m.text === null ? 'text-ink-2' : 'text-ink')}
        >
          {summary}
          {attrs.length > 0 ? (
            <span className="text-ink-3">
              {' '}
              · {attrs.length} {attrs.length === 1 ? 'attribute' : 'attributes'}
            </span>
          ) : null}
        </button>
        <span className="text-meta text-ink-2">
          <Timestamp iso={m.publishTime} />
        </span>
        <span className="tnum text-right text-meta text-ink-3">{m.deliveryAttempt ? `attempt ${m.deliveryAttempt}` : ''}</span>
      </div>
      {open ? (
        <div className="flex flex-col gap-2 px-6 pt-1 pb-3 pl-16">
          <dl className="m-0 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-meta">
            <dt className="text-ink-3">Message id</dt>
            <dd className="m-0 font-mono text-[12px]">{m.messageId}</dd>
            {m.orderingKey ? (
              <>
                <dt className="text-ink-3">Ordering key</dt>
                <dd className="m-0 font-mono text-[12px]">{m.orderingKey}</dd>
              </>
            ) : null}
            <dt className="text-ink-3">Size</dt>
            <dd className="m-0 tnum">{size.toLocaleString('en-US')} bytes</dd>
            {attrs.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="truncate font-mono text-[12px] text-ink-2">{k}</dt>
                <dd className="m-0 font-mono text-[12px] break-words">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex items-center gap-2">
            <Legend>Data</Legend>
            <Select<View>
              value={view}
              onValueChange={setView}
              aria-label="Show data as"
              options={[
                ...(m.text !== null ? [{ value: 'text' as View, label: json ? 'JSON' : 'Text' }] : []),
                { value: 'base64', label: 'Base64' },
                { value: 'hex', label: 'Hex' },
              ]}
              className="w-28"
            />
          </div>
          <pre className="m-0 max-h-80 overflow-auto rounded-control bg-well p-2 font-mono text-[12px] whitespace-pre-wrap break-words text-ink">
            {view === 'text' ? (json ?? m.text) : view === 'base64' ? m.data : hex(m.data)}
          </pre>
        </div>
      ) : null}
    </li>
  );
}

export function MessageList({
  messages,
  label,
  selection,
  onSelectionChange,
}: {
  messages: PubSubMessage[];
  label: string;
  selection?: ReadonlySet<string>;
  onSelectionChange?: (next: Set<string>) => void;
}) {
  return (
    <ol aria-label={label} className="m-0 list-none border-t border-rule p-0">
      {messages.map((m, i) => (
        <MessageRow
          // biome-ignore lint/suspicious/noArrayIndexKey: a redelivered message appears twice with the same id.
          key={`${m.messageId}:${i}`}
          m={m}
          index={i}
          selectable={!!onSelectionChange}
          selected={selection?.has(m.messageId)}
          onSelect={(on) => {
            const next = new Set(selection);
            if (on) next.add(m.messageId);
            else next.delete(m.messageId);
            onSelectionChange?.(next);
          }}
        />
      ))}
    </ol>
  );
}

// ---- publish -------------------------------------------------------------------------------------

type Mode = 'text' | 'json' | 'base64' | 'file';
type Outgoing = { data: string; attributes: Record<string, string>; orderingKey?: string };

function parseNdjson(text: string): Outgoing[] | string {
  const out: Outgoing[] = [];
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      return `Line ${i + 1} is not JSON.`;
    }
    const o = v as { data?: unknown; attributes?: unknown; orderingKey?: unknown };
    if (!o || typeof o !== 'object') return `Line ${i + 1} is not an object.`;
    const data = typeof o.data === 'string' ? o.data : o.data === undefined ? '' : JSON.stringify(o.data);
    const attributes =
      o.attributes && typeof o.attributes === 'object'
        ? Object.fromEntries(Object.entries(o.attributes).map(([k, x]) => [k, String(x)]))
        : {};
    out.push({
      data: toBase64(data),
      attributes,
      ...(typeof o.orderingKey === 'string' && o.orderingKey ? { orderingKey: o.orderingKey } : {}),
    });
  }
  return out.length > 0 ? out : 'The file has no messages.';
}

/** Publish (D-02, CA-01): one message as text, JSON or base64, or many from an NDJSON file. */
export function PublishDialog({
  projectId,
  topic,
  open,
  onOpenChange,
  readOnly,
}: {
  projectId: string;
  topic: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnly: string | null;
}) {
  const [mode, setMode] = useState<Mode>('text');
  const [data, setData] = useState('');
  const [attrs, setAttrs] = useState(labelRowsFrom({}));
  const [orderingKey, setOrderingKey] = useState('');
  const [file, setFile] = useState<Outgoing[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (open) {
      setData('');
      setAttrs(labelRowsFrom({}));
      setOrderingKey('');
      setFile(null);
      setFileError(null);
    }
  }, [open]);

  let error: string | null = null;
  let payload = '';
  if (mode === 'json') {
    try {
      payload = toBase64(JSON.stringify(JSON.parse(data)));
    } catch (e) {
      error = e instanceof Error ? `Not valid JSON: ${e.message}` : 'Not valid JSON';
    }
  } else if (mode === 'base64') {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data.trim())) error = 'Not valid base64.';
    payload = data.trim();
  } else payload = toBase64(data);
  const attributes = Object.fromEntries(attrs.filter((r) => r.name.trim()).map((r) => [r.name.trim(), r.value]));
  const messages: Outgoing[] = mode === 'file' ? (file ?? []) : [{ data: payload, attributes, ...(orderingKey ? { orderingKey } : {}) }];
  const empty = mode !== 'file' && !payload && Object.keys(attributes).length === 0;

  const send = async (confirm?: string) => {
    setBusy(true);
    try {
      const r = await publish(projectId, topic, { messages, ...(confirm ? { confirm } : {}) });
      toast.success(`Published ${r.messageIds.length} ${r.messageIds.length === 1 ? 'message' : 'messages'}`, {
        description: r.messageIds.length === 1 ? `Message id ${r.messageIds[0]}` : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('Publishing failed', { description: err instanceof ApiError ? err.problem.detail : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={`Publish to ${topic}`}
      width="lg"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PaperPlaneTiltIcon}
            loading={busy}
            disabled={!!readOnly || !!error || empty || (mode === 'file' && !file)}
            disabledReason={readOnly ?? error ?? (empty ? 'A message needs data or an attribute' : null)}
            onClick={() => (messages.length > 100 ? setConfirming(true) : void send())}
          >
            {mode === 'file' && file ? `Publish ${file.length.toLocaleString('en-US')} messages` : 'Publish message'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Data">
          <Select<Mode>
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'text', label: 'Text' },
              { value: 'json', label: 'JSON' },
              { value: 'base64', label: 'Base64' },
              { value: 'file', label: 'Many, from an NDJSON file' },
            ]}
          />
        </Field>
        {mode === 'file' ? (
          <div className="flex flex-col gap-1">
            <label className="text-dense">
              <span className="sr-only">NDJSON file</span>
              <input
                type="file"
                accept=".ndjson,.jsonl,.json,application/x-ndjson"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const r = parseNdjson(await f.text());
                  if (typeof r === 'string') {
                    setFile(null);
                    setFileError(r);
                  } else {
                    setFile(r);
                    setFileError(null);
                  }
                }}
              />
            </label>
            <p className="m-0 text-meta text-ink-3">
              One message per line: {'{"data": "…", "attributes": {"k": "v"}, "orderingKey": "…"}'}. Data may be a string or any JSON value.
            </p>
            {fileError ? <p className="m-0 text-meta text-redline-ink">{fileError}</p> : null}
            {file ? <p className="m-0 text-meta text-ink-2">{file.length.toLocaleString('en-US')} messages ready.</p> : null}
          </div>
        ) : (
          <>
            <Field
              label={mode === 'base64' ? 'Base64 payload' : mode === 'json' ? 'JSON payload' : 'Text payload'}
              error={error ?? undefined}
            >
              <Textarea mono rows={6} value={data} onChange={(e) => setData(e.target.value)} />
            </Field>
            <KeyValueEditor label="Attributes" rows={attrs} onChange={setAttrs} keyLabel="Attribute" />
            <Field label="Ordering key" help="Only for subscriptions with message ordering.">
              <Input mono value={orderingKey} onChange={(e) => setOrderingKey(e.target.value)} />
            </Field>
            <EquivalentCommand
              gcloud={`gcloud pubsub topics publish ${topic} --message=${sh(mode === 'base64' ? '<base64 payload>' : data || 'MESSAGE')}${
                Object.keys(attributes).length
                  ? ` --attribute=${sh(
                      Object.entries(attributes)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(','),
                    )}`
                  : ''
              }${orderingKey ? ` --ordering-key=${sh(orderingKey)}` : ''} --project=${projectId}`}
            />
          </>
        )}
      </div>
      <ConfirmDestructive
        open={confirming}
        onOpenChange={setConfirming}
        title="Publish many messages"
        consequence={`${messages.length.toLocaleString('en-US')} messages are published to ${topic}, and every subscription receives them.`}
        expected={String(messages.length)}
        confirmLabel="Publish them"
        onConfirm={async (confirm) => {
          setConfirming(false);
          await send(confirm);
        }}
      />
    </Dialog>
  );
}
