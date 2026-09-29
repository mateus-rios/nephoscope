import type {
  CloudFunction,
  FunctionSource,
  FunctionSummary,
  InvokeRequest,
  InvokeResponse,
  ListResponse,
  OperationAccepted,
  RedeploySource,
} from '@nephoscope/contracts';
import { useQuery } from '@tanstack/react-query';
import { useOperationMutation } from '../../kit/operations';
import { api, downloadFromApi } from '../../lib/api';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/functions`;
const fn = (p: string, l: string, f: string) => `${base(p)}/locations/${enc(l)}/functions/${enc(f)}`;

export function useFunctions(projectId: string) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['functions', profileId, projectId],
    queryFn: ({ signal }) => api<ListResponse<FunctionSummary>>(base(projectId), { signal }),
    enabled: !!profileId,
  });
}

export function useFunction(projectId: string, location: string, id: string) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['functions', profileId, projectId, location, id],
    queryFn: ({ signal }) => api<CloudFunction>(fn(projectId, location, id), { signal }),
    enabled: !!profileId,
    refetchInterval: (q) => (q.state.data?.state === 'deploying' ? 5000 : false),
  });
}

export function useFunctionRaw(projectId: string, location: string, id: string, enabled: boolean) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['functions', profileId, projectId, location, id, 'raw'],
    queryFn: ({ signal }) => api<unknown>(`${fn(projectId, location, id)}/raw`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export function useFunctionSource(projectId: string, location: string, id: string, enabled: boolean) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['functions', profileId, projectId, location, id, 'source'],
    queryFn: ({ signal }) => api<FunctionSource>(`${fn(projectId, location, id)}/source`, { signal }),
    enabled: !!profileId && enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRedeploySource(projectId: string, location: string, id: string) {
  const profileId = useSession((s) => s.profileId);
  return useOperationMutation({
    mutationFn: (body: RedeploySource) => api<OperationAccepted>(`${fn(projectId, location, id)}/source`, { body }),
    started: () => `Redeploying ${id}`,
    invalidate: [['functions', profileId, projectId, location, id]],
  });
}

export function invokeFunction(projectId: string, location: string, id: string, req: InvokeRequest) {
  return api<InvokeResponse>(`${fn(projectId, location, id)}/invoke`, { body: req });
}

export function deleteFunction(projectId: string, location: string, id: string, confirm: string) {
  return api<OperationAccepted>(fn(projectId, location, id), { method: 'DELETE', body: { confirm } });
}

export function downloadSource(projectId: string, location: string, id: string) {
  return downloadFromApi(`${fn(projectId, location, id)}/source/archive`, `${id}-source.zip`);
}

export const functionLogFilter = (f: Pick<FunctionSummary, 'id' | 'location' | 'generation' | 'runService'>): string => {
  if (f.generation === 'gen1')
    return `resource.type="cloud_function" resource.labels.function_name="${f.id}" resource.labels.region="${f.location}"`;
  const service = f.runService?.split('/').pop() ?? f.id;
  return `resource.type="cloud_run_revision" resource.labels.service_name="${service}" resource.labels.location="${f.location}"`;
};
