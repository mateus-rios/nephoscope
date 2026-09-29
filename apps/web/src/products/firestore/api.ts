import type {
  Aggregation,
  AggregationResult,
  BackupSchedule,
  CollectionIdsPage,
  CreateDatabase,
  CreateDocument,
  CreateIndex,
  DatastoreEntity,
  DocumentsPage,
  EntitiesPage,
  ExplainMode,
  ExportDocuments,
  FieldOverride,
  FirestoreBackup,
  FirestoreDatabase,
  FirestoreDocument,
  FirestoreIndex,
  FirestoreOperation,
  ImportBatch,
  ImportBatchResult,
  ImportDocuments,
  ListResponse,
  OperationAccepted,
  QueryResult,
  QuerySpecInput,
  Ruleset,
  RulesIssue,
  RulesState,
  RulesTestResult,
  SaveBackupSchedule,
  SaveDocument,
  SaveEntity,
  SetFieldIndexes,
  SetTtl,
  TestRules,
  UpdateDatabase,
} from '@nephoscope/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useOperationMutation } from '../../kit/operations';
import { ApiError, api, qs } from '../../lib/api';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
export const fsBase = (p: string) => `/api/projects/${enc(p)}/firestore`;
const dbBase = (p: string, d: string) => `${fsBase(p)}/databases/${enc(d)}`;
const dsBase = (p: string, d: string) => `/api/projects/${enc(p)}/datastore/databases/${enc(d)}`;

export const failed = (what: string) => (err: unknown) =>
  toast.error(`${what} failed`, { description: err instanceof ApiError ? err.problem.detail : String(err), duration: 10_000 });

/** `projects/p/databases/d/documents`, the root that `$ref` paths are relative to. */
export const documentsRoot = (p: string, d: string) => `projects/${p}/databases/${d}/documents`;

function useKey(...parts: unknown[]) {
  const profileId = useSession((s) => s.profileId);
  return { profileId, key: ['firestore', profileId, ...parts] };
}

// ---- databases ----------------------------------------------------------------------------------

export function useDatabases(projectId: string) {
  const { profileId, key } = useKey(projectId, 'databases');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<FirestoreDatabase[]>(`${fsBase(projectId)}/databases`, { signal }),
    enabled: !!profileId,
  });
}

export function useCreateDatabase(projectId: string) {
  const { key } = useKey(projectId, 'databases');
  return useOperationMutation({
    mutationFn: (body: CreateDatabase) => api<OperationAccepted>(`${fsBase(projectId)}/databases`, { body }),
    started: (b) => `Creating database ${b.id}`,
    invalidate: [key],
  });
}

export function useUpdateDatabase(projectId: string, databaseId: string) {
  const { key } = useKey(projectId, 'databases');
  return useOperationMutation({
    mutationFn: (body: UpdateDatabase) => api<OperationAccepted>(dbBase(projectId, databaseId), { method: 'PATCH', body }),
    started: () => `Updating ${databaseId}`,
    invalidate: [key],
  });
}

export function deleteDatabase(projectId: string, databaseId: string, confirm: string) {
  return api<OperationAccepted>(dbBase(projectId, databaseId), { method: 'DELETE', body: { confirm } });
}

export function useCloneDatabase(projectId: string, databaseId: string) {
  return useOperationMutation({
    mutationFn: (body: { targetId: string; snapshotTime: string }) =>
      api<OperationAccepted>(`${dbBase(projectId, databaseId)}/clone`, { body }),
    started: (b) => `Cloning ${databaseId} to ${b.targetId}`,
  });
}

// ---- data -------------------------------------------------------------------------------------------

export function useCollections(projectId: string, databaseId: string, parent: string, enabled = true) {
  const { profileId, key } = useKey(projectId, databaseId, 'collections', parent);
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ signal, pageParam }) =>
      api<CollectionIdsPage>(
        `${dbBase(projectId, databaseId)}/collections${qs({ parent, pageSize: 100, pageToken: pageParam || undefined })}`,
        { signal },
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId && enabled,
  });
}

export function useDocuments(projectId: string, databaseId: string, collection: string, pageSize: number, enabled = true) {
  const { profileId, key } = useKey(projectId, databaseId, 'documents', collection, pageSize);
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ signal, pageParam }) =>
      api<DocumentsPage>(
        `${dbBase(projectId, databaseId)}/documents${qs({ collection, pageSize, pageToken: pageParam || undefined, showMissing: true })}`,
        { signal },
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId && enabled && collection !== '',
  });
}

export function useDocument(projectId: string, databaseId: string, path: string | null) {
  const { profileId, key } = useKey(projectId, databaseId, 'document', path);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<FirestoreDocument>(`${dbBase(projectId, databaseId)}/document${qs({ path: path ?? '' })}`, { signal }),
    enabled: !!profileId && !!path,
    retry: (n, err) => !(err instanceof ApiError && err.problem.code === 'NOT_FOUND') && n < 2,
  });
}

/** Refreshes every data view of the database after a write. */
export function useInvalidateData(projectId: string, databaseId: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return () => client.invalidateQueries({ queryKey: ['firestore', profileId, projectId, databaseId] });
}

