import { randomBytes } from 'node:crypto';
import { type PubSubMessage, type PubSubWatchParams, PubSubWatchParamsSchema, type PubSubWatchUpdate } from '@nephoscope/contracts';
import { Logger } from '@nestjs/common';
import type { LiveChannelProvider, LiveHandle } from '../../core/live/live.types.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';
import type { PubSubService } from './pubsub.service.js';
import { mapReceived } from './pubsub-mapping.js';

// biome-ignore lint/suspicious/noExplicitAny: the high-level Subscription and Message classes.
type Any = any;

const FLUSH_MS = 200;
export const WATCH_PREFIX = 'nephoscope-watch-';

/**
 * Watch a topic (SPEC-0006 D-05, CA-05): a subscription of its own, with a 24-hour expiration and
 * 10 minutes of retention, streamed and acknowledged as messages arrive, and deleted on close.
 * It creates a subscription, so it is a mutating channel and read-only mode refuses it.
 */
export function pubsubWatchChannel(service: PubSubService): LiveChannelProvider<PubSubWatchParams> {
  const logger = new Logger('PubSubWatch');
  return {
    channel: 'pubsub.watch',
    params: PubSubWatchParamsSchema as never,
    mutating: true,
    async open(ctx, sink): Promise<LiveHandle> {
      const params = PubSubWatchParamsSchema.parse(ctx.params);
      if (!params.topic.startsWith(`projects/${ctx.projectId}/`))
        throw ProblemException.of('INVALID_ARGUMENT', 'The topic belongs to another project.');
      const pubsub = await service.forProject(ctx.profile.profile.id, ctx.projectId ?? '');
      const id = `${WATCH_PREFIX}${randomBytes(5).toString('hex')}`;
      const [subscription]: Any[] = await pubsub.topic(params.topic).createSubscription(id, {
        expirationPolicy: { ttl: { seconds: 86_400 } },
        messageRetentionDuration: { seconds: 600 },
        ...(params.filter ? { filter: params.filter } : {}),
        labels: { 'created-by': 'nephoscope' },
      });
      const name = String(subscription.name);
      let buffer: PubSubMessage[] = [];
      let announced = false;
      const flush = () => {
        if (!announced || buffer.length > 0) {
          const update: PubSubWatchUpdate = { subscription: announced ? null : name, messages: buffer };
          announced = true;
          buffer = [];
          sink.data(update);
        }
      };
      flush();
      const timer = setInterval(flush, FLUSH_MS);
      subscription.on('message', (m: Any) => {
        buffer.push(
          mapReceived({
            message: { messageId: m.id, data: m.data, attributes: m.attributes, publishTime: m.publishTime, orderingKey: m.orderingKey },
            deliveryAttempt: m.deliveryAttempt,
          }),
        );
        m.ack();
      });
      subscription.on('error', (err: unknown) => sink.error(toProblem(err)));
      return {
        async close() {
          clearInterval(timer);
          try {
            await subscription.close();
            await subscription.delete();
          } catch (err) {
            // The 24-hour expiration removes it anyway (R-02).
            logger.warn({ msg: 'Could not delete the watch subscription', subscription: name, error: String(err) });
          }
        },
      };
    },
  };
}
