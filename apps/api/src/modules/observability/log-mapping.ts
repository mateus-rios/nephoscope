import { type LogEntry, type LogHttp, type LogSeverity, logSeverities } from '@nephoscope/contracts';
import { rawJson } from '../../core/gcp/proto.js';

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** "0.123s" or { seconds, nanos } to milliseconds. */
function latencyMs(v: unknown): number | null {
  if (typeof v === 'string') {
    const m = /^(-?\d+(?:\.\d+)?)s$/.exec(v);
    return m ? Math.round(Number(m[1]) * 1e6) / 1e3 : null;
  }
  if (isRecord(v)) {
    const seconds = Number(String(v.seconds ?? 0));
    const nanos = Number(v.nanos ?? 0);
    return Math.round((seconds * 1e3 + nanos / 1e6) * 1e3) / 1e3;
  }
  return null;
}

function severityOf(v: unknown): LogSeverity {
  if (typeof v === 'string' && (logSeverities as readonly string[]).includes(v)) return v as LogSeverity;
  if (typeof v === 'number') {
    // LogSeverity enum numbers: 0, 100, 200 ... 800.
    const index = Math.round(v / 100);
    return logSeverities[index] ?? 'DEFAULT';
  }
  return 'DEFAULT';
}

function mapHttp(h: unknown): LogHttp | null {
  if (!isRecord(h)) return null;
  const status = Number(h.status);
  return {
    method: str(h.requestMethod),
    url: str(h.requestUrl),
    status: Number.isInteger(status) && status > 0 ? status : null,
    latencyMs: latencyMs(h.latency),
    responseSize: h.responseSize === undefined || h.responseSize === null ? null : String(h.responseSize),
    userAgent: str(h.userAgent),
    remoteIp: str(h.remoteIp),
  };
}

function formatLatency(ms: number | null): string {
  if (ms === null) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

const MAX_SUMMARY = 500;

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_SUMMARY ? `${oneLine.slice(0, MAX_SUMMARY)}…` : oneLine;
}

/** The row text of SPEC-0005 D-01. */
export function summarize(entry: Json, http: LogHttp | null): string {
  if (http && (http.method || http.status)) {
    return clip([http.method, http.status, formatLatency(http.latencyMs), http.url].filter((p) => p !== null && p !== '').join(' '));
  }
  if (typeof entry.textPayload === 'string') return clip(entry.textPayload);
  if (isRecord(entry.jsonPayload)) {
    const p = entry.jsonPayload;
    const message = p.message ?? p.msg ?? p.textPayload;
    if (typeof message === 'string') return clip(message);
    return clip(JSON.stringify(p));
  }
  if (isRecord(entry.protoPayload)) {
    const p = entry.protoPayload;
    const parts = [str(p.methodName), str(p.resourceName)].filter(Boolean);
    if (parts.length > 0) return clip(parts.join(' '));
    return clip(String(p['@type'] ?? 'protoPayload'));
  }
  return '';
}

/** Maps an entry in the REST JSON shape (entries.list) to the panel DTO. */
export function mapRestEntry(entry: Json): LogEntry {
  const http = mapHttp(entry.httpRequest);
  const resource = isRecord(entry.resource) ? entry.resource : {};
  const labels = isRecord(resource.labels) ? (resource.labels as Record<string, string>) : {};
  const timestamp = str(entry.timestamp);
  return {
    id: `${str(entry.insertId) ?? ''}@${timestamp ?? ''}`,
    timestamp,
    severity: severityOf(entry.severity),
    logName: str(entry.logName) ?? '',
    resource: { type: str(resource.type) ?? '', labels },
    summary: summarize(entry, http),
    http,
    trace: str(entry.trace),
    raw: entry,
  };
}

// ---- gRPC (tail) entries ---------------------------------------------------------------------

/** google.protobuf.Value in its proto JSON form to plain JSON. */
function valueToJson(v: unknown): unknown {
  if (!isRecord(v)) return v;
  if ('nullValue' in v) return null;
  if ('numberValue' in v) return v.numberValue;
  if ('stringValue' in v) return v.stringValue;
  if ('boolValue' in v) return v.boolValue;
  if ('structValue' in v) return structToJson(v.structValue);
  if ('listValue' in v) return (isRecord(v.listValue) && Array.isArray(v.listValue.values) ? v.listValue.values : []).map(valueToJson);
  return null;
}

/** google.protobuf.Struct `{ fields }` to a plain object. */
export function structToJson(s: unknown): Json {
  const out: Json = {};
  if (!isRecord(s) || !isRecord(s.fields)) return out;
  for (const [k, v] of Object.entries(s.fields)) out[k] = valueToJson(v);
  return out;
}

/**
 * Converts a streamed proto entry to the REST shape. Proto payloads (audit logs) cannot be decoded
 * without their definitions, so the tail shows their type; the list view has the full payload.
 */
export function protoEntryToRest(message: unknown): Json {
  const json = rawJson(message) as Json;
  if (isRecord(json.jsonPayload)) json.jsonPayload = structToJson(json.jsonPayload);
  if (isRecord(json.protoPayload)) {
    const p = json.protoPayload;
    const type = str(p['@type']) ?? str(p.type_url) ?? str(p.typeUrl);
    if (!('@type' in p) || 'value' in p) {
      json.protoPayload = {
        '@type': type ?? 'unknown',
        note: 'Proto payloads are not decoded in the live tail. Stop the tail and reload the list to see this one.',
      };
    }
  }
  return json;
}
