import { z } from 'zod';

/** The raw API console: any method a discovery document describes (SPEC-0009 D-01). */

/** APIs whose request bodies can carry secret material; their bodies are not kept in the history. */
export const RAW_SECRET_APIS: readonly string[] = ['secretmanager', 'iamcredentials', 'sts', 'cloudkms', 'oauth2'];
export const RAW_HISTORY_LIMIT = 50;

export interface RawApiEntry {
  /** `name:version`, as the directory names it. */
  id: string;
  name: string;
  version: string;
  title: string;
  description: string;
  preferred: boolean;
}

export interface RawMethodSummary {
  id: string;
  httpMethod: string;
  path: string;
  description: string;
}

export interface RawResourceNode {
  name: string;
  methods: RawMethodSummary[];
  resources: RawResourceNode[];
}

export interface RawApiTree {
  name: string;
  version: string;
  title: string;
  baseUrl: string;
  methods: RawMethodSummary[];
  resources: RawResourceNode[];
}

export interface RawParam {
  name: string;
  location: 'path' | 'query';
  type: string;
  required: boolean;
  repeated: boolean;
  description: string;
  pattern: string | null;
  enum: string[];
}

export interface RawMethodDetail extends RawMethodSummary {
  baseUrl: string;
  parameters: RawParam[];
  /** JSON Schema of the request body, generated from the discovery schemas; null when there is no body. */
  requestSchema: unknown | null;
  requestRef: string | null;
  responseRef: string | null;
  scopes: string[];
}

const ID = /^[a-z][a-z0-9_.]{0,200}$/;
export const RawApiNameSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/);
export const RawApiVersionSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/);
export const RawMethodIdSchema = z.string().regex(ID);

export const RawCallSchema = z.object({
  api: RawApiNameSchema,
  version: RawApiVersionSchema,
  methodId: RawMethodIdSchema,
  params: z.record(z.string().max(128), z.union([z.string().max(8192), z.array(z.string().max(8192)).max(100)])).default({}),
  body: z.unknown().optional(),
  /** DELETE methods need the last path segment typed (SPEC-0001 D-13). */
  confirm: z.string().max(1024).optional(),
});
export type RawCall = z.infer<typeof RawCallSchema>;

export interface RawCallResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Parsed JSON, or the text when the body is not JSON. */
  body: unknown;
  durationMs: number;
  url: string;
}

export interface RawHistoryItem {
  at: string;
  api: string;
  version: string;
  methodId: string;
  httpMethod: string;
  params: Record<string, string | string[]>;
  /** Left out for the APIs of RAW_SECRET_APIS. */
  body?: unknown;
  status: number;
}

/**
 * Expands a discovery path template: `{name}` is one encoded segment, `{+name}` keeps its
 * slashes. Throws when a value is missing or could leave its place (`..`, `?`, `#`).
 */
export function expandRawPath(template: string, values: Record<string, string | string[] | undefined>): string {
  return template.replace(/\{(\+?)([^}]+)\}/g, (_m, plus: string, name: string) => {
    const raw = values[name];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v === undefined || v === '') throw new Error(`The path parameter ${name} is required.`);
    if (/[?#]/.test(v) || v.split('/').some((s) => s === '..' || s === '.')) throw new Error(`The path parameter ${name} is not valid.`);
    return plus ? v.split('/').map(encodeURIComponent).join('/') : encodeURIComponent(v);
  });
}

/** The last segment of an expanded path: what a DELETE asks to be typed. */
export function rawConfirmToken(expandedPath: string): string {
  const last = expandedPath.split('?')[0]?.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// biome-ignore lint/suspicious/noExplicitAny: discovery schemas are read field by field.
type Any = any;

function toJsonSchema(s: Any): Record<string, unknown> {
  if (!s || typeof s !== 'object') return {};
  if (s.$ref) return { $ref: `#/definitions/${s.$ref}`, ...(s.description ? { description: s.description } : {}) };
  const out: Record<string, unknown> = {};
  if (s.description) out.description = s.description;
  if (Array.isArray(s.enum)) out.enum = s.enum;
  switch (s.type) {
    case 'string':
      // Discovery declares 64-bit integers as strings; Google's JSON mapping also takes numbers.
      out.type = s.format === 'int64' || s.format === 'uint64' ? ['string', 'integer'] : 'string';
      break;
    case 'integer':
      out.type = 'integer';
      break;
    case 'number':
      out.type = 'number';
      break;
    case 'boolean':
      out.type = 'boolean';
      break;
    case 'array':
      out.type = 'array';
      out.items = toJsonSchema(s.items);
      break;
    case 'object':
      out.type = 'object';
      if (s.properties) {
        out.properties = Object.fromEntries(
          Object.entries(s.properties as Record<string, Any>)
            // Output-only fields are left out, so the editor does not suggest them.
            .filter(([, p]) => !p?.readOnly)
            .map(([k, p]) => [k, toJsonSchema(p)]),
        );
      }
      if (s.additionalProperties) out.additionalProperties = toJsonSchema(s.additionalProperties);
      break;
    default:
      break;
  }
  return out;
}

/** The JSON Schema of a discovery schema and every schema it reaches (SPEC-0009 D-01). */
export function discoveryJsonSchema(schemas: Record<string, Any>, ref: string): Record<string, unknown> {
  const definitions: Record<string, unknown> = {};
  const visit = (name: string) => {
    if (definitions[name] || !schemas[name]) return;
    definitions[name] = {};
    definitions[name] = toJsonSchema(schemas[name]);
    const walk = (s: Any) => {
      if (!s || typeof s !== 'object') return;
      if (s.$ref) visit(String(s.$ref));
      walk(s.items);
      walk(s.additionalProperties);
      for (const p of Object.values((s.properties ?? {}) as Record<string, Any>)) walk(p);
    };
    walk(schemas[name]);
  };
  visit(ref);
  return { $schema: 'http://json-schema.org/draft-07/schema#', $ref: `#/definitions/${ref}`, definitions };
}

/** A curl command for the same call; the token comes from gcloud, never from Nephoscope. */
export function rawCurl(httpMethod: string, url: string, body: unknown): string {
  const q = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  const parts = [`curl -X ${httpMethod}`, '-H "Authorization: Bearer $(gcloud auth print-access-token)"'];
  if (body !== undefined) parts.push('-H "Content-Type: application/json"', `-d ${q(JSON.stringify(body))}`);
  parts.push(q(url));
  return parts.join(' \\\n  ');
}

/** A query string from parameters; lists repeat the key. Empty values are left out. */
export function queryStringOf(params: Record<string, string | string[]>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    for (const item of Array.isArray(v) ? v : [v]) if (item !== '') parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(item)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}
