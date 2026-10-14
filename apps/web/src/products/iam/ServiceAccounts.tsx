import type { NewKeyView, ServiceAccountKeyView, ServiceAccountView } from '@nephoscope/contracts';
import { DownloadSimpleIcon, KeyIcon, PlusIcon, TrashIcon, UploadSimpleIcon, UserPlusIcon } from '@phosphor-icons/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Notes, Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Switch, Textarea } from '../../design/Form';
import { Dialog, MenuItem, Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { FactList } from '../../kit/FactList';
import { ApiError, downloadFromApi } from '../../lib/api';
import { queryClient, useActiveProfile, useInstance } from '../../state/queries';
import { readOnlyReason } from '../run/common';
import {
  addKeyAsProfile,
  deleteKey,
  deleteServiceAccount,
  newKeyDownloadPath,
  useCreateKey,
  useCreateServiceAccount,
  useKeys,
  useServiceAccount,
  useServiceAccountPolicy,
  useServiceAccounts,
  useSetKeyEnabled,
  useSetServiceAccountEnabled,
  useSetServiceAccountPolicy,
  useUndeleteServiceAccount,
  useUpdateServiceAccount,
  useUploadKey,
} from './api';
import { PolicyEditor } from './PolicyEditor';

const saHref = (projectId: string, email: string) => `/p/${projectId}/iam/serviceaccounts/${email}`;

function AccountState({ a }: { a: ServiceAccountView }) {
  return a.disabled ? <StatusGlyph kind="paused" label="Disabled" /> : <StatusGlyph kind="ok" label="Enabled" />;
}

function CreateSheet({
  projectId,
  open,
  onOpenChange,
  readOnly,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnly: string | null;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useCreateServiceAccount(projectId);
  const navigate = useNavigate();
  useEffect(() => {
    if (open) {
      setId('');
      setName('');
      setDescription('');
    }
  }, [open]);
  const idOk = /^[a-z]([-a-z0-9]*[a-z0-9])$/.test(id) && id.length >= 6 && id.length <= 30;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create service account"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PlusIcon}
            loading={create.isPending}
            disabled={!!readOnly || !idOk}
            disabledReason={readOnly ?? 'An id of 6 to 30 lowercase letters, digits and hyphens'}
            onClick={() =>
              create.mutate(
                { accountId: id, displayName: name || undefined, description: description || undefined },
                { onSuccess: (a) => void navigate({ to: saHref(projectId, a.email) }) },
              )
            }
          >
            Create service account
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Account id" required help={`The email becomes ${id || 'ID'}@${projectId}.iam.gserviceaccount.com.`}>
          <Input mono value={id} onChange={(e) => setId(e.target.value.toLowerCase())} autoFocus />
        </Field>
        <Field label="Display name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </Field>
        <EquivalentCommand
          gcloud={`gcloud iam service-accounts create ${id || 'ID'}${name ? ` --display-name="${name}"` : ''} --project=${projectId}`}
        />
      </div>
    </Sheet>
  );
}

/** Service accounts of the project (SPEC-0007 D-02). */
export function ServiceAccounts({ projectId, readOnly }: { projectId: string; readOnly: string | null }) {
  const q = useServiceAccounts(projectId);
  const navigate = useNavigate();
  const undelete = useUndeleteServiceAccount(projectId);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [uniqueId, setUniqueId] = useState('');
  const [filter, setFilter] = useState('');
  const rows = (q.data ?? []).filter(
    (a) => !filter.trim() || `${a.email} ${a.displayName ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const columns: ResourceColumn<ServiceAccountView>[] = [
    {
      id: 'email',
      header: 'Email',
      hideable: false,
      sortValue: (a) => a.email,
      cell: (a) => (
        <Link to={saHref(projectId, a.email)} className="truncate font-mono text-[12px] text-ink" onClick={(e) => e.stopPropagation()}>
          {a.email}
        </Link>
      ),
    },
    {
      id: 'name',
      header: 'Display name',
      sortValue: (a) => a.displayName ?? '',
      cell: (a) => a.displayName ?? <span className="text-ink-3">None</span>,
    },
    { id: 'state', header: 'State', width: '8rem', sortValue: (a) => (a.disabled ? 0 : 1), cell: (a) => <AccountState a={a} /> },
    {
      id: 'keys',
      header: 'User keys',
      width: '7rem',
      align: 'right',
      sortValue: (a) => a.keyCount ?? -1,
      cell: (a) => <span className="tnum">{a.keyCount ?? ''}</span>,
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
          tableId="iam-service-accounts"
          label="Service accounts"
          rows={rows}
          columns={columns}
          getRowId={(a) => a.email}
          onOpen={(a) => void navigate({ to: saHref(projectId, a.email) })}
          filtered={rows.length !== (q.data?.length ?? 0)}
          emptyTitle="No service accounts"
          emptyText="A service account is an identity for workloads and keys, such as the ones Nephoscope profiles use."
          toolbar={
            <div className="flex flex-wrap items-end gap-3">
              <Input
                data-filter-input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by email or name"
                aria-label="Filter service accounts"
                className="w-72"
              />
              <span className="ml-auto flex gap-2">
                <Button disabled={!!readOnly} disabledReason={readOnly} onClick={() => setRestoring(true)}>
                  Restore deleted account
                </Button>
                <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setCreating(true)}>
                  Create service account
                </Button>
              </span>
            </div>
          }
        />
      )}
      <CreateSheet projectId={projectId} open={creating} onOpenChange={setCreating} readOnly={readOnly} />
      <Dialog
        open={restoring}
        onOpenChange={setRestoring}
        title="Restore deleted service account"
        width="sm"
        footer={
          <>
            <Button onClick={() => setRestoring(false)}>Cancel</Button>
            <Button
              variant="commit"
              loading={undelete.isPending}
              disabled={!/^[0-9]{10,30}$/.test(uniqueId)}
              onClick={() => undelete.mutate(uniqueId, { onSuccess: () => setRestoring(false) })}
            >
              Restore service account
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="m-0 text-dense text-ink-2">
            A deleted service account can be restored for 30 days. Deleted accounts are not listed: find the numeric unique id in the audit
            log of the deletion.
          </p>
          <Field label="Unique id">
            <Input mono value={uniqueId} onChange={(e) => setUniqueId(e.target.value.trim())} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

function NewKeyDialog({ created, onOpenChange }: { created: NewKeyView | null; onOpenChange: (o: boolean) => void }) {
  const [downloaded, setDownloaded] = useState(false);
  const [added, setAdded] = useState(false);
  const [name, setName] = useState('');
  const [readOnly, setReadOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (created) {
      setDownloaded(false);
      setAdded(false);
      setName('');
      setReadOnly(true);
    }
  }, [created]);
  return (
    <Dialog
      open={created !== null}
      onOpenChange={onOpenChange}
      title="New key created"
      width="md"
      footer={<Button onClick={() => onOpenChange(false)}>Close</Button>}
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <Notes
            title="Key safety"
            notes={[
              {
                id: 'once',
                tone: 'warn',
                text: `Nephoscope holds the private key until ${new Date(created.expiresAt).toLocaleTimeString()}, then forgets it. It can be downloaded once.`,
              },
              {
                id: 'safe',
                tone: 'info',
                text: "A key file grants this account's access to whoever has it. Store it like a password and delete it when it is no longer needed.",
              },
            ]}
          />
          <FactList facts={[['Key id', <Mono key="k" value={created.key.id} copy />]]} />
          <div className="flex flex-col gap-3 rounded-control border border-rule p-3">
            <span className="text-dense font-medium text-ink">Add as a Nephoscope profile</span>
            <p className="m-0 text-meta text-ink-2">The key is stored encrypted with the other profiles and never reaches this browser.</p>
            <Field label="Profile name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to the account name" />
            </Field>
            <Switch
              checked={readOnly}
              onCheckedChange={setReadOnly}
              label="Read-only profile"
              description="Recommended until you need to change things with this key."
            />
            <div>
              <Button
                variant="commit"
                icon={UserPlusIcon}
                loading={busy}
                disabled={added}
                disabledReason="Already added"
                onClick={async () => {
                  setBusy(true);
                  try {
                    const profile = await addKeyAsProfile(created.handle, { name: name.trim() || undefined, readOnly });
                    setAdded(true);
                    void queryClient.invalidateQueries({ queryKey: ['profiles'] });
                    toast.success(`Added profile ${profile.name}`);
                  } catch (err) {
                    toast.error('Adding the profile failed', { description: err instanceof ApiError ? err.problem.detail : String(err) });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {added ? 'Added as a profile' : 'Add as a Nephoscope profile'}
              </Button>
            </div>
          </div>
          <div>
            <Button
              icon={DownloadSimpleIcon}
              disabled={downloaded}
              disabledReason="A key can be downloaded once"
              onClick={() => {
                setDownloaded(true);
                void downloadFromApi(newKeyDownloadPath(created.handle), `${created.key.id.slice(0, 12)}.json`).catch((err: Error) =>
                  toast.error('Download failed', { description: err.message }),
                );
              }}
            >
              {downloaded ? 'Downloaded' : 'Download key file once'}
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function KeysTab({ projectId, email, readOnly }: { projectId: string; email: string; readOnly: string | null }) {
  const keys = useKeys(projectId, email);
  const create = useCreateKey(projectId, email);
  const upload = useUploadKey(projectId, email);
  const setEnabled = useSetKeyEnabled(projectId, email);
  const [created, setCreated] = useState<NewKeyView | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pem, setPem] = useState('');
  const [deleting, setDeleting] = useState<ServiceAccountKeyView | null>(null);
  const columns: ResourceColumn<ServiceAccountKeyView>[] = [
    { id: 'id', header: 'Key id', hideable: false, sortValue: (k) => k.id, cell: (k) => <Mono value={k.id} /> },
    {
      id: 'type',
      header: 'Type',
      width: '9rem',
      sortValue: (k) => k.keyType,
      cell: (k) => (k.keyType === 'USER_MANAGED' ? 'User managed' : 'Google managed'),
    },
    {
      id: 'state',
      header: 'State',
      width: '8rem',
      cell: (k) => (k.disabled ? <StatusGlyph kind="paused" label="Disabled" /> : <StatusGlyph kind="ok" label="Enabled" />),
    },
    {
      id: 'created',
      header: 'Created',
      width: '9rem',
      sortValue: (k) => k.validAfter ?? '',
      cell: (k) => <Timestamp iso={k.validAfter} />,
    },
    {
      id: 'expires',
      header: 'Expires',
      width: '9rem',
      sortValue: (k) => k.validBefore ?? '',
      cell: (k) => (k.validBefore?.startsWith('9999') ? 'Never' : <Timestamp iso={k.validBefore} />),
    },
    { id: 'origin', header: 'Origin', width: '8rem', defaultHidden: true, cell: (k) => k.origin ?? '' },
    {
      id: 'actions',
      header: 'Actions',
      width: '10rem',
      hideable: false,
      cell: (k) =>
        k.keyType !== 'USER_MANAGED' ? null : (
          <span className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={!!readOnly}
              disabledReason={readOnly}
              onClick={() => setEnabled.mutate({ key: k.id, enabled: k.disabled })}
            >
              {k.disabled ? 'Enable' : 'Disable'}
            </Button>
            <IconButton
              icon={TrashIcon}
              label={`Delete key ${k.id.slice(0, 12)}`}
              size="sm"
              disabled={!!readOnly}
              onClick={() => setDeleting(k)}
            />
          </span>
        ),
    },
  ];
  return (
    <div className="pt-3">
      {keys.isPending ? (
        <DelayedSkeleton />
      ) : keys.error instanceof ApiError ? (
        <ProblemState problem={keys.error.problem} onRetry={() => void keys.refetch()} />
      ) : (
        <ResourceTable
          tableId="iam-keys"
          label="Keys"
          rows={keys.data ?? []}
          columns={columns}
          getRowId={(k) => k.id}
          emptyTitle="No keys"
          emptyText="Workloads on Google Cloud need no key. Create one only for use outside it, such as a Nephoscope profile."
          toolbar={
            <div className="flex justify-end gap-2">
              <Button icon={UploadSimpleIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setUploading(true)}>
                Upload public key
              </Button>
              <Button
                variant="commit"
                icon={KeyIcon}
                loading={create.isPending}
                disabled={!!readOnly}
                disabledReason={readOnly}
                onClick={() => create.mutate(undefined, { onSuccess: (k) => setCreated(k) })}
              >
                Create JSON key
              </Button>
            </div>
          }
        />
      )}
      <NewKeyDialog created={created} onOpenChange={(o) => !o && setCreated(null)} />
      <Dialog
        open={uploading}
        onOpenChange={setUploading}
        title="Upload a public key"
        footer={
          <>
            <Button onClick={() => setUploading(false)}>Cancel</Button>
            <Button
              variant="commit"
              loading={upload.isPending}
              disabled={!pem.includes('BEGIN CERTIFICATE')}
              onClick={() => upload.mutate(pem, { onSuccess: () => setUploading(false) })}
            >
              Upload public key
            </Button>
          </>
        }
      >
        <Field label="X.509 certificate (PEM)" help="The private key stays with you; Google stores only the certificate.">
          <Textarea mono rows={8} value={pem} onChange={(e) => setPem(e.target.value)} />
        </Field>
      </Dialog>
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete key"
        consequence="Anything using this key stops authenticating at once, including Nephoscope profiles made from it."
        expected={deleting?.id.slice(0, 12) ?? ''}
        confirmLabel="Delete key"
        command={deleting ? `gcloud iam service-accounts keys delete ${deleting.id} --iam-account=${email}` : undefined}
        onConfirm={async (c) => {
          if (deleting) await deleteKey(projectId, email, deleting.id, c);
          void keys.refetch();
        }}
      />
    </div>
  );
}

function PermissionsTab({ projectId, email, readOnly }: { projectId: string; email: string; readOnly: string | null }) {
  const policy = useServiceAccountPolicy(projectId, email, true);
  const save = useSetServiceAccountPolicy(projectId, email);
  if (policy.isPending) return <DelayedSkeleton />;
  if (policy.error instanceof ApiError) return <ProblemState problem={policy.error.problem} onRetry={() => void policy.refetch()} />;
  if (!policy.data) return null;
  return (
    <>
      <p className="m-0 px-6 pt-3 text-dense text-ink-2">
        Who can act as this account: Service Account User lets a principal deploy workloads that run as it; Token Creator lets it mint
        tokens as it.
      </p>
      <PolicyEditor
        projectId={projectId}
        policy={policy.data}
        self={null}
        readOnly={readOnly}
        save={(body) => save.mutateAsync(body)}
        onReload={() => void policy.refetch()}
        suggested={['roles/iam.serviceAccountUser', 'roles/iam.serviceAccountTokenCreator']}
        gcloudTarget={`iam service-accounts ${email}`}
      />
    </>
  );
}

/** One service account: details, keys and who can act as it (SPEC-0007 D-02, CA-02). */
export function ServiceAccountPage() {
  const { projectId, email } = useParams({ strict: false }) as { projectId: string; email: string };
  const q = useServiceAccount(projectId, email);
  const update = useUpdateServiceAccount(projectId, email);
  const setEnabled = useSetServiceAccountEnabled(projectId, email);
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const instance = useInstance();
  const { profile } = useActiveProfile();
  const readOnly = readOnlyReason(instance.data?.readOnly, profile?.readOnly);
  useEffect(() => {
    setName(q.data?.displayName ?? '');
    setDescription(q.data?.description ?? '');
  }, [q.data]);
  if (q.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (q.error instanceof ApiError || !q.data)
    return q.error instanceof ApiError ? <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} /> : null;
  const a = q.data;
  const changed = name !== (a.displayName ?? '') || description !== (a.description ?? '');
  return (
    <>
      <DetailLayout<'overview' | 'keys' | 'permissions'>
        crumbs={[{ label: 'IAM', to: `/p/${projectId}/iam?tab=serviceaccounts` }, { label: a.email }]}
        title={a.displayName || a.email.split('@')[0] || a.email}
        status={<AccountState a={a} />}
        subtitle={<Mono value={a.email} copy />}
        actions={
          <Button
            disabled={!!readOnly}
            disabledReason={readOnly}
            loading={setEnabled.isPending}
            onClick={() => setEnabled.mutate(a.disabled)}
          >
            {a.disabled ? 'Enable account' : 'Disable account'}
          </Button>
        }
        menu={
          <MenuItem onClick={() => setDeleting(true)} disabled={!!readOnly} className="text-redline-ink">
            Delete service account
          </MenuItem>
        }
        cells={[
          { label: 'Unique id', value: <Mono value={a.uniqueId} />, mono: true },
          { label: 'Project', value: projectId, mono: true },
        ]}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'keys', label: 'Keys' },
          { key: 'permissions', label: 'Who can act as it' },
        ]}
        defaultTab="overview"
      >
        {(tab) =>
          tab === 'keys' ? (
            <KeysTab projectId={projectId} email={email} readOnly={readOnly} />
          ) : tab === 'permissions' ? (
            <PermissionsTab projectId={projectId} email={email} readOnly={readOnly} />
          ) : (
            <Section title="Details">
              <div className="flex max-w-xl flex-col gap-4 px-6">
                <Field label="Display name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Description">
                  <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
                </Field>
                <div>
                  <Button
                    disabled={!!readOnly || !changed}
                    disabledReason={readOnly ?? 'No changes'}
                    loading={update.isPending}
                    onClick={() => update.mutate({ displayName: name, description })}
                  >
                    Save details
                  </Button>
                </div>
              </div>
            </Section>
          )
        }
      </DetailLayout>
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete service account"
        consequence="Workloads and keys using this account stop working. It can be restored for 30 days with its unique id, after which it is gone."
        expected={a.email}
        confirmLabel="Delete service account"
        command={`gcloud iam service-accounts delete ${a.email} --project=${projectId}`}
        onConfirm={async (c) => {
          await deleteServiceAccount(projectId, a.email, c);
          void navigate({ to: `/p/${projectId}/iam` as string, search: { tab: 'serviceaccounts' } });
        }}
      />
    </>
  );
}
