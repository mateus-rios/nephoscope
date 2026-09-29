import {
  type AddProfile,
  type AddProfileResult,
  type AuditEntry,
  type Capabilities,
  type InstanceInfo,
  type ListResponse,
  type OperationAccepted,
  type Prefs,
  type Profile,
  type ProfileCheck,
  type ProjectSummary,
  type ServiceSummary,
  type UpdatePrefs,
  type UpdateProfile,
} from '@nephoscope/contracts';
import { QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { ApiError, api, qs } from '../lib/api';
import { useSession } from './session';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failures, error) => error instanceof ApiError && error.problem.retryable && failures < 2,
    },
    mutations: { retry: false },
  },
});

export const qk = {
  instance: ['instance'] as const,
  profiles: ['profiles'] as const,
  prefs: ['prefs'] as const,
  projects: (profileId: string | null, q: string) => ['projects', profileId, q] as const,
  project: (profileId: string | null, projectId: string) => ['project', profileId, projectId] as const,
  caps: (profileId: string | null, projectId: string) => ['caps', profileId, projectId] as const,
  services: (profileId: string | null, projectId: string, state: string) => ['services', profileId, projectId, state] as const,
  recents: (profileId: string | null) => ['recents', profileId] as const,
  audit: (filter: Record<string, string | undefined>) => ['audit', filter] as const,
  search: (profileId: string | null, projectId: string, q: string) => ['search', profileId, projectId, q] as const,
};

export type InstanceView = InstanceInfo & { notices: string[] };

export function useInstance() {
  return useQuery({ queryKey: qk.instance, queryFn: () => api<InstanceView>('/api/instance', { profileId: null }), staleTime: 60_000 });
}

export function useProfiles() {
  return useQuery({ queryKey: qk.profiles, queryFn: () => api<Profile[]>('/api/profiles', { profileId: null }) });
}

/**
 * The profile this tab acts with. Falls back to the Environment profile, then the first saved
 * one, when the remembered id no longer exists (SPEC-0001 CA-07).
 */
export function useActiveProfile(): { profile: Profile | null; profiles: Profile[]; loading: boolean } {
  const profiles = useProfiles();
  const profileId = useSession((s) => s.profileId);
  const setProfile = useSession((s) => s.setProfile);
  const list = profiles.data ?? [];
  const resolved = list.find((p) => p.id === profileId) ?? list.find((p) => p.source === 'environment') ?? list[0] ?? null;
  useEffect(() => {
    if (resolved && resolved.id !== profileId) setProfile(resolved.id);
  }, [resolved, profileId, setProfile]);
  return { profile: resolved, profiles: list, loading: profiles.isPending };
}

export function usePrefs() {
  return useQuery({ queryKey: qk.prefs, queryFn: () => api<Prefs>('/api/prefs', { profileId: null }) });
}

export function useUpdatePrefs() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdatePrefs) => api<Prefs>('/api/prefs', { method: 'PATCH', body: patch, profileId: null }),
    onSuccess: (prefs) => client.setQueryData(qk.prefs, prefs),
  });
}

export function useRecentProjects() {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: qk.recents(profileId),
    queryFn: () => api<string[]>('/api/recents/projects'),
    enabled: !!profileId,
  });
}

export function useProjectSearch(q: string, enabled = true) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: qk.projects(profileId, q),
    queryFn: ({ signal }) => api<ListResponse<ProjectSummary>>(`/api/projects${qs({ q, pageSize: 50 })}`, { signal }),
    enabled: !!profileId && enabled,
    staleTime: 60_000,
  });
}

export function useProject(projectId: string | undefined) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: qk.project(profileId, projectId ?? ''),
    queryFn: ({ signal }) => api<ProjectSummary>(`/api/projects/${encodeURIComponent(projectId ?? '')}`, { signal }),
    enabled: !!profileId && !!projectId,
    staleTime: 5 * 60_000,
  });
}

export function useCapabilities(projectId: string | undefined) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: qk.caps(profileId, projectId ?? ''),
    queryFn: ({ signal }) => api<Capabilities>(`/api/projects/${encodeURIComponent(projectId ?? '')}/capabilities`, { signal }),
    enabled: !!profileId && !!projectId,
    staleTime: 5 * 60_000,
  });
}

