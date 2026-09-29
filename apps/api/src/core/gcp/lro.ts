import type { Poller, PollResult } from '../operations/operations.service.js';
import { toProblem } from '../problem/google-error.mapper.js';

/** The part of `google.longrunning.Operation` the tracker needs. */
export interface OperationLike {
  name?: string | null;
  done?: boolean | null;
  error?: { code?: number | null; message?: string | null } | null;
  metadata?: unknown;
}

/**
 * Poller for `google.longrunning` operations (SPEC-0001 D-09). `get` fetches the operation by
 * name, usually `client.getOperation({ name })` of the generated client that started it.
 */
export function lroPoller(get: (name: string) => Promise<OperationLike>, name: string, onDone?: () => void): Poller {
  return async (): Promise<PollResult> => {
    const op = await get(name);
    if (!op.done) return { done: false };
    onDone?.();
    if (op.error?.code) {
      // Code 1 is CANCELLED: the operation was cancelled rather than failed.
      if (op.error.code === 1) return { done: true, cancelled: true, message: op.error.message ?? null };
      return { done: true, error: toProblem({ code: op.error.code, details: op.error.message ?? 'The operation failed.' }) };
    }
    return { done: true };
  };
}

/** Reads `getOperation` from a generated client, which returns `[operation]`. */
export function operationGetter(client: {
  getOperation(request: { name: string }): Promise<[OperationLike]> | Promise<OperationLike[]>;
}): (name: string) => Promise<OperationLike> {
  return async (name) => {
    const [op] = await client.getOperation({ name });
    return op ?? { done: false };
  };
}
