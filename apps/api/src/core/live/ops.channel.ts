import { z } from 'zod';
import type { OperationsService } from '../operations/operations.service.js';
import type { LiveChannelProvider } from './live.types.js';

/** The `ops` channel: a snapshot, then every change of the profile's operations (SPEC-0001 CA-33). */
export function opsChannel(ops: OperationsService): LiveChannelProvider<Record<string, never>> {
  return {
    channel: 'ops',
    params: z.object({}).strict(),
    open(ctx, sink) {
      const profileId = ctx.profile.profile.id;
      sink.data({ kind: 'snapshot', operations: ops.list(profileId).slice(0, 50) });
      const unsubscribe = ops.subscribe((op) => {
        if (op.profileId === profileId) sink.data({ kind: 'update', operation: op });
      });
      return { close: unsubscribe };
    },
  };
}
