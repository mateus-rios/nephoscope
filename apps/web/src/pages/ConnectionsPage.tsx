import type { ColorTag, Profile, ProfileCheck } from '@nephoscope/contracts';
import { colorTags, MAX_KEY_BYTES } from '@nephoscope/contracts/constants';
import { DotsThreeIcon, KeyIcon, PlusIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../design/Button';
import { ConfirmDestructive } from '../design/ConfirmDestructive';
import { Legend, type Note, Notes, TitleBlock } from '../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../design/Feedback';
import { Field, Input, Switch, Textarea } from '../design/Form';
import { Dialog, Menu, MenuItem, MenuSeparator, Sheet } from '../design/Overlays';
import { ProfileMark } from '../design/ProfileMark';
import { type ResourceColumn, ResourceTable } from '../design/ResourceTable';
import { Stamp, StatusGlyph } from '../design/Status';
import { Mono, Timestamp } from '../design/Values';
import { ApiError } from '../lib/api';
import { cn } from '../lib/cn';
import {
  useAddProfile,
  useDeleteProfile,
  useInstance,
  useProfiles,
  useResetProfiles,
  useTestProfile,
  useUpdateProfile,
} from '../state/queries';
import { useSession } from '../state/session';

const tagSwatch: Record<ColorTag, string> = {
  none: 'bg-tag-none',
  gray: 'bg-tag-gray',
  blue: 'bg-tag-blue',
  green: 'bg-tag-green',
  amber: 'bg-tag-amber',
  red: 'bg-tag-red',
  violet: 'bg-tag-violet',
};

const typeLabel: Record<Profile['type'], string> = {
  service_account: 'Service account key',
  authorized_user: 'gcloud user credentials',
  external_account: 'Workload identity',
  impersonated_service_account: 'Impersonation',
  emulator_only: 'Emulators only',
  metadata_server: 'Metadata server',
};

function ColorTagPicker({ value, onChange }: { value: ColorTag; onChange: (t: ColorTag) => void }) {
  return (
    <div role="radiogroup" aria-label="Color tag" className="flex flex-wrap gap-1.5">
      {colorTags.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          onClick={() => onChange(t)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-pill border px-2 text-meta',
            value === t ? 'border-ink text-ink' : 'border-rule-strong text-ink-2 hover:border-ink-3',
          )}
        >
          <span className={cn('size-2.5 rounded-pill', tagSwatch[t])} aria-hidden />
          {t === 'none' ? 'No color' : t.charAt(0).toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  );
}

const STEP_LABEL: Record<ProfileCheck['steps'][number]['step'], string> = {
  parse: 'The key is JSON',
  type: 'Its credential type is supported',
  token: 'Google issues an access token',
  projects: 'It can see at least one project',
};

function CheckSteps({ check }: { check: ProfileCheck }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
      {check.steps.map((s) => (
        <li key={s.step} className="flex items-start gap-2 text-dense">
          <StatusGlyph kind={s.ok ? 'ok' : s.step === 'projects' ? 'warn' : 'error'} label={s.ok ? 'Passed' : 'Failed'} compact />
          <span className="flex flex-col">
            <span className="text-ink">{STEP_LABEL[s.step]}</span>
            {s.message ? <span className="text-meta text-ink-2">{s.message}</span> : null}
          </span>
        </li>
      ))}
      {check.visibleProjects !== null ? (
        <li className="pl-6 text-meta text-ink-3">
          {check.visibleProjects >= 50 ? '50 or more projects visible' : `${check.visibleProjects} projects visible`}
        </li>
      ) : null}
    </ol>
  );
}

/** Adds a key: drop or paste, then the server checks it step by step (SPEC-0001 CA-03). */
function AddProfileSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const add = useAddProfile();
  const setProfile = useSession((s) => s.setProfile);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [colorTag, setColorTag] = useState<ColorTag>('none');
  const [readOnly, setReadOnly] = useState(false);
  const [defaultProject, setDefaultProject] = useState('');
  const [quotaProject, setQuotaProject] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resets the form only when the sheet opens.
  useEffect(() => {
    if (open) {
      setKey('');
      setName('');
      setColorTag('none');
      setReadOnly(false);
      setDefaultProject('');
      setQuotaProject('');
      setFileError(null);
      add.reset();
    }
  }, [open]);

  let preview: { type: string; principal: string } | null = null;
  try {
    const parsed = key.trim() ? (JSON.parse(key) as Record<string, unknown>) : null;
    if (parsed && typeof parsed.type === 'string') {
      preview = { type: parsed.type, principal: String(parsed.client_email ?? parsed.account ?? '') };
    }
  } catch {
    preview = null;
  }

  const readFile = async (file: File) => {
    setFileError(null);
    if (file.size > MAX_KEY_BYTES) {
      setFileError('This file is larger than 64 KB, which is too large for a key.');
      return;
    }
    setKey(await file.text());
  };

  const problem = add.error instanceof ApiError ? add.error.problem : null;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add a key"
      description="The key is stored encrypted on this machine and never sent back to the browser."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PlusIcon}
            disabled={!key.trim()}
            loading={add.isPending}
            onClick={() =>
              add.mutate(
                {
                  key,
                  name: name.trim() || undefined,
                  colorTag,
                  readOnly,
                  defaultProject: defaultProject.trim() || undefined,
                  quotaProjectId: quotaProject.trim() || undefined,
                },
                {
                  onSuccess: (result) => {
                    toast.success(`Profile ${result.profile.name} added`, {
                      action: { label: 'Act as it', onClick: () => setProfile(result.profile.id) },
                    });
                    onOpenChange(false);
                  },
                },
              )
            }
          >
            Add profile
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping a file is a shortcut; the "Choose a file" button and the paste field are the keyboard path. */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) void readFile(file);
          }}
          className={cn(
            'flex flex-col items-start gap-2 rounded-control border border-dashed px-4 py-4',
            dragging ? 'border-ink bg-construct-tint' : 'border-rule-strong',
          )}
        >
          <span className="flex items-center gap-2 text-dense text-ink">
            <KeyIcon size={16} className="text-ink-3" aria-hidden />
            Drop a JSON key here, or paste it below.
          </span>
          <Button size="sm" icon={UploadSimpleIcon} onClick={() => fileInput.current?.click()}>
            Choose a file
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
              e.target.value = '';
            }}
          />
          {fileError ? <p className="m-0 text-meta text-redline-ink">{fileError}</p> : null}
        </div>
        <Field
          label="Key JSON"
          error={problem?.errors?.find((x) => x.path === 'key')?.message ?? (problem && !problem.errors ? problem.detail : null)}
          help={
            preview
              ? `${preview.type}${preview.principal ? ` · ${preview.principal}` : ''}`
              : 'Service account key, gcloud credentials, or a workload identity configuration.'
          }
        >
          <Textarea value={key} onChange={(e) => setKey(e.target.value)} mono rows={6} spellCheck={false} autoComplete="off" />
        </Field>
        {add.data ? <CheckSteps check={add.data.check} /> : null}
        <Field label="Name" help="Defaults to the part of the principal before @.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-dense font-medium text-ink">Color tag</span>
          <ColorTagPicker value={colorTag} onChange={setColorTag} />
          <span className="text-meta text-ink-3">Drawn as the ribbon under the title strip, so production stands out.</span>
        </div>
        <Switch
          checked={readOnly}
          onCheckedChange={setReadOnly}
          label="Read-only"
          description="Nephoscope refuses every change to Google Cloud while acting with this profile."
        />
        <Field label="Default project" help="Opened when you pick this profile. Defaults to the key's own project.">
          <Input value={defaultProject} onChange={(e) => setDefaultProject(e.target.value)} mono placeholder="my-project-123" />
        </Field>
        <Field label="Quota project" help="Some APIs bill and check quota in this project. Leave empty to use Google's default.">
          <Input value={quotaProject} onChange={(e) => setQuotaProject(e.target.value)} mono />
        </Field>
      </div>
    </Sheet>
  );
}

