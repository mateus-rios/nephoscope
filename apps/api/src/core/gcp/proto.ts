/** Helpers for values returned by google-gax clients (int64 and enums arrive as strings). */

interface TimestampLike {
  seconds?: string | number | { toString(): string } | null;
  nanos?: number | null;
}

/** RFC 3339 with nanoseconds, or null. Never goes through `Date` for the fraction. */
export function timestampToIso(ts: TimestampLike | null | undefined): string | null {
  if (!ts || ts.seconds === null || ts.seconds === undefined) return null;
  const seconds = Number(String(ts.seconds));
  if (!Number.isFinite(seconds)) return null;
  const base = new Date(seconds * 1000).toISOString().slice(0, 19);
  const nanos = ts.nanos ?? 0;
  if (!nanos) return `${base}Z`;
  const frac = String(nanos).padStart(9, '0').replace(/0+$/, '');
  return `${base}.${frac}Z`;
}

interface DurationLike {
  seconds?: string | number | { toString(): string } | null;
  nanos?: number | null;
}

/** Seconds as a number, or null when unset. */
export function durationToSeconds(d: DurationLike | null | undefined): number | null {
  if (!d || (d.seconds === null && d.nanos === null) || (d.seconds === undefined && d.nanos === undefined)) return null;
  const seconds = Number(String(d.seconds ?? 0));
  return seconds + (d.nanos ?? 0) / 1e9;
}

export function secondsToDuration(seconds: number): { seconds: number; nanos: number } {
  const whole = Math.floor(seconds);
  return { seconds: whole, nanos: Math.round((seconds - whole) * 1e9) };
}

/** A number from an int32 or int64 field, which gax may return as a string. */
export function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : null;
}

const TIMESTAMP_KEY = /(Time|Timestamp)$|^timestamp$|^time$/;

function isSecondsNanos(v: Record<string, unknown>): boolean {
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => k === 'seconds' || k === 'nanos');
}

/**
 * The REST JSON shape of a message, for read-only raw views (SPEC-0001 CA-64): longs as strings,
 * enums as names, Timestamps as RFC 3339 and Durations as "3.5s". Timestamps and Durations share
 * one wire shape, so the field name decides (Google names timestamps `*Time`).
 */
export function rawJson(value: unknown): unknown {
  const json =
    value && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function'
      ? (value as { toJSON(): unknown }).toJSON()
      : value;
  return normalize(json, '');
}

function normalize(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return value.map((v) => normalize(v, key));
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  if (isSecondsNanos(obj)) {
    if (TIMESTAMP_KEY.test(key)) return timestampToIso(obj as TimestampLike);
    const s = durationToSeconds(obj as DurationLike);
    return s === null ? null : `${s}s`;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = normalize(v, k);
  }
  return out;
}

/** Enum value as its name, whether gax returned the name or the number. */
export function enumName<T extends string>(value: unknown, names: readonly T[], fallback: T): T {
  if (typeof value === 'string' && (names as readonly string[]).includes(value)) return value as T;
  if (typeof value === 'number' && names[value] !== undefined) return names[value] as T;
  return fallback;
}
