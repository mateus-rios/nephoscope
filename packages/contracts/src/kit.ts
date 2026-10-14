import { z } from 'zod';
import type { MetricPresetKind } from './observability.js';

/**
 * The descriptor-driven resource kit (SPEC-0001 D-16, D-30): list, detail, raw JSON, logs and
 * simple lifecycle actions for the products that need no bespoke page. The display part lives
 * here; how each collection is read from Google lives in the API (`modules/kit/sources.ts`).
 */

export const kitValueKinds = [
  'text',
  'mono',
  'short',
  'time',
  'expiry',
  'state',
  'bytes',
  'number',
  'labels',
  'bool',
  'list',
  'count',
] as const;
export type KitValueKind = (typeof kitValueKinds)[number];

export interface KitColumn {
  id: string;
  header: string;
  /** Path in the item's REST JSON: `a.b`, `a[0].b`, `a[].b` (every element), `#a` (array length). */
  path: string;
  kind?: KitValueKind;
  width?: string;
  defaultHidden?: boolean;
}

/** `password` values are write-only: never prefilled, shown or echoed into a command. */
export const kitFieldKinds = ['int', 'number', 'text', 'password', 'enum', 'bool'] as const;
export type KitFieldKind = (typeof kitFieldKinds)[number];

export interface KitField {
  id: string;
  label: string;
  kind: KitFieldKind;
  required?: boolean;
  min?: number;
  max?: number;
  /** Regular expression a text value must match. Required for values placed in a URL path. */
  pattern?: string;
  options?: { value: string; label: string }[];
  help?: string;
  /** Path of the item value used as the initial value. */
  from?: string;
  /** Initial value when the item has none. */
  initial?: string | number | boolean;
}

export interface KitAction {
  id: string;
  /** Verb and object, such as "Fail over instance" (SPEC-0002 D-12). */
  label: string;
  /** One sentence on the effect, shown before running. */
  consequence: string;
  danger?: boolean;
  /** Typed confirmation of the short name (SPEC-0001 D-13). */
  confirm?: boolean;
  fields?: KitField[];
  /** Shown only when the item's value at `path` is (or is not) one of the values. */
  when?: { path: string; in?: string[]; notIn?: string[] };
  /** Equivalent gcloud command; `{id}`, `{location}`, `{project}` and `{$field}` are filled in. */
  gcloud?: string;
  /** Collection actions (create) take no item. */
  scope?: 'item' | 'collection';
}

export interface KitState {
  path: string;
  ok?: string[];
  warn?: string[];
  error?: string[];
  running?: string[];
  paused?: string[];
  pending?: string[];
}

export interface KitExtra {
  id: string;
  label: string;
  /** How the sub-resource is shown: code text (from `key`, lines joined), JSON, or a base64 PNG. */
  render: 'sql' | 'text' | 'json' | 'image';
  /** Shown only when the item's value at `path` is (or is not) one of the values. */
  when?: { path: string; in?: string[]; notIn?: string[] };
  /** Read by a custom tab rather than shown as a tab of its own. */
  hidden?: boolean;
}

/** A tab with its own component in the web app, for what descriptors cannot say. */
export interface KitCustomTab {
  id: string;
  label: string;
}

export interface KitCollection {
  /** `product/collection`, such as `spanner/instances`. */
  key: string;
  product: string;
  label: string;
  singular: string;
  /** What the resource is, for the empty state. */
  description: string;
  /**
   * Regular expression for the item path: the resource name without `projects/{project}/`, or the
   * Compute self link after the project. Anchored; segments are restricted so a path cannot reach
   * another API path.
   */
  pathPattern: string;
  /** Item field shown as its name; defaults to the last path segment. */
  titlePath?: string;
  columns: KitColumn[];
  /** Facts on the detail page; defaults to the columns. */
  facts?: KitColumn[];
  state?: KitState;
  /** Child collection keys shown as tabs of an item. */
  children?: string[];
  /** Extra sub-resources of an item, shown as tabs. */
  extras?: KitExtra[];
  /** Tabs drawn by a component of the web app, keyed by id (`products/kit/tabs.tsx`). */
  customTabs?: KitCustomTab[];
  /** Metrics tab: a preset of SPEC-0005 D-07 and its resource labels, filled by `fillKitTemplate`. */
  metrics?: { kind: MetricPresetKind; labels: Record<string, string> };
  /** Rows open the item pages of this collection instead, when they name the same resources. */
  linkTo?: string;
  /**
   * Logs tab filter, filled in by `fillKitTemplate` from the item. Values are quoted by the
   * filter author.
   */
  logFilter?: string;
  actions?: KitAction[];
  /** Lists across regions one call per region; the page offers a region choice. */
  regional?: boolean;
}

/** One listed item: the REST JSON plus where it lives. */
export interface KitItem {
  /** Item path, see KitCollection.pathPattern. */
  _path: string;
  _location: string;
  [field: string]: unknown;
}

export const KitPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[A-Za-z0-9._~@:%=+-]+(\/[A-Za-z0-9._~@:%=+-]+)*$/, 'Invalid resource path')
  .refine((p) => !p.split('/').some((s) => s === '.' || s === '..'), 'Invalid resource path');

