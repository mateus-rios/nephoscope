import { randomUUID } from 'node:crypto';
import type { OperationFamily, OperationSummary, Problem } from '@nephoscope/contracts';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { toProblem } from '../problem/google-error.mapper.js';
import { JsonStore } from '../store/json-store.js';

export interface PollResult {
  done: boolean;
  /** Set when done with a failure. */
  error?: Problem;
  progress?: number | null;
  message?: string | null;
  cancelled?: boolean;
}

export type Poller = () => Promise<PollResult>;

export interface TrackInput {
  profileId: string;
  projectId: string;
  product: string;
  kind: string;
  family: OperationFamily;
  resource: OperationSummary['resource'];
  googleName: string | null;
  poll: Poller;
}

/** Rebuilds a poller for an operation found in operations.json after a restart (SPEC-0001 CA-35). */
export type Resumer = (summary: OperationSummary) => Poller | null;

type Listener = (op: OperationSummary) => void;

const OPERATIONS_FILE = 'operations.json';
const KEEP = 200;
const BACKOFF_MS = [1000, 2000, 5000];
const STEADY_MS = 10_000;

/** Long-running operation tracker (SPEC-0001 D-09, CA-32 to CA-35). */
@Injectable()
export class OperationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Operations');
  private readonly ops = new Map<string, OperationSummary>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly listeners = new Set<Listener>();
  private readonly resumers = new Map<string, Resumer>();
  private readonly aborters = new Map<string, AbortController>();
  private stopped = false;

  constructor(private readonly store: JsonStore) {}

  async onModuleInit(): Promise<void> {
    const saved = await this.store.read<OperationSummary[]>(OPERATIONS_FILE, []);
    for (const op of saved.slice(-KEEP)) this.ops.set(op.id, op);
    for (const [kind, resumer] of this.resumers) this.resumeKind(kind, resumer);
    // Operations of products never opened in this session cannot be polled: mark them unknown.
    const grace = setTimeout(() => {
      for (const op of this.ops.values()) {
        if (op.status === 'running' && !this.timers.has(op.id)) {
          this.finish(op.id, { status: 'unknown', message: 'Status unknown after a restart' });
        }
      }
    }, 60_000);
    grace.unref();
  }

  private resumeKind(kind: string, resumer: Resumer): void {
    for (const op of this.ops.values()) {
      if (op.kind === kind && op.status === 'running' && !this.timers.has(op.id)) {
        const poll = resumer(op);
        if (poll) this.schedule(op.id, poll, 0);
        else this.finish(op.id, { status: 'unknown', message: 'Status unknown after a restart' });
      }
    }
  }

  /** Registers how to resume operations of a kind after a restart. Called by product modules. */
  registerResumer(kind: string, resumer: Resumer): void {
    this.resumers.set(kind, resumer);
    this.resumeKind(kind, resumer);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(profileId?: string): OperationSummary[] {
    return [...this.ops.values()]
      .filter((o) => !profileId || o.profileId === profileId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  get(id: string): OperationSummary | undefined {
    return this.ops.get(id);
  }

  track(input: TrackInput): OperationSummary {
    const op: OperationSummary = {
      id: randomUUID(),
      profileId: input.profileId,
      projectId: input.projectId,
      product: input.product,
      kind: input.kind,
      family: input.family,
      resource: input.resource,
      status: 'running',
      progress: null,
      message: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      googleName: input.googleName,
    };
    this.ops.set(op.id, op);
    this.emit(op);
    this.schedule(op.id, input.poll, 0);
    return op;
  }

  /**
   * Runs work Nephoscope does itself, such as a recursive delete (SPEC-0004 D-05), as an operation:
   * progress is pushed as it happens (at most twice a second) and cancel() aborts the signal.
   */
  trackLocal(
    input: Omit<TrackInput, 'poll' | 'family' | 'googleName'>,
    run: (report: (progress: number | null, message: string) => void, signal: AbortSignal) => Promise<string | undefined>,
  ): OperationSummary {
    const op: OperationSummary = {
      id: randomUUID(),
      profileId: input.profileId,
      projectId: input.projectId,
      product: input.product,
      kind: input.kind,
      family: 'local',
      resource: input.resource,
      status: 'running',
      progress: null,
      message: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      googleName: null,
      cancellable: true,
    };
    const abort = new AbortController();
    this.ops.set(op.id, op);
    this.aborters.set(op.id, abort);
    this.emit(op);
    let last = 0;
    const report = (progress: number | null, message: string) => {
      const cur = this.ops.get(op.id);
      if (cur?.status !== 'running') return;
      const next = { ...cur, progress: progress === null ? null : Math.max(0, Math.min(99, Math.round(progress))), message };
      this.ops.set(op.id, next);
      const now = Date.now();
      if (now - last >= 500) {
        last = now;
        this.emit(next);
      }
    };
    void run(report, abort.signal).then(
      (message) => {
        this.aborters.delete(op.id);
        const cur = this.ops.get(op.id);
        if (abort.signal.aborted) this.finish(op.id, { status: 'cancelled', cancellable: false, message: message ?? cur?.message ?? null });
        else this.finish(op.id, { status: 'succeeded', progress: 100, cancellable: false, message: message ?? cur?.message ?? null });
      },
      (err: unknown) => {
        this.aborters.delete(op.id);
        const cur = this.ops.get(op.id);
        this.finish(op.id, { status: 'failed', cancellable: false, error: toProblem(err), message: cur?.message ?? null });
      },
    );
    return op;
  }

  /** Stops a running local operation; returns false when it cannot be cancelled. */
  cancel(id: string): boolean {
    const abort = this.aborters.get(id);
    if (!abort) return false;
    abort.abort();
    return true;
  }

  /** Records a mutation that finished at once, so it appears in the tray like the others. */
  recordInstant(input: Omit<TrackInput, 'poll' | 'family' | 'googleName'> & { message?: string }): OperationSummary {
    const now = new Date().toISOString();
    const op: OperationSummary = {
      id: randomUUID(),
      profileId: input.profileId,
      projectId: input.projectId,
      product: input.product,
      kind: input.kind,
      family: 'instant',
      resource: input.resource,
      status: 'succeeded',
      progress: 100,
      message: input.message ?? null,
      startedAt: now,
      finishedAt: now,
      error: null,
      googleName: null,
    };
    this.ops.set(op.id, op);
    this.emit(op);
    void this.persist();
    return op;
  }

  private schedule(id: string, poll: Poller, attempt: number): void {
    if (this.stopped) return;
    const delay = attempt === 0 ? 0 : (BACKOFF_MS[attempt - 1] ?? STEADY_MS);
    const timer = setTimeout(() => void this.tick(id, poll, attempt), delay);
    timer.unref();
    this.timers.set(id, timer);
  }

  private async tick(id: string, poll: Poller, attempt: number): Promise<void> {
    this.timers.delete(id);
    const op = this.ops.get(id);
    if (op?.status !== 'running') return;
    try {
      const r = await poll();
      if (r.done) {
        if (r.cancelled) this.finish(id, { status: 'cancelled', message: r.message ?? null });
        else if (r.error) this.finish(id, { status: 'failed', error: r.error, message: r.message ?? null });
        else this.finish(id, { status: 'succeeded', progress: 100, message: r.message ?? null });
        return;
      }
      if (r.progress !== undefined || r.message !== undefined) {
        const next = { ...op, progress: r.progress ?? op.progress, message: r.message ?? op.message };
        this.ops.set(id, next);
        this.emit(next);
      }
    } catch (err) {
      // A failing poll is retried; the error is only kept if the operation itself fails.
      this.logger.debug({ msg: 'Operation poll failed; retrying', id, error: String(err) });
      if (attempt > 30) {
        this.finish(id, { status: 'failed', error: toProblem(err) });
        return;
      }
    }
    this.schedule(id, poll, attempt + 1);
  }

  private finish(id: string, patch: Partial<OperationSummary>): void {
    const op = this.ops.get(id);
    if (!op) return;
    const next: OperationSummary = { ...op, ...patch, finishedAt: new Date().toISOString() };
    this.ops.set(id, next);
    this.emit(next);
    void this.persist();
  }

  private emit(op: OperationSummary): void {
    for (const l of this.listeners) {
      try {
        l(op);
      } catch (err) {
        this.logger.debug({ msg: 'Operation listener failed', error: String(err) });
      }
    }
    if (op.status === 'running') void this.persist();
  }

  private async persist(): Promise<void> {
    const all = [...this.ops.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const kept = all.slice(-KEEP);
    if (kept.length < all.length) {
      for (const o of all.slice(0, all.length - KEEP)) this.ops.delete(o.id);
    }
    await this.store.write(OPERATIONS_FILE, kept).catch((err: unknown) => {
      this.logger.warn({ msg: 'Could not persist operations', error: String(err) });
    });
  }
}
