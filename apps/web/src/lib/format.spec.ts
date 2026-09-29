import { describe, expect, it } from 'vitest';
import { absoluteTime, bytes, count, duration, relativeTime } from './format';
import { fnv1a, initialsOf } from './hash';

describe('relativeTime', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  it('says "just now" within 45 seconds', () => {
    expect(relativeTime('2026-09-28T11:59:30Z', now)).toBe('just now');
  });
  it('is empty for missing values and echoes unparseable ones', () => {
    expect(relativeTime(null, now)).toBe('');
    expect(relativeTime('not a date', now)).toBe('not a date');
  });
});

describe('absoluteTime', () => {
  it('gives UTC without milliseconds', () => {
    expect(absoluteTime('2026-09-28T12:34:56.789Z')?.utc).toBe('2026-09-28 12:34:56 UTC');
  });
  it('is null for missing or invalid values', () => {
    expect(absoluteTime(undefined)).toBeNull();
    expect(absoluteTime('x')).toBeNull();
  });
});

describe('bytes', () => {
  it('uses IEC units with three significant digits', () => {
    expect(bytes(512)).toBe('512 B');
    expect(bytes(1536)).toBe('1.50 KiB');
    expect(bytes('10485760')).toBe('10.0 MiB');
    expect(bytes(200 * 1024 ** 3)).toBe('200 GiB');
  });
  it('is empty for non-numbers', () => {
    expect(bytes(null)).toBe('');
    expect(bytes('abc')).toBe('');
  });
});

describe('duration', () => {
  it('is compact at every scale', () => {
    expect(duration(850)).toBe('850ms');
    expect(duration(2500)).toBe('2.5s');
    expect(duration(72_000)).toBe('1m 12s');
    expect(duration(3 * 3600_000 + 4 * 60_000)).toBe('3h 4m');
  });
});

describe('count', () => {
  it('picks singular or plural', () => {
    expect(count(1, 'document')).toBe('1 document');
    expect(count(3, 'document')).toBe('3 documents');
    expect(count(2, 'policy', 'policies')).toBe('2 policies');
  });
});

describe('profile mark helpers', () => {
  it('hashes stably', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('key-1')).toBe(fnv1a('key-1'));
    expect(fnv1a('key-1')).not.toBe(fnv1a('key-2'));
  });
  it('takes initials from the principal', () => {
    expect(initialsOf('deploy-bot@acme.iam.gserviceaccount.com', 'x')).toBe('DB');
    expect(initialsOf('ana@example.com', 'x')).toBe('AN');
    expect(initialsOf(null, 'Environment')).toBe('EN');
  });
});
