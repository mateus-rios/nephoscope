import { describe, expect, it, vi } from 'vitest';
import { fanOut, WildcardSupport } from './fan-out.js';
import { lroPoller } from './lro.js';
import { durationToSeconds, rawJson, secondsToDuration, toInt } from './proto.js';

describe('fanOut', () => {
  it('merges locations and reports the ones that failed', async () => {
    const r = await fanOut(['a', 'b', 'c'], async (loc) => {
      if (loc === 'b') throw Object.assign(new Error('down'), { code: 14, details: 'down' });
      return [loc];
    });
    expect(r.items.sort()).toEqual(['a', 'c']);
    expect(r.unreachable).toEqual(['b']);
  });

  it('throws when every location fails', async () => {
    await expect(fanOut(['a', 'b'], async () => Promise.reject(new Error('nope')))).rejects.toThrow('nope');
  });

  it('respects the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await fanOut(
      Array.from({ length: 20 }, (_, i) => `l${i}`),
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        return [];
      },
      8,
    );
    expect(peak).toBeLessThanOrEqual(8);
  });
});

describe('WildcardSupport', () => {
  it('falls back to fan-out once the wildcard is rejected, and remembers it', async () => {
    const support = new WildcardSupport();
    const wildcard = vi.fn().mockRejectedValue(Object.assign(new Error('bad'), { code: 3, details: 'Invalid location' }));
    const perLocation = vi.fn().mockResolvedValue({ items: [1], nextPageToken: null });
    await expect(support.list('workflows', wildcard, perLocation)).resolves.toEqual({ items: [1], nextPageToken: null });
    await support.list('workflows', wildcard, perLocation);
    expect(wildcard).toHaveBeenCalledTimes(1);
    expect(perLocation).toHaveBeenCalledTimes(2);
  });

  it('rethrows permission errors instead of falling back', async () => {
    const support = new WildcardSupport();
    const denied = Object.assign(new Error('denied'), { code: 7, details: 'Permission denied' });
    await expect(support.list('x', () => Promise.reject(denied), vi.fn())).rejects.toBe(denied);
  });
});

describe('lroPoller', () => {
  it('reports running, success, failure and cancellation', async () => {
    expect(await lroPoller(async () => ({ done: false }), 'op')()).toEqual({ done: false });
    expect(await lroPoller(async () => ({ done: true }), 'op')()).toEqual({ done: true });
    const failed = await lroPoller(async () => ({ done: true, error: { code: 9, message: 'Revision failed' } }), 'op')();
    expect(failed.done && failed.error?.code).toBe('FAILED_PRECONDITION');
    expect(failed.error?.detail).toBe('Revision failed');
    const cancelled = await lroPoller(async () => ({ done: true, error: { code: 1, message: 'Cancelled' } }), 'op')();
    expect(cancelled.cancelled).toBe(true);
  });
});

describe('proto helpers', () => {
  it('converts durations', () => {
    expect(durationToSeconds({ seconds: '300' })).toBe(300);
    expect(durationToSeconds({ seconds: 1, nanos: 500_000_000 })).toBe(1.5);
    expect(durationToSeconds(null)).toBeNull();
    expect(secondsToDuration(2.25)).toEqual({ seconds: 2, nanos: 250_000_000 });
    expect(toInt('42')).toBe(42);
    expect(toInt(undefined)).toBeNull();
  });

  it('renders raw JSON with timestamps and durations in REST form', () => {
    const raw = rawJson({
      toJSON: () => ({
        createTime: { seconds: '1790000000' },
        timeout: { seconds: '300' },
        template: { timeout: { seconds: '60', nanos: 500000000 } },
        list: [{ updateTime: { seconds: '0' } }],
        empty: undefined,
      }),
    });
    expect(raw).toEqual({
      createTime: '2026-09-21T14:13:20Z',
      timeout: '300s',
      template: { timeout: '60.5s' },
      list: [{ updateTime: '1970-01-01T00:00:00Z' }],
    });
  });
});
