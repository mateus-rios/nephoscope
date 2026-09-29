import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  LIVE_BUFFER_LIMIT,
  LIVE_PATH,
  type LiveChannel,
  type LiveClientMessage,
  LiveClientMessageSchema,
  type LiveServerMessage,
  type Problem,
} from '@nephoscope/contracts';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type WebSocket, WebSocketServer } from 'ws';
import { NEPHOSCOPE_CONFIG, type NephoscopeConfig } from '../config/config.js';
import { ProfilesService } from '../credentials/profiles.service.js';
import { OperationsService } from '../operations/operations.service.js';
import { toProblem } from '../problem/google-error.mapper.js';
import { makeProblem } from '../problem/problem.js';
import { AccessToken, readCookie, TOKEN_COOKIE } from '../security/access-token.js';
import { hostnameOf, isAllowedHost, isLoopbackHost, originAuthority } from '../security/host.js';
import type { LiveChannelProvider, LiveHandle, LiveSink } from './live.types.js';
import { opsChannel } from './ops.channel.js';

interface ActiveSub {
  id: string;
  provider: LiveChannelProvider;
  reopen: () => Promise<LiveHandle>;
  handle: LiveHandle | null;
  pending: number;
  dropped: number;
  paused: boolean;
  pauseTimer: NodeJS.Timeout | null;
  closed: boolean;
}

const HEARTBEAT_MS = 30_000;

/**
 * One WebSocket per tab, multiplexing live channels (SPEC-0001 D-10, CA-36 to CA-41). The upgrade
 * is refused unless Host, Origin and, when required, the access token check out (CA-16, CA-71).
 */
@Injectable()
export class LiveGateway implements OnModuleDestroy {
  private readonly logger = new Logger('Live');
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  private readonly providers = new Map<LiveChannel, LiveChannelProvider>();
  private readonly sockets = new Set<WebSocket>();

  constructor(
    @Inject(NEPHOSCOPE_CONFIG) private readonly config: NephoscopeConfig,
    private readonly profiles: ProfilesService,
    private readonly token: AccessToken,
    operations: OperationsService,
  ) {
    this.register(opsChannel(operations));
  }

  register<P>(provider: LiveChannelProvider<P>): void {
    this.providers.set(provider.channel, provider as LiveChannelProvider);
  }

