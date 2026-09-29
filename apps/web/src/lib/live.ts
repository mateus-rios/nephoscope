import type { LiveChannel, LiveClientMessage, LiveServerMessage, Problem } from '@nephoscope/contracts';
import { LIVE_PATH } from '@nephoscope/contracts/constants';

export type LiveStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

export interface LiveHandlers {
  data(payload: unknown): void;
  error?(problem: Problem): void;
  gap?(dropped: number): void;
  end?(): void;
}

interface Subscription {
  message: Extract<LiveClientMessage, { type: 'sub' }>;
  handlers: LiveHandlers;
}

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 10_000;

/**
 * One WebSocket per tab, multiplexing every live view (SPEC-0001 D-10, CA-36 to CA-40): reconnects
 * with backoff, resubscribes everything, and pauses streams while the tab is hidden.
 */
class LiveClient {
  private ws: WebSocket | null = null;
  private readonly subs = new Map<string, Subscription>();
  private readonly statusListeners = new Set<(s: LiveStatus) => void>();
  private status: LiveStatus = 'idle';
  private backoff = 500;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private counter = 0;
  private visibilityBound = false;

  getStatus(): LiveStatus {
    return this.status;
  }

  onStatus(listener: (s: LiveStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  subscribe(
    channel: LiveChannel,
    context: { profileId: string; projectId: string | null },
    params: unknown,
    handlers: LiveHandlers,
  ): () => void {
    const id = `s${++this.counter}`;
    const message: Subscription['message'] = {
      type: 'sub',
      id,
      channel,
      profileId: context.profileId,
      projectId: context.projectId,
      params,
    };
    this.subs.set(id, { message, handlers });
    this.bindVisibility();
    if (this.ws?.readyState === WebSocket.OPEN) this.send(message);
    else this.connect();
    return () => {
      if (!this.subs.delete(id)) return;
      this.send({ type: 'unsub', id });
      if (this.subs.size === 0) this.scheduleIdleClose();
    };
  }

  private setStatus(s: LiveStatus) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  private send(message: LiveClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}${LIVE_PATH}`);
    this.ws = ws;
    this.setStatus(this.status === 'idle' ? 'connecting' : 'reconnecting');

    ws.onopen = () => {
      this.backoff = 500;
      this.setStatus('open');
      for (const sub of this.subs.values()) this.send(sub.message);
      if (document.visibilityState === 'hidden') this.pauseAll();
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_MS);
    };

    ws.onmessage = (event) => {
      let msg: LiveServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as LiveServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'pong') return;
      const sub = this.subs.get(msg.id);
      if (!sub) return;
      switch (msg.type) {
        case 'data':
          sub.handlers.data(msg.data);
          break;
        case 'gap':
          sub.handlers.gap?.(msg.dropped);
          break;
        case 'error':
          this.subs.delete(msg.id);
          sub.handlers.error?.(msg.problem);
          break;
        case 'end':
          this.subs.delete(msg.id);
          sub.handlers.end?.();
          break;
      }
    };

    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.ws = null;
      if (this.subs.size === 0) {
        this.setStatus('idle');
        return;
      }
      this.setStatus('reconnecting');
      const delay = this.backoff;
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  private scheduleIdleClose() {
    setTimeout(() => {
      if (this.subs.size === 0 && this.ws) {
        this.ws.close(1000, 'No live views');
      }
    }, 5_000);
  }

  private pauseAll() {
    for (const id of this.subs.keys()) this.send({ type: 'pause', id });
  }

  private resumeAll() {
    for (const id of this.subs.keys()) this.send({ type: 'resume', id });
  }

  private bindVisibility() {
    if (this.visibilityBound) return;
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.pauseAll();
      else this.resumeAll();
    });
  }
}

export const live = new LiveClient();
