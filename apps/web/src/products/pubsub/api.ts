import type {
  CreateSchema,
  CreateSubscription,
  CreateTopic,
  ListResponse,
  Publish,
  PubSubMessage,
  PubSubSchema,
  PubSubSnapshot,
  PubSubSubscription,
  PubSubTopic,
  Resend,
  ResendResult,
  Seek,
  SubscriptionSettings,
  TopicSettings,
  ValidateMessage,
} from '@nephoscope/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, api } from '../../lib/api';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/pubsub`;
export const shortName = (name: string) => name.split('/').pop() ?? name;
export const topicPath = (p: string, id: string) => `projects/${p}/topics/${id}`;
export const subscriptionPath = (p: string, id: string) => `projects/${p}/subscriptions/${id}`;

export const failed = (what: string) => (err: unknown) =>
  toast.error(`${what} failed`, { description: err instanceof ApiError ? err.problem.detail : String(err), duration: 10_000 });

function useKey(...parts: unknown[]) {
  const profileId = useSession((s) => s.profileId);
  return { profileId, key: ['pubsub', profileId, ...parts] };
}

export function useInvalidatePubSub(projectId: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return () => client.invalidateQueries({ queryKey: ['pubsub', profileId, projectId] });
}

function useList<T>(projectId: string, what: string) {
  const { profileId, key } = useKey(projectId, what);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<ListResponse<T>>(`${base(projectId)}/${what}`, { signal }),
    enabled: !!profileId,
  });
}

export const useTopics = (projectId: string) => useList<PubSubTopic>(projectId, 'topics');
export const useSubscriptions = (projectId: string) => useList<PubSubSubscription>(projectId, 'subscriptions');
export const useSnapshots = (projectId: string, enabled = true) => {
  const { profileId, key } = useKey(projectId, 'snapshots');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<ListResponse<PubSubSnapshot>>(`${base(projectId)}/snapshots`, { signal }),
    enabled: !!profileId && enabled,
    retry: false,
  });
};
export const useSchemas = (projectId: string, enabled = true) => {
  const { profileId, key } = useKey(projectId, 'schemas');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<ListResponse<PubSubSchema>>(`${base(projectId)}/schemas`, { signal }),
    enabled: !!profileId && enabled,
    retry: false,
  });
};

export function useTopic(projectId: string, id: string) {
  const { profileId, key } = useKey(projectId, 'topics', id);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<PubSubTopic>(`${base(projectId)}/topics/${enc(id)}`, { signal }),
    enabled: !!profileId,
  });
}

export function useTopicRaw(projectId: string, id: string, enabled: boolean) {
  const { profileId, key } = useKey(projectId, 'topics', id, 'raw');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<unknown>(`${base(projectId)}/topics/${enc(id)}/raw`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export function useTopicSubscriptions(projectId: string, id: string) {
  const { profileId, key } = useKey(projectId, 'topics', id, 'subscriptions');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<string[]>(`${base(projectId)}/topics/${enc(id)}/subscriptions`, { signal }),
    enabled: !!profileId,
  });
}

export function useTopicSnapshots(projectId: string, id: string) {
  const { profileId, key } = useKey(projectId, 'topics', id, 'snapshots');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<string[]>(`${base(projectId)}/topics/${enc(id)}/snapshots`, { signal }),
    enabled: !!profileId,
    retry: false,
  });
}

export function useSubscription(projectId: string, id: string) {
  const { profileId, key } = useKey(projectId, 'subscriptions', id);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<PubSubSubscription>(`${base(projectId)}/subscriptions/${enc(id)}`, { signal }),
    enabled: !!profileId,
  });
}

export function useSubscriptionRaw(projectId: string, id: string, enabled: boolean) {
  const { profileId, key } = useKey(projectId, 'subscriptions', id, 'raw');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<unknown>(`${base(projectId)}/subscriptions/${enc(id)}/raw`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export function useSchema(projectId: string, id: string) {
  const { profileId, key } = useKey(projectId, 'schemas', id);
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<PubSubSchema>(`${base(projectId)}/schemas/${enc(id)}`, { signal }),
    enabled: !!profileId,
  });
}

export function useSchemaRevisions(projectId: string, id: string) {
  const { profileId, key } = useKey(projectId, 'schemas', id, 'revisions');
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<PubSubSchema[]>(`${base(projectId)}/schemas/${enc(id)}/revisions`, { signal }),
    enabled: !!profileId,
  });
}

function useWrite<V, R>(projectId: string, fn: (v: V) => Promise<R>, what: string, done?: (r: R, v: V) => string | null) {
  const invalidate = useInvalidatePubSub(projectId);
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      const message = done?.(r, v);
      if (message) toast.success(message);
      void invalidate();
    },
    onError: failed(what),
  });
}

