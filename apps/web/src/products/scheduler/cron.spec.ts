import { describe, expect, it } from 'vitest';
import { formatInZone, isValidTimeZone, previewCron } from './cron';

describe('previewCron (SPEC-0003 D-12, T-15)', () => {
  it('describes and previews "0 */2 * * 1-5" in America/Sao_Paulo', () => {
    const p = previewCron('0 */2 * * 1-5', 'America/Sao_Paulo', 5, new Date('2026-09-28T12:00:00Z'));
    expect(p.valid).toBe(true);
    expect(p.description).toBe('On the hour, every 2 hours, Monday through Friday');
    // 09:00 in Sao Paulo (UTC-3); the next even hour there is 10:00, which is 13:00 UTC.
    expect(p.next.map((d) => d.toISOString())).toEqual([
      '2026-09-28T13:00:00.000Z',
      '2026-09-28T15:00:00.000Z',
      '2026-09-28T17:00:00.000Z',
      '2026-09-28T19:00:00.000Z',
      '2026-09-28T21:00:00.000Z',
    ]);
    expect(formatInZone(p.next[0]!, 'America/Sao_Paulo')).toMatch(/10:00/);
  });

  it('rejects wrong field counts and invalid values', () => {
    expect(previewCron('* * * *', 'Etc/UTC').error).toMatch(/five fields/);
    expect(previewCron('61 * * * *', 'Etc/UTC').valid).toBe(false);
    expect(previewCron('', 'Etc/UTC').valid).toBe(false);
  });

  it('checks time zones', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
