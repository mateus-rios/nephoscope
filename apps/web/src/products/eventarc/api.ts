import type {
  CreateTrigger,
  EventarcTrigger,
  EventProvider,
  ListResponse,
  OperationAccepted,
  TriggerDestination,
} from '@nephoscope/contracts';
import { useQuery } from '@tanstack/react-query';
import { useOperationMutation } from '../../kit/operations';
import { api, qs } from '../../lib/api';
import { useSession } from '../../state/session';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/eventarc`;

export function useTriggers(projectId: string, enabled = true) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['eventarc', profileId, projectId],
    queryFn: ({ signal }) => api<ListResponse<EventarcTrigger>>(`${base(projectId)}/triggers`, { signal }),
    enabled: !!profileId && enabled,
  });
}

export function useProviders(projectId: string, location: string, enabled: boolean) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['eventarc', profileId, projectId, 'providers', location],
    queryFn: ({ signal }) => api<EventProvider[]>(`${base(projectId)}/providers${qs({ location })}`, { signal }),
    enabled: !!profileId && enabled && /^[a-z0-9-]{2,}$/.test(location),
    staleTime: 60 * 60_000,
  });
}

export function useCreateTrigger(projectId: string) {
  const profileId = useSession((s) => s.profileId);
  return useOperationMutation({
    mutationFn: (body: CreateTrigger) => api<OperationAccepted>(`${base(projectId)}/triggers`, { body }),
    started: (b) => `Creating trigger ${b.id}`,
    invalidate: [['eventarc', profileId, projectId]],
  });
}

export function deleteTrigger(projectId: string, location: string, id: string, confirm: string) {
  return api<OperationAccepted>(`${base(projectId)}/locations/${enc(location)}/triggers/${enc(id)}`, {
    method: 'DELETE',
    body: { confirm },
  });
}

export function destinationText(d: TriggerDestination): string {
  switch (d.kind) {
    case 'cloudRun':
      return `Cloud Run ${d.service}${d.path ? ` ${d.path}` : ''} (${d.region})`;
    case 'workflow':
      return `Workflow ${d.workflow.split('/').pop()}`;
    case 'cloudFunction':
      return `Function ${d.function.split('/').pop()}`;
    case 'gke':
      return `GKE ${d.service}`;
    case 'http':
      return d.uri;
    default:
      return 'Unknown';
  }
}
