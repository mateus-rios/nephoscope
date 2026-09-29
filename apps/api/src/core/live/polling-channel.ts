import type { LiveChannel } from '@nephoscope/contracts';
import type { z } from 'zod';
import { toProblem } from '../problem/google-error.mapper.js';
import type { LiveChannelProvider, LiveContext } from './live.types.js';

interface PollingOptions<P, T> {
  channel: LiveChannel;
  params: z.ZodType<P>;
  /** SPEC-0003 NFR-02: live pages reflect a change within 5 seconds. */
  intervalMs?: number;
  read(ctx: LiveContext<P>): Promise<T>;
  /** True when nothing more will change; the channel sends the last state and ends. */
  finished(value: T): boolean;
}

/**
 * A live channel over an API that has no stream: reads every few seconds and sends only changes.
 * Pausing stops the reads (the gateway closes and reopens the handle, SPEC-0001 CA-39).
 */
export function pollingChannel<P, T>(options: PollingOptions<P, T>): LiveChannelProvider<P> {
  const interval = options.intervalMs ?? 3000;
  return {
    channel: options.channel,
    params: options.params,
    open(ctx, sink) {
      let stopped = false;
      let timer: NodeJS.Timeout | null = null;
      let last = '';
      let failures = 0;
      const tick = async () => {
        if (stopped) return;
        try {
          const value = await options.read(ctx);
          failures = 0;
          if (stopped) return;
          const serialized = JSON.stringify(value);
          if (serialized !== last) {
            last = serialized;
            sink.data(value);
          }
          if (options.finished(value)) {
            sink.end();
            return;
          }
        } catch (err) {
          failures++;
          const problem = toProblem(err);
          // Transient errors are retried quietly; anything else, or three in a row, ends the stream.
          if (!problem.retryable || failures >= 3) {
            sink.error(problem);
            return;
          }
        }
        if (!stopped) timer = setTimeout(() => void tick(), interval);
      };
      void tick();
      return {
        close() {
          stopped = true;
          if (timer) clearTimeout(timer);
        },
      };
    },
  };
}
