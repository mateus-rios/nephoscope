import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperationsService } from './operations.service.js';

const store = { read: async () => [], write: async () => undefined } as never;

describe('Operations tray cancellation (SPEC-0001 CA-34)', () => {
  afterEach(() => vi.useRealTimers());

  it('asks Google to stop a tracked operation that can be cancelled, and the poll sees the end', async () => {
    vi.useFakeTimers();
    const ops = new OperationsService(store);
    let state: 'running' | 'cancelled' = 'running';
    const cancel = vi.fn(async () => {
      state = 'cancelled';
    });
    const op = ops.track({
      profileId: 'p1',
      projectId: 'demo',
      product: 'bigquery',
      kind: 'bigquery.query',
      family: 'bigquery',
      resource: { name: 'j1', displayName: 'Query', href: null },
      googleName: 'https://bigquery.googleapis.com/bigquery/v2/projects/demo/jobs/j1',
      poll: async () => (state === 'running' ? { done: false } : { done: true, cancelled: true }),
      cancel,
    });
    expect(op.cancellable).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(ops.cancel(op.id)).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(ops.get(op.id)).toMatchObject({ status: 'cancelled', cancellable: false });
    expect(ops.cancel(op.id)).toBe(false);
  });

  it('refuses to cancel an operation that has no way to stop', () => {
    const ops = new OperationsService(store);
    const op = ops.track({
      profileId: 'p1',
      projectId: 'demo',
      product: 'run',
      kind: 'run.deploy',
      family: 'longrunning',
      resource: { name: 'x', displayName: 'Deploy', href: null },
      googleName: null,
      poll: async () => ({ done: false }),
    });
    expect(op.cancellable).toBeUndefined();
    expect(ops.cancel(op.id)).toBe(false);
  });
});
