import type {
  BucketIamPolicy,
  CopyObject,
  CreateBucket,
  ListResponse,
  ObjectLink,
  ObjectLinkRequest,
  ObjectRef,
  ObjectsPage,
  OperationAccepted,
  Problem,
  SetBucketIam,
  StorageBucket,
  StorageCapabilities,
  StorageObject,
  UpdateBucket,
  UpdateObject,
} from '@nephoscope/contracts';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE, PROFILE_HEADER } from '@nephoscope/contracts/constants';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, api, qs } from '../../lib/api';
import { useOperations } from '../../state/operations';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/storage`;
const bucketBase = (p: string, b: string) => `${base(p)}/buckets/${enc(b)}`;
export const baseName = (name: string) => name.replace(/\/$/, '').split('/').pop() ?? name;
export const bucketHref = (p: string, b: string) => `/p/${p}/storage/${enc(b)}`;

export const failed = (what: string) => (err: unknown) =>
  toast.error(`${what} failed`, { description: err instanceof ApiError ? err.problem.detail : String(err), duration: 10_000 });

function useKey(...parts: unknown[]) {
  const profileId = useSession((s) => s.profileId);
  return { profileId, key: ['storage', profileId, ...parts] };
}

export function useInvalidateStorage(projectId: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return (...parts: unknown[]) => client.invalidateQueries({ queryKey: ['storage', profileId, projectId, ...parts] });
}

export function useCapabilities(projectId: string) {
  const { profileId, key } = useKey(projectId, 'capabilities');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<StorageCapabilities>(`${base(projectId)}/capabilities`, { signal }),
    enabled: !!profileId,
    staleTime: 60_000,
  });
}

export function useBuckets(projectId: string) {
  const { profileId, key } = useKey(projectId, 'buckets');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<ListResponse<StorageBucket>>(`${base(projectId)}/buckets`, { signal }),
    enabled: !!profileId,
  });
}

export function useBucket(projectId: string, bucket: string) {
  const { profileId, key } = useKey(projectId, 'buckets', bucket);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<StorageBucket>(bucketBase(projectId, bucket), { signal }),
    enabled: !!profileId,
  });
}

export function useBucketRaw(projectId: string, bucket: string, enabled: boolean) {
  const { profileId, key } = useKey(projectId, 'buckets', bucket, 'raw');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<unknown>(`${bucketBase(projectId, bucket)}/raw`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export function useBucketIam(projectId: string, bucket: string, enabled: boolean) {
  const { profileId, key } = useKey(projectId, 'buckets', bucket, 'iam');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<BucketIamPolicy>(`${bucketBase(projectId, bucket)}/iam`, { signal }),
    enabled: !!profileId && enabled,
    retry: false,
  });
}

export interface ObjectListing {
  prefix: string;
  flat: boolean;
  versions: boolean;
  softDeleted: boolean;
}

/** One level (or everything under a prefix), 1,000 per page (D-11). */
export function useObjects(projectId: string, bucket: string, q: ObjectListing, hierarchical: boolean) {
  const { profileId, key } = useKey(projectId, 'buckets', bucket, 'objects', q, hierarchical);
  return useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api<ObjectsPage>(
        `${bucketBase(projectId, bucket)}/objects${qs({
          prefix: q.prefix,
          flat: q.flat,
          versions: q.versions,
          softDeleted: q.softDeleted,
          hierarchical,
          pageToken: pageParam,
        })}`,
        { signal },
      ),
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId,
  });
}

export function useObject(projectId: string, bucket: string, ref: ObjectRef | null) {
  const { profileId, key } = useKey(projectId, 'buckets', bucket, 'object', ref?.name, ref?.generation);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<StorageObject>(`${bucketBase(projectId, bucket)}/object${qs({ name: ref?.name, generation: ref?.generation })}`, { signal }),
    enabled: !!profileId && !!ref,
  });
}

export const createBucket = (projectId: string, body: CreateBucket) => api<StorageBucket>(`${base(projectId)}/buckets`, { body });
export const updateBucket = (projectId: string, bucket: string, body: UpdateBucket) =>
  api<StorageBucket>(bucketBase(projectId, bucket), { method: 'PATCH', body });
export const lockRetention = (projectId: string, bucket: string, metageneration: string, confirm: string) =>
  api<StorageBucket>(`${bucketBase(projectId, bucket)}/lock-retention`, { body: { metageneration, confirm } });
export const countObjects = (projectId: string, bucket: string) =>
  api<{ count: number; capped: boolean }>(`${bucketBase(projectId, bucket)}/count`);
export const deleteBucket = (projectId: string, bucket: string, confirm: string, confirmObjects?: string) =>
  api<OperationAccepted | { operation: null }>(bucketBase(projectId, bucket), { method: 'DELETE', body: { confirm, confirmObjects } });
export const setBucketIam = (projectId: string, bucket: string, body: SetBucketIam) =>
  api<BucketIamPolicy>(`${bucketBase(projectId, bucket)}/iam`, { method: 'PUT', body });

export const updateObject = (projectId: string, bucket: string, body: UpdateObject) =>
  api<StorageObject>(`${bucketBase(projectId, bucket)}/object`, { method: 'PATCH', body });
export const deleteObjects = (projectId: string, bucket: string, objects: ObjectRef[], confirm: string) =>
  api<{ deleted: number; failures: { name: string; error: string }[] }>(`${bucketBase(projectId, bucket)}/objects/delete`, {
    body: { objects, confirm },
  });
export const copyObject = (projectId: string, bucket: string, body: CopyObject) =>
  api<StorageObject>(`${bucketBase(projectId, bucket)}/objects/copy`, { body });
export const restoreObject = (projectId: string, bucket: string, name: string, generation: string) =>
  api<StorageObject>(`${bucketBase(projectId, bucket)}/objects/restore`, { body: { name, generation } });
export const makePublic = (projectId: string, bucket: string, name: string, confirm: string) =>
  api<void>(`${bucketBase(projectId, bucket)}/objects/public`, { body: { name, confirm } });
export const signUrl = (projectId: string, bucket: string, name: string, expiresSeconds: number) =>
  api<{ url: string; expiresAt: string }>(`${bucketBase(projectId, bucket)}/objects/signed-url`, { body: { name, expiresSeconds } });
export const objectLink = (projectId: string, bucket: string, body: ObjectLinkRequest) =>
  api<ObjectLink>(`${bucketBase(projectId, bucket)}/objects/link`, { body });
export const createFolder = (projectId: string, bucket: string, name: string, hierarchical: boolean) =>
  api<void>(`${bucketBase(projectId, bucket)}/folders`, { body: { name, hierarchical } });
export const renameFolder = (projectId: string, bucket: string, source: string, destination: string) =>
  api<OperationAccepted>(`${bucketBase(projectId, bucket)}/folders/rename`, { body: { source, destination } });

export function useBucketMutation<V, R>(projectId: string, bucket: string, fn: (v: V) => Promise<R>, what: string) {
  const invalidate = useInvalidateStorage(projectId);
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void invalidate('buckets', bucket);
      void invalidate('buckets');
    },
    onError: failed(what),
  });
}

/** Downloads through a short-lived attachment link: streamed by the server, never held here (D-11). */
export async function downloadObject(projectId: string, bucket: string, ref: ObjectRef): Promise<void> {
  const link = await objectLink(projectId, bucket, { ...ref, disposition: 'attachment' });
  const a = document.createElement('a');
  a.href = link.url;
  a.rel = 'noopener';
  a.click();
}

/** Tracks a bucket delete that empties the bucket first (D-10). */
export function trackOperation(result: OperationAccepted | { operation: null }) {
  if (result.operation) useOperations.getState().upsert(result.operation);
}

// ---- uploads -------------------------------------------------------------------------------------------

export interface UploadHandle {
  promise: Promise<StorageObject>;
  abort: () => void;
}

export class UploadError extends Error {
  constructor(
    readonly problem: Problem | null,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Streams one file to the server, which streams it on into a resumable upload (D-11, CA-11).
 * XMLHttpRequest, because fetch still reports no upload progress.
 */
export function uploadFile(
  projectId: string,
  bucket: string,
  name: string,
  file: Blob,
  overwrite: boolean,
  onProgress: (loaded: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<StorageObject>((resolve, reject) => {
    xhr.open('PUT', `${bucketBase(projectId, bucket)}/upload${qs({ name, overwrite })}`);
    xhr.setRequestHeader(CLIENT_HEADER, CLIENT_HEADER_VALUE);
    const profileId = useSession.getState().profileId;
    if (profileId) xhr.setRequestHeader(PROFILE_HEADER, profileId);
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as StorageObject);
      else {
        const problem = body && typeof body === 'object' && 'code' in body ? (body as Problem) : null;
        reject(new UploadError(problem, problem?.detail ?? `The server answered ${xhr.status}.`));
      }
    };
    xhr.onerror = () => reject(new UploadError(null, 'The upload was interrupted.'));
    xhr.onabort = () => reject(new UploadError(null, 'Cancelled'));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
