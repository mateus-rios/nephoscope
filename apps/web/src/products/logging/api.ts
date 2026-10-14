import type {
  CreateLogBucket,
  CreateLogView,
  LogBucket,
  LogBucketLink,
  LogExclusionView,
  LogMetric,
  LogSink,
  LogsCatalog,
  LogView,
  SavedItem,
  SavedKind,
  SaveExclusion,
  SaveLogMetric,
  SaveSink,
  UpdateLogBucket,
} from '@nephoscope/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, api, qs } from '../../lib/api';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/logging`;
const failed = (what: string) => (err: unknown) =>
  toast.error(`${what} failed`, { description: err instanceof ApiError ? err.problem.detail : String(err), duration: 10_000 });

function useKey(projectId: string, ...rest: unknown[]) {
  const profileId = useSession((s) => s.profileId);
  return { key: ['logging', profileId, projectId, ...rest], enabled: !!profileId };
}

export function useLogsCatalog(projectId: string) {
  const { key, enabled } = useKey(projectId, 'catalog');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<LogsCatalog>(`${base(projectId)}/catalog`, { signal }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useSinks(projectId: string) {
  const { key, enabled } = useKey(projectId, 'sinks');
  return useQuery({ queryKey: key, queryFn: ({ signal }) => api<LogSink[]>(`${base(projectId)}/sinks`, { signal }), enabled });
}

export function useExclusions(projectId: string) {
  const { key, enabled } = useKey(projectId, 'exclusions');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<LogExclusionView[]>(`${base(projectId)}/exclusions`, { signal }),
    enabled,
  });
}

export function useLogBuckets(projectId: string) {
  const { key, enabled } = useKey(projectId, 'buckets');
  return useQuery({ queryKey: key, queryFn: ({ signal }) => api<LogBucket[]>(`${base(projectId)}/buckets`, { signal }), enabled });
}

const bucketPath = (p: string, b: LogBucket) => `${base(p)}/buckets/${enc(b.location)}/${enc(b.id)}`;

export function useLogViews(projectId: string, bucket: LogBucket | null) {
  const { key, enabled } = useKey(projectId, 'views', bucket?.name);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<LogView[]>(`${bucketPath(projectId, bucket as LogBucket)}/views`, { signal }),
    enabled: enabled && !!bucket,
  });
}

export function useLogLinks(projectId: string, bucket: LogBucket | null) {
  const { key, enabled } = useKey(projectId, 'links', bucket?.name);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<LogBucketLink[]>(`${bucketPath(projectId, bucket as LogBucket)}/links`, { signal }),
    enabled: enabled && !!bucket && bucket.analyticsEnabled,
  });
}

export function useLogMetrics(projectId: string) {
  const { key, enabled } = useKey(projectId, 'metrics');
  return useQuery({ queryKey: key, queryFn: ({ signal }) => api<LogMetric[]>(`${base(projectId)}/metrics`, { signal }), enabled });
}

function useLoggingMutation<V, R>(projectId: string, fn: (v: V) => Promise<R>, done: (r: R, v: V) => string, what: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      void client.invalidateQueries({ queryKey: ['logging', profileId, projectId] });
      toast.success(done(r, v));
    },
    onError: failed(what),
  });
}

export const useSaveSink = (projectId: string, existing: string | null) =>
  useLoggingMutation(
    projectId,
    (b: SaveSink) =>
      existing
        ? api<LogSink>(`${base(projectId)}/sinks/${enc(existing)}`, { method: 'PUT', body: b })
        : api<LogSink>(`${base(projectId)}/sinks`, { body: b }),
    (s) => `Saved sink ${s.name}`,
    'Saving the sink',
  );

export const deleteSink = (projectId: string, sink: string, confirm: string) =>
  api<void>(`${base(projectId)}/sinks/${enc(sink)}`, { method: 'DELETE', body: { confirm } });

export const useSaveExclusion = (projectId: string, existing: string | null) =>
  useLoggingMutation(
    projectId,
    (b: SaveExclusion) =>
      existing
        ? api<LogExclusionView>(`${base(projectId)}/exclusions/${enc(existing)}`, { method: 'PUT', body: b })
        : api<LogExclusionView>(`${base(projectId)}/exclusions`, { body: b }),
    (e) => `Saved exclusion ${e.name}`,
    'Saving the exclusion',
  );

export const deleteExclusion = (projectId: string, id: string, confirm: string) =>
  api<void>(`${base(projectId)}/exclusions/${enc(id)}`, { method: 'DELETE', body: { confirm } });

export const useCreateLogBucket = (projectId: string) =>
  useLoggingMutation(
    projectId,
    (b: CreateLogBucket) => api<LogBucket>(`${base(projectId)}/buckets`, { body: b }),
    (b) => `Created log bucket ${b.id}`,
    'Creating the bucket',
  );

export const useUpdateLogBucket = (projectId: string, bucket: LogBucket) =>
  useLoggingMutation(
    projectId,
    (b: UpdateLogBucket) => api<LogBucket>(bucketPath(projectId, bucket), { method: 'PATCH', body: b }),
    (b) => `Saved log bucket ${b.id}`,
    'Saving the bucket',
  );

export const deleteLogBucket = (projectId: string, bucket: LogBucket, confirm: string) =>
  api<void>(bucketPath(projectId, bucket), { method: 'DELETE', body: { confirm } });

export const undeleteLogBucket = (projectId: string, bucket: LogBucket) =>
  api<void>(`${bucketPath(projectId, bucket)}/undelete`, { method: 'POST' });

export const useCreateLogView = (projectId: string, bucket: LogBucket) =>
  useLoggingMutation(
    projectId,
    (v: CreateLogView) => api<LogView>(`${bucketPath(projectId, bucket)}/views`, { body: v }),
    (v) => `Created log view ${v.id}`,
    'Creating the view',
  );

export const deleteLogView = (projectId: string, bucket: LogBucket, view: string, confirm: string) =>
  api<void>(`${bucketPath(projectId, bucket)}/views/${enc(view)}`, { method: 'DELETE', body: { confirm } });

export const useSaveLogMetric = (projectId: string, existing: string | null) =>
  useLoggingMutation(
    projectId,
    (b: SaveLogMetric) =>
      existing
        ? api<LogMetric>(`${base(projectId)}/metrics/${enc(existing)}`, { method: 'PUT', body: b })
        : api<LogMetric>(`${base(projectId)}/metrics`, { body: b }),
    (m) => `Saved log-based metric ${m.name}`,
    'Saving the metric',
  );

export const deleteLogMetric = (projectId: string, metric: string, confirm: string) =>
  api<void>(`${base(projectId)}/metrics/${enc(metric)}`, { method: 'DELETE', body: { confirm } });

// ---- saved queries (SPEC-0001 CA-53) ------------------------------------------------------------

export function useSaved(kind: SavedKind, projectId: string) {
  return useQuery({
    queryKey: ['saved', kind, projectId],
    queryFn: ({ signal }) => api<SavedItem[]>(`/api/saved/${kind}${qs({ projectId })}`, { signal }),
  });
}

export function useSaveItem(kind: SavedKind, projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (b: { name: string; value: string }) => api<SavedItem>(`/api/saved/${kind}`, { body: { ...b, projectId } }),
    onSuccess: (s) => {
      void client.invalidateQueries({ queryKey: ['saved', kind] });
      toast.success(`Saved "${s.name}"`);
    },
    onError: failed('Saving'),
  });
}

export function useDeleteSaved(kind: SavedKind) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/saved/${kind}/${enc(id)}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['saved', kind] }),
    onError: failed('Removing the saved item'),
  });
}