export function createDocument(projectId: string, databaseId: string, body: CreateDocument) {
  return api<FirestoreDocument>(`${dbBase(projectId, databaseId)}/documents`, { body });
}

export function saveDocument(projectId: string, databaseId: string, path: string, body: SaveDocument) {
  return api<FirestoreDocument>(`${dbBase(projectId, databaseId)}/document${qs({ path })}`, { method: 'PUT', body });
}

export function deleteDocument(projectId: string, databaseId: string, path: string, confirm: string, recursive: boolean) {
  return api<OperationAccepted | { operation: null }>(`${dbBase(projectId, databaseId)}/document${qs({ path })}`, {
    method: 'DELETE',
    body: { confirm, recursive },
  });
}

export function countCollection(projectId: string, databaseId: string, collection: string) {
  return api<{ count: number }>(`${dbBase(projectId, databaseId)}/count${qs({ collection })}`);
}

export function deleteCollection(projectId: string, databaseId: string, collection: string, confirm: string) {
  return api<OperationAccepted>(`${dbBase(projectId, databaseId)}/delete-collection`, { body: { collection, confirm } });
}

export function runQuery(projectId: string, databaseId: string, query: QuerySpecInput, explain?: ExplainMode) {
  return api<QueryResult>(`${dbBase(projectId, databaseId)}/query`, { body: { query, explain } });
}

export function runAggregation(
  projectId: string,
  databaseId: string,
  query: QuerySpecInput,
  aggregations: Aggregation[],
  explain?: ExplainMode,
) {
  return api<AggregationResult>(`${dbBase(projectId, databaseId)}/aggregate`, { body: { query, aggregations, explain } });
}

export function importBatch(projectId: string, databaseId: string, body: ImportBatch) {
  return api<ImportBatchResult>(`${dbBase(projectId, databaseId)}/import-batch`, { body });
}

// ---- indexes, fields, TTL ---------------------------------------------------------------------------

export function useIndexes(projectId: string, databaseId: string) {
  const { profileId, key } = useKey(projectId, databaseId, 'indexes');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<FirestoreIndex[]>(`${dbBase(projectId, databaseId)}/indexes`, { signal }),
    enabled: !!profileId,
  });
}

export function useCreateIndex(projectId: string, databaseId: string) {
  const { key } = useKey(projectId, databaseId, 'indexes');
  return useOperationMutation({
    mutationFn: (body: CreateIndex) => api<OperationAccepted>(`${dbBase(projectId, databaseId)}/indexes`, { body }),
    started: (b) => `Creating an index on ${b.collectionGroup}`,
    invalidate: [key],
  });
}

export function deleteIndex(projectId: string, databaseId: string, name: string) {
  return api<void>(`${dbBase(projectId, databaseId)}/indexes/delete`, { body: { name } });
}

export function useFields(projectId: string, databaseId: string, kind: 'overrides' | 'ttl') {
  const { profileId, key } = useKey(projectId, databaseId, 'fields', kind);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<FieldOverride[]>(`${dbBase(projectId, databaseId)}/fields${qs({ kind })}`, { signal }),
    enabled: !!profileId,
  });
}

export function useSetFieldIndexes(projectId: string, databaseId: string) {
  const { key } = useKey(projectId, databaseId, 'fields');
  return useOperationMutation({
    mutationFn: (body: SetFieldIndexes) =>
      api<OperationAccepted>(`${dbBase(projectId, databaseId)}/fields/indexes`, { method: 'PUT', body }),
    started: (b) => `Updating indexes of ${b.collectionGroup}.${b.fieldPath}`,
    invalidate: [key],
  });
}

export function useSetTtl(projectId: string, databaseId: string) {
  const { key } = useKey(projectId, databaseId, 'fields');
  return useOperationMutation({
    mutationFn: (body: SetTtl) => api<OperationAccepted>(`${dbBase(projectId, databaseId)}/fields/ttl`, { method: 'PUT', body }),
    started: (b) => `${b.enabled ? 'Enabling' : 'Disabling'} TTL on ${b.collectionGroup}.${b.fieldPath}`,
    invalidate: [key],
  });
}

// ---- export, import, bulk delete ---------------------------------------------------------------------

export function useAdminOperations(projectId: string, databaseId: string) {
  const { profileId, key } = useKey(projectId, databaseId, 'operations');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<FirestoreOperation[]>(`${dbBase(projectId, databaseId)}/operations`, { signal }),
    enabled: !!profileId,
    refetchInterval: 15_000,
  });
}

export function useExportDocuments(projectId: string, databaseId: string) {
  return useOperationMutation({
    mutationFn: (body: ExportDocuments) => api<OperationAccepted>(`${dbBase(projectId, databaseId)}/export`, { body }),
    started: (b) => `Exporting to ${b.outputUriPrefix}`,
  });
}

export function useImportDocuments(projectId: string, databaseId: string) {
  return useOperationMutation({
    mutationFn: (body: ImportDocuments) => api<OperationAccepted>(`${dbBase(projectId, databaseId)}/import`, { body }),
    started: (b) => `Importing ${b.inputUriPrefix}`,
  });
}

