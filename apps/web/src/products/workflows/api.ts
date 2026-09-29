import type {
  CreateWorkflow,
  DeployWorkflow,
  ExecuteWorkflow,
  ListResponse,
  OperationAccepted,
  StepEntry,
  Workflow,
  WorkflowExecution,
  WorkflowRevision,
  WorkflowSummary,
} from '@nephoscope/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useOperationMutation } from '../../kit/operations';
import { ApiError, api, qs } from '../../lib/api';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/workflows`;
const wf = (p: string, l: string, w: string) => `${base(p)}/locations/${enc(l)}/workflows/${enc(w)}`;
export const wfKey = (profileId: string | null, p: string, l: string, w: string) => ['workflows', profileId, p, l, w] as const;

export function useWorkflows(projectId: string) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['workflows', profileId, projectId],
    queryFn: ({ signal }) => api<ListResponse<WorkflowSummary>>(base(projectId), { signal }),
    enabled: !!profileId,
  });
}

export function useWorkflow(projectId: string, location: string, id: string) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: wfKey(profileId, projectId, location, id),
    queryFn: ({ signal }) => api<Workflow>(wf(projectId, location, id), { signal }),
    enabled: !!profileId,
  });
}

export function useWorkflowRaw(projectId: string, location: string, id: string, enabled: boolean) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: [...wfKey(profileId, projectId, location, id), 'raw'],
    queryFn: ({ signal }) => api<unknown>(`${wf(projectId, location, id)}/raw`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export function useWorkflowRevisions(projectId: string, location: string, id: string, enabled: boolean) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: [...wfKey(profileId, projectId, location, id), 'revisions'],
    queryFn: ({ signal }) => api<WorkflowRevision[]>(`${wf(projectId, location, id)}/revisions`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export function useWorkflowExecutions(projectId: string, location: string, id: string) {
  const profileId = useSession((s) => s.profileId);
  return useInfiniteQuery({
    queryKey: [...wfKey(profileId, projectId, location, id), 'executions'],
    queryFn: ({ pageParam, signal }) =>
      api<ListResponse<WorkflowExecution>>(`${wf(projectId, location, id)}/executions${qs({ pageToken: pageParam })}`, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId,
    refetchInterval: (q) => (q.state.data?.pages[0]?.items.some((e) => e.state === 'active' || e.state === 'queued') ? 5000 : false),
  });
}

export function useWorkflowExecution(projectId: string, location: string, id: string, execution: string) {
  const profileId = useSession((s) => s.profileId);
  const path = `${wf(projectId, location, id)}/executions/${enc(execution)}`;
  const key = [...wfKey(profileId, projectId, location, id), 'execution', execution] as const;
  const exec = useQuery({ queryKey: key, queryFn: ({ signal }) => api<WorkflowExecution>(path, { signal }), enabled: !!profileId });
  const detailed = exec.data?.historyLevel === 'EXECUTION_HISTORY_DETAILED';
  const steps = useQuery({
    queryKey: [...key, 'steps'],
    queryFn: ({ signal }) => api<StepEntry[]>(`${path}/steps${qs({ detailed: detailed ? '1' : undefined })}`, { signal }),
    enabled: !!profileId && !!exec.data,
  });
  return { exec, steps, key };
}

export function useArgHistory(workflowName: string) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['history', `workflows.args:${workflowName}`, profileId],
    queryFn: ({ signal }) => api<string[]>(`/api/history/${enc(`workflows.args:${workflowName}`)}`, { signal, profileId: null }),
    staleTime: 0,
  });
}

export function useDeployWorkflow(projectId: string, location: string, id: string) {
  const profileId = useSession((s) => s.profileId);
  return useOperationMutation({
    mutationFn: (body: DeployWorkflow) => api<OperationAccepted>(`${wf(projectId, location, id)}/deploy`, { body }),
    started: () => `Deploying ${id}`,
    invalidate: [[...wfKey(profileId, projectId, location, id)]],
  });
}

export function useCreateWorkflow(projectId: string) {
  const profileId = useSession((s) => s.profileId);
  return useOperationMutation({
    mutationFn: (body: CreateWorkflow) => api<OperationAccepted>(base(projectId), { body }),
    started: (b) => `Creating ${b.id}`,
    invalidate: [['workflows', profileId, projectId]],
  });
}

export function useExecuteWorkflow(projectId: string, location: string, id: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return useMutation({
    mutationFn: (body: ExecuteWorkflow) => api<WorkflowExecution>(`${wf(projectId, location, id)}/executions`, { body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [...wfKey(profileId, projectId, location, id), 'executions'] });
      void client.invalidateQueries({ queryKey: ['history'] });
    },
    onError: (err) => toast.error(`Executing ${id} failed`, { description: err instanceof ApiError ? err.problem.detail : String(err) }),
  });
}

export function useCancelWorkflowExecution(projectId: string, location: string, id: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return useMutation({
    mutationFn: (execution: string) =>
      api<WorkflowExecution>(`${wf(projectId, location, id)}/executions/${enc(execution)}/cancel`, { method: 'POST' }),
    onSuccess: (e) => {
      client.setQueryData([...wfKey(profileId, projectId, location, id), 'execution', e.id], e);
      toast(`Cancelled ${e.id}`);
    },
    onError: (err) => toast.error('Cancelling failed', { description: err instanceof ApiError ? err.problem.detail : String(err) }),
  });
}

export function deleteWorkflow(projectId: string, location: string, id: string, confirm: string) {
  return api<OperationAccepted>(wf(projectId, location, id), { method: 'DELETE', body: { confirm } });
}

/** SPEC-0003 CA-30. */
export function workflowLogFilter(id: string, location: string, execution?: string): string {
  const base = `resource.type="workflows.googleapis.com/Workflow" resource.labels.workflow_id="${id}" resource.labels.location="${location}"`;
  return execution ? `${base} labels."workflows.googleapis.com/execution_id"="${execution}"` : base;
}
