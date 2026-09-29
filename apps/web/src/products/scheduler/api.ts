import type {
  BulkResult,
  BulkScheduler,
  CreateSchedulerJob,
  ListResponse,
  SaveSchedulerJob,
  SchedulerAction,
  SchedulerJob,
  SchedulerTarget,
} from '@nephoscope/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, api } from '../../lib/api';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/scheduler`;
const job = (p: string, l: string, j: string) => `${base(p)}/locations/${enc(l)}/jobs/${enc(j)}`;

const failed = (what: string) => (err: unknown) =>
  toast.error(`${what} failed`, { description: err instanceof ApiError ? err.problem.detail : String(err) });

export function useSchedulerJobs(projectId: string, enabled = true) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['scheduler', profileId, projectId],
    queryFn: ({ signal }) => api<ListResponse<SchedulerJob>>(`${base(projectId)}/jobs`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export function useSchedulerJob(projectId: string, location: string, id: string) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['scheduler', profileId, projectId, location, id],
    queryFn: ({ signal }) => api<SchedulerJob>(job(projectId, location, id), { signal }),
    enabled: !!profileId,
  });
}

export function useSchedulerJobRaw(projectId: string, location: string, id: string, enabled: boolean) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['scheduler', profileId, projectId, location, id, 'raw'],
    queryFn: ({ signal }) => api<unknown>(`${job(projectId, location, id)}/raw`, { signal }),
    enabled: !!profileId && enabled,
  });
}

function useInvalidate(projectId: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return () => client.invalidateQueries({ queryKey: ['scheduler', profileId, projectId] });
}

export function useCreateSchedulerJob(projectId: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (body: CreateSchedulerJob) => api<SchedulerJob>(`${base(projectId)}/jobs`, { body }),
    onSuccess: (j) => {
      void invalidate();
      toast.success(`Created ${j.id}`);
    },
    onError: failed('Creating the job'),
  });
}

export function useUpdateSchedulerJob(projectId: string, location: string, id: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (body: SaveSchedulerJob) => api<SchedulerJob>(job(projectId, location, id), { method: 'PUT', body }),
    onSuccess: () => {
      void invalidate();
      toast.success(`Saved ${id}`);
    },
    onError: failed('Saving the job'),
  });
}

export function useSchedulerAction(projectId: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: ({ location, id, action }: { location: string; id: string; action: SchedulerAction }) =>
      api<SchedulerJob>(`${job(projectId, location, id)}/${action}`, { method: 'POST' }),
    onSuccess: (j, v) => {
      void invalidate();
      toast(v.action === 'run' ? `${j.id} is running now` : v.action === 'pause' ? `Paused ${j.id}` : `Resumed ${j.id}`);
    },
    onError: failed('The action'),
  });
}

export function useBulkScheduler(projectId: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (body: BulkScheduler) => api<BulkResult[]>(`${base(projectId)}/bulk`, { body }),
    onSuccess: (results) => {
      void invalidate();
      const bad = results.filter((r) => !r.ok);
      if (bad.length === 0) toast.success(`Done for ${results.length} ${results.length === 1 ? 'job' : 'jobs'}`);
      else
        toast.error(`${bad.length} of ${results.length} failed`, {
          description: bad.map((b) => `${b.name.split('/').pop()}: ${b.error}`).join('\n'),
          duration: 12_000,
        });
    },
    onError: failed('The bulk action'),
  });
}

export function deleteSchedulerJob(projectId: string, location: string, id: string, confirm: string) {
  return api<void>(job(projectId, location, id), { method: 'DELETE', body: { confirm } });
}

export function targetSummary(t: SchedulerTarget): string {
  if (t.kind === 'pubsub') return `Pub/Sub ${t.topic.split('/').pop()}`;
  if (t.kind === 'appengine') return `App Engine ${t.method} ${t.relativeUri}`;
  return `${t.method} ${t.uri}`;
}

/** SPEC-0003 CA-30. */
export const schedulerLogFilter = (id: string, location: string) =>
  `resource.type="cloud_scheduler_job" resource.labels.job_id="${id}" resource.labels.location="${location}"`;
