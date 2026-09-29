import { CronExpressionParser } from 'cron-parser';
import cronstrue from 'cronstrue';

export interface CronPreview {
  valid: boolean;
  error: string | null;
  /** Plain English, such as "At 03:00 AM, Monday through Friday" (SPEC-0003 D-12). */
  description: string | null;
  /** Next runs as instants; format them in the job's zone and the local zone. */
  next: Date[];
}

/** Validates a Scheduler cron expression and previews the next runs in `timeZone`. */
export function previewCron(expression: string, timeZone: string, count = 5, from: Date = new Date()): CronPreview {
  const expr = expression.trim();
  if (!expr) return { valid: false, error: 'Enter a schedule.', description: null, next: [] };
  if (expr.split(/\s+/).length !== 5) {
    return {
      valid: false,
      error: 'Cloud Scheduler uses five fields: minute, hour, day of month, month, day of week.',
      description: null,
      next: [],
    };
  }
  let description: string | null = null;
  try {
    description = cronstrue.toString(expr, { use24HourTimeFormat: true, verbose: false });
  } catch (err) {
    return {
      valid: false,
      error: typeof err === 'string' ? err : err instanceof Error ? err.message : 'Invalid schedule',
      description: null,
      next: [],
    };
  }
  try {
    const it = CronExpressionParser.parse(expr, { tz: timeZone || 'Etc/UTC', currentDate: from });
    const next: Date[] = [];
    for (let i = 0; i < count; i++) next.push(it.next().toDate());
    return { valid: true, error: null, description, next };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Invalid schedule', description, next: [] };
  }
}

/** "Mon 28 Sep, 03:00" in a time zone. */
export function formatInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Time zones for the picker; Intl knows them all in modern browsers. */
export function timeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
  return supported && supported.length > 0
    ? ['Etc/UTC', ...supported.filter((z) => z !== 'UTC')]
    : ['Etc/UTC', 'America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo'];
}
