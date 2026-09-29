/**
 * Sliding one-minute window per key. Used to stay under Google's per-project read quotas
 * (SPEC-0001 CA-70, SPEC-0005 D-02).
 */
export class RateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(private readonly perMinute: number) {}

  private prune(key: string, now: number): number[] {
    const list = (this.windows.get(key) ?? []).filter((t) => now - t < 60_000);
    this.windows.set(key, list);
    return list;
  }

  /** Takes a slot now, or tells how long to wait for one. */
  tryAcquire(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterMs: number } {
    const list = this.prune(key, now);
    if (list.length < this.perMinute) {
      list.push(now);
      return { ok: true };
    }
    return { ok: false, retryAfterMs: 60_000 - (now - (list[0] ?? now)) };
  }

  /** Waits for a slot; rejects if `signal` aborts first. */
  async acquire(key: string, signal?: AbortSignal): Promise<void> {
    for (;;) {
      const r = this.tryAcquire(key);
      if (r.ok) return;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, r.retryAfterMs + 5);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            reject(signal.reason ?? new Error('Aborted'));
          },
          { once: true },
        );
      });
    }
  }
}
