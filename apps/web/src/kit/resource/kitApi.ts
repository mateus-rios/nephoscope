import type { KitActionBody, KitItem, ListResponse, OperationAccepted } from '@nephoscope/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;

export function kitBase(projectId: string, key: string): string {
  const [product, collection] = key.split('/');
  return `/api/projects/${enc(projectId)}/kit/${enc(product ?? '')}/${enc(collection ?? '')}`;
}

/** Page of a kit resource: `/p/{project}/r/{product}/{collection}/{path}`. */
export function kitHref(projectId: string, key: string, path: string): string {
  return `/p/${projectId}/r/${key}/${path}`;
}

export function useKitList(projectId: string, key: string, opts: { parent?: string; region?: string; enabled?: boolean } = {}) {
  const profileId = useSession((s) => s.profileId);
  return useInfiniteQuery({
    queryKey: ['kit', profileId, projectId, key, 'list', opts.parent ?? '', opts.region ?? ''],
    queryFn: ({ signal, pageParam }) =>
      api<ListResponse<KitItem>>(`${kitBase(projectId, key)}${qs({ parent: opts.parent, region: opts.region, pageToken: pageParam })}`, {
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId && (opts.enabled ?? true),
  });
}

export function useKitItem(projectId: string, key: string, path: string) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['kit', profileId, projectId, key, 'item', path],
    queryFn: ({ signal }) => api<KitItem>(`${kitBase(projectId, key)}/item${qs({ path })}`, { signal }),
    enabled: !!profileId,
  });
}

export function useKitExtra(projectId: string, key: string, path: string, extra: string, enabled: boolean) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['kit', profileId, projectId, key, 'extra', path, extra],
    queryFn: ({ signal }) => api<{ value: unknown }>(`${kitBase(projectId, key)}/item/extras/${enc(extra)}${qs({ path })}`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export function runKitAction(projectId: string, key: string, action: string, body: KitActionBody): Promise<OperationAccepted> {
  return api<OperationAccepted>(`${kitBase(projectId, key)}/actions/${enc(action)}`, { body });
}