function EditProfileSheet({ profile, onOpenChange }: { profile: Profile | null; onOpenChange: (o: boolean) => void }) {
  const update = useUpdateProfile();
  const [name, setName] = useState('');
  const [colorTag, setColorTag] = useState<ColorTag>('none');
  const [readOnly, setReadOnly] = useState(false);
  const [defaultProject, setDefaultProject] = useState('');
  const [quotaProject, setQuotaProject] = useState('');
  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setColorTag(profile.colorTag);
      setReadOnly(profile.readOnly);
      setDefaultProject(profile.defaultProject ?? '');
      setQuotaProject(profile.quotaProjectId ?? '');
    }
  }, [profile]);
  const problem = update.error instanceof ApiError ? update.error.problem : null;
  return (
    <Sheet
      open={profile !== null}
      onOpenChange={onOpenChange}
      title={`Edit ${profile?.name ?? ''}`}
      description={
        profile?.source === 'environment'
          ? 'The key itself comes from GOOGLE_APPLICATION_CREDENTIALS and cannot be changed here.'
          : undefined
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={update.isPending}
            onClick={() =>
              profile &&
              update.mutate(
                {
                  id: profile.id,
                  patch: {
                    name: name.trim() || profile.name,
                    colorTag,
                    readOnly,
                    defaultProject: defaultProject.trim() || null,
                    quotaProjectId: quotaProject.trim() || null,
                  },
                },
                {
                  onSuccess: () => {
                    toast.success('Profile saved');
                    onOpenChange(false);
                  },
                },
              )
            }
          >
            Save profile
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {problem ? <p className="m-0 text-dense text-redline-ink">{problem.detail}</p> : null}
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-dense font-medium text-ink">Color tag</span>
          <ColorTagPicker value={colorTag} onChange={setColorTag} />
        </div>
        <Switch
          checked={readOnly}
          onCheckedChange={setReadOnly}
          label="Read-only"
          description="Refuse every change to Google Cloud while acting with this profile."
        />
        <Field label="Default project">
          <Input value={defaultProject} onChange={(e) => setDefaultProject(e.target.value)} mono />
        </Field>
        <Field label="Quota project" help="Changing it reconnects this profile's clients.">
          <Input value={quotaProject} onChange={(e) => setQuotaProject(e.target.value)} mono />
        </Field>
      </div>
    </Sheet>
  );
}

