import {
  type ListResponse,
  type OperationAccepted,
  type RegistryDockerImageView,
  type RegistryPackageView,
  type RegistryRepositoryView,
  type RegistryTagView,
  type RegistryVersionView,
  registryConfirmToken,
  type VulnerabilityReport,
} from '@nephoscope/contracts';
import { PlusIcon, RocketIcon, ShieldWarningIcon, TrashIcon } from '@phosphor-icons/react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, buttonClass, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Notes, Section, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Chip, Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { partialNote } from '../../kit/ListControls';
import { ResourcePermissions } from '../../kit/ResourcePermissions';
import { ApiError, api, qs } from '../../lib/api';
import { bytes } from '../../lib/format';
import { useOperations } from '../../state/operations';
import { useActiveProfile, useInstance } from '../../state/queries';
import { useSession } from '../../state/session';
import { readOnlyReason } from '../run/common';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/artifactregistry`;

function useReadOnly() {
  const instance = useInstance();
  const { profile } = useActiveProfile();
  return readOnlyReason(instance.data?.readOnly, profile?.readOnly);
}

function useRegistryQuery<T>(projectId: string, key: unknown[], path: string, enabled = true) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['artifactregistry', profileId, projectId, ...key],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled: !!profileId && enabled,
  });
}

function usePaged<T>(projectId: string, key: unknown[], path: string, name: string, enabled = true) {
  const profileId = useSession((s) => s.profileId);
  return useInfiniteQuery({
    queryKey: ['artifactregistry', profileId, projectId, ...key, name],
    queryFn: ({ signal, pageParam }) => api<ListResponse<T>>(`${path}${qs({ name, pageToken: pageParam })}`, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: !!profileId && enabled,
  });
}

function useDeleteItem(projectId: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return async (name: string, confirm: string) => {
    const r = await api<OperationAccepted>(`${base(projectId)}/item`, { method: 'DELETE', body: { name, confirm } });
    useOperations.getState().upsert(r.operation);
    void client.invalidateQueries({ queryKey: ['artifactregistry', profileId, projectId] });
  };
}

const repoHref = (projectId: string, r: Pick<RegistryRepositoryView, 'location' | 'id'>) =>
  `/p/${projectId}/artifactregistry/${r.location}/${r.id}`;

/** Repositories of every format and location (SPEC-0007 D-11, CA-11). */
export function RegistryPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const q = useRegistryQuery<ListResponse<RegistryRepositoryView>>(projectId, ['repositories'], `${base(projectId)}/repositories`);
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  useEffect(() => {
    document.title = 'Artifact Registry · Nephoscope';
  }, []);
  const all = q.data?.items ?? [];
  const rows = all.filter((r) => !filter.trim() || r.id.includes(filter.trim().toLowerCase()));
  const columns: ResourceColumn<RegistryRepositoryView>[] = [
    {
      id: 'id',
      header: 'Repository',
      hideable: false,
      sortValue: (r) => r.id,
      cell: (r) => (
        <Link to={repoHref(projectId, r)} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {r.id}
        </Link>
      ),
    },
    { id: 'format', header: 'Format', width: '7rem', sortValue: (r) => r.format, cell: (r) => r.format },
    { id: 'mode', header: 'Mode', width: '8rem', cell: (r) => r.mode.replace('_REPOSITORY', '').toLowerCase() },
    { id: 'location', header: 'Location', width: '10rem', sortValue: (r) => r.location, cell: (r) => <Mono value={r.location} /> },
    {
      id: 'size',
      header: 'Size',
      width: '7rem',
      align: 'right',
      sortValue: (r) => Number(r.sizeBytes ?? 0),
      cell: (r) => <span className="tnum">{bytes(r.sizeBytes)}</span>,
    },
    {
      id: 'cleanup',
      header: 'Cleanup',
      width: '9rem',
      cell: (r) =>
        Object.keys(r.cleanupPolicies).length ? (
          `${Object.keys(r.cleanupPolicies).length} policies${r.cleanupPolicyDryRun ? ', dry run' : ''}`
        ) : (
          <span className="text-ink-3">None</span>
        ),
    },
    {
      id: 'updated',
      header: 'Updated',
      width: '9rem',
      sortValue: (r) => r.updateTime ?? '',
      cell: (r) => <Timestamp iso={r.updateTime} />,
    },
  ];
  return (
    <div className="pb-16">
      <TitleBlock title="Artifact Registry" subtitle="Repositories of container images and packages, in every location." />
      <Notes notes={partialNote(q.data?.unreachable)} />
      <div className="pt-3">
        {q.isPending ? (
          <DelayedSkeleton />
        ) : q.error instanceof ApiError ? (
          <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
        ) : (
          <ResourceTable
            tableId="registry-repositories"
            label="Repositories"
            rows={rows}
            columns={columns}
            getRowId={(r) => r.name}
            onOpen={(r) => void navigate({ to: repoHref(projectId, r) })}
            filtered={rows.length !== all.length}
            emptyTitle="No repositories"
            emptyText="A repository stores container images or language packages. Create one with gcloud artifacts repositories create."
            toolbar={
              <Input
                data-filter-input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by name"
                aria-label="Filter repositories"
                className="w-64"
              />
            }
          />
        )}
      </div>
    </div>
  );
}

function VulnerabilitySheet({
  projectId,
  image,
  onClose,
}: {
  projectId: string;
  image: RegistryDockerImageView | null;
  onClose: () => void;
}) {
  const q = useRegistryQuery<VulnerabilityReport>(
    projectId,
    ['vulns', image?.uri],
    `${base(projectId)}/vulnerabilities${qs({ uri: image?.uri })}`,
    !!image,
  );
  return (
    <Sheet open={image !== null} onOpenChange={(o) => !o && onClose()} title="Vulnerabilities" description={image?.uri}>
      {q.isPending ? (
        <DelayedSkeleton rows={4} />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} />
      ) : !q.data?.available ? (
        <EmptyState title="Vulnerability scanning is not available">
          {q.data?.reason ?? 'Turn on the Container Scanning API to scan images.'}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {Object.entries(q.data.counts).map(([sev, n]) => (
              <Chip key={sev}>
                {sev.toLowerCase()}: <span className="tnum">{n}</span>
              </Chip>
            ))}
            {Object.keys(q.data.counts).length === 0 ? <StatusGlyph kind="ok" label="No known vulnerabilities" /> : null}
          </div>
          <ul className="m-0 flex list-none flex-col p-0">
            {q.data.findings.slice(0, 300).map((f, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: findings can repeat a CVE across packages.
              <li key={i} className="grid grid-cols-[6rem_9rem_1fr] gap-2 border-b border-rule py-1 text-meta">
                <span className={f.severity === 'CRITICAL' || f.severity === 'HIGH' ? 'text-redline-ink' : 'text-ink-2'}>
                  {f.severity.toLowerCase()}
                </span>
                <span className="font-mono text-[11px]">{f.cve}</span>
                <span className="min-w-0 truncate text-ink">
                  {f.packageName ?? ''} {f.fixAvailable ? '(fix available)' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

function ImagesTab({ projectId, repo, readOnly }: { projectId: string; repo: RegistryRepositoryView; readOnly: string | null }) {
  const q = usePaged<RegistryDockerImageView>(projectId, ['images'], `${base(projectId)}/docker-images`, repo.name);
  const [vulns, setVulns] = useState<RegistryDockerImageView | null>(null);
  const [deleting, setDeleting] = useState<RegistryDockerImageView | null>(null);
  const remove = useDeleteItem(projectId);
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items), [q.data]);
  const versionName = (i: RegistryDockerImageView) => `${repo.name}/packages/${enc(i.image)}/versions/${i.digest}`;
  const columns: ResourceColumn<RegistryDockerImageView>[] = [
    { id: 'image', header: 'Image', hideable: false, sortValue: (i) => i.image, cell: (i) => <Mono value={i.image} /> },
    {
      id: 'tags',
      header: 'Tags',
      cell: (i) =>
        i.tags.length ? (
          <span className="flex flex-wrap gap-1">
            {i.tags.slice(0, 4).map((t) => (
              <Chip key={t} mono>
                {t}
              </Chip>
            ))}
          </span>
        ) : (
          <span className="text-ink-3">Untagged</span>
        ),
    },
    { id: 'digest', header: 'Digest', width: '10rem', cell: (i) => <Mono value={i.digest.slice(0, 19)} /> },
    {
      id: 'size',
      header: 'Size',
      width: '7rem',
      align: 'right',
      sortValue: (i) => Number(i.sizeBytes ?? 0),
      cell: (i) => <span className="tnum">{bytes(i.sizeBytes)}</span>,
    },
    {
      id: 'uploaded',
      header: 'Uploaded',
      width: '9rem',
      sortValue: (i) => i.uploadTime ?? '',
      cell: (i) => <Timestamp iso={i.uploadTime} />,
    },
    { id: 'built', header: 'Built', width: '9rem', defaultHidden: true, cell: (i) => <Timestamp iso={i.buildTime} /> },
    {
      id: 'actions',
      header: 'Actions',
      width: '9rem',
      hideable: false,
      cell: (i) => (
        <span className="flex gap-1">
          <Link
            to={`/p/${projectId}/run` as string}
            search={{ deployImage: i.uri }}
            className={buttonClass({ size: 'sm', variant: 'ghost' })}
            aria-label={`Deploy ${i.image} to Cloud Run`}
            title="Deploy to Cloud Run"
          >
            <RocketIcon size={16} aria-hidden />
          </Link>
          <IconButton icon={ShieldWarningIcon} label={`Vulnerabilities of ${i.image}`} size="sm" onClick={() => setVulns(i)} />
          <IconButton
            icon={TrashIcon}
            label={`Delete ${i.image}@${i.digest.slice(7, 19)}`}
            size="sm"
            disabled={!!readOnly}
            onClick={() => setDeleting(i)}
          />
        </span>
      ),
    },
  ];
  return (
    <div className="pt-3">
      {q.isPending ? (
        <DelayedSkeleton />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : (
        <ResourceTable
          tableId="registry-images"
          label="Images"
          rows={rows}
          columns={columns}
          getRowId={(i) => i.name}
          emptyTitle="No images"
          emptyText={`Push with docker push ${repo.registryUri ?? ''}/IMAGE:TAG.`}
          hasMore={q.hasNextPage}
          loadingMore={q.isFetchingNextPage}
          onLoadMore={() => void q.fetchNextPage()}
        />
      )}
      <VulnerabilitySheet projectId={projectId} image={vulns} onClose={() => setVulns(null)} />
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete image"
        consequence="The image version and its tags are deleted. Services pinned to this digest can no longer pull it."
        expected={deleting ? registryConfirmToken(versionName(deleting)) : ''}
        confirmLabel="Delete image"
        command={deleting ? `gcloud artifacts docker images delete ${deleting.uri} --delete-tags` : undefined}
        onConfirm={async (c) => {
          if (deleting) await remove(versionName(deleting), c);
        }}
      />
    </div>
  );
}

function PackageSheet({
  projectId,
  pkg,
  onClose,
  readOnly,
}: {
  projectId: string;
  pkg: RegistryPackageView | null;
  onClose: () => void;
  readOnly: string | null;
}) {
  const versions = usePaged<RegistryVersionView>(projectId, ['versions'], `${base(projectId)}/versions`, pkg?.name ?? '', !!pkg);
  const tags = useRegistryQuery<RegistryTagView[]>(
    projectId,
    ['tags', pkg?.name],
    `${base(projectId)}/tags${qs({ name: pkg?.name })}`,
    !!pkg,
  );
  const [deleting, setDeleting] = useState<{ name: string; label: string } | null>(null);
  const [tag, setTag] = useState('');
  const [version, setVersion] = useState('');
  const remove = useDeleteItem(projectId);
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  const createTag = useMutation({
    mutationFn: () => api<RegistryTagView>(`${base(projectId)}/tags`, { body: { package: pkg?.name, tag, version } }),
    onSuccess: () => {
      toast.success(`Tagged ${tag}`);
      setTag('');
      void client.invalidateQueries({ queryKey: ['artifactregistry', profileId, projectId] });
    },
    onError: (err) => toast.error('Tagging failed', { description: err instanceof ApiError ? err.problem.detail : String(err) }),
  });
  const list = (versions.data?.pages ?? []).flatMap((p) => p.items);
  useEffect(() => setVersion(list[0]?.name ?? ''), [list[0]?.name]);
  return (
    <Sheet
      open={pkg !== null}
      onOpenChange={(o) => !o && onClose()}
      title={pkg?.displayName ?? ''}
      description="Versions and tags of the package."
    >
      <div className="flex flex-col gap-4">
        <Section title="Tags" className="mt-0">
          <ul className="m-0 flex list-none flex-col p-0">
            {(tags.data ?? []).map((t) => (
              <li key={t.name} className="flex items-center justify-between gap-2 border-b border-rule px-6 py-0.5 text-dense">
                <span className="font-mono text-[12px]">{t.id}</span>
                <span className="min-w-0 truncate font-mono text-[11px] text-ink-3">{t.version.split('/').pop()}</span>
                <IconButton
                  icon={TrashIcon}
                  label={`Delete tag ${t.id}`}
                  size="sm"
                  disabled={!!readOnly}
                  onClick={() => setDeleting({ name: t.name, label: 'tag' })}
                />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2 px-6 pt-2">
            <Field label="New tag" className="w-36">
              <Input mono value={tag} onChange={(e) => setTag(e.target.value)} />
            </Field>
            <Field label="On version" className="min-w-48 flex-1">
              <Select<string>
                value={version}
                onValueChange={setVersion}
                options={list.map((v) => ({ value: v.name, label: v.id.slice(0, 40) }))}
              />
            </Field>
            <Button
              icon={PlusIcon}
              disabled={!!readOnly || !/^[A-Za-z0-9_.-]{1,128}$/.test(tag) || !version}
              disabledReason={readOnly}
              loading={createTag.isPending}
              onClick={() => createTag.mutate()}
            >
              Add tag
            </Button>
          </div>
        </Section>
        <Section title="Versions">
          <ul className="m-0 flex list-none flex-col p-0">
            {list.map((v) => (
              <li key={v.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-rule px-6 py-0.5 text-dense">
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[12px]">{v.id}</span>
                  {v.tags.length ? <span className="block truncate text-meta text-ink-3">{v.tags.join(', ')}</span> : null}
                </span>
                <Timestamp iso={v.updateTime} />
                <IconButton
                  icon={TrashIcon}
                  label={`Delete version ${v.id.slice(0, 19)}`}
                  size="sm"
                  disabled={!!readOnly}
                  onClick={() => setDeleting({ name: v.name, label: 'version' })}
                />
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.label ?? ''}`}
        consequence={
          deleting?.label === 'tag'
            ? 'The tag stops pointing at its version; the version stays.'
            : 'The version and the tags on it are deleted.'
        }
        expected={deleting ? registryConfirmToken(deleting.name) : ''}
        confirmLabel={`Delete ${deleting?.label ?? ''}`}
        onConfirm={async (c) => {
          if (deleting) await remove(deleting.name, c);
        }}
      />
    </Sheet>
  );
}

