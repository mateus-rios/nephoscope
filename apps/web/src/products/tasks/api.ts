import type { CreateQueue, CreateTask, ListResponse, QueueAction, QueueTask, SaveQueue, TaskQueue } from '@nephoscope/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, api } from '../../lib/api';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/tasks`;
const queue = (p: string, l: string, q: string) => `${base(p)}/locations/${enc(l)}/queues/${enc(q)}`;
const failed = (what: string) => (err: unknown) =>
  toast.error(`${what} failed`, { description: err instanceof ApiError ? err.problem.detail : String(err) });

export function useQueues(projectId: string) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['tasks', profileId, projectId],
    queryFn: ({ signal }) => api<ListResponse<TaskQueue>>(`${base(projectId)}/queues`, { signal }),
    enabled: !!profileId,
  });
}

export function useQueue(projectId: string, location: string, id: string) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['tasks', profileId, projectId, location, id],
    queryFn: ({ signal }) => api<TaskQueue>(queue(projectId, location, id), { signal }),
    enabled: !!profileId,
  });
}

export function useQueueRaw(projectId: string, location: string, id: string, enabled: boolean) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['tasks', profileId, projectId, location, id, 'raw'],
    queryFn: ({ signal }) => api<unknown>(`${queue(projectId, location, id)}/raw`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export function useQueueTasks(projectId: string, location: string, id: string) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['tasks', profileId, projectId, location, id, 'tasks'],
    queryFn: ({ signal }) => api<ListResponse<QueueTask>>(`${queue(projectId, location, id)}/tasks`, { signal }),
    enabled: !!profileId,
  });
}

function useInvalidate(projectId: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return () => client.invalidateQueries({ queryKey: ['tasks', profileId, projectId] });
}

export function useCreateQueue(projectId: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (body: CreateQueue) => api<TaskQueue>(`${base(projectId)}/queues`, { body }),
    onSuccess: (q) => {
      void invalidate();
      toast.success(`Created queue ${q.id}`);
    },
    onError: failed('Creating the queue'),
  });
}

export function useSaveQueue(projectId: string, location: string, id: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (body: SaveQueue) => api<TaskQueue>(queue(projectId, location, id), { method: 'PUT', body }),
    onSuccess: () => {
      void invalidate();
      toast.success(`Saved ${id}`);
    },
    onError: failed('Saving the queue'),
  });
}

export function useQueueAction(projectId: string, location: string, id: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (action: QueueAction) => api<TaskQueue>(`${queue(projectId, location, id)}/${action}`, { method: 'POST' }),
    onSuccess: (_q, action) => {
      void invalidate();
      toast(action === 'pause' ? `Paused ${id}` : `Resumed ${id}`);
    },
    onError: failed('The action'),
  });
}

export function purgeQueue(projectId: string, location: string, id: string, confirm: string) {
  return api<TaskQueue>(`${queue(projectId, location, id)}/purge`, { body: { confirm } });
}

export function deleteQueue(projectId: string, location: string, id: string, confirm: string) {
  return api<void>(queue(projectId, location, id), { method: 'DELETE', body: { confirm } });
}

export function useCreateTask(projectId: string, location: string, id: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (body: CreateTask) => api<QueueTask>(`${queue(projectId, location, id)}/tasks`, { body }),
    onSuccess: (t) => {
      void invalidate();
      toast.success(`Created task ${t.id}`);
    },
    onError: failed('Creating the task'),
  });
}

export function useRunTask(projectId: string, location: string, id: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (task: string) => api<QueueTask>(`${queue(projectId, location, id)}/tasks/${enc(task)}/run`, { method: 'POST' }),
    onSuccess: (t) => {
      void invalidate();
      toast(`Dispatched task ${t.id}`);
    },
    onError: failed('Running the task'),
  });
}

export function deleteTask(projectId: string, location: string, id: string, task: string, confirm: string) {
  return api<void>(`${queue(projectId, location, id)}/tasks/${enc(task)}`, { method: 'DELETE', body: { confirm } });
}

/** SPEC-0003 CA-30. */
export const queueLogFilter = (id: string) => `resource.type="cloud_tasks_queue" resource.labels.queue_id="${id}"`;
