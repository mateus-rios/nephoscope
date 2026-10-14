import {
  type CryptoKeyView,
  type KeyRingView,
  type KeyVersionView,
  type KmsPurpose,
  type KmsToolOp,
  type KmsToolResult,
  kmsAlgorithms,
  kmsProtectionLevels,
  kmsPurposes,
} from '@nephoscope/contracts';
import { ArrowsClockwiseIcon, PlusIcon } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Section, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Textarea } from '../../design/Form';
import { Dialog, Sheet } from '../../design/Overlays';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { StatusGlyph } from '../../design/Status';
import { CopyButton, Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { KeyValueEditor, labelRowsFrom, labelsFromRows } from '../../kit/KeyValueEditor';
import { Notes, partialNote } from '../../kit/ListControls';
import { ResourcePermissions } from '../../kit/ResourcePermissions';
import { KitTable } from '../../kit/resource/KitTable';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api, qs } from '../../lib/api';
import { useActiveProfile, useInstance } from '../../state/queries';
import { useSession } from '../../state/session';
import { readOnlyReason } from '../run/common';

const enc = encodeURIComponent;
const base = (p: string) => `/api/projects/${enc(p)}/kms`;
const ringPath = (p: string, l: string, r: string) => `${base(p)}/keyrings/${enc(l)}/${enc(r)}`;
const keyPath = (p: string, l: string, r: string, k: string) => `${ringPath(p, l, r)}/keys/${enc(k)}`;

function useReadOnly() {
  const instance = useInstance();
  const { profile } = useActiveProfile();
  return readOnlyReason(instance.data?.readOnly, profile?.readOnly);
}

function useKmsQuery<T>(projectId: string, key: unknown[], path: string, enabled = true) {
  const profileId = useSession((s) => s.profileId);
  return useQuery({
    queryKey: ['kms', profileId, projectId, ...key],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled: !!profileId && enabled,
  });
}

function useKmsMutation<V, R>(projectId: string, fn: (v: V) => Promise<R>, done: (r: R, v: V) => string, what: string) {
  const client = useQueryClient();
  const profileId = useSession((s) => s.profileId);
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      void client.invalidateQueries({ queryKey: ['kms', profileId, projectId] });
      toast.success(done(r, v));
    },
    onError: (err) => toast.error(`${what} failed`, { description: err instanceof ApiError ? err.problem.detail : String(err) }),
  });
}

function VersionState({ state }: { state: string }) {
  const map: Record<string, ['ok' | 'paused' | 'error' | 'running' | 'warn' | 'unknown', string]> = {
    ENABLED: ['ok', 'Enabled'],
    DISABLED: ['paused', 'Disabled'],
    DESTROYED: ['error', 'Destroyed'],
    DESTROY_SCHEDULED: ['warn', 'Destruction scheduled'],
    PENDING_GENERATION: ['running', 'Generating'],
    PENDING_IMPORT: ['running', 'Importing'],
    IMPORT_FAILED: ['error', 'Import failed'],
    GENERATION_FAILED: ['error', 'Generation failed'],
  };
  const [kind, label] = map[state] ?? ['unknown', state];
  return <StatusGlyph kind={kind} label={label} />;
}

