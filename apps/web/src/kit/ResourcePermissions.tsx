import type { IamPolicyView, ResourceIamKind, SetIamPolicy } from '@nephoscope/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DelayedSkeleton, ProblemState } from '../design/Feedback';
import { ApiError, api, qs } from '../lib/api';
import { PolicyEditor } from '../products/iam/PolicyEditor';
import { useActiveProfile } from '../state/queries';
import { useSession } from '../state/session';

interface ResourcePermissionsProps {
  projectId: string;
  kind: ResourceIamKind;
  /** Full resource name, `projects/{p}/...`. */
  name: string;
  readOnly: string | null;
  /** gcloud noun for the equivalent command, such as `secrets my-secret`. */
  gcloudTarget: string;
  suggested?: string[];
}

/** The Permissions tab of a resource (SPEC-0001 CA-64): its IAM policy, edited like the project's. */
export function ResourcePermissions({ projectId, kind, name, readOnly, gcloudTarget, suggested }: ResourcePermissionsProps) {
  const profileId = useSession((s) => s.profileId);
  const { profile } = useActiveProfile();
  const client = useQueryClient();
  const key = ['resource-iam', profileId, projectId, kind, name];
  const path = `/api/projects/${encodeURIComponent(projectId)}/resource-iam${qs({ kind, name })}`;
  const policy = useQuery({ queryKey: key, queryFn: ({ signal }) => api<IamPolicyView>(path, { signal }), enabled: !!profileId });
  const save = useMutation({
    mutationFn: (body: SetIamPolicy) => api<IamPolicyView>(path, { method: 'PUT', body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key });
      toast.success('Permissions saved');
    },
  });
  if (policy.isPending) return <DelayedSkeleton rows={6} />;
  if (policy.error instanceof ApiError) return <ProblemState problem={policy.error.problem} onRetry={() => void policy.refetch()} />;
  if (!policy.data) return null;
  const principal = profile?.principal ?? null;
  const self = principal ? (/\.gserviceaccount\.com$/.test(principal) ? `serviceAccount:${principal}` : `user:${principal}`) : null;
  return (
    <PolicyEditor
      projectId={projectId}
      policy={policy.data}
      self={self}
      readOnly={readOnly}
      save={(body) => save.mutateAsync(body)}
      onReload={() => void policy.refetch()}
      suggested={suggested}
      gcloudTarget={gcloudTarget}
    />
  );
}
