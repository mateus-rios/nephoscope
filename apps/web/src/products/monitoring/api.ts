import type {
  AlertPolicyView,
  ChannelDescriptorView,
  CreateAlertPolicy,
  CreateChannel,
  CreateUptimeCheck,
  DashboardSummary,
  MetricDescriptorView,
  NotificationChannelView,
  SeriesQuery,
  SeriesResult,
  UptimeCheckView,
} from '@nephoscope/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, api, qs } from '../../lib/api';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
export const monBase = (p: string) => `/api/projects/${enc(p)}/monitoring`;
const failed = (what: string) => (err: unknown) =>
  toast.error(`${what} failed`, { description: err instanceof ApiError ? err.problem.detail : String(err), duration: 10_000 });

function useKey(projectId: string, ...rest: unknown[]) {
  const profileId = useSession((s) => s.profileId);
  return { key: ['monitoring', profileId, projectId, ...rest], enabled: !!profileId };
}

export function useMetricSearch(projectId: string, q: string) {
  const { key, enabled } = useKey(projectId, 'descriptors', q);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<MetricDescriptorView[]>(`${monBase(projectId)}/metric-descriptors${qs({ q })}`, { signal }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
  });
}

/** Series for a chart. Never refreshes by itself; the range picker and Run refresh it. */
export function useSeries(projectId: string, query: SeriesQuery | null) {
  const { key, enabled } = useKey(projectId, 'series', query);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<SeriesResult>(`${monBase(projectId)}/series`, { body: query, signal }),
    enabled: enabled && !!query,
    retry: false,
    staleTime: 60_000,
  });
}

export function useDashboards(projectId: string) {
  const { key, enabled } = useKey(projectId, 'dashboards');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<DashboardSummary[]>(`${monBase(projectId)}/dashboards`, { signal }),
    enabled,
  });
}

export function useDashboard(projectId: string, id: string) {
  const { key, enabled } = useKey(projectId, 'dashboards', id);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<Record<string, unknown>>(`${monBase(projectId)}/dashboards/${enc(id)}`, { signal }),
    enabled,
  });
}

export function usePolicies(projectId: string) {
  const { key, enabled } = useKey(projectId, 'policies');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<AlertPolicyView[]>(`${monBase(projectId)}/alert-policies`, { signal }),
    enabled,
  });
}

export function usePolicy(projectId: string, id: string) {
  const { key, enabled } = useKey(projectId, 'policies', id);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<{ policy: AlertPolicyView; raw: unknown }>(`${monBase(projectId)}/alert-policies/${enc(id)}`, { signal }),
    enabled,
  });
}

export function useUptime(projectId: string) {
  const { key, enabled } = useKey(projectId, 'uptime');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<UptimeCheckView[]>(`${monBase(projectId)}/uptime-checks`, { signal }),
    enabled,
  });
}

export function useChannels(projectId: string) {
  const { key, enabled } = useKey(projectId, 'channels');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<NotificationChannelView[]>(`${monBase(projectId)}/channels`, { signal }),
    enabled,
  });
}

export function useChannelDescriptors(projectId: string, enabledNow: boolean) {
  const { key, enabled } = useKey(projectId, 'channel-descriptors');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<ChannelDescriptorView[]>(`${monBase(projectId)}/channel-descriptors`, { signal }),
    enabled: enabled && enabledNow,
    staleTime: 60 * 60_000,
  });
}

function useMonMutation<V, R>(projectId: string, fn: (v: V) => Promise<R>, done: (r: R, v: V) => string, what: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      void client.invalidateQueries({ queryKey: ['monitoring', profileId, projectId] });
      toast.success(done(r, v));
    },
    onError: failed(what),
  });
}

export const useSaveDashboard = (projectId: string, id: string) =>
  useMonMutation(
    projectId,
    (json: string) => api(`${monBase(projectId)}/dashboards/${enc(id)}`, { method: 'PUT', body: { json } }),
    () => 'Dashboard saved',
    'Saving the dashboard',
  );

export const deleteDashboard = (projectId: string, id: string, confirm: string) =>
  api<void>(`${monBase(projectId)}/dashboards/${enc(id)}`, { method: 'DELETE', body: { confirm } });

export const useCreatePolicy = (projectId: string) =>
  useMonMutation(
    projectId,
    (b: CreateAlertPolicy) => api<AlertPolicyView>(`${monBase(projectId)}/alert-policies`, { body: b }),
    (p) => `Created alert policy ${p.displayName}`,
    'Creating the policy',
  );

export const useSetPolicyEnabled = (projectId: string) =>
  useMonMutation(
    projectId,
    (v: { id: string; enabled: boolean }) =>
      api<AlertPolicyView>(`${monBase(projectId)}/alert-policies/${enc(v.id)}`, { method: 'PATCH', body: { enabled: v.enabled } }),
    (p) => `${p.enabled ? 'Enabled' : 'Disabled'} ${p.displayName}`,
    'Changing the policy',
  );

export const deletePolicy = (projectId: string, id: string, confirm: string) =>
  api<void>(`${monBase(projectId)}/alert-policies/${enc(id)}`, { method: 'DELETE', body: { confirm } });

export const useCreateUptime = (projectId: string) =>
  useMonMutation(
    projectId,
    (b: CreateUptimeCheck) => api<UptimeCheckView>(`${monBase(projectId)}/uptime-checks`, { body: b }),
    (c) => `Created uptime check ${c.displayName}`,
    'Creating the uptime check',
  );

export const deleteUptime = (projectId: string, id: string, confirm: string) =>
  api<void>(`${monBase(projectId)}/uptime-checks/${enc(id)}`, { method: 'DELETE', body: { confirm } });

export const useCreateChannel = (projectId: string) =>
  useMonMutation(
    projectId,
    (b: CreateChannel) => api<NotificationChannelView>(`${monBase(projectId)}/channels`, { body: b }),
    (c) => `Created channel ${c.displayName}`,
    'Creating the channel',
  );

export const useVerifyChannel = (projectId: string) =>
  useMonMutation(
    projectId,
    (id: string) => api<void>(`${monBase(projectId)}/channels/${enc(id)}/verify`, { method: 'POST' }),
    () => 'Verification code sent',
    'Sending the verification',
  );

export const deleteChannel = (projectId: string, id: string, confirm: string) =>
  api<void>(`${monBase(projectId)}/channels/${enc(id)}`, { method: 'DELETE', body: { confirm } });