/** Key rings of the project, by location (SPEC-0007 D-08). */
export function KmsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const [location, setLocation] = useSearchState<string>('location', 'global');
  const locations = useKmsQuery<string[]>(projectId, ['locations'], `${base(projectId)}/locations`);
  const rings = useKmsQuery<{ items: KeyRingView[]; unreachable?: string[] }>(
    projectId,
    ['rings', location],
    `${base(projectId)}/keyrings${qs({ location })}`,
  );
  const autokey = useKmsQuery<{ keyProject: string | null }>(projectId, ['autokey'], `${base(projectId)}/autokey`);
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const [creating, setCreating] = useState(false);
  const [id, setId] = useState('');
  const [newLocation, setNewLocation] = useState('global');
  const create = useKmsMutation(
    projectId,
    (b: { id: string; location: string }) => api<KeyRingView>(`${base(projectId)}/keyrings`, { body: b }),
    (r) => `Created key ring ${r.id}`,
    'Creating the key ring',
  );
  useEffect(() => {
    document.title = 'Cloud KMS · Nephoscope';
  }, []);
  const href = (r: KeyRingView) => `/p/${projectId}/kms/${r.location}/${r.id}`;
  const columns: ResourceColumn<KeyRingView>[] = [
    {
      id: 'id',
      header: 'Key ring',
      hideable: false,
      sortValue: (r) => r.id,
      cell: (r) => (
        <Link to={href(r)} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {r.id}
        </Link>
      ),
    },
    { id: 'location', header: 'Location', width: '12rem', sortValue: (r) => r.location, cell: (r) => <Mono value={r.location} /> },
    {
      id: 'created',
      header: 'Created',
      width: '9rem',
      sortValue: (r) => r.createTime ?? '',
      cell: (r) => <Timestamp iso={r.createTime} />,
    },
  ];
  return (
    <div className="pb-16">
      <TitleBlock
        title="Cloud KMS"
        subtitle={`Key rings, keys and key versions. Autokey: ${autokey.data?.keyProject ? `keys are created in ${autokey.data.keyProject}` : 'not configured for this project'}.`}
        actions={
          <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setCreating(true)}>
            Create key ring
          </Button>
        }
      />
      <Notes notes={partialNote(rings.data?.unreachable)} />
      <div className="pt-3">
        {rings.isPending ? (
          <DelayedSkeleton />
        ) : rings.error instanceof ApiError ? (
          <ProblemState problem={rings.error.problem} onRetry={() => void rings.refetch()} />
        ) : (
          <ResourceTable
            tableId="kms-keyrings"
            label="Key rings"
            rows={rings.data?.items ?? []}
            columns={columns}
            getRowId={(r) => r.name}
            onOpen={(r) => void navigate({ to: href(r) })}
            emptyTitle={location === 'all' ? 'No key rings' : `No key rings in ${location}`}
            emptyText="A key ring groups keys in one location. Key rings and keys cannot be deleted."
            toolbar={
              <Field label="Location" className="w-56">
                <Select<string>
                  value={location}
                  onValueChange={setLocation}
                  options={[
                    { value: 'global', label: 'global' },
                    { value: 'all', label: 'All locations' },
                    ...(locations.data ?? []).filter((l) => l !== 'global').map((l) => ({ value: l, label: l })),
                  ]}
                />
              </Field>
            }
          />
        )}
      </div>
      <Section title="Key handles" description="Keys created by Autokey for resources of this project.">
        <KitTable projectId={projectId} collectionKey="kms/keyhandles" readOnly={readOnly} />
      </Section>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Create key ring"
        width="sm"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="commit"
              loading={create.isPending}
              disabled={!/^[a-zA-Z0-9_-]{1,63}$/.test(id)}
              onClick={() => create.mutate({ id, location: newLocation }, { onSuccess: () => setCreating(false) })}
            >
              Create key ring
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Name" required>
            <Input mono value={id} onChange={(e) => setId(e.target.value)} />
          </Field>
          <Field label="Location">
            <Select<string>
              value={newLocation}
              onValueChange={setNewLocation}
              options={(locations.data ?? ['global']).map((l) => ({ value: l, label: l }))}
            />
          </Field>
          <p className="m-0 text-meta text-ink-3">Key rings cannot be deleted or renamed.</p>
          <EquivalentCommand gcloud={`gcloud kms keyrings create ${id || 'NAME'} --location=${newLocation} --project=${projectId}`} />
        </div>
      </Dialog>
    </div>
  );
}

