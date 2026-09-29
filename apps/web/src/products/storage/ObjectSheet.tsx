import type { StorageBucket, StorageCapabilities, StorageObject } from '@nephoscope/contracts';
import {
  ArrowCounterClockwiseIcon,
  CopyIcon,
  DownloadSimpleIcon,
  FloppyDiskIcon,
  GlobeIcon,
  LinkIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { Legend } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Dialog, Sheet } from '../../design/Overlays';
import { StatusGlyph } from '../../design/Status';
import { CopyButton, Mono, Timestamp } from '../../design/Values';
import { KeyValueEditor, labelRowsFrom, labelsFromRows } from '../../kit/KeyValueEditor';
import { ApiError } from '../../lib/api';
import { bytes } from '../../lib/format';
import {
  baseName,
  copyObject,
  deleteObjects,
  downloadObject,
  failed,
  makePublic,
  restoreObject,
  signUrl,
  updateObject,
  useBuckets,
  useObject,
} from './api';
import { Preview } from './Preview';

export interface ObjectTarget {
  name: string;
  generation?: string;
}

const EXPIRIES = [
  { value: '900', label: '15 minutes' },
  { value: '3600', label: '1 hour' },
  { value: '86400', label: '1 day' },
  { value: '604800', label: '7 days (the longest)' },
];