export function bulkDelete(projectId: string, databaseId: string, collectionIds: string[], confirm: string) {
  return api<OperationAccepted>(`${dbBase(projectId, databaseId)}/bulk-delete`, { body: { collectionIds, confirm } });
}

// ---- backups ---------------------------------------------------------------------------------------------

export function useBackups(projectId: string) {
  const { profileId, key } = useKey(projectId, 'backups');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<ListResponse<FirestoreBackup>>(`${fsBase(projectId)}/backups`, { signal }),
    enabled: !!profileId,
  });
}

export function deleteBackup(projectId: string, name: string, confirm: string) {
  return api<void>(`${fsBase(projectId)}/backups/delete`, { body: { name, confirm } });
}

export function restoreBackup(projectId: string, backup: string, targetId: string, confirm: string) {
  return api<OperationAccepted>(`${fsBase(projectId)}/restore`, { body: { backup, targetId, confirm } });
}

export function useSchedules(projectId: string, databaseId: string) {
  const { profileId, key } = useKey(projectId, databaseId, 'schedules');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<BackupSchedule[]>(`${dbBase(projectId, databaseId)}/backup-schedules`, { signal }),
    enabled: !!profileId,
  });
}

export function useSaveSchedule(projectId: string, databaseId: string) {
  const client = useQueryClient();
  const { key } = useKey(projectId, databaseId, 'schedules');
  return useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: SaveBackupSchedule }) =>
      id
        ? api<BackupSchedule>(`${dbBase(projectId, databaseId)}/backup-schedules/${enc(id)}`, { method: 'PUT', body })
        : api<BackupSchedule>(`${dbBase(projectId, databaseId)}/backup-schedules`, { body }),
    onSuccess: () => {
      toast.success('Backup schedule saved');
      void client.invalidateQueries({ queryKey: key });
    },
    onError: failed('Saving the schedule'),
  });
}

export function deleteSchedule(projectId: string, databaseId: string, id: string) {
  return api<void>(`${dbBase(projectId, databaseId)}/backup-schedules/${enc(id)}`, { method: 'DELETE' });
}

// ---- rules -------------------------------------------------------------------------------------------------

export function useRules(projectId: string, databaseId: string) {
  const { profileId, key } = useKey(projectId, databaseId, 'rules');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<RulesState>(`${dbBase(projectId, databaseId)}/rules`, { signal }),
    enabled: !!profileId,
  });
}

export function fetchRuleset(projectId: string, id: string) {
  return api<Ruleset>(`${fsBase(projectId)}/rulesets/${enc(id)}`);
}

export function validateRules(projectId: string, source: string) {
  return api<RulesIssue[]>(`${fsBase(projectId)}/rules/validate`, { body: { source } });
}

export function publishRules(projectId: string, databaseId: string, source: string, baseRuleset: string | null) {
  return api<{ ruleset: Ruleset; issues: RulesIssue[] }>(`${dbBase(projectId, databaseId)}/rules`, { body: { source, baseRuleset } });
}

export function testRules(projectId: string, databaseId: string, body: TestRules) {
  return api<{ issues: RulesIssue[]; results: RulesTestResult[] }>(`${dbBase(projectId, databaseId)}/rules/test`, { body });
}

// ---- datastore mode ----------------------------------------------------------------------------------------

export function useNamespaces(projectId: string, databaseId: string) {
  const { profileId, key } = useKey(projectId, databaseId, 'ds', 'namespaces');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<string[]>(`${dsBase(projectId, databaseId)}/namespaces`, { signal }),
    enabled: !!profileId,
  });
}

export function useKinds(projectId: string, databaseId: string, namespace: string) {
  const { profileId, key } = useKey(projectId, databaseId, 'ds', 'kinds', namespace);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<string[]>(`${dsBase(projectId, databaseId)}/kinds${qs({ namespace })}`, { signal }),
    enabled: !!profileId,
  });
}

export function useEntities(projectId: string, databaseId: string, namespace: string, kind: string) {
  const { profileId, key } = useKey(projectId, databaseId, 'ds', 'entities', namespace, kind);
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ signal, pageParam }) =>
      api<EntitiesPage>(`${dsBase(projectId, databaseId)}/entities${qs({ namespace, kind, cursor: pageParam || undefined })}`, { signal }),
    initialPageParam: '',
    getNextPageParam: (last) => last.endCursor ?? undefined,
    enabled: !!profileId && !!kind,
  });
}

export function runGql(projectId: string, databaseId: string, namespace: string, gql: string, cursor?: string) {
  return api<EntitiesPage>(`${dsBase(projectId, databaseId)}/gql`, { body: { namespace, gql, cursor } });
}

export function saveEntity(projectId: string, databaseId: string, body: SaveEntity) {
  return api<DatastoreEntity>(`${dsBase(projectId, databaseId)}/entity`, { method: 'PUT', body });
}

export function deleteEntity(projectId: string, databaseId: string, key: DatastoreEntity['key'], confirm: string) {
  return api<void>(`${dsBase(projectId, databaseId)}/entity/delete`, { body: { key, confirm } });
}
