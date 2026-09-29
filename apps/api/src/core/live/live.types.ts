import type { LiveChannel, Problem } from '@nephoscope/contracts';
import type { z } from 'zod';
import type { ProfileHandle } from '../credentials/profiles.service.js';

export interface LiveSink {
  data(payload: unknown): void;
  gap(dropped: number): void;
  error(problem: Problem): void;
  end(): void;
}

export interface LiveHandle {
  close(): void | Promise<void>;
  /** Optional native pause; without it the gateway closes and reopens the stream (SPEC-0001 CA-39). */
  pause?(): void;
  resume?(): void;
}

export interface LiveContext<P> {
  profile: ProfileHandle;
  projectId: string | null;
  params: P;
}

export interface LiveChannelProvider<P = unknown> {
  channel: LiveChannel;
  params: z.ZodType<P>;
  /** Mutating channels are refused in read-only mode (SPEC-0001 CA-48). */
  mutating?: boolean;
  /** Milliseconds to wait before honoring a pause (SPEC-0004 D-10 uses 60 s). */
  pauseGraceMs?: number;
  open(ctx: LiveContext<P>, sink: LiveSink): Promise<LiveHandle> | LiveHandle;
}
