import { enumName, timestampToIso } from './proto.js';
import { RateLimiter } from './rate-limiter.js';

describe('timestampToIso', () => {
  it('keeps nanoseconds without going through Date for the fraction', () => {
    expect(timestampToIso({ seconds: '1759060800', nanos: 123456789 })).toBe('2025-09-28T12:00:00.123456789Z');
    expect(timestampToIso({ seconds: 1759060800, nanos: 120000000 })).toBe('2025-09-28T12:00:00.12Z');
    expect(timestampToIso({ seconds: '1759060800', nanos: 0 })).toBe('2025-09-28T12:00:00Z');
    expect(timestampToIso(null)).toBeNull();
  });
});

describe('enumName', () => {
  it('accepts names and numbers', () => {
    const names = ['STATE_UNSPECIFIED', 'ACTIVE', 'DELETE_REQUESTED'] as const;
    expect(enumName('ACTIVE', names, 'STATE_UNSPECIFIED')).toBe('ACTIVE');
    expect(enumName(2, names, 'STATE_UNSPECIFIED')).toBe('DELETE_REQUESTED');
    expect(enumName('NOPE', names, 'STATE_UNSPECIFIED')).toBe('STATE_UNSPECIFIED');
  });
});

describe('RateLimiter', () => {
  it('allows the configured number per minute, per key', () => {
    const rl = new RateLimiter(2);
    expect(rl.tryAcquire('a', 0).ok).toBe(true);
    expect(rl.tryAcquire('a', 1).ok).toBe(true);
    const third = rl.tryAcquire('a', 2);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.retryAfterMs).toBe(59_998);
    expect(rl.tryAcquire('b', 2).ok).toBe(true);
    expect(rl.tryAcquire('a', 60_001).ok).toBe(true);
  });
});