export const useCreateTopic = (projectId: string) =>
  useWrite(
    projectId,
    (b: CreateTopic) => api<PubSubTopic>(`${base(projectId)}/topics`, { body: b }),
    'Creating the topic',
    (t) => `Created ${t.id}`,
  );
export const useUpdateTopic = (projectId: string, id: string) =>
  useWrite(
    projectId,
    (b: TopicSettings) => api<PubSubTopic>(`${base(projectId)}/topics/${enc(id)}`, { method: 'PUT', body: b }),
    'Saving the topic',
    () => `Saved ${id}`,
  );
export const deleteTopic = (projectId: string, id: string, confirm: string) =>
  api<void>(`${base(projectId)}/topics/${enc(id)}`, { method: 'DELETE', body: { confirm } });
export const useCreateSubscription = (projectId: string) =>
  useWrite(
    projectId,
    (b: CreateSubscription) => api<PubSubSubscription>(`${base(projectId)}/subscriptions`, { body: b }),
    'Creating the subscription',
    (s) => `Created ${s.id}`,
  );
export const useUpdateSubscription = (projectId: string, id: string) =>
  useWrite(
    projectId,
    (b: SubscriptionSettings) => api<PubSubSubscription>(`${base(projectId)}/subscriptions/${enc(id)}`, { method: 'PUT', body: b }),
    'Saving the subscription',
    () => `Saved ${id}`,
  );
export const deleteSubscription = (projectId: string, id: string, confirm: string) =>
  api<void>(`${base(projectId)}/subscriptions/${enc(id)}`, { method: 'DELETE', body: { confirm } });
export const detachSubscription = (projectId: string, id: string, confirm: string) =>
  api<void>(`${base(projectId)}/subscriptions/${enc(id)}/detach`, { body: { confirm } });
export const publish = (projectId: string, topic: string, body: Publish) =>
  api<{ messageIds: string[] }>(`${base(projectId)}/topics/${enc(topic)}/publish`, { body });
export const peek = (projectId: string, sub: string, max: number) =>
  api<PubSubMessage[]>(`${base(projectId)}/subscriptions/${enc(sub)}/peek`, { body: { max } });
export const pullAck = (projectId: string, sub: string, max: number, confirm: string) =>
  api<PubSubMessage[]>(`${base(projectId)}/subscriptions/${enc(sub)}/pull-ack`, { body: { max, confirm } });
export const seek = (projectId: string, sub: string, body: Seek) =>
  api<void>(`${base(projectId)}/subscriptions/${enc(sub)}/seek`, { body });
export const grantDeadLetter = (projectId: string, sub: string, projectNumber: string) =>
  api<{ member: string }>(`${base(projectId)}/subscriptions/${enc(sub)}/dead-letter-grants`, { body: { projectNumber } });
export const resend = (projectId: string, body: Resend) => api<ResendResult>(`${base(projectId)}/resend`, { body });
export const createSnapshot = (projectId: string, id: string, subscription: string) =>
  api<PubSubSnapshot>(`${base(projectId)}/snapshots`, { body: { id, subscription } });
export const deleteSnapshot = (projectId: string, id: string, confirm: string) =>
  api<void>(`${base(projectId)}/snapshots/${enc(id)}`, { method: 'DELETE', body: { confirm } });
export const createSchema = (projectId: string, body: CreateSchema) => api<PubSubSchema>(`${base(projectId)}/schemas`, { body });
export const commitSchema = (projectId: string, id: string, type: string, definition: string) =>
  api<PubSubSchema>(`${base(projectId)}/schemas/${enc(id)}/commit`, { body: { type, definition } });
export const rollbackSchema = (projectId: string, id: string, revisionId: string) =>
  api<PubSubSchema>(`${base(projectId)}/schemas/${enc(id)}/rollback`, { body: { revisionId } });
export const deleteRevision = (projectId: string, id: string, revisionId: string) =>
  api<void>(`${base(projectId)}/schemas/${enc(id)}/revisions/${enc(revisionId)}`, { method: 'DELETE' });
export const deleteSchema = (projectId: string, id: string, confirm: string) =>
  api<void>(`${base(projectId)}/schemas/${enc(id)}`, { method: 'DELETE', body: { confirm } });
export const validateSchema = (projectId: string, type: string, definition: string) =>
  api<{ valid: boolean; message: string | null }>(`${base(projectId)}/schemas/validate`, { body: { type, definition } });
export const validateMessage = (projectId: string, id: string, body: ValidateMessage) =>
  api<{ valid: boolean; message: string | null }>(`${base(projectId)}/schemas/${enc(id)}/validate-message`, { body });
