import type { EnvVar } from '@nephoscope/contracts';
import { KeyIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useRef } from 'react';
import { Button, IconButton } from '../design/Button';
import { Legend } from '../design/Drafting';
import { Input } from '../design/Form';
import { Tooltip } from '../design/Tooltip';

interface Row {
  name: string;
  value: string;
  secret?: { secret: string; version: string } | null;
}

interface KeyValueEditorProps<R extends Row> {
  label: string;
  rows: R[];
  onChange: (rows: R[]) => void;
  keyLabel?: string;
  valueLabel?: string;
  /** Env vars may point at Secret Manager instead of holding a value (SPEC-0003 D-02). */
  allowSecrets?: boolean;
  keyPattern?: RegExp;
  keyHint?: string;
}

/**
 * Editable name and value pairs. Pasting `NAME=value` lines into a name field adds them all, the
 * way people copy environment files.
 */
export function KeyValueEditor<R extends Row>({
  label,
  rows,
  onChange,
  keyLabel = 'Name',
  valueLabel = 'Value',
  allowSecrets,
  keyPattern,
  keyHint,
}: KeyValueEditorProps<R>) {
  // Stable keys for rows the parent holds as plain values; they follow removals and pastes below.
  const keys = useRef<number[]>([]);
  const nextKey = useRef(0);
  while (keys.current.length < rows.length) keys.current.push(nextKey.current++);
  keys.current.length = rows.length;
  const names = rows.map((r) => r.name.trim());
  const duplicate = (n: string) => n !== '' && names.filter((x) => x === n).length > 1;
  const update = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1 text-dense font-medium text-ink">{label}</legend>
      {rows.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-x-2 gap-y-1.5">
          <Legend>{keyLabel}</Legend>
          <Legend>{valueLabel}</Legend>
          <span />
          {rows.map((r, i) => {
            const invalid = r.name !== '' && keyPattern && !keyPattern.test(r.name);
            const dup = duplicate(r.name.trim());
            return (
              <div key={keys.current[i]} className="contents">
                <div className="flex flex-col gap-0.5">
                  <Input
                    mono
                    value={r.name}
                    aria-label={`${keyLabel} ${i + 1}`}
                    aria-invalid={invalid || dup || undefined}
                    onChange={(e) => update(i, { name: e.target.value })}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData('text');
                      if (!text.includes('\n') && !/^[^=\s]+=/.test(text)) return;
                      e.preventDefault();
                      const parsed = text
                        .split(/\r?\n/)
                        .map((l) => l.trim())
                        .filter((l) => l && !l.startsWith('#') && l.includes('='))
                        .map((l) => {
                          const at = l.indexOf('=');
                          return {
                            name: l
                              .slice(0, at)
                              .replace(/^export\s+/, '')
                              .trim(),
                            value: l.slice(at + 1).replace(/^["']|["']$/g, ''),
                            secret: null,
                          } as R;
                        });
                      keys.current.splice(i, 1, ...parsed.map(() => nextKey.current++));
                      onChange([...rows.slice(0, i), ...parsed, ...rows.slice(i + 1)]);
                    }}
                  />
                  {invalid ? <span className="text-meta text-redline-ink">{keyHint ?? 'Invalid name'}</span> : null}
                  {dup ? <span className="text-meta text-redline-ink">Used twice</span> : null}
                </div>
                {r.secret ? (
                  <div className="grid grid-cols-[1fr_6rem] gap-1.5">
                    <Input
                      mono
                      value={r.secret.secret}
                      aria-label={`Secret for ${r.name || `row ${i + 1}`}`}
                      placeholder="secret-name"
                      onChange={(e) => update(i, { secret: { ...(r.secret as NonNullable<Row['secret']>), secret: e.target.value } })}
                    />
                    <Input
                      mono
                      value={r.secret.version}
                      aria-label={`Secret version for ${r.name || `row ${i + 1}`}`}
                      placeholder="latest"
                      onChange={(e) => update(i, { secret: { ...(r.secret as NonNullable<Row['secret']>), version: e.target.value } })}
                    />
                  </div>
                ) : (
                  <Input
                    mono
                    value={r.value}
                    aria-label={`${valueLabel} ${i + 1}`}
                    onChange={(e) => update(i, { value: e.target.value })}
                  />
                )}
                <span className="flex items-start gap-0.5">
                  {allowSecrets ? (
                    <Tooltip content={r.secret ? 'Use a plain value' : 'Reference a Secret Manager secret'}>
                      <IconButton
                        icon={KeyIcon}
                        label={r.secret ? 'Use a plain value' : 'Reference a secret'}
                        active={!!r.secret}
                        tooltip={false}
                        onClick={() =>
                          update(i, r.secret ? { secret: null, value: '' } : { secret: { secret: '', version: 'latest' }, value: '' })
                        }
                      />
                    </Tooltip>
                  ) : null}
                  <IconButton
                    icon={TrashIcon}
                    label={`Remove ${r.name || `row ${i + 1}`}`}
                    onClick={() => {
                      keys.current.splice(i, 1);
                      onChange(rows.filter((_, j) => j !== i));
                    }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="m-0 text-meta text-ink-3">None.</p>
      )}
      <div>
        <Button size="sm" variant="ghost" icon={PlusIcon} onClick={() => onChange([...rows, { name: '', value: '', secret: null } as R])}>
          Add {keyLabel.toLowerCase()}
        </Button>
      </div>
    </fieldset>
  );
}

export function envRowsFrom(env: EnvVar[]): Row[] {
  return env.map((e) => ({ name: e.name, value: e.value ?? '', secret: e.secret }));
}

export function envFromRows(rows: Row[]): EnvVar[] {
  return rows
    .filter((r) => r.name.trim() !== '')
    .map((r) =>
      r.secret ? { name: r.name.trim(), value: null, secret: r.secret } : { name: r.name.trim(), value: r.value, secret: null },
    );
}

export function labelRowsFrom(labels: Record<string, string>): Row[] {
  return Object.entries(labels).map(([name, value]) => ({ name, value }));
}

export function labelsFromRows(rows: Row[]): Record<string, string> {
  return Object.fromEntries(rows.filter((r) => r.name.trim() !== '').map((r) => [r.name.trim(), r.value]));
}

export const LABEL_KEY = /^[a-z][a-z0-9_-]{0,62}$/;
export const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