function PackagesTab({ projectId, repo, readOnly }: { projectId: string; repo: RegistryRepositoryView; readOnly: string | null }) {
  const q = usePaged<RegistryPackageView>(projectId, ['packages'], `${base(projectId)}/packages`, repo.name);
  const [open, setOpen] = useState<RegistryPackageView | null>(null);
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items), [q.data]);
  const columns: ResourceColumn<RegistryPackageView>[] = [
    { id: 'name', header: 'Package', hideable: false, sortValue: (p) => p.displayName, cell: (p) => <Mono value={p.displayName} /> },
    {
      id: 'created',
      header: 'Created',
      width: '9rem',
      sortValue: (p) => p.createTime ?? '',
      cell: (p) => <Timestamp iso={p.createTime} />,
    },
    {
      id: 'updated',
      header: 'Updated',
      width: '9rem',
      sortValue: (p) => p.updateTime ?? '',
      cell: (p) => <Timestamp iso={p.updateTime} />,
    },
  ];
  return (
    <div className="pt-3">
      {q.isPending ? (
        <DelayedSkeleton />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : (
        <ResourceTable
          tableId="registry-packages"
          label="Packages"
          rows={rows}
          columns={columns}
          getRowId={(p) => p.name}
          onOpen={setOpen}
          emptyTitle="No packages"
          hasMore={q.hasNextPage}
          loadingMore={q.isFetchingNextPage}
          onLoadMore={() => void q.fetchNextPage()}
        />
      )}
      <PackageSheet projectId={projectId} pkg={open} onClose={() => setOpen(null)} readOnly={readOnly} />
    </div>
  );
}

