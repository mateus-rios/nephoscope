import type {
  AddKeyAsProfile,
  CreateServiceAccount,
  IamPolicyView,
  NewKeyView,
  Profile,
  ProjectIamView,
  RoleDetail,
  RoleSearch,
  RoleSummary,
  SaveCustomRole,
  ServiceAccountKeyView,
  ServiceAccountView,
  SetIamPolicy,
  TestablePermission,
  Troubleshoot,
  TroubleshootView,
  UpdateServiceAccount,
} from '@nephoscope/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, api, qs } from '../../lib/api';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
export const iamBase = (p: string) => `/api/projects/${enc(p)}/iam`;
const saPath = (p: string, email: string) => `${iamBase(p)}/service-accounts/${enc(email)}`;
const failed = (what: string) => (err: unknown) =>
  toast.error(`${what} failed`, { description: err instanceof ApiError ? err.problem.detail : String(err), duration: 10_000 });

function useKey(projectId: string, ...rest: unknown[]) {
  const profileId = useSession((s) => s.profileId);
  return { key: ['iam', profileId, projectId, ...rest], enabled: !!profileId };
}

export function useProjectPolicy(projectId: string) {
  const { key, enabled } = useKey(projectId, 'policy');
  return useQuery({ queryKey: key, queryFn: ({ signal }) => api<ProjectIamView>(`${iamBase(projectId)}/policy`, { signal }), enabled });
}

export function useSetProjectPolicy(projectId: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return useMutation({
    mutationFn: (body: SetIamPolicy) => api<IamPolicyView>(`${iamBase(projectId)}/policy`, { method: 'PUT', body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['iam', profileId, projectId, 'policy'] });
      toast.success('IAM policy saved');
    },
  });
}

export function useRoleSearch(projectId: string, q: Partial<RoleSearch>, enabledNow = true) {
  const { key, enabled } = useKey(projectId, 'roles', q);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<RoleSummary[]>(`${iamBase(projectId)}/roles${qs(q)}`, { signal }),
    enabled: enabled && enabledNow,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function useRole(projectId: string, name: string | null) {
  const { key, enabled } = useKey(projectId, 'role', name);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<RoleDetail>(`${iamBase(projectId)}/role${qs({ name })}`, { signal }),
    enabled: enabled && !!name,
    staleTime: 10 * 60_000,
  });
}

export function useTestablePermissions(projectId: string, enabledNow: boolean) {
  const { key, enabled } = useKey(projectId, 'testable');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<TestablePermission[]>(`${iamBase(projectId)}/testable-permissions`, { signal }),
    enabled: enabled && enabledNow,
    staleTime: 60 * 60_000,
  });
}

function useIamMutation<V, R>(projectId: string, fn: (v: V) => Promise<R>, done: (r: R, v: V) => string, what: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      void client.invalidateQueries({ queryKey: ['iam', profileId, projectId] });
      toast.success(done(r, v));
    },
    onError: failed(what),
  });
}

export const useSaveRole = (projectId: string, existing: string | null) =>
  useIamMutation(
    projectId,
    (b: SaveCustomRole) =>
      existing
        ? api<RoleDetail>(`${iamBase(projectId)}/roles/${enc(existing)}`, { method: 'PUT', body: b })
        : api<RoleDetail>(`${iamBase(projectId)}/roles`, { body: b }),
    (r) => `Saved role ${r.title}`,
    'Saving the role',
  );

export const deleteRole = (projectId: string, roleId: string, confirm: string) =>
  api<void>(`${iamBase(projectId)}/roles/${enc(roleId)}`, { method: 'DELETE', body: { confirm } });

export const useUndeleteRole = (projectId: string) =>
  useIamMutation(
    projectId,
    (roleId: string) => api<RoleDetail>(`${iamBase(projectId)}/roles/${enc(roleId)}/undelete`, { method: 'POST' }),
    (r) => `Restored ${r.title}`,
    'Restoring the role',
  );

export function useServiceAccounts(projectId: string) {
  const { key, enabled } = useKey(projectId, 'service-accounts');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<ServiceAccountView[]>(`${iamBase(projectId)}/service-accounts`, { signal }),
    enabled,
  });
}

export function useServiceAccount(projectId: string, email: string) {
  const { key, enabled } = useKey(projectId, 'service-accounts', email);
  return useQuery({ queryKey: key, queryFn: ({ signal }) => api<ServiceAccountView>(saPath(projectId, email), { signal }), enabled });
}