/** V4 signed URLs, offered only when the profile can sign (D-11, CA-13). */
function SignedUrlDialog({
  projectId,
  bucket,
  name,
  signingAccount,
  open,
  onOpenChange,
}: {
  projectId: string;
  bucket: string;
  name: string;
  signingAccount: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [expires, setExpires] = useState('3600');
  const [result, setResult] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setResult(null);
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Signed URL"
      description={
        <>
          Anyone with the URL can read <span className="font-mono">{baseName(name)}</span> until it expires, without signing in.
        </>
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{result ? 'Close' : 'Cancel'}</Button>
          {!result ? (
            <Button
              variant="commit"
              icon={LinkIcon}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setResult(await signUrl(projectId, bucket, name, Number(expires)));
                } catch (err) {
                  failed('Signing the URL')(err);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Sign URL
            </Button>
          ) : null}
        </>
      }
    >
      {result ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <pre className="m-0 max-h-40 min-w-0 flex-1 overflow-auto rounded-control bg-well p-2 font-mono text-[11px] break-all whitespace-pre-wrap text-ink">
              {result.url}
            </pre>
            <CopyButton value={result.url} label="Copy URL" />
          </div>
          <p className="m-0 text-meta text-ink-2">
            Valid until <Timestamp iso={result.expiresAt} />.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Valid for">
            <Select value={expires} onValueChange={setExpires} options={EXPIRIES} />
          </Field>
          {signingAccount ? (
            <p className="m-0 text-meta text-ink-3">
              Signed by <span className="font-mono">{signingAccount}</span>. Revoking the URL early means removing that account’s access.
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

/** Copy, move or rename (a move within the bucket), D-11. */
export function CopyMoveDialog({
  projectId,
  bucket,
  object,
  mode,
  onOpenChange,
  onDone,
}: {
  projectId: string;
  bucket: string;
  object: { name: string; generation?: string } | null;
  mode: 'copy' | 'move' | 'rename';
  onOpenChange: (o: boolean) => void;
  onDone: (o: StorageObject) => void;
}) {
  const buckets = useBuckets(projectId);
  const [dest, setDest] = useState(bucket);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!object) return;
    setDest(bucket);
    setName(mode === 'copy' ? object.name.replace(/(\.[^./]+)?$/, ' copy$1') : object.name);
  }, [object, bucket, mode]);
  if (!object) return null;
  const same = dest === bucket && name === object.name;
  const verb = mode === 'copy' ? 'Copy' : mode === 'move' ? 'Move' : 'Rename';
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`${verb} ${baseName(object.name)}`}
      description={mode === 'rename' ? 'Renaming copies the object to the new name, then deletes the old one.' : undefined}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={CopyIcon}
            loading={busy}
            disabled={!name.trim() || same}
            onClick={async () => {
              setBusy(true);
              try {
                const o = await copyObject(projectId, bucket, {
                  source: { name: object.name, ...(object.generation ? { generation: object.generation } : {}) },
                  destinationBucket: dest,
                  destinationName: name.trim(),
                  move: mode !== 'copy',
                });
                toast.success(`${mode === 'copy' ? 'Copied' : mode === 'move' ? 'Moved' : 'Renamed'} to ${o.name}`);
                onDone(o);
                onOpenChange(false);
              } catch (err) {
                failed(`${verb === 'Copy' ? 'Copying' : verb === 'Move' ? 'Moving' : 'Renaming'} the object`)(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {verb} object
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {mode !== 'rename' ? (
          <Field label="Destination bucket">
            <Select
              value={dest}
              onValueChange={setDest}
              options={(buckets.data?.items ?? [{ name: bucket } as StorageBucket]).map((b) => ({ value: b.name, label: b.name }))}
            />
          </Field>
        ) : null}
        <Field label="Object name" help="The full name, with any folder prefix.">
          <Input mono value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
      </div>
    </Dialog>
  );
}

interface MetaForm {
  contentType: string;
  cacheControl: string;
  contentDisposition: string;
  contentEncoding: string;
  contentLanguage: string;
  metadata: { name: string; value: string }[];
  eventBasedHold: boolean;
  temporaryHold: boolean;
}

const formOf = (o: StorageObject): MetaForm => ({
  contentType: o.contentType ?? '',
  cacheControl: o.cacheControl ?? '',
  contentDisposition: o.contentDisposition ?? '',
  contentEncoding: o.contentEncoding ?? '',
  contentLanguage: o.contentLanguage ?? '',
  metadata: labelRowsFrom(o.metadata),
  eventBasedHold: o.eventBasedHold,
  temporaryHold: o.temporaryHold,
});

/** Object details, preview, metadata and actions (D-11, D-12). */
export function ObjectSheet({
  projectId,
  bucket,
  target,
  capabilities,
  readOnly,
  onOpenChange,
  onChanged,
}: {
  projectId: string;
  bucket: StorageBucket;
  target: ObjectTarget | null;
  capabilities: StorageCapabilities | undefined;
  readOnly: string | null;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const object = useObject(projectId, bucket.name, target);
  const [form, setForm] = useState<MetaForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<'copy' | 'move' | 'rename' | 'sign' | 'delete' | 'public' | null>(null);
  const o = object.data;
  useEffect(() => {
    if (o) setForm(formOf(o));
  }, [o]);
  const live = o ? !o.timeDeleted && !o.softDeleteTime : false;
  const softDeleted = !!o?.softDeleteTime;
  const noncurrent = !!o?.timeDeleted && !softDeleted;
  const dirty = !!o && !!form && JSON.stringify(form) !== JSON.stringify(formOf(o));
  const set = (patch: Partial<MetaForm>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const ref = o ? { name: o.name, generation: o.generation } : null;
  const done = () => {
    onChanged();
    void object.refetch();
  };
  const publicBlocked =
    bucket.publicAccessPrevention === 'enforced'
      ? 'Public access prevention is enforced on this bucket'
      : bucket.uniformAccess
        ? 'The bucket uses uniform access: grant allUsers a role on the bucket instead'
        : null;

  return (
    <Sheet
      open={!!target}
      onOpenChange={onOpenChange}
      title={target ? baseName(target.name) : 'Object'}
      description={target ? <span className="font-mono text-[12px] break-all">{target.name}</span> : undefined}
      footer={
        o ? (
          live ? (
            <Button
              variant="commit"
              icon={FloppyDiskIcon}
              loading={saving}
              disabled={!dirty || !!readOnly}
              disabledReason={readOnly}
              onClick={async () => {
                if (!form) return;
                setSaving(true);
                try {
                  const n = (s: string) => (s.trim() === '' ? null : s.trim());
                  await updateObject(projectId, bucket.name, {
                    name: o.name,
                    contentType: n(form.contentType),
                    cacheControl: n(form.cacheControl),
                    contentDisposition: n(form.contentDisposition),
                    contentEncoding: n(form.contentEncoding),
                    contentLanguage: n(form.contentLanguage),
                    metadata: labelsFromRows(form.metadata),
                    eventBasedHold: form.eventBasedHold,
                    temporaryHold: form.temporaryHold,
                  });
                  toast.success(`Saved ${baseName(o.name)}`);
                  done();
                } catch (err) {
                  failed('Saving the metadata')(err);
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save metadata
            </Button>
          ) : softDeleted ? (
            <Button
              variant="commit"
              icon={ArrowCounterClockwiseIcon}
              disabled={!!readOnly}
              disabledReason={readOnly}
              onClick={async () => {
                try {
                  await restoreObject(projectId, bucket.name, o.name, o.generation);
                  toast.success(`Restored ${baseName(o.name)}`);
                  done();
                } catch (err) {
                  failed('Restoring the object')(err);
                }
              }}
            >
              Restore object
            </Button>
          ) : (
            <Button
              variant="commit"
              icon={ArrowCounterClockwiseIcon}
              disabled={!!readOnly}
              disabledReason={readOnly}
              onClick={async () => {
                try {
                  // A noncurrent version is restored by copying it over the live object.
                  await copyObject(projectId, bucket.name, {
                    source: { name: o.name, generation: o.generation },
                    destinationBucket: bucket.name,
                    destinationName: o.name,
                    move: false,
                  });
                  toast.success(`Restored this version of ${baseName(o.name)}`);
                  done();
                } catch (err) {
                  failed('Restoring the version')(err);
                }
              }}
            >
              Make this version current
            </Button>
          )
        ) : undefined
      }
    >
      {object.isPending ? (
        <DelayedSkeleton rows={8} />
      ) : object.error instanceof ApiError ? (
        <ProblemState problem={object.error.problem} onRetry={() => void object.refetch()} />
      ) : o && form ? (
        <div className="flex flex-col gap-5">
          {!live ? (
            <StatusGlyph
              kind="warn"
              label={
                softDeleted ? `Soft-deleted; restorable until ${new Date(o.hardDeleteTime ?? '').toLocaleString()}` : 'Noncurrent version'
              }
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              icon={DownloadSimpleIcon}
              onClick={() => ref && void downloadObject(projectId, bucket.name, ref).catch(failed('Downloading'))}
              disabled={softDeleted}
              disabledReason={softDeleted ? 'Restore it first' : null}
            >
              Download
            </Button>
            {live ? (
              <>
                <Button icon={CopyIcon} onClick={() => setDialog('copy')} disabled={!!readOnly} disabledReason={readOnly}>
                  Copy
                </Button>
                <Button onClick={() => setDialog('move')} disabled={!!readOnly} disabledReason={readOnly}>
                  Move
                </Button>
                <Button onClick={() => setDialog('rename')} disabled={!!readOnly} disabledReason={readOnly}>
                  Rename
                </Button>
                {capabilities?.canSign ? (
                  <Button icon={LinkIcon} onClick={() => setDialog('sign')}>
                    Signed URL
                  </Button>
                ) : null}
                <Button
                  icon={GlobeIcon}
                  onClick={() => setDialog('public')}
                  disabled={!!readOnly || !!publicBlocked}
                  disabledReason={readOnly ?? publicBlocked}
                >
                  Make public
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              icon={TrashIcon}
              onClick={() => setDialog('delete')}
              disabled={!!readOnly || softDeleted}
              disabledReason={readOnly}
            >
              {noncurrent ? 'Delete version' : 'Delete'}
            </Button>
          </div>
          {!capabilities?.canSign && live ? (
            <p className="m-0 text-meta text-ink-3">
              {capabilities?.emulator
                ? 'Signed URLs are not available with the emulator.'
                : 'Signed URLs need a service account key, or iam.serviceAccounts.signBlob on a service account.'}
            </p>
          ) : null}

          <section aria-label="Preview">
            <Legend>Preview</Legend>
            <div className="mt-2">
              {softDeleted ? (
                <p className="m-0 text-meta text-ink-3">Restore the object to preview it.</p>
              ) : (
                <Preview projectId={projectId} bucket={bucket.name} object={o} />
              )}
            </div>
          </section>

          <section aria-label="Details">
            <Legend>Details</Legend>
            <dl className="m-0 mt-2 grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-dense">
              <dt className="text-ink-3">Size</dt>
              <dd className="m-0 tnum">
                {bytes(o.size)} <span className="text-ink-3">({Number(o.size).toLocaleString('en-US')} bytes)</span>
              </dd>
              <dt className="text-ink-3">Generation</dt>
              <dd className="m-0">
                <Mono value={o.generation} copy />
              </dd>
              <dt className="text-ink-3">Metageneration</dt>
              <dd className="m-0">
                <Mono value={o.metageneration ?? ''} />
              </dd>
              <dt className="text-ink-3">Storage class</dt>
              <dd className="m-0">{o.storageClass ?? ''}</dd>
              <dt className="text-ink-3">Created</dt>
              <dd className="m-0">
                <Timestamp iso={o.created} />
              </dd>
              <dt className="text-ink-3">Updated</dt>
              <dd className="m-0">
                <Timestamp iso={o.updated} />
              </dd>
              {o.customTime ? (
                <>
                  <dt className="text-ink-3">Custom time</dt>
                  <dd className="m-0">
                    <Timestamp iso={o.customTime} />
                  </dd>
                </>
              ) : null}
              <dt className="text-ink-3">MD5</dt>
              <dd className="m-0">
                <Mono value={o.md5 ?? 'None (composite object)'} />
              </dd>
              <dt className="text-ink-3">CRC32C</dt>
              <dd className="m-0">
                <Mono value={o.crc32c ?? ''} />
              </dd>
              {o.retentionExpirationTime ? (
                <>
                  <dt className="text-ink-3">Retained until</dt>
                  <dd className="m-0">
                    <Timestamp iso={o.retentionExpirationTime} />
                  </dd>
                </>
              ) : null}
              <dt className="text-ink-3">Encryption</dt>
              <dd className="m-0">{o.kmsKeyName ? <Mono value={o.kmsKeyName} /> : 'Google managed'}</dd>
              <dt className="text-ink-3">gsutil URI</dt>
              <dd className="m-0">
                <Mono value={`gs://${bucket.name}/${o.name}`} copy />
              </dd>
            </dl>
          </section>

          {live ? (
            <section aria-label="Metadata" className="flex flex-col gap-3">
              <Legend>Metadata</Legend>
              <Field label="Content type">
                <Input mono value={form.contentType} onChange={(e) => set({ contentType: e.target.value })} disabled={!!readOnly} />
              </Field>
              <Field label="Cache control" help="For example no-store, or public, max-age=3600.">
                <Input mono value={form.cacheControl} onChange={(e) => set({ cacheControl: e.target.value })} disabled={!!readOnly} />
              </Field>
              <Field label="Content disposition">
                <Input
                  mono
                  value={form.contentDisposition}
                  onChange={(e) => set({ contentDisposition: e.target.value })}
                  disabled={!!readOnly}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Content encoding">
                  <Input
                    mono
                    value={form.contentEncoding}
                    onChange={(e) => set({ contentEncoding: e.target.value })}
                    disabled={!!readOnly}
                  />
                </Field>
                <Field label="Content language">
                  <Input
                    mono
                    value={form.contentLanguage}
                    onChange={(e) => set({ contentLanguage: e.target.value })}
                    disabled={!!readOnly}
                  />
                </Field>
              </div>
              <KeyValueEditor label="Custom metadata" rows={form.metadata} onChange={(rows) => set({ metadata: rows })} keyLabel="Key" />
              <Legend>Holds</Legend>
              <Switch
                checked={form.temporaryHold}
                onCheckedChange={(v) => set({ temporaryHold: v })}
                label="Temporary hold"
                description="The object cannot be deleted or replaced while held."
                disabled={!!readOnly}
              />
              <Switch
                checked={form.eventBasedHold}
                onCheckedChange={(v) => set({ eventBasedHold: v })}
                label="Event-based hold"
                description="Like a temporary hold; releasing it starts the retention period."
                disabled={!!readOnly}
              />
            </section>
          ) : null}

          <SignedUrlDialog
            projectId={projectId}
            bucket={bucket.name}
            name={o.name}
            signingAccount={capabilities?.signingAccount ?? null}
            open={dialog === 'sign'}
            onOpenChange={(v) => !v && setDialog(null)}
          />
          <CopyMoveDialog
            projectId={projectId}
            bucket={bucket.name}
            object={dialog === 'copy' || dialog === 'move' || dialog === 'rename' ? { name: o.name } : null}
            mode={dialog === 'move' ? 'move' : dialog === 'rename' ? 'rename' : 'copy'}
            onOpenChange={(v) => !v && setDialog(null)}
            onDone={() => {
              onChanged();
              if (dialog !== 'copy') onOpenChange(false);
            }}
          />
          <ConfirmDestructive
            open={dialog === 'delete'}
            onOpenChange={(v) => !v && setDialog(null)}
            title={noncurrent ? 'Delete version' : 'Delete object'}
            consequence={
              noncurrent
                ? 'This noncurrent version is deleted permanently.'
                : bucket.softDeleteSeconds
                  ? 'The object is soft-deleted: it stays restorable for the bucket’s soft delete period.'
                  : bucket.versioning
                    ? 'The live object becomes a noncurrent version.'
                    : 'The object is deleted permanently.'
            }
            expected={baseName(o.name)}
            confirmLabel={noncurrent ? 'Delete version' : 'Delete object'}
            command={`gcloud storage rm gs://${bucket.name}/${o.name}${noncurrent ? `#${o.generation}` : ''}`}
            onConfirm={async (confirm) => {
              const r = await deleteObjects(
                projectId,
                bucket.name,
                [noncurrent ? { name: o.name, generation: o.generation } : { name: o.name }],
                confirm,
              );
              const failure = r.failures[0];
              if (failure)
                throw new ApiError({
                  type: 'about:blank',
                  title: 'Delete failed',
                  status: 400,
                  detail: failure.error,
                  code: 'FAILED_PRECONDITION',
                  retryable: false,
                });
              toast.success(`Deleted ${baseName(o.name)}`);
              onChanged();
              onOpenChange(false);
            }}
          />
          <ConfirmDestructive
            open={dialog === 'public'}
            onOpenChange={(v) => !v && setDialog(null)}
            title="Make public"
            consequence="Anyone on the internet can read this object, without signing in, until its allUsers access is removed."
            expected={baseName(o.name)}
            confirmLabel="Make object public"
            command={`gcloud storage objects update gs://${bucket.name}/${o.name} --add-acl-grant=entity=allUsers,role=READER`}
            onConfirm={async (confirm) => {
              await makePublic(projectId, bucket.name, o.name, confirm);
              toast.success(`${baseName(o.name)} is public`, {
                description: `https://storage.googleapis.com/${bucket.name}/${o.name.split('/').map(encodeURIComponent).join('/')}`,
              });
            }}
          />
        </div>
      ) : null}
    </Sheet>
  );
}
