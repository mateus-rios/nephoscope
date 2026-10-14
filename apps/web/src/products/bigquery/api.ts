import type {
  BqDatasetSummary,
  BqDatasetView,
  BqDryRun,
  BqDryRunResult,
  BqJobDetail,
  BqJobRef,
  BqJobSummary,
  BqModelSummary,
  BqResultsPage,
  BqRoutineSummary,
  BqRun,
  BqTableSummary,
  BqTableView,
  ListResponse,
  OperationAccepted,
} from '@nephoscope/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
export const bqBase = (p: string) => `/api/projects/${enc(p)}/bigquery`;
export const tableApi = (p: string, dp: string, d: string, t: string) => `${bqBase(p)}/tables/${enc(dp)}/${enc(d)}/${enc(t)}`;
export const datasetApi = (p: string, dp: string, d: string) => `${bqBase(p)}/datasets/${enc(dp)}/${enc(d)}`;
export const tableHref = (p: string, dp: string, d: string, t: string) => `/p/${p}/bigquery/${dp}/${d}/${enc(t)}`;
export const datasetHref = (p: string, dp: string, d: string) => `/p/${p}/bigquery/${dp}/${d}`;
/** A table name as GoogleSQL quotes it. */
export const quoted = (p: string, d: string, t: string) => `\`${p}.${d}.${t}\``;

function useBq<T>(projectId: string, key: unknown[], path: string, enabled = true) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['bigquery', profileId, projectId, ...key],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled: !!profileId && enabled,
  });
}

export const useDatasets = (projectId: string, project: string, enabled = true) =>
  useBq<BqDatasetSummary[]>(projectId, ['datasets', project], `${bqBase(projectId)}/datasets${qs({ project })}`, enabled);
export const useDataset = (projectId: string, project: string, dataset: string) =>
  useBq<BqDatasetView>(projectId, ['dataset', project, dataset], datasetApi(projectId, project, dataset));
export const useTables = (projectId: string, project: string, dataset: string, enabled = true) =>
  useBq<BqTableSummary[]>(projectId, ['tables', project, dataset], `${datasetApi(projectId, project, dataset)}/tables`, enabled);
export const useRoutines = (projectId: string, project: string, dataset: string, enabled = true) =>
  useBq<BqRoutineSummary[]>(projectId, ['routines', project, dataset], `${datasetApi(projectId, project, dataset)}/routines`, enabled);
export const useModels = (projectId: string, project: string, dataset: string, enabled = true) =>
  useBq<BqModelSummary[]>(projectId, ['models', project, dataset], `${datasetApi(projectId, project, dataset)}/models`, enabled);
export const useTable = (projectId: string, project: string, dataset: string, table: string, enabled = true) =>
  useBq<BqTableView>(projectId, ['table', project, dataset, table], tableApi(projectId, project, dataset, table), enabled);
export const useJob = (projectId: string, ref: BqJobRef | null, live: boolean) => {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['bigquery', profileId, projectId, 'job', ref?.location, ref?.jobId],
    queryFn: ({ signal }) => api<BqJobDetail>(`${bqBase(projectId)}/jobs/${enc(ref?.location ?? '')}/${enc(ref?.jobId ?? '')}`, { signal }),
    enabled: !!profileId && !!ref,
    refetchInterval: (q) => (live && q.state.data?.state !== 'DONE' ? 1500 : false),
  });
};

export function usePaged(projectId: string, key: unknown[], path: string, enabled: boolean, pageSize = 200) {
  const profileId = useSession((s) => s.profileId);
  return useInfiniteQuery({
    queryKey: ['bigquery', profileId, projectId, ...key],
    queryFn: ({ signal, pageParam }) => api<BqResultsPage>(`${path}${qs({ pageToken: pageParam, maxResults: pageSize })}`, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pageToken ?? undefined,
    enabled: !!profileId && enabled,
  });
}

export function useJobs(projectId: string, state: string, principal: string | undefined) {
  const profileId = useSession((s) => s.profileId);
  return useInfiniteQuery({
    queryKey: ['bigquery', profileId, projectId, 'jobs', state, principal],
    queryFn: ({ signal, pageParam }) =>
      api<ListResponse<BqJobSummary>>(
        `${bqBase(projectId)}/jobs${qs({ state: state === 'any' ? undefined : state, principal, pageToken: pageParam })}`,
        { signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId,
  });
}

export const dryRun = (projectId: string, b: BqDryRun, signal?: AbortSignal) =>
  api<BqDryRunResult>(`${bqBase(projectId)}/query/dryrun`, { body: b, signal });
export const runQuery = (projectId: string, b: BqRun) =>
  api<OperationAccepted & { job: BqJobRef }>(`${bqBase(projectId)}/query/run`, { body: b });