export function useKeys(projectId: string, email: string) {
  const { key, enabled } = useKey(projectId, 'service-accounts', email, 'keys');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<ServiceAccountKeyView[]>(`${saPath(projectId, email)}/keys`, { signal }),
    enabled,
  });
}

export function useServiceAccountPolicy(projectId: string, email: string, enabledNow: boolean) {
  const { key, enabled } = useKey(projectId, 'service-accounts', email, 'policy');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<IamPolicyView>(`${saPath(projectId, email)}/policy`, { signal }),
    enabled: enabled && enabledNow,
  });
}

export const useCreateServiceAccount = (projectId: string) =>
  useIamMutation(
    projectId,
    (b: CreateServiceAccount) => api<ServiceAccountView>(`${iamBase(projectId)}/service-accounts`, { body: b }),
    (a) => `Created ${a.email}`,
    'Creating the service account',
  );

export const useUpdateServiceAccount = (projectId: string, email: string) =>
  useIamMutation(
    projectId,
    (b: UpdateServiceAccount) => api<ServiceAccountView>(saPath(projectId, email), { method: 'PATCH', body: b }),
    () => `Saved ${email}`,
    'Saving the service account',
  );

export const useSetServiceAccountEnabled = (projectId: string, email: string) =>
  useIamMutation(
    projectId,
    (enabled: boolean) => api<void>(`${saPath(projectId, email)}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' }),
    (_r, enabled) => `${enabled ? 'Enabled' : 'Disabled'} ${email}`,
    'Changing the service account',
  );

export const deleteServiceAccount = (projectId: string, email: string, confirm: string) =>
  api<void>(saPath(projectId, email), { method: 'DELETE', body: { confirm } });

export const useUndeleteServiceAccount = (projectId: string) =>
  useIamMutation(
    projectId,
    (uniqueId: string) => api<ServiceAccountView>(`${iamBase(projectId)}/service-accounts/undelete`, { body: { uniqueId } }),
    (a) => `Restored ${a.email}`,
    'Restoring the service account',
  );

export const useCreateKey = (projectId: string, email: string) =>
  useIamMutation(
    projectId,
    () => api<NewKeyView>(`${saPath(projectId, email)}/keys`, { method: 'POST' }),
    (k) => `Created key ${k.key.id.slice(0, 12)}`,
    'Creating the key',
  );

export const useUploadKey = (projectId: string, email: string) =>
  useIamMutation(
    projectId,
    (publicKeyPem: string) => api<ServiceAccountKeyView>(`${saPath(projectId, email)}/keys/upload`, { body: { publicKeyPem } }),
    (k) => `Uploaded key ${k.id.slice(0, 12)}`,
    'Uploading the key',
  );

export const useSetKeyEnabled = (projectId: string, email: string) =>
  useIamMutation(
    projectId,
    (v: { key: string; enabled: boolean }) =>
      api<void>(`${saPath(projectId, email)}/keys/${enc(v.key)}/${v.enabled ? 'enable' : 'disable'}`, { method: 'POST' }),
    (_r, v) => `${v.enabled ? 'Enabled' : 'Disabled'} key ${v.key.slice(0, 12)}`,
    'Changing the key',
  );

export const deleteKey = (projectId: string, email: string, key: string, confirm: string) =>
  api<void>(`${saPath(projectId, email)}/keys/${enc(key)}`, { method: 'DELETE', body: { confirm } });

export const addKeyAsProfile = (handle: string, body: AddKeyAsProfile) =>
  api<Profile>(`/api/iam/new-keys/${enc(handle)}/profile`, { body });
export const newKeyDownloadPath = (handle: string) => `/api/iam/new-keys/${enc(handle)}/download`;

export function useSetServiceAccountPolicy(projectId: string, email: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return useMutation({
    mutationFn: (body: SetIamPolicy) => api<IamPolicyView>(`${saPath(projectId, email)}/policy`, { method: 'PUT', body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['iam', profileId, projectId, 'service-accounts', email, 'policy'] });
      toast.success('Saved who can act as the service account');
    },
    onError: failed('Saving the policy'),
  });
}

export const testPermissions = (projectId: string, permissions: string[]) =>
  api<{ granted: string[]; denied: string[] }>(`${iamBase(projectId)}/test-permissions`, { body: { permissions } });

export const troubleshoot = (projectId: string, body: Troubleshoot) =>
  api<TroubleshootView>(`${iamBase(projectId)}/troubleshoot`, { body });