export const KitActionBodySchema = z.object({
  path: KitPathSchema.optional(),
  /** Collection actions of a child collection name the parent item. */
  parent: KitPathSchema.optional(),
  confirm: z.string().max(1024).optional(),
  values: z.record(z.string().max(64), z.union([z.string().max(4096), z.number(), z.boolean()])).default({}),
});
export type KitActionBody = z.infer<typeof KitActionBodySchema>;

export const KitListQuerySchema = z.object({
  /** Child lists name their parent's path. */
  parent: KitPathSchema.optional(),
  /** Regional collections: one region, or all (default). */
  region: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64)
    .optional(),
  pageToken: z.string().max(4096).optional(),
});
export type KitListQuery = z.infer<typeof KitListQuerySchema>;

/** Reads a value by kit path; `[]` maps over arrays and `#path` counts an array. */
export function readPath(obj: unknown, path: string): unknown {
  if (path.startsWith('#')) {
    const v = readPath(obj, path.slice(1));
    return Array.isArray(v) ? v.length : v === undefined || v === null ? 0 : null;
  }
  const parts = path.split('.').filter(Boolean);
  let cur: unknown[] = [obj];
  let mapped = false;
  for (const raw of parts) {
    const m = /^([^[\]]+)(\[(\d*)\])?$/.exec(raw);
    if (!m) return undefined;
    const key = m[1] as string;
    const next: unknown[] = [];
    for (const c of cur) {
      if (c === null || typeof c !== 'object') continue;
      let v = (c as Record<string, unknown>)[key];
      if (m[2] !== undefined) {
        if (!Array.isArray(v)) continue;
        if (m[3] === '') {
          mapped = true;
          next.push(...v);
          continue;
        }
        v = v[Number(m[3])];
      }
      if (v !== undefined) next.push(v);
    }
    cur = next;
  }
  return mapped ? cur : cur[0];
}

/** Whether an item meets a `when` condition of an action or extra; values compare as strings. */
export function kitWhen(cond: { path: string; in?: string[]; notIn?: string[] } | undefined, item: unknown): boolean {
  if (!cond) return true;
  const v = String(readPath(item, cond.path) ?? '');
  if (cond.in && !cond.in.includes(v)) return false;
  return !cond.notIn?.includes(v);
}

/** Fills `{project}`, `{id}`, `{location}`, `{seg:N}` (path segment), `{field:path}` and `{$field}` in a kit template. */
export function fillKitTemplate(
  template: string,
  ctx: { project: string; item: KitItem | null; values?: Record<string, unknown> },
): string {
  return template.replace(/\{(\$?[a-zA-Z]+)(?::([^}]+))?\}/g, (whole, name: string, arg?: string) => {
    if (name === 'project') return ctx.project;
    if (name === 'id') return ctx.item?._path.split('/').pop() ?? '';
    if (name === 'location') return ctx.item?._location ?? '';
    if (name === 'seg' && arg) return ctx.item?._path.split('/')[Number(arg)] ?? '';
    if (name === 'field' && arg) {
      const v = readPath(ctx.item, arg);
      return v === undefined || v === null ? '' : String(v);
    }
    if (name.startsWith('$')) {
      const v = ctx.values?.[name.slice(1)];
      return v === undefined || v === null ? '' : String(v);
    }
    return whole;
  });
}

/**
 * Checks action values against their fields; returns the typed values or the problems. The API
 * checks again before calling Google, so a value placed in a URL always matches its pattern.
 */
export function validateKitValues(
  fields: readonly KitField[],
  values: Record<string, unknown>,
): { ok: true; values: Record<string, string | number | boolean> } | { ok: false; errors: { path: string; message: string }[] } {
  const out: Record<string, string | number | boolean> = {};
  const errors: { path: string; message: string }[] = [];
  for (const f of fields) {
    const raw = values[f.id];
    const empty = raw === undefined || raw === null || raw === '';
    if (empty) {
      if (f.required) errors.push({ path: f.id, message: `${f.label} is required.` });
      continue;
    }
    switch (f.kind) {
      case 'int':
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
        if (!Number.isFinite(n) || (f.kind === 'int' && !Number.isInteger(n))) {
          errors.push({ path: f.id, message: `${f.label} must be ${f.kind === 'int' ? 'a whole number' : 'a number'}.` });
        } else if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
          errors.push({ path: f.id, message: `${f.label} must be between ${f.min ?? '-∞'} and ${f.max ?? '∞'}.` });
        } else out[f.id] = n;
        break;
      }
      case 'bool':
        out[f.id] = raw === true || raw === 'true';
        break;
      case 'enum':
        if (!f.options?.some((o) => o.value === String(raw))) errors.push({ path: f.id, message: `${f.label} has an unknown value.` });
        else out[f.id] = String(raw);
        break;
      case 'text':
      case 'password': {
        // Passwords keep their spaces: they are what the user typed.
        const s = f.kind === 'password' ? String(raw) : String(raw).trim();
        if (f.pattern && !new RegExp(f.pattern).test(s)) errors.push({ path: f.id, message: `${f.label} is not in the expected format.` });
        else out[f.id] = s;
        break;
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, values: out };
}
