import { z } from 'zod';
import { LIVE_BUFFER_LIMIT, LIVE_PATH, liveChannels } from './constants.js';
import { ProblemSchema } from './problem.js';

export const LiveChannelSchema = z.enum(liveChannels);
export type LiveChannel = z.infer<typeof LiveChannelSchema>;

const subscriptionId = z.string().min(1).max(64);

/** Client to server messages (SPEC-0001 CA-36). */
export const LiveClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sub'),
    id: subscriptionId,
    channel: LiveChannelSchema,
    profileId: z.string().min(1).max(64),
    projectId: z.string().max(100).nullable(),
    params: z.unknown(),
  }),
  z.object({ type: z.literal('unsub'), id: subscriptionId }),
  z.object({ type: z.literal('pause'), id: subscriptionId }),
  z.object({ type: z.literal('resume'), id: subscriptionId }),
  z.object({ type: z.literal('ping') }),
]);
export type LiveClientMessage = z.infer<typeof LiveClientMessageSchema>;

/** Server to client messages (SPEC-0001 CA-36). */
export const LiveServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('data'), id: subscriptionId, data: z.unknown() }),
  z.object({ type: z.literal('gap'), id: subscriptionId, dropped: z.number().int() }),
  z.object({ type: z.literal('error'), id: subscriptionId, problem: ProblemSchema }),
  z.object({ type: z.literal('end'), id: subscriptionId }),
  z.object({ type: z.literal('pong') }),
]);
export type LiveServerMessage = z.infer<typeof LiveServerMessageSchema>;

export { LIVE_BUFFER_LIMIT, LIVE_PATH, liveChannels };
