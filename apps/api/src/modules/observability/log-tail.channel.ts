import { type LogTailMessage, type LogTailParams, LogTailParamsSchema } from '@nephoscope/contracts';
import { Logger } from '@nestjs/common';
import type { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { sdk } from '../../core/gcp/sdk.js';
import type { LiveChannelProvider, LiveSink } from '../../core/live/live.types.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { makeProblem } from '../../core/problem/problem.js';
import { mapRestEntry, protoEntryToRest } from './log-mapping.js';

interface TailStream {
  write(chunk: unknown): boolean;
  on(event: 'data', fn: (chunk: unknown) => void): TailStream;
  on(event: 'error', fn: (err: unknown) => void): TailStream;
  on(event: 'end', fn: () => void): TailStream;
  cancel(): void;
  end(): void;
}

interface Session {
  key: string;
  stream: TailStream | null;
  sinks: Set<LiveSink>;
  closeTimer: NodeJS.Timeout | null;
}

type SuppressionReason = Extract<LogTailMessage, { kind: 'suppressed' }>['reason'];
/** SPEC-0005 CA-04: a tail without subscribers closes within 2 seconds. */
const CLOSE_AFTER_MS = 1500;

function suppressionReason(v: unknown): SuppressionReason {
  if (v === 'RATE_LIMIT' || v === 1) return 'rate_limit';
  if (v === 'NOT_CONSUMED' || v === 2) return 'not_consumed';
  return 'unknown';
}

/**
 * The `logging.tail` channel (SPEC-0005 D-03): one Google tail session per (profile, project,
 * filter), shared by every subscriber that asks for the same thing.
 */
export function logTailChannel(clients: GcpClientFactory): LiveChannelProvider<LogTailParams> {
  const logger = new Logger('LogTail');
  const sessions = new Map<string, Session>();

  function broadcast(session: Session, message: LogTailMessage): void {
    for (const sink of session.sinks) sink.data(message);
  }

  function fail(session: Session, err: unknown): void {
    const problem = toProblem(err);
    const limit =
      problem.code === 'RESOURCE_EXHAUSTED'
        ? makeProblem(
            'RESOURCE_EXHAUSTED',
            'Live tail limit reached in this project (10 sessions, shared with other tools). Close other tails and try again.',
            { retryable: true },
          )
        : problem;
    for (const sink of session.sinks) sink.error(limit);
    sessions.delete(session.key);
  }

  async function open(session: Session, profileId: string, projectId: string, filter: string): Promise<void> {
    const { LoggingServiceV2Client } = await sdk.logging();
    const client = clients.get(profileId, 'logging.v2', (auth) => new LoggingServiceV2Client({ auth }));
    const stream = client.tailLogEntries() as unknown as TailStream;
    session.stream = stream;
    stream.on('data', (chunk) => {
      const res = chunk as { entries?: unknown[]; suppressionInfo?: { reason?: unknown; suppressedCount?: number }[] };
      if (res.entries?.length) {
        broadcast(session, { kind: 'entries', entries: res.entries.map((e) => mapRestEntry(protoEntryToRest(e))) });
      }
      for (const s of res.suppressionInfo ?? []) {
        if (s.suppressedCount) broadcast(session, { kind: 'suppressed', count: s.suppressedCount, reason: suppressionReason(s.reason) });
      }
    });
    stream.on('error', (err) => {
      // Cancelling our own stream reports CANCELLED; that is not a failure.
      if ((err as { code?: number }).code === 1) return;
      logger.debug({ msg: 'Tail failed', error: String(err) });
      fail(session, err);
    });
    stream.on('end', () => {
      for (const sink of session.sinks) sink.end();
      sessions.delete(session.key);
    });
    stream.write({ resourceNames: [`projects/${projectId}`], filter, bufferWindow: { seconds: 2 } });
    broadcast(session, { kind: 'started' });
  }

  function release(session: Session, sink: LiveSink): void {
    session.sinks.delete(sink);
    if (session.sinks.size > 0 || session.closeTimer) return;
    session.closeTimer = setTimeout(() => {
      if (session.sinks.size > 0) {
        session.closeTimer = null;
        return;
      }
      sessions.delete(session.key);
      try {
        session.stream?.cancel();
      } catch {
        /* Already closed. */
      }
    }, CLOSE_AFTER_MS);
    session.closeTimer.unref();
  }

  return {
    channel: 'logging.tail',
    params: LogTailParamsSchema,
    async open(ctx, sink) {
      if (!ctx.projectId) throw makeProblem('INVALID_ARGUMENT', 'A live tail needs a project.');
      const profileId = ctx.profile.profile.id;
      const key = `${profileId}\u0000${ctx.projectId}\u0000${ctx.params.filter}`;
      let session = sessions.get(key);
      if (session) {
        if (session.closeTimer) {
          clearTimeout(session.closeTimer);
          session.closeTimer = null;
        }
        session.sinks.add(sink);
        // A new subscriber gets entries from now on (SPEC-0005 D-03).
        sink.data({ kind: 'started' } satisfies LogTailMessage);
      } else {
        session = { key, stream: null, sinks: new Set([sink]), closeTimer: null };
        sessions.set(key, session);
        await open(session, profileId, ctx.projectId, ctx.params.filter);
      }
      const current = session;
      return { close: () => release(current, sink) };
    },
  };
}