/** Connections: the keys Nephoscope can act with (SPEC-0001 §8.1, CA-11). */
export function ConnectionsPage() {
  const profiles = useProfiles();
  const instance = useInstance();
  const activeId = useSession((s) => s.profileId);
  const setProfile = useSession((s) => s.setProfile);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [resetting, setResetting] = useState(false);
  const [testing, setTesting] = useState<Profile | null>(null);
  const test = useTestProfile();
  const del = useDeleteProfile();
  const reset = useResetProfiles();

  useEffect(() => {
    document.title = 'Connections · Nephoscope';
  }, []);

  const notes: Note[] = [];
  const credentials = instance.data?.credentials;
  if (credentials?.environmentMissing && credentials.environmentFileSet) {
    notes.push({
      id: 'env-failed',
      tone: 'error',
      text: `The key in GOOGLE_APPLICATION_CREDENTIALS could not be loaded: ${credentials.environmentError ?? 'unknown reason'}. Fix the file or its permissions and restart Nephoscope.`,
    });
  } else if (credentials?.environmentMissing) {
    notes.push({
      id: 'env-missing',
      tone: 'info',
      text: 'GOOGLE_APPLICATION_CREDENTIALS is not set and no gcloud application default credentials were found. Add a key here, or restart Nephoscope with the variable pointing at one.',
    });
  }
  if (instance.data?.dataDir.profilesUnreadable) {
    notes.push({
      id: 'unreadable',
      tone: 'error',
      text: 'Saved profiles exist but cannot be decrypted, usually because NEPHOSCOPE_SECRET changed. Restore the old secret, or reset them.',
      action: (
        <Button size="sm" variant="ghost" onClick={() => setResetting(true)}>
          Reset saved profiles
        </Button>
      ),
    });
  }
  if (instance.data && !instance.data.dataDir.writable) {
    notes.push({ id: 'readonly-dir', tone: 'warn', text: 'The data directory is not writable, so new keys cannot be saved.' });
  }

  const columns: ResourceColumn<Profile>[] = [
    {
      id: 'name',
      header: 'Profile',
      hideable: false,
      sortValue: (p) => p.name,
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-2">
          <ProfileMark seed={p.keyId ?? p.principal ?? p.id} principal={p.principal} name={p.name} colorTag={p.colorTag} />
          <span className={cn('truncate', p.id === activeId ? 'font-semibold text-ink' : 'text-ink')}>{p.name}</span>
          {p.source === 'environment' ? <Stamp>Environment</Stamp> : null}
          {p.readOnly ? <Stamp tone="redline">Read-only</Stamp> : null}
        </span>
      ),
    },
    {
      id: 'principal',
      header: 'Principal',
      sortValue: (p) => p.principal ?? '',
      cell: (p) => (p.principal ? <Mono value={p.principal} copy /> : <span className="text-ink-3">Unknown</span>),
    },
    {
      id: 'type',
      header: 'Type',
      width: '12rem',
      sortValue: (p) => p.type,
      cell: (p) => <span className="text-ink-2">{typeLabel[p.type]}</span>,
    },
    { id: 'keyId', header: 'Key id', width: '10rem', defaultHidden: true, cell: (p) => (p.keyId ? <Mono value={p.keyId} /> : null) },
    {
      id: 'defaultProject',
      header: 'Default project',
      width: '11rem',
      sortValue: (p) => p.defaultProject ?? '',
      cell: (p) => (p.defaultProject ? <Mono value={p.defaultProject} /> : null),
    },
    {
      id: 'quota',
      header: 'Quota project',
      width: '11rem',
      defaultHidden: true,
      cell: (p) => (p.quotaProjectId ? <Mono value={p.quotaProjectId} /> : null),
    },
    {
      id: 'created',
      header: 'Added',
      width: '8rem',
      defaultHidden: true,
      sortValue: (p) => p.createdAt,
      cell: (p) => <Timestamp iso={p.createdAt} />,
    },
    {
      id: 'menu',
      header: 'Actions',
      width: '6.5rem',
      hideable: false,
      cell: (p) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: only keeps clicks on the row actions from opening the row.
        // biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside handle their own keys.
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {p.id !== activeId ? (
            <Button size="sm" variant="ghost" onClick={() => setProfile(p.id)}>
              Use
            </Button>
          ) : (
            <span className="px-2 text-meta text-ink-3">In use</span>
          )}
          <Menu align="end" trigger={<IconButton icon={DotsThreeIcon} label={`More for ${p.name}`} size="sm" />}>
            <MenuItem
              onClick={() => {
                setTesting(p);
                test.mutate(p.id);
              }}
            >
              Test the key
            </MenuItem>
            <MenuItem onClick={() => setEditing(p)}>Edit</MenuItem>
            {p.source === 'saved' ? (
              <>
                <MenuSeparator />
                <MenuItem onClick={() => setDeleting(p)} className="text-redline-ink">
                  Delete profile
                </MenuItem>
              </>
            ) : null}
          </Menu>
        </span>
      ),
    },
  ];

  return (
    <div className="pb-16">
      <TitleBlock
        title="Connections"
        subtitle="The keys Nephoscope can act with. Each browser tab acts with one of them; private keys never leave the server."
        actions={
          <Button
            variant="commit"
            icon={PlusIcon}
            onClick={() => setAdding(true)}
            disabled={!!instance.data && !instance.data.dataDir.writable}
            disabledReason="The data directory is not writable"
          >
            Add key
          </Button>
        }
      />
      <Notes notes={notes} />
      <div className="pt-4">
        {profiles.isPending ? (
          <DelayedSkeleton rows={3} />
        ) : profiles.error instanceof ApiError ? (
          <ProblemState problem={profiles.error.problem} onRetry={() => void profiles.refetch()} />
        ) : (
          <ResourceTable
            tableId="connections"
            label="Profiles"
            rows={profiles.data ?? []}
            columns={columns}
            getRowId={(p) => p.id}
            onOpen={(p) => setEditing(p)}
            emptyTitle="No keys yet"
            emptyText="Add a service account key, gcloud credentials or a workload identity configuration to start."
            emptyAction={
              <Button icon={PlusIcon} onClick={() => setAdding(true)}>
                Add a key
              </Button>
            }
          />
        )}
      </div>
      <section className="mx-6 mt-10 max-w-[75ch] border-t border-rule pt-4">
        <Legend as="h2" className="mt-0 mb-2">
          Running Nephoscope with a key
        </Legend>
        <p className="m-0 text-dense text-ink-2">
          The Environment profile comes from the key mounted when the container starts. Publish the port on 127.0.0.1 only: Nephoscope has
          no login.
        </p>
        <pre className="mt-2 mb-0 overflow-x-auto rounded-control bg-well p-3 font-mono text-[11px] leading-5 text-ink">
          {
            'docker run -p 127.0.0.1:8080:8080 \\\n  -v /path/to/key.json:/secrets/key.json:ro \\\n  -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/key.json \\\n  -v nephoscope-data:/data nephoscope'
          }
        </pre>
      </section>

      <AddProfileSheet open={adding} onOpenChange={setAdding} />
      <EditProfileSheet profile={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <Dialog open={testing !== null} onOpenChange={(o) => !o && setTesting(null)} title={`Test ${testing?.name ?? ''}`} width="sm">
        {test.isPending ? <p className="m-0 text-dense text-ink-2">Asking Google for a token and the visible projects…</p> : null}
        {test.data ? <CheckSteps check={test.data} /> : null}
        {test.error instanceof ApiError ? <p className="m-0 text-dense text-redline-ink">{test.error.problem.detail}</p> : null}
      </Dialog>
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete profile"
        consequence={`The key of ${deleting?.name ?? ''} is removed from this machine. Google Cloud is not changed; the key itself stays valid until you delete it in IAM.`}
        expected={deleting?.name ?? ''}
        confirmLabel="Delete profile"
        onConfirm={async (confirm) => {
          if (!deleting) return;
          await del.mutateAsync({ id: deleting.id, confirm });
          toast.success(`Profile ${deleting.name} deleted`);
        }}
      />
      <ConfirmDestructive
        open={resetting}
        onOpenChange={setResetting}
        title="Reset saved profiles"
        consequence="Every saved profile is discarded. The Environment profile is not affected."
        expected="reset"
        confirmLabel="Reset saved profiles"
        onConfirm={async (confirm) => {
          await reset.mutateAsync(confirm);
          toast.success('Saved profiles reset');
        }}
      />
    </div>
  );
}