  attach(server: Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const reject = (status: number, text: string) => {
        socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        socket.destroy();
      };
      const path = (req.url ?? '/').split('?')[0];
      if (path !== LIVE_PATH) return reject(404, 'Not Found');
      const hostname = hostnameOf(req.headers.host);
      if (!isAllowedHost(hostname, this.config.allowedHosts)) return reject(421, 'Misdirected Request');
      const origin = originAuthority(req.headers.origin);
      if (!origin || origin !== String(req.headers.host ?? '').toLowerCase()) return reject(403, 'Forbidden');
      if ((this.config.requireToken || !isLoopbackHost(hostname)) && !this.token.matches(readCookie(req.headers.cookie, TOKEN_COOKIE))) {
        return reject(401, 'Unauthorized');
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const ws of this.sockets) ws.close(1001, 'Server shutting down');
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private onConnection(ws: WebSocket): void {
    this.sockets.add(ws);
    const subs = new Map<string, ActiveSub>();
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, HEARTBEAT_MS);
    heartbeat.unref();

    const send = (sub: ActiveSub | null, msg: LiveServerMessage) => {
      if (ws.readyState !== ws.OPEN) return;
      if (!sub) return ws.send(JSON.stringify(msg));
      if (sub.pending >= LIVE_BUFFER_LIMIT) {
        sub.dropped++;
        return;
      }
      sub.pending++;
      ws.send(JSON.stringify(msg), () => {
        sub.pending--;
        if (sub.dropped > 0 && sub.pending < LIVE_BUFFER_LIMIT / 2 && ws.readyState === ws.OPEN) {
          const dropped = sub.dropped;
          sub.dropped = 0;
          ws.send(JSON.stringify({ type: 'gap', id: sub.id, dropped } satisfies LiveServerMessage));
        }
      });
    };

    const closeSub = async (sub: ActiveSub) => {
      sub.closed = true;
      if (sub.pauseTimer) clearTimeout(sub.pauseTimer);
      subs.delete(sub.id);
      const h = sub.handle;
      sub.handle = null;
      try {
        await h?.close();
      } catch (err) {
        this.logger.debug({ msg: 'Live stream close failed', error: String(err) });
      }
    };

    const sinkFor = (sub: ActiveSub): LiveSink => ({
      data: (payload) => !sub.closed && send(sub, { type: 'data', id: sub.id, data: payload }),
      gap: (dropped) => !sub.closed && send(sub, { type: 'gap', id: sub.id, dropped }),
      error: (problem) => {
        if (sub.closed) return;
        send(null, { type: 'error', id: sub.id, problem });
        void closeSub(sub);
      },
      end: () => {
        if (sub.closed) return;
        send(null, { type: 'end', id: sub.id });
        void closeSub(sub);
      },
    });

    const fail = (id: string, problem: Problem) => send(null, { type: 'error', id, problem });

    const onMessage = async (msg: LiveClientMessage) => {
      switch (msg.type) {
        case 'ping':
          return send(null, { type: 'pong' });
        case 'unsub': {
          const sub = subs.get(msg.id);
          if (sub) await closeSub(sub);
          return;
        }
        case 'pause': {
          const sub = subs.get(msg.id);
          if (!sub || sub.paused) return;
          sub.paused = true;
          const doPause = () => {
            sub.pauseTimer = null;
            if (!sub.paused || sub.closed) return;
            if (sub.handle?.pause) sub.handle.pause();
            else {
              const h = sub.handle;
              sub.handle = null;
              void Promise.resolve(h?.close()).catch(() => undefined);
            }
          };
          const grace = sub.provider.pauseGraceMs ?? 0;
          if (grace > 0) {
            sub.pauseTimer = setTimeout(doPause, grace);
            sub.pauseTimer.unref();
          } else doPause();
          return;
        }
        case 'resume': {
          const sub = subs.get(msg.id);
          if (!sub?.paused) return;
          sub.paused = false;
          if (sub.pauseTimer) {
            clearTimeout(sub.pauseTimer);
            sub.pauseTimer = null;
            return;
          }
          if (sub.handle?.resume) sub.handle.resume();
          else if (!sub.handle) {
            try {
              sub.handle = await sub.reopen();
            } catch (err) {
              sinkFor(sub).error(toProblem(err));
            }
          }
          return;
        }
        case 'sub': {
          if (subs.has(msg.id)) return fail(msg.id, makeProblem('INVALID_ARGUMENT', 'Subscription id already in use.'));
          const provider = this.providers.get(msg.channel);
          if (!provider) return fail(msg.id, makeProblem('NOT_FOUND', `Live channel "${msg.channel}" is not available in this build.`));
          let profile: ReturnType<ProfilesService['get']>;
          try {
            profile = this.profiles.get(msg.profileId);
          } catch (err) {
            return fail(msg.id, toProblem(err));
          }
          if (provider.mutating && (this.config.readOnly || profile.profile.readOnly)) {
            return fail(
              msg.id,
              makeProblem('READ_ONLY', 'This live view changes Google Cloud resources and is not allowed in read-only mode.'),
            );
          }
          const parsed = provider.params.safeParse(msg.params ?? {});
          if (!parsed.success) {
            return fail(
              msg.id,
              makeProblem('INVALID_ARGUMENT', 'Invalid live subscription parameters.', {
                errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
              }),
            );
          }
          const sub: ActiveSub = {
            id: msg.id,
            provider,
            reopen: async () => provider.open({ profile, projectId: msg.projectId, params: parsed.data }, sinkFor(sub)),
            handle: null,
            pending: 0,
            dropped: 0,
            paused: false,
            pauseTimer: null,
            closed: false,
          };
          subs.set(msg.id, sub);
          try {
            sub.handle = await sub.reopen();
            if (sub.closed) await Promise.resolve(sub.handle.close()).catch(() => undefined);
          } catch (err) {
            subs.delete(msg.id);
            fail(msg.id, toProblem(err));
          }
          return;
        }
      }
    };

    ws.on('message', (raw) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const parsed = LiveClientMessageSchema.safeParse(json);
      if (!parsed.success) {
        const id = (json as { id?: unknown })?.id;
        if (typeof id === 'string') fail(id, makeProblem('INVALID_ARGUMENT', 'Invalid live message.'));
        return;
      }
      void onMessage(parsed.data).catch((err: unknown) => this.logger.warn({ msg: 'Live message failed', error: String(err) }));
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      this.sockets.delete(ws);
      for (const sub of [...subs.values()]) void closeSub(sub);
    });
    ws.on('error', () => ws.terminate());
  }
}
