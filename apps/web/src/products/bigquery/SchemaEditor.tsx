import { PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button, IconButton } from '../../design/Button';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Field, Input, Select } from '../../design/Form';
import { TabNav } from '../../design/TabNav';

const TYPES = [
  'STRING',
  'INT64',
  'FLOAT64',
  'NUMERIC',
  'BIGNUMERIC',
  'BOOL',
  'BYTES',
  'DATE',
  'DATETIME',
  'TIME',
  'TIMESTAMP',
  'GEOGRAPHY',
  'JSON',
] as const;
const MODES = ['NULLABLE', 'REQUIRED', 'REPEATED'] as const;

export interface SchemaRow {
  name: string;
  type: string;
  mode: string;
}

/** Field rows from schema JSON, or null when the JSON has nested fields or does not parse. */
export function rowsFromJson(json: string): SchemaRow[] | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    const fields = Array.isArray(parsed) ? parsed : (parsed as { fields?: unknown })?.fields;
    if (!Array.isArray(fields)) return null;
    const rows: SchemaRow[] = [];
    for (const f of fields as Record<string, unknown>[]) {
      if (f.fields || f.type === 'RECORD' || f.type === 'STRUCT') return null;
      rows.push({ name: String(f.name ?? ''), type: String(f.type ?? 'STRING'), mode: String(f.mode ?? 'NULLABLE') });
    }
    return rows;
  } catch {
    return null;
  }
}

export function jsonFromRows(rows: SchemaRow[]): string {
  return JSON.stringify(
    rows.map((r) => (r.mode === 'NULLABLE' ? { name: r.name, type: r.type } : r)),
    null,
    2,
  );
}

/**
 * A table schema as field rows, with the JSON view for nested fields (SPEC-0008 D-01). The JSON
 * is the value either way.
 */
export function SchemaEditor({ value, onChange }: { value: string; onChange: (json: string) => void }) {
  const [view, setView] = useState<'fields' | 'json'>(() => (rowsFromJson(value) ? 'fields' : 'json'));
  const rows = rowsFromJson(value);
  const set = (next: SchemaRow[]) => onChange(jsonFromRows(next));
  return (
    <div className="flex flex-col gap-3">
      <TabNav
        label="Schema view"
        active={view}
        onSelect={(k) => setView(k as 'fields' | 'json')}
        items={[
          { key: 'fields', label: 'Fields' },
          { key: 'json', label: 'JSON' },
        ]}
      />
      {view === 'json' ? (
        <CodeEditor value={value} onChange={onChange} language="json" height={260} label="Table schema as JSON" />
      ) : rows === null ? (
        <p className="m-0 text-dense text-ink-2">This schema has nested fields or is not valid JSON; edit it in the JSON view.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={`field-${i.toString()}`} className="flex flex-wrap items-end gap-2">
              <Field label="Name" className="min-w-40 flex-1">
                <Input value={r.name} onChange={(e) => set(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} mono />
              </Field>
              <Field label="Type" className="w-40">
                <Select<string>
                  value={r.type}
                  onValueChange={(type) => set(rows.map((x, j) => (j === i ? { ...x, type } : x)))}
                  options={TYPES.map((t) => ({ value: t, label: t }))}
                />
              </Field>
              <Field label="Mode" className="w-36">
                <Select<string>
                  value={r.mode}
                  onValueChange={(mode) => set(rows.map((x, j) => (j === i ? { ...x, mode } : x)))}
                  options={MODES.map((m) => ({ value: m, label: m.toLowerCase() }))}
                />
              </Field>
              <IconButton icon={TrashIcon} label={`Remove field ${r.name || i + 1}`} onClick={() => set(rows.filter((_, j) => j !== i))} />
            </div>
          ))}
          <span>
            <Button size="sm" icon={PlusIcon} onClick={() => set([...rows, { name: '', type: 'STRING', mode: 'NULLABLE' }])}>
              Add field
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
