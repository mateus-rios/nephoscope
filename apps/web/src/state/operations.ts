import type { OperationSummary } from '@nephoscope/contracts';
import { create } from 'zustand';

interface OperationsState {
  byId: Record<string, OperationSummary>;
  replaceAll(ops: OperationSummary[]): void;
  upsert(op: OperationSummary): OperationSummary | undefined;
}

/** Operations of the active profile, fed by the `ops` live channel (SPEC-0001 CA-33, CA-34). */
export const useOperations = create<OperationsState>((set, get) => ({
  byId: {},
  replaceAll(ops) {
    set({ byId: Object.fromEntries(ops.map((o) => [o.id, o])) });
  },
  upsert(op) {
    const previous = get().byId[op.id];
    set((s) => ({ byId: { ...s.byId, [op.id]: op } }));
    return previous;
  },
}));

export function sortOperations(ops: OperationSummary[]): OperationSummary[] {
  return [...ops].sort((a, b) => {
    const ra = a.status === 'running' ? 0 : 1;
    const rb = b.status === 'running' ? 0 : 1;
    return ra - rb || b.startedAt.localeCompare(a.startedAt);
  });
}
