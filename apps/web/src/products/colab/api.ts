import type {
  AssignColabRuntime,
  ColabCommit,
  ColabExecution,
  ColabExecutionList,
  ColabExecutionOutput,
  ColabNotebook,
  ColabNotebookDetail,
  ColabRuntime,
  ColabRuntimeAction,
  ColabSchedule,
  ColabTemplate,
  CreateColabExecution,
  CreateColabNotebook,
  CreateColabSchedule,
  CreateColabTemplate,
  ListResponse,
  NotebookDocument,
  OperationAccepted,
  SaveColabNotebook,
  SaveColabSchedule,
  UpdateColabTemplate,
} from '@nephoscope/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useOperationMutation } from '../../kit/operations';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api, downloadFromApi, qs } from '../../lib/api';
import { useOperations } from '../../state/operations';
import { useSession } from '../../state/session';

/** Deletes of Vertex AI resources are operations; they go to the tray like the rest (SPEC-0001 CA-27). */
async function operation(request: Promise<OperationAccepted>): Promise<OperationAccepted> {
  const result = await request;
  useOperations.getState().upsert(result.operation);
  return result;
}

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/colab`;
const at = (p: string, kind: string, l: string, id: string) => `${base(p)}/locations/${enc(l)}/${kind}/${enc(id)}`;

export const failed = (what: string) => (err: unknown) =>
  toast.error(`${what} failed`, { description: err instanceof ApiError ? err.problem.detail : String(err), duration: 10_000 });

export const shortName = (name: string) => name.split('/').pop() ?? name;
export const locationOf = (name: string) => /\/locations\/([^/]+)/.exec(name)?.[1] ?? '';
/** Google may name the project by number; resources compare without it. */
export const sameResource = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.replace(/^projects\/[^/]+\//, '') === b.replace(/^projects\/[^/]+\//, '');

export const colabHref = {
  notebook: (p: string, l: string, id: string) => `/p/${p}/colab/notebooks/${l}/${enc(id)}`,
  runtime: (p: string, l: string, id: string) => `/p/${p}/colab/runtimes/${l}/${enc(id)}`,
  template: (p: string, l: string, id: string) => `/p/${p}/colab/templates/${l}/${enc(id)}`,
  execution: (p: string, l: string, id: string) => `/p/${p}/colab/executions/${l}/${enc(id)}`,
  schedule: (p: string, l: string, id: string) => `/p/${p}/colab/schedules/${l}/${enc(id)}`,
  list: (p: string, tab: string) => `/p/${p}/colab?tab=${tab}`,
};

/** The region the Colab pages show: one region, or `all` (SPEC-0010 D-03). */
export function useColabRegion(): [string, (r: string) => void] {
  return useSearchState<string>('region', 'all');
}

function useKey() {
  return useSession((s) => s.profileId);
}

function useList<T>(kind: string, projectId: string, region: string, enabled: boolean) {
  const profileId = useKey();
  return useQuery({
    queryKey: ['colab', profileId, projectId, kind, region],
    queryFn: ({ signal }) => api<ListResponse<T>>(`${base(projectId)}/${kind}${qs({ region })}`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export const useNotebooks = (p: string, region: string, enabled = true) => useList<ColabNotebook>('notebooks', p, region, enabled);
export const useTemplates = (p: string, region: string, enabled = true) => useList<ColabTemplate>('templates', p, region, enabled);
export const useRuntimes = (p: string, region: string, enabled = true) => useList<ColabRuntime>('runtimes', p, region, enabled);
export const useSchedules = (p: string, region: string, enabled = true) => useList<ColabSchedule>('schedules', p, region, enabled);

/** Executions, newest first; one region pages on, all regions show the newest page of each. */
export function useExecutions(projectId: string, region: string, enabled = true) {
  const profileId = useKey();
  return useInfiniteQuery({
    queryKey: ['colab', profileId, projectId, 'executions', region],
    queryFn: ({ signal, pageParam }) =>
      api<ColabExecutionList>(`${base(projectId)}/executions${qs({ region, pageToken: pageParam })}`, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId && enabled,
  });
}

function useOne<T>(projectId: string, kind: string, location: string, id: string, suffix = '', enabled = true) {
  const profileId = useKey();
  return useQuery({
    queryKey: ['colab', profileId, projectId, kind, location, id, suffix],
    queryFn: ({ signal }) => api<T>(`${at(projectId, kind, location, id)}${suffix}`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export const useNotebook = (p: string, l: string, id: string) => useOne<ColabNotebookDetail>(p, 'notebooks', l, id);
export const useTemplate = (p: string, l: string, id: string) => useOne<ColabTemplate>(p, 'templates', l, id);
export const useRuntime = (p: string, l: string, id: string) => useOne<ColabRuntime>(p, 'runtimes', l, id);
export const useExecution = (p: string, l: string, id: string) => useOne<ColabExecution>(p, 'executions', l, id);
export const useSchedule = (p: string, l: string, id: string) => useOne<ColabSchedule>(p, 'schedules', l, id);
export const useRaw = (p: string, kind: string, l: string, id: string, enabled: boolean) =>
  useOne<unknown>(p, kind, l, id, '/raw', enabled);

export function useNotebookContent(p: string, l: string, id: string, commit: string | null, enabled = true) {
  return useOne<NotebookDocument>(p, 'notebooks', l, id, `/content${qs({ commit })}`, enabled);
}
export const useNotebookHistory = (p: string, l: string, id: string, enabled: boolean) =>
  useOne<ListResponse<ColabCommit>>(p, 'notebooks', l, id, '/history', enabled);
export const useNotebookRuns = (p: string, l: string, id: string, enabled: boolean) =>
  useOne<ColabExecutionList>(p, 'notebooks', l, id, '/executions', enabled);
export const useNotebookSchedules = (p: string, l: string, id: string, enabled: boolean) =>
  useOne<ListResponse<ColabSchedule>>(p, 'notebooks', l, id, '/schedules', enabled);
export const useScheduleRuns = (p: string, l: string, id: string, enabled: boolean) =>
  useOne<ColabExecutionList>(p, 'schedules', l, id, '/runs', enabled);
export const useExecutionOutput = (p: string, l: string, id: string, enabled: boolean) =>
  useOne<ColabExecutionOutput>(p, 'executions', l, id, '/output', enabled);
export const useExecutionNotebook = (p: string, l: string, id: string, object: string | null) =>
  useOne<NotebookDocument>(p, 'executions', l, id, `/output/notebook${qs({ object })}`, !!object);

export function downloadNotebook(p: string, l: string, id: string, fileName: string, commit?: string | null) {
  return downloadFromApi(`${at(p, 'notebooks', l, id)}/download${qs({ commit })}`, fileName);
}

function useInvalidate(projectId: string) {
  const client = useQueryClient();
  const profileId = useKey();
  return () => client.invalidateQueries({ queryKey: ['colab', profileId, projectId] });
}

// ---- notebooks ---------------------------------------------------------------------------------------

export function useCreateNotebook(projectId: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (body: CreateColabNotebook) => api<ColabNotebookDetail>(`${base(projectId)}/notebooks`, { body }),
    onSuccess: (n) => {
      void invalidate();
      toast.success(`Created ${n.displayName}`);
    },
    onError: failed('Creating the notebook'),
  });
}

export function useSaveNotebook(projectId: string, location: string, id: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (body: SaveColabNotebook) =>
      api<ColabNotebookDetail>(`${at(projectId, 'notebooks', location, id)}/content`, { method: 'PUT', body }),
    onSuccess: (n) => {
      void invalidate();
      toast.success(`Saved a new version of ${n.displayName}`);
    },
    onError: failed('Saving the notebook'),
  });
}

export function useRenameNotebook(projectId: string, location: string, id: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (displayName: string) =>
      api<ColabNotebook>(at(projectId, 'notebooks', location, id), { method: 'PATCH', body: { displayName } }),
    onSuccess: (n) => {
      void invalidate();
      toast.success(`Renamed to ${n.displayName}`);
    },
    onError: failed('Renaming the notebook'),
  });
}

export function deleteNotebook(p: string, l: string, id: string, confirm: string) {
  return api<void>(at(p, 'notebooks', l, id), { method: 'DELETE', body: { confirm } });
}

// ---- templates and runtimes ------------------------------------------------------------------------

export function useCreateTemplate(projectId: string) {
  return useOperationMutation({
    mutationFn: (body: CreateColabTemplate) => api<OperationAccepted>(`${base(projectId)}/templates`, { body }),
    started: (b) => `Creating template ${b.displayName}`,
  });
}

export function useUpdateTemplate(projectId: string, location: string, id: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (body: UpdateColabTemplate) => api<ColabTemplate>(at(projectId, 'templates', location, id), { method: 'PATCH', body }),
    onSuccess: (t) => {
      void invalidate();
      toast.success(`Saved ${t.displayName}`);
    },
    onError: failed('Saving the template'),
  });
}

export function deleteTemplate(p: string, l: string, id: string, confirm: string) {
  return operation(api<OperationAccepted>(at(p, 'templates', l, id), { method: 'DELETE', body: { confirm } }));
}

export function useAssignRuntime(projectId: string) {
  return useOperationMutation({
    mutationFn: (body: AssignColabRuntime) => api<OperationAccepted>(`${base(projectId)}/runtimes`, { body }),
    started: (b) => `Assigning runtime ${b.displayName}`,
  });
}

export function useRuntimeAction(projectId: string) {
  return useOperationMutation({
    mutationFn: ({ location, id, action }: { location: string; id: string; action: ColabRuntimeAction; label: string }) =>
      api<OperationAccepted>(`${at(projectId, 'runtimes', location, id)}/${action}`, { method: 'POST' }),
    started: (v) => `${v.action === 'start' ? 'Starting' : v.action === 'stop' ? 'Stopping' : 'Upgrading'} ${v.label}`,
  });
}

export function deleteRuntime(p: string, l: string, id: string, confirm: string) {
  return operation(api<OperationAccepted>(at(p, 'runtimes', l, id), { method: 'DELETE', body: { confirm } }));
}

// ---- executions and schedules -----------------------------------------------------------------------

export function useCreateExecution(projectId: string) {
  return useOperationMutation({
    mutationFn: (body: CreateColabExecution) => api<OperationAccepted>(`${base(projectId)}/executions`, { body }),
    started: (b) => `Running ${b.displayName}`,
  });
}

export function deleteExecution(p: string, l: string, id: string, confirm: string) {
  return operation(api<OperationAccepted>(at(p, 'executions', l, id), { method: 'DELETE', body: { confirm } }));
}

export function useCreateSchedule(projectId: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (body: CreateColabSchedule) => api<ColabSchedule>(`${base(projectId)}/schedules`, { body }),
    onSuccess: (s) => {
      void invalidate();
      toast.success(`Created schedule ${s.displayName}`);
    },
    onError: failed('Creating the schedule'),
  });
}

export function useUpdateSchedule(projectId: string, location: string, id: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (body: SaveColabSchedule) => api<ColabSchedule>(at(projectId, 'schedules', location, id), { method: 'PUT', body }),
    onSuccess: (s) => {
      void invalidate();
      toast.success(`Saved ${s.displayName}`);
    },
    onError: failed('Saving the schedule'),
  });
}

export function useScheduleState(projectId: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: ({ location, id, action, catchUp }: { location: string; id: string; action: 'pause' | 'resume'; catchUp?: boolean }) =>
      api<ColabSchedule>(`${at(projectId, 'schedules', location, id)}/${action}`, {
        method: 'POST',
        body: action === 'resume' ? { catchUp: !!catchUp } : undefined,
      }),
    onSuccess: (s, v) => {
      void invalidate();
      toast(v.action === 'pause' ? `Paused ${s.displayName}` : `Resumed ${s.displayName}`);
    },
    onError: failed('The action'),
  });
}

export function deleteSchedule(p: string, l: string, id: string, confirm: string) {
  return operation(api<OperationAccepted>(at(p, 'schedules', l, id), { method: 'DELETE', body: { confirm } }));
}