function CleanupTab({ projectId, repo, readOnly }: { projectId: string; repo: RegistryRepositoryView; readOnly: string | null }) {
  const original = JSON.stringify(repo.cleanupPolicies, null, 2);
  const [text, setText] = useState(original);
  const [dryRun, setDryRun] = useState(repo.cleanupPolicyDryRun);
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  useEffect(() => {
    setText(JSON.stringify(repo.cleanupPolicies, null, 2));
    setDryRun(repo.cleanupPolicyDryRun);
  }, [repo]);
  const save = useMutation({
    mutationFn: () =>
      api<RegistryRepositoryView>(`${base(projectId)}/repository/cleanup${qs({ name: repo.name })}`, {
        method: 'PUT',
        body: { policiesJson: text, dryRun },
      }),
    onSuccess: () => {
      toast.success('Cleanup policies saved');
      void client.invalidateQueries({ queryKey: ['artifactregistry', profileId, projectId] });
    },
    onError: (err) => toast.error('Saving failed', { description: err instanceof ApiError ? err.problem.detail : String(err) }),
  });
  let error: string | null = null;
  try {
    JSON.parse(text || '{}');
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <Section
      title="Cleanup policies"
      description="A map of policies by id; each keeps or deletes versions by tag state, age and count. Dry run only logs what would be deleted."
    >
      <div className="flex flex-col gap-3 px-6">
        <CodeEditor value={text} onChange={setText} language="json" height={320} label="Cleanup policies JSON" />
        <Switch
          checked={dryRun}
          onCheckedChange={setDryRun}
          label="Dry run"
          description="Log what the policies would delete, without deleting."
        />
        <div className="flex items-center gap-2">
          <Button
            disabled={!!readOnly || !!error || (text === original && dryRun === repo.cleanupPolicyDryRun)}
            disabledReason={readOnly ?? error ?? 'No changes'}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Save cleanup policies
          </Button>
          {error ? <span className="text-meta text-redline-ink">{error}</span> : null}
        </div>
      </div>
    </Section>
  );
}