function CreateKeySheet({
  projectId,
  location,
  ring,
  open,
  onOpenChange,
}: {
  projectId: string;
  location: string;
  ring: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [id, setId] = useState('');
  const [purpose, setPurpose] = useState<KmsPurpose>('ENCRYPT_DECRYPT');
  const [protection, setProtection] = useState<(typeof kmsProtectionLevels)[number]>('SOFTWARE');
  const [algorithm, setAlgorithm] = useState('GOOGLE_SYMMETRIC_ENCRYPTION');
  const [days, setDays] = useState('90');
  const [labels, setLabels] = useState<{ name: string; value: string }[]>([]);
  const navigate = useNavigate();
  const create = useKmsMutation(
    projectId,
    (b: object) => api<CryptoKeyView>(`${ringPath(projectId, location, ring)}/keys`, { body: b }),
    (k) => `Created key ${k.id}`,
    'Creating the key',
  );
  useEffect(() => setAlgorithm(kmsAlgorithms[purpose][0] ?? ''), [purpose]);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create key"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={create.isPending}
            disabled={!/^[a-zA-Z0-9_-]{1,63}$/.test(id)}
            onClick={() =>
              create.mutate(
                {
                  id,
                  purpose,
                  protectionLevel: protection,
                  algorithm,
                  rotationPeriodSeconds: purpose === 'ENCRYPT_DECRYPT' && Number(days) ? Number(days) * 86_400 : undefined,
                  labels: labelsFromRows(labels),
                },
                { onSuccess: (k) => void navigate({ to: `/p/${projectId}/kms/${location}/${ring}/${k.id}` }) },
              )
            }
          >
            Create key
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required>
          <Input mono value={id} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field label="Purpose">
          <Select<KmsPurpose>
            value={purpose}
            onValueChange={setPurpose}
            options={kmsPurposes.map((p) => ({ value: p, label: p.replace(/_/g, ' ').toLowerCase() }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Protection level">
            <Select<(typeof kmsProtectionLevels)[number]>
              value={protection}
              onValueChange={setProtection}
              options={kmsProtectionLevels.map((p) => ({ value: p, label: p }))}
            />
          </Field>
          <Field label="Algorithm">
            <Select<string>
              value={algorithm}
              onValueChange={setAlgorithm}
              options={kmsAlgorithms[purpose].map((a) => ({ value: a, label: a }))}
            />
          </Field>
        </div>
        {purpose === 'ENCRYPT_DECRYPT' ? (
          <Field label="Rotate every (days)" help="Empty or 0 for manual rotation.">
            <Input mono value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
          </Field>
        ) : null}
        <KeyValueEditor label="Labels" keyLabel="Label" rows={labels} onChange={setLabels} />
        <EquivalentCommand
          gcloud={`gcloud kms keys create ${id || 'NAME'} --keyring=${ring} --location=${location} --purpose=${purpose.toLowerCase().replace(/_/g, '-')} --default-algorithm=${algorithm.toLowerCase().replace(/_/g, '-')} --protection-level=${protection.toLowerCase()} --project=${projectId}`}
        />
      </div>
    </Sheet>
  );
}

/** A key ring: its keys, import jobs and permissions (SPEC-0007 D-08). */
export function KeyRingPage() {
  const { projectId, location, ring } = useParams({ strict: false }) as { projectId: string; location: string; ring: string };
  const keys = useKmsQuery<CryptoKeyView[]>(projectId, ['keys', location, ring], `${ringPath(projectId, location, ring)}/keys`);
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const [creating, setCreating] = useState(false);
  const href = (k: CryptoKeyView) => `/p/${projectId}/kms/${location}/${ring}/${k.id}`;
  const columns: ResourceColumn<CryptoKeyView>[] = [
    {
      id: 'id',
      header: 'Key',
      hideable: false,
      sortValue: (k) => k.id,
      cell: (k) => (
        <Link to={href(k)} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {k.id}
        </Link>
      ),
    },
    {
      id: 'purpose',
      header: 'Purpose',
      width: '11rem',
      sortValue: (k) => k.purpose,
      cell: (k) => k.purpose.replace(/_/g, ' ').toLowerCase(),
    },
    { id: 'protection', header: 'Protection', width: '8rem', cell: (k) => k.protectionLevel ?? '' },
    {
      id: 'primary',
      header: 'Primary version',
      width: '12rem',
      cell: (k) =>
        k.primary ? (
          <span className="flex items-center gap-2">
            <span className="tnum font-mono text-[12px]">{k.primary.id}</span>
            <VersionState state={k.primary.state} />
          </span>
        ) : (
          <span className="text-ink-3">None</span>
        ),
    },
    {
      id: 'rotation',
      header: 'Next rotation',
      width: '9rem',
      cell: (k) => (k.nextRotationTime ? <Timestamp iso={k.nextRotationTime} /> : <span className="text-ink-3">Manual</span>),
    },
  ];
  const name = `projects/${projectId}/locations/${location}/keyRings/${ring}`;
  return (
    <>
      <DetailLayout<'keys' | 'importjobs' | 'permissions'>
        crumbs={[{ label: 'Cloud KMS', to: `/p/${projectId}/kms${location === 'global' ? '' : `?location=${location}`}` }, { label: ring }]}
        title={ring}
        subtitle={`Key ring in ${location}`}
        actions={
          <Button variant="commit" icon={PlusIcon} disabled={!!readOnly} disabledReason={readOnly} onClick={() => setCreating(true)}>
            Create key
          </Button>
        }
        tabs={[
          { key: 'keys', label: 'Keys' },
          { key: 'importjobs', label: 'Import jobs' },
          { key: 'permissions', label: 'Permissions' },
        ]}
        defaultTab="keys"
      >
        {(tab) =>
          tab === 'importjobs' ? (
            <KitTable
              projectId={projectId}
              collectionKey="kms/importjobs"
              parent={`locations/${location}/keyRings/${ring}`}
              readOnly={readOnly}
            />
          ) : tab === 'permissions' ? (
            <ResourcePermissions
              projectId={projectId}
              kind="kms-keyring"
              name={name}
              readOnly={readOnly}
              gcloudTarget={`kms keyrings ${ring} --location=${location}`}
            />
          ) : keys.isPending ? (
            <DelayedSkeleton />
          ) : keys.error instanceof ApiError ? (
            <ProblemState problem={keys.error.problem} onRetry={() => void keys.refetch()} />
          ) : (
            <div className="pt-3">
              <ResourceTable
                tableId="kms-keys"
                label="Keys"
                rows={keys.data ?? []}
                columns={columns}
                getRowId={(k) => k.name}
                onOpen={(k) => void navigate({ to: href(k) })}
                emptyTitle="No keys"
                emptyText="A key encrypts, signs or authenticates data through its versions."
              />
            </div>
          )
        }
      </DetailLayout>
      <CreateKeySheet projectId={projectId} location={location} ring={ring} open={creating} onOpenChange={setCreating} />
    </>
  );
}

const TOOL_LABEL: Record<KmsToolOp, string> = {
  encrypt: 'Encrypt',
  decrypt: 'Decrypt',
  sign: 'Sign',
  verify: 'Verify signature',
  macSign: 'Compute MAC',
  macVerify: 'Verify MAC',
};

function opsFor(purpose: string): KmsToolOp[] {
  if (purpose === 'ENCRYPT_DECRYPT' || purpose === 'RAW_ENCRYPT_DECRYPT') return ['encrypt', 'decrypt'];
  if (purpose === 'ASYMMETRIC_SIGN') return ['sign', 'verify'];
  if (purpose === 'ASYMMETRIC_DECRYPT') return ['decrypt'];
  if (purpose === 'MAC') return ['macSign', 'macVerify'];
  return [];
}

const toBase64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

function Tools({
  projectId,
  location,
  ring,
  keyId,
  k,
  versions,
}: {
  projectId: string;
  location: string;
  ring: string;
  keyId: string;
  k: CryptoKeyView;
  versions: KeyVersionView[];
}) {
  const ops = opsFor(k.purpose);
  const [op, setOp] = useState<KmsToolOp>(ops[0] ?? 'encrypt');
  const [input, setInput] = useState('');
  const [inputIsBase64, setInputIsBase64] = useState(false);
  const [signature, setSignature] = useState('');
  const enabledVersions = versions.filter((v) => v.state === 'ENABLED');
  const [version, setVersion] = useState(enabledVersions[0]?.id ?? '');
  const [result, setResult] = useState<KmsToolResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsVersion = op !== 'encrypt' && !(op === 'decrypt' && k.purpose !== 'ASYMMETRIC_DECRYPT');
  const binaryInput = op === 'decrypt' || inputIsBase64;
  return (
    <Section title="Crypto tools" description="Inputs up to 64 KiB. Every use is recorded in the Activity log.">
      <div className="flex max-w-3xl flex-col gap-3 px-6">
        {ops.length === 0 ? <p className="m-0 text-dense text-ink-3">This key purpose has no tool in Nephoscope.</p> : null}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Operation" className="w-48">
            <Select<KmsToolOp>
              value={op}
              onValueChange={(v) => {
                setOp(v);
                setResult(null);
              }}
              options={ops.map((o) => ({ value: o, label: TOOL_LABEL[o] }))}
            />
          </Field>
          {needsVersion ? (
            <Field label="Version" className="w-32">
              <Select<string>
                value={version}
                onValueChange={setVersion}
                options={enabledVersions.map((v) => ({ value: v.id, label: v.id }))}
              />
            </Field>
          ) : null}
          {op !== 'decrypt' ? (
            <label className="flex items-center gap-2 pb-2 text-dense">
              <input type="checkbox" checked={inputIsBase64} onChange={(e) => setInputIsBase64(e.target.checked)} />
              Input is base64
            </label>
          ) : null}
        </div>
        <Field label={op === 'decrypt' ? 'Ciphertext (base64)' : binaryInput ? 'Data (base64)' : 'Data (text)'}>
          <Textarea mono rows={5} value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        {op === 'verify' || op === 'macVerify' ? (
          <Field label={op === 'verify' ? 'Signature (base64)' : 'MAC (base64)'}>
            <Textarea mono rows={3} value={signature} onChange={(e) => setSignature(e.target.value)} />
          </Field>
        ) : null}
        <div>
          <Button
            icon={ArrowsClockwiseIcon}
            loading={busy}
            disabled={!input.trim() || (needsVersion && !version)}
            onClick={async () => {
              setBusy(true);
              setError(null);
              setResult(null);
              try {
                setResult(
                  await api<KmsToolResult>(`${keyPath(projectId, location, ring, keyId)}/tool`, {
                    body: {
                      op,
                      input: binaryInput ? input.trim() : toBase64(input),
                      signature: signature.trim() || undefined,
                      version: needsVersion ? version : undefined,
                    },
                  }),
                );
              } catch (err) {
                setError(err instanceof ApiError ? err.problem.detail : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {TOOL_LABEL[op]}
          </Button>
        </div>
        {error ? <p className="m-0 text-dense text-redline-ink">{error}</p> : null}
        {result ? (
          result.verified !== null ? (
            <StatusGlyph kind={result.verified ? 'ok' : 'error'} label={result.verified ? 'Valid' : 'Not valid'} />
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-dense font-medium text-ink">Result{result.version ? ` (version ${result.version})` : ''}</span>
                <CopyButton value={result.text ?? result.output ?? ''} label="Copy result" />
              </div>
              <pre className="m-0 max-h-60 overflow-auto rounded-control bg-well p-2 font-mono text-[12px] break-all whitespace-pre-wrap text-ink">
                {result.text ?? result.output}
              </pre>
            </div>
          )
        ) : null}
      </div>
    </Section>
  );
}

/** One key: versions with their lifecycle, tools, settings and permissions (SPEC-0007 D-08, CA-08). */
export function CryptoKeyPage() {
  const { projectId, location, ring, key } = useParams({ strict: false }) as {
    projectId: string;
    location: string;
    ring: string;
    key: string;
  };
  const k = useKmsQuery<CryptoKeyView>(projectId, ['key', location, ring, key], keyPath(projectId, location, ring, key));
  const versions = useKmsQuery<KeyVersionView[]>(
    projectId,
    ['versions', location, ring, key],
    `${keyPath(projectId, location, ring, key)}/versions`,
  );
  const readOnly = useReadOnly();
  const rotate = useKmsMutation(
    projectId,
    () => api<KeyVersionView>(`${keyPath(projectId, location, ring, key)}/versions`, { method: 'POST' }),
    (v) => `Created version ${v.id}`,
    'Rotating',
  );
  const act = useKmsMutation(
    projectId,
    (v: { version: string; action: string; confirm?: string }) =>
      api<void>(`${keyPath(projectId, location, ring, key)}/versions/${v.version}/${v.action}`, { body: { confirm: v.confirm } }),
    (_r, v) => `${v.action === 'primary' ? 'Made primary' : `${v.action[0]?.toUpperCase()}${v.action.slice(1)}d`} version ${v.version}`,
    'Changing the version',
  );
  const update = useKmsMutation(
    projectId,
    (b: object) => api<CryptoKeyView>(keyPath(projectId, location, ring, key), { method: 'PATCH', body: b }),
    () => `Saved ${key}`,
    'Saving the key',
  );
  const [destroying, setDestroying] = useState<KeyVersionView | null>(null);
  const [labels, setLabels] = useState<{ name: string; value: string }[]>([]);
  const [days, setDays] = useState('');
  useEffect(() => {
    if (k.data) {
      setLabels(labelRowsFrom(k.data.labels));
      setDays(k.data.rotationPeriodSeconds ? String(Math.round(k.data.rotationPeriodSeconds / 86_400)) : '');
    }
  }, [k.data]);
  if (k.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (k.error instanceof ApiError || !k.data)
    return k.error instanceof ApiError ? <ProblemState problem={k.error.problem} onRetry={() => void k.refetch()} /> : null;
  const kd = k.data;
  const columns: ResourceColumn<KeyVersionView>[] = [
    {
      id: 'id',
      header: 'Version',
      width: '7rem',
      hideable: false,
      sortValue: (v) => Number(v.id),
      cell: (v) => (
        <span className="tnum font-mono text-[12px]">
          {v.id}
          {v.primary ? ' (primary)' : ''}
        </span>
      ),
    },
    { id: 'state', header: 'State', width: '12rem', cell: (v) => <VersionState state={v.state} /> },
    { id: 'algorithm', header: 'Algorithm', cell: (v) => <Mono value={v.algorithm ?? ''} /> },
    {
      id: 'created',
      header: 'Created',
      width: '9rem',
      sortValue: (v) => v.createTime ?? '',
      cell: (v) => <Timestamp iso={v.createTime} />,
    },
    { id: 'destroy', header: 'Destroyed or due', width: '10rem', cell: (v) => (v.destroyTime ? <Timestamp iso={v.destroyTime} /> : null) },
    {
      id: 'actions',
      header: 'Actions',
      width: '18rem',
      hideable: false,
      cell: (v) => {
        const disabled = !!readOnly;
        if (v.state === 'DESTROY_SCHEDULED') {
          return (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              disabledReason={readOnly}
              onClick={() => act.mutate({ version: v.id, action: 'restore' })}
            >
              Restore
            </Button>
          );
        }
        if (v.state !== 'ENABLED' && v.state !== 'DISABLED') return null;
        return (
          <span className="flex gap-1">
            {v.state === 'ENABLED' && !v.primary && kd.purpose === 'ENCRYPT_DECRYPT' ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                disabledReason={readOnly}
                onClick={() => act.mutate({ version: v.id, action: 'primary' })}
              >
                Make primary
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              disabledReason={readOnly}
              onClick={() => act.mutate({ version: v.id, action: v.state === 'ENABLED' ? 'disable' : 'enable' })}
            >
              {v.state === 'ENABLED' ? 'Disable' : 'Enable'}
            </Button>
            <Button size="sm" variant="ghost" disabled={disabled} disabledReason={readOnly} onClick={() => setDestroying(v)}>
              Destroy
            </Button>
          </span>
        );
      },
    },
  ];
  const name = `projects/${projectId}/locations/${location}/keyRings/${ring}/cryptoKeys/${key}`;
  return (
    <>
      <DetailLayout<'versions' | 'tools' | 'settings' | 'permissions'>
        crumbs={[
          { label: 'Cloud KMS', to: `/p/${projectId}/kms` },
          { label: ring, to: `/p/${projectId}/kms/${location}/${ring}` },
          { label: key },
        ]}
        title={key}
        subtitle={kd.purpose.replace(/_/g, ' ').toLowerCase()}
        actions={
          <Button
            icon={ArrowsClockwiseIcon}
            disabled={!!readOnly}
            disabledReason={readOnly}
            loading={rotate.isPending}
            onClick={() => rotate.mutate(undefined)}
          >
            Rotate key
          </Button>
        }
        cells={[
          { label: 'Location', value: location, mono: true },
          { label: 'Protection', value: kd.protectionLevel ?? '' },
          { label: 'Algorithm', value: kd.algorithm ?? '', mono: true },
          { label: 'Next rotation', value: kd.nextRotationTime ? <Timestamp iso={kd.nextRotationTime} /> : 'Manual' },
        ]}
        tabs={[
          { key: 'versions', label: 'Versions' },
          { key: 'tools', label: 'Tools' },
          { key: 'settings', label: 'Settings' },
          { key: 'permissions', label: 'Permissions' },
        ]}
        defaultTab="versions"
      >
        {(tab) =>
          tab === 'tools' ? (
            <Tools projectId={projectId} location={location} ring={ring} keyId={key} k={kd} versions={versions.data ?? []} />
          ) : tab === 'permissions' ? (
            <ResourcePermissions
              projectId={projectId}
              kind="kms-key"
              name={name}
              readOnly={readOnly}
              gcloudTarget={`kms keys ${key} --keyring=${ring} --location=${location}`}
              suggested={['roles/cloudkms.cryptoKeyEncrypterDecrypter', 'roles/cloudkms.signerVerifier', 'roles/cloudkms.viewer']}
            />
          ) : tab === 'settings' ? (
            <Section title="Settings">
              <div className="flex max-w-xl flex-col gap-4 px-6">
                {kd.purpose === 'ENCRYPT_DECRYPT' ? (
                  <Field label="Rotate every (days)" help="Empty for manual rotation.">
                    <Input mono value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
                  </Field>
                ) : null}
                <KeyValueEditor label="Labels" keyLabel="Label" rows={labels} onChange={setLabels} />
                <div>
                  <Button
                    disabled={!!readOnly}
                    disabledReason={readOnly}
                    loading={update.isPending}
                    onClick={() =>
                      update.mutate({
                        labels: labelsFromRows(labels),
                        ...(kd.purpose === 'ENCRYPT_DECRYPT' ? { rotationPeriodSeconds: Number(days) ? Number(days) * 86_400 : null } : {}),
                      })
                    }
                  >
                    Save settings
                  </Button>
                </div>
              </div>
            </Section>
          ) : versions.isPending ? (
            <DelayedSkeleton />
          ) : versions.error instanceof ApiError ? (
            <ProblemState problem={versions.error.problem} onRetry={() => void versions.refetch()} />
          ) : (
            <div className="pt-3">
              <ResourceTable
                tableId="kms-versions"
                label="Key versions"
                rows={versions.data ?? []}
                columns={columns}
                getRowId={(v) => v.name}
                emptyTitle="No versions"
              />
            </div>
          )
        }
      </DetailLayout>
      <ConfirmDestructive
        open={destroying !== null}
        onOpenChange={(o) => !o && setDestroying(null)}
        title="Schedule key version destruction"
        consequence={`Version ${destroying?.id ?? ''} is destroyed after ${kd.destroyScheduledDuration ?? 'the scheduled period'}. Data encrypted with it cannot be decrypted afterwards; it can be restored until then.`}
        expected={destroying?.id ?? ''}
        confirmLabel="Schedule destruction"
        command={`gcloud kms keys versions destroy ${destroying?.id ?? ''} --key=${key} --keyring=${ring} --location=${location} --project=${projectId}`}
        onConfirm={async (c) => {
          if (destroying) await act.mutateAsync({ version: destroying.id, action: 'destroy', confirm: c });
        }}
      />
    </>
  );
}