export function useRefreshCapabilities(projectId: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return useMutation({
    mutationFn: () => api<Capabilities>(`/api/projects/${encodeURIComponent(projectId)}/capabilities?refresh=1`),
    onSuccess: (caps) => client.setQueryData(qk.caps(profileId, projectId), caps),
  });
}

export interface Can {
  /** true: granted; false: not granted; null: unknown (probe unavailable). */
  allowed: boolean | null;
  permission: string;
}

/** Advisory capability checks for UI gating (SPEC-0001 D-11, CA-45). */
export function useCan(projectId: string | undefined) {
  const caps = useCapabilities(projectId);
  return useMemo(() => {
    const data = caps.data;
    const granted = new Set(data?.permissions.granted ?? []);
    const tested = new Set(data?.permissions.tested ?? []);
    const enabled = new Set(data?.services.enabled ?? []);
    return {
      loaded: !!data,
      permission(permission: string): Can {
        if (!data?.permissions.known || !tested.has(permission)) return { allowed: null, permission };
        return { allowed: granted.has(permission), permission };
      },
      service(service: string | null): boolean | null {
        if (!service) return true;
        if (!data?.services.known) return null;
        return enabled.has(service);
      },
    };
  }, [caps.data]);
}

export function useServices(projectId: string, state: 'ENABLED' | 'DISABLED') {
  const profileId = useSession((s) => s.profileId);
  return useInfiniteQuery({
    queryKey: qk.services(profileId, projectId, state),
    queryFn: ({ pageParam, signal }) =>
      api<ListResponse<ServiceSummary>>(
        `/api/projects/${encodeURIComponent(projectId)}/services${qs({ state, pageSize: 200, pageToken: pageParam })}`,
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId,
  });
}

export function useEnableService(projectId: string) {
  return useMutation({
    mutationFn: (input: { service: string; consumerProject?: string }) =>
      api<OperationAccepted>(`/api/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(input.service)}/enable`, {
        method: 'POST',
        body: { consumerProject: input.consumerProject },
      }),
  });
}

export function useDisableService(projectId: string) {
  return useMutation({
    mutationFn: (input: { service: string; confirm: string }) =>
      api<OperationAccepted>(`/api/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(input.service)}/disable`, {
        method: 'POST',
        body: { confirm: input.confirm },
      }),
  });
}

export function useAudit(filter: { projectId?: string; outcome?: string; product?: string; profileId?: string }) {
  return useQuery({
    queryKey: qk.audit(filter),
    queryFn: ({ signal }) => api<AuditEntry[]>(`/api/audit${qs({ ...filter, limit: 500 })}`, { signal, profileId: null }),
    staleTime: 5_000,
  });
}

export function useAddProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AddProfile) => api<AddProfileResult>('/api/profiles', { body: input, profileId: null }),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.profiles }),
  });
}

export function useUpdateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateProfile }) =>
      api<Profile>(`/api/profiles/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, profileId: null }),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.profiles }),
  });
}

export function useTestProfile() {
  return useMutation({
    mutationFn: (id: string) => api<ProfileCheck>(`/api/profiles/${encodeURIComponent(id)}/test`, { method: 'POST', profileId: null }),
  });
}

export function useDeleteProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: string }) =>
      api<void>(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE', body: { confirm }, profileId: null }),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.profiles }),
  });
}

export function useResetProfiles() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (confirm: string) => api<void>('/api/profiles/reset', { body: { confirm }, profileId: null }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.profiles });
      void client.invalidateQueries({ queryKey: qk.instance });
    },
  });
}

export interface AssetResult {
  name: string;
  assetType: string;
  displayName: string;
  location: string | null;
  state: string | null;
  project: string | null;
  updateTime: string | null;
}

export function useResourceSearch(projectId: string | undefined, q: string) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: qk.search(profileId, projectId ?? '', q),
    queryFn: ({ signal }) => api<AssetResult[]>(`/api/projects/${encodeURIComponent(projectId ?? '')}/search${qs({ q })}`, { signal }),
    enabled: !!profileId && !!projectId && q.trim().length >= 2,
    staleTime: 30_000,
    retry: false,
  });
}
