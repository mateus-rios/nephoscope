import type { OperationAccepted } from '@nephoscope/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '../lib/api';
import { useOperations } from '../state/operations';

interface OperationMutationOptions<V, R extends OperationAccepted> {
  mutationFn: (vars: V) => Promise<R>;
  /** Shown as the toast title, such as "Deploying api". */
  started: (vars: V) => string;
  /** Query keys to refresh right away (the operation's end refreshes its product again). */
  invalidate?: readonly unknown[][];
  onSuccess?: (result: R, vars: V) => void;
}

/**
 * A mutation that starts a Google operation (SPEC-0001 CA-27): the 202 result goes straight into
 * the operations tray, and failures become a toast with the problem's detail.
 */
export function useOperationMutation<V, R extends OperationAccepted = OperationAccepted>(options: OperationMutationOptions<V, R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: options.mutationFn,
    onSuccess: (result, vars) => {
      useOperations.getState().upsert(result.operation);
      toast(options.started(vars), { description: 'Follow it in the operations tray.' });
      for (const key of options.invalidate ?? []) void client.invalidateQueries({ queryKey: key });
      options.onSuccess?.(result, vars);
    },
    onError: (err, vars) => {
      toast.error(`${options.started(vars)} failed`, {
        description: err instanceof ApiError ? err.problem.detail : String(err),
        duration: 10_000,
      });
    },
  });
}
