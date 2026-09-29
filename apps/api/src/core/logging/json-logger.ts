import type { LoggerService, LogLevel } from '@nestjs/common';

const levelRank: Record<string, number> = { error: 0, warn: 1, info: 2, log: 2, debug: 3, verbose: 4 };

/** Keys whose values are never written to logs (SPEC-0001 CA-69). */
const SECRET_KEYS = /private_?key|client_?secret|refresh_?token|access_?token|authorization|password|secret|payload|cookie/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

/** Structured JSON logs on stdout (SPEC-0001 CA-69). */
export class JsonLogger implements LoggerService {
  private readonly max: number;

  constructor(level: 'error' | 'warn' | 'info' | 'debug' = 'info') {
    this.max = levelRank[level] ?? 2;
  }

  log(message: unknown, ...optional: unknown[]) {
    this.write('info', message, optional);
  }
  error(message: unknown, ...optional: unknown[]) {
    this.write('error', message, optional);
  }
  warn(message: unknown, ...optional: unknown[]) {
    this.write('warn', message, optional);
  }
  debug(message: unknown, ...optional: unknown[]) {
    this.write('debug', message, optional);
  }
  verbose(message: unknown, ...optional: unknown[]) {
    this.write('verbose', message, optional);
  }
  setLogLevels(_levels: LogLevel[]) {}

  private write(level: string, message: unknown, optional: unknown[]) {
    if ((levelRank[level] ?? 2) > this.max) return;
    // Nest passes the context as the last string argument.
    const context = typeof optional.at(-1) === 'string' ? (optional.pop() as string) : undefined;
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      ...(context ? { context } : {}),
    };
    if (message instanceof Error) {
      entry.msg = message.message;
      entry.stack = message.stack;
    } else if (typeof message === 'object' && message !== null) {
      Object.assign(entry, redact(message) as object);
    } else {
      entry.msg = String(message);
    }
    for (const extra of optional) {
      if (typeof extra === 'string' && level === 'error') entry.stack = extra;
      else if (extra !== undefined) entry.extra = redact(extra);
    }
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
}