/** One repository: images or packages, cleanup policies, permissions (SPEC-0007 D-11). */
export function RepositoryPage() {
  const { projectId, location, repo: id } = useParams({ strict: false }) as { projectId: string; location: string; repo: string };
  const name = `projects/${projectId}/locations/${location}/repositories/${id}`;
  const q = useRegistryQuery<RegistryRepositoryView>(projectId, ['repository', name], `${base(projectId)}/repository${qs({ name })}`);
  const readOnly = useReadOnly();
  if (q.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (q.error instanceof ApiError || !q.data)
    return q.error instanceof ApiError ? <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} /> : null;
  const r = q.data;
  const docker = r.format === 'DOCKER';
  return (
    <DetailLayout<'images' | 'packages' | 'cleanup' | 'permissions'>
      crumbs={[{ label: 'Artifact Registry', to: `/p/${projectId}/artifactregistry` }, { label: r.id }]}
      title={r.id}
      subtitle={r.description ?? undefined}
      cells={[
        { label: 'Format', value: r.format },
        { label: 'Location', value: r.location, mono: true },
        { label: 'Size', value: bytes(r.sizeBytes) },
        { label: 'Address', value: r.registryUri ? <Mono value={r.registryUri} copy /> : 'None', wide: true },
      ]}
      tabs={[
        ...(docker ? [{ key: 'images' as const, label: 'Images' }] : []),
        { key: 'packages', label: 'Packages' },
        { key: 'cleanup', label: 'Cleanup policies' },
        { key: 'permissions', label: 'Permissions' },
      ]}
      defaultTab={docker ? 'images' : 'packages'}
    >
      {(tab) =>
        tab === 'images' ? (
          <ImagesTab projectId={projectId} repo={r} readOnly={readOnly} />
        ) : tab === 'cleanup' ? (
          <CleanupTab projectId={projectId} repo={r} readOnly={readOnly} />
        ) : tab === 'permissions' ? (
          <ResourcePermissions
            projectId={projectId}
            kind="ar-repo"
            name={r.name}
            readOnly={readOnly}
            gcloudTarget={`artifacts repositories ${r.id} --location=${r.location}`}
            suggested={['roles/artifactregistry.reader', 'roles/artifactregistry.writer']}
          />
        ) : (
          <PackagesTab projectId={projectId} repo={r} readOnly={readOnly} />
        )
      }
    </DetailLayout>
  );
}
