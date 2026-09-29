import type {
  ArtifactRepository,
  CreateService,
  DeployService,
  DockerImage,
  ExecuteJob,
  InvokeRequest,
  InvokeResponse,
  ListResponse,
  OperationAccepted,
  PublicAccessMode,
  Revision,
  RunExecution,
  RunJob,
  RunJobSummary,
  RunService,
  RunServiceSummary,
  RunTask,
  ServiceAccess,
  TrafficTarget,
  UpdateJob,
} from '@nephoscope/contracts';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useOperationMutation } from '../../kit/operations';
import { api, qs } from '../../lib/api';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/run`;
const svc = (p: string, l: string, s: string) => `${base(p)}/locations/${enc(l)}/services/${enc(s)}`;
const job = (p: string, l: string, j: string) => `${base(p)}/locations/${enc(l)}/jobs/${enc(j)}`;

export const runKeys = {
  services: (profileId: string | null, p: string) => ['run', profileId, p, 'services'] as const,
  service: (profileId: string | null, p: string, l: string, s: string) => ['run', profileId, p, 'service', l, s] as const,
  jobs: (profileId: string | null, p: string) => ['run', profileId, p, 'jobs'] as const,
  job: (profileId: string | null, p: string, l: string, j: string) => ['run', profileId, p, 'job', l, j] as const,
};

function useProfileId() {
  return useSession((s) => s.profileId);
}

export function useRunServices(projectId: string) {
  const profileId = useProfileId();
  return useInfiniteQuery({
    queryKey: runKeys.services(profileId, projectId),
    queryFn: ({ pageParam, signal }) =>
      api<ListResponse<RunServiceSummary>>(`${base(projectId)}/services${qs({ pageToken: pageParam })}`, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId,
  });
}

/** Public or private per service, resolved after the list (SPEC-0003 CA-01). */
export function useServiceAccess(projectId: string, names: string[]) {
  const profileId = useProfileId();
  const key = names.slice(0, 100).sort().join(',');
  return useQuery({
    queryKey: ['run', profileId, projectId, 'access', key],
    queryFn: ({ signal }) => api<ServiceAccess[]>(`${base(projectId)}/service-access${qs({ names: key })}`, { signal }),
    enabled: !!profileId && names.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useRunService(projectId: string, location: string, id: string) {
  const profileId = useProfileId();
  return useQuery({
    queryKey: runKeys.service(profileId, projectId, location, id),
    queryFn: ({ signal }) => api<RunService>(svc(projectId, location, id), { signal }),
    enabled: !!profileId,
    // A deploying service refreshes until it settles.
    refetchInterval: (q) => (q.state.data?.status === 'deploying' ? 4000 : false),
  });
}

export function useRunServiceYaml(projectId: string, location: string, id: string, enabled: boolean) {
  const profileId = useProfileId();
  return useQuery({
    queryKey: [...runKeys.service(profileId, projectId, location, id), 'yaml'],
    queryFn: ({ signal }) => api<unknown>(`${svc(projectId, location, id)}/yaml`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export function useServiceAccessOne(projectId: string, location: string, id: string, enabled = true) {
  const profileId = useProfileId();
  return useQuery({
    queryKey: [...runKeys.service(profileId, projectId, location, id), 'access'],
    queryFn: ({ signal }) => api<ServiceAccess>(`${svc(projectId, location, id)}/access`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export function useRevisions(projectId: string, location: string, id: string) {
  const profileId = useProfileId();
  return useInfiniteQuery({
    queryKey: [...runKeys.service(profileId, projectId, location, id), 'revisions'],
    queryFn: ({ pageParam, signal }) =>
      api<ListResponse<Revision>>(`${svc(projectId, location, id)}/revisions${qs({ pageToken: pageParam })}`, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId,
  });
}

export function useRevisionRaw(projectId: string, location: string, id: string, revision: string | null) {
  const profileId = useProfileId();
  return useQuery({
    queryKey: [...runKeys.service(profileId, projectId, location, id), 'revision-raw', revision],
    queryFn: ({ signal }) => api<unknown>(`${svc(projectId, location, id)}/revisions/${enc(revision ?? '')}/raw`, { signal }),
    enabled: !!profileId && !!revision,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRunJobs(projectId: string) {
  const profileId = useProfileId();
  return useInfiniteQuery({
    queryKey: runKeys.jobs(profileId, projectId),
    queryFn: ({ pageParam, signal }) =>
      api<ListResponse<RunJobSummary>>(`${base(projectId)}/jobs${qs({ pageToken: pageParam })}`, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId,
  });
}

export function useRunJob(projectId: string, location: string, id: string) {
  const profileId = useProfileId();
  return useQuery({
    queryKey: runKeys.job(profileId, projectId, location, id),
    queryFn: ({ signal }) => api<RunJob>(job(projectId, location, id), { signal }),
    enabled: !!profileId,
  });
}

export function useRunJobYaml(projectId: string, location: string, id: string, enabled: boolean) {
  const profileId = useProfileId();
  return useQuery({
    queryKey: [...runKeys.job(profileId, projectId, location, id), 'yaml'],
    queryFn: ({ signal }) => api<unknown>(`${job(projectId, location, id)}/yaml`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export function useExecutions(projectId: string, location: string, id: string) {
  const profileId = useProfileId();
  return useInfiniteQuery({
    queryKey: [...runKeys.job(profileId, projectId, location, id), 'executions'],
    queryFn: ({ pageParam, signal }) =>
      api<ListResponse<RunExecution>>(`${job(projectId, location, id)}/executions${qs({ pageToken: pageParam })}`, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId,
    refetchInterval: (q) => (q.state.data?.pages[0]?.items.some((e) => e.outcome === 'running' || e.outcome === 'pending') ? 5000 : false),
  });
}

export function useExecution(projectId: string, location: string, jobId: string, execution: string) {
  const profileId = useProfileId();
  const path = `${job(projectId, location, jobId)}/executions/${enc(execution)}`;
  const execQuery = useQuery({
    queryKey: [...runKeys.job(profileId, projectId, location, jobId), 'execution', execution],
    queryFn: ({ signal }) => api<RunExecution>(path, { signal }),
    enabled: !!profileId,
  });
  const tasksQuery = useQuery({
    queryKey: [...runKeys.job(profileId, projectId, location, jobId), 'execution', execution, 'tasks'],
    queryFn: ({ signal }) => api<RunTask[]>(`${path}/tasks`, { signal }),
    enabled: !!profileId,
  });
  return { execQuery, tasksQuery };
}

export function useExecutionRaw(projectId: string, location: string, jobId: string, execution: string, enabled: boolean) {
  const profileId = useProfileId();
  return useQuery({
    queryKey: [...runKeys.job(profileId, projectId, location, jobId), 'execution', execution, 'raw'],
    queryFn: ({ signal }) => api<unknown>(`${job(projectId, location, jobId)}/executions/${enc(execution)}/raw`, { signal }),
    enabled: !!profileId && enabled,
  });
}

// ---- Mutations -------------------------------------------------------------------------------

export function useCreateService(projectId: string) {
  const profileId = useProfileId();
  return useOperationMutation({
    mutationFn: (body: CreateService) => api<OperationAccepted>(`${base(projectId)}/services`, { body }),
    started: (b) => `Creating ${b.id} in ${b.region}`,
    invalidate: [[...runKeys.services(profileId, projectId)]],
  });
}

export function useDeploy(projectId: string, location: string, id: string) {
  const profileId = useProfileId();
  return useOperationMutation({
    mutationFn: (body: DeployService) => api<OperationAccepted>(`${svc(projectId, location, id)}/deploy`, { body }),
    started: () => `Deploying ${id}`,
    invalidate: [[...runKeys.service(profileId, projectId, location, id)]],
  });
}

export function useSetTraffic(projectId: string, location: string, id: string) {
  const profileId = useProfileId();
  return useOperationMutation({
    mutationFn: (body: { traffic: TrafficTarget[]; etag?: string }) =>
      api<OperationAccepted>(`${svc(projectId, location, id)}/traffic`, { method: 'PUT', body }),
    started: () => `Updating traffic of ${id}`,
    invalidate: [[...runKeys.service(profileId, projectId, location, id)]],
  });
}

export function useRollback(projectId: string, location: string, id: string) {
  const profileId = useProfileId();
  return useOperationMutation({
    mutationFn: (revision: string) => api<OperationAccepted>(`${svc(projectId, location, id)}/rollback`, { body: { revision } }),
    started: (r) => `Rolling back ${id} to ${r}`,
    invalidate: [[...runKeys.service(profileId, projectId, location, id)]],
  });
}

export function useSetAccess(projectId: string, location: string, id: string) {
  const profileId = useProfileId();
  return useOperationMutation({
    mutationFn: (mode: PublicAccessMode) =>
      api<OperationAccepted>(`${svc(projectId, location, id)}/access`, { method: 'PUT', body: { mode } }),
    started: (m) => (m === 'none' ? `Requiring authentication on ${id}` : `Allowing public access to ${id}`),
    invalidate: [[...runKeys.service(profileId, projectId, location, id)], ['run', profileId, projectId, 'access']],
  });
}

export function deleteService(projectId: string, location: string, id: string, confirm: string) {
  return api<OperationAccepted>(svc(projectId, location, id), { method: 'DELETE', body: { confirm } });
}

export function deleteRevision(projectId: string, location: string, id: string, revision: string, confirm: string) {
  return api<OperationAccepted>(`${svc(projectId, location, id)}/revisions/${enc(revision)}`, { method: 'DELETE', body: { confirm } });
}

export function invokeService(projectId: string, location: string, id: string, req: InvokeRequest) {
  return api<InvokeResponse>(`${svc(projectId, location, id)}/invoke`, { body: req });
}

export function useUpdateJob(projectId: string, location: string, id: string) {
  const profileId = useProfileId();
  return useOperationMutation({
    mutationFn: (body: UpdateJob) => api<OperationAccepted>(job(projectId, location, id), { method: 'PATCH', body }),
    started: () => `Updating ${id}`,
    invalidate: [[...runKeys.job(profileId, projectId, location, id)]],
  });
}

export function useExecuteJob(projectId: string, location: string, id: string) {
  const profileId = useProfileId();
  return useOperationMutation<ExecuteJob, OperationAccepted & { execution: string | null }>({
    mutationFn: (body) => api<OperationAccepted & { execution: string | null }>(`${job(projectId, location, id)}/run`, { body }),
    started: () => `Executing ${id}`,
    invalidate: [[...runKeys.job(profileId, projectId, location, id)]],
  });
}

export function deleteJob(projectId: string, location: string, id: string, confirm: string) {
  return api<OperationAccepted>(job(projectId, location, id), { method: 'DELETE', body: { confirm } });
}

export function useCancelExecution(projectId: string, location: string, jobId: string) {
  const profileId = useProfileId();
  return useOperationMutation({
    mutationFn: (execution: string) =>
      api<OperationAccepted>(`${job(projectId, location, jobId)}/executions/${enc(execution)}/cancel`, { method: 'POST' }),
    started: (e) => `Cancelling ${e}`,
    invalidate: [[...runKeys.job(profileId, projectId, location, jobId)]],
  });
}

export function deleteExecution(projectId: string, location: string, jobId: string, execution: string, confirm: string) {
  return api<OperationAccepted>(`${job(projectId, location, jobId)}/executions/${enc(execution)}`, { method: 'DELETE', body: { confirm } });
}

export function useRepositories(projectId: string, enabled: boolean) {
  const profileId = useProfileId();
  return useQuery({
    queryKey: ['artifacts', profileId, projectId, 'repositories'],
    queryFn: ({ signal }) => api<ListResponse<ArtifactRepository>>(`/api/projects/${enc(projectId)}/artifacts/repositories`, { signal }),
    enabled: !!profileId && enabled,
    staleTime: 5 * 60_000,
  });
}

export function useDockerImages(projectId: string, repository: string | null) {
  const profileId = useProfileId();
  return useQuery({
    queryKey: ['artifacts', profileId, projectId, 'images', repository],
    queryFn: ({ signal }) =>
      api<ListResponse<DockerImage>>(`/api/projects/${enc(projectId)}/artifacts/docker-images${qs({ repository })}`, { signal }),
    enabled: !!profileId && !!repository,
    staleTime: 60_000,
  });
}
