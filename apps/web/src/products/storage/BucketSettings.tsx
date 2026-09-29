import type { CorsRule, IamBinding, LifecycleRule, StorageBucket, UpdateBucket } from '@nephoscope/contracts';
import { storageClasses } from '@nephoscope/contracts/storage-preview';
import { FloppyDiskIcon, LockIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Legend, Notes, Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Switch, Textarea } from '../../design/Form';
import { Mono } from '../../design/Values';
import { KeyValueEditor, LABEL_KEY, labelRowsFrom, labelsFromRows } from '../../kit/KeyValueEditor';
import { ApiError } from '../../lib/api';
import { duration } from '../../lib/format';
import { failed, lockRetention, setBucketIam, updateBucket, useBucketIam, useInvalidateStorage } from './api';
import { classLabel } from './StoragePage';

// ---- validation without zod in the browser; the server validates again (SPEC-0001 D-02) ------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrArr = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateCors(text: string): { rules: CorsRule[] } | { error: string } {
  let v: unknown;
  try {
    v = JSON.parse(text || '[]');
  } catch (err) {
    return { error: `Not JSON: ${(err as Error).message}` };
  }
  if (!Array.isArray(v)) return { error: 'CORS is a JSON array of rules.' };
  for (const [i, r] of v.entries()) {
    const at = `Rule ${i + 1}`;
    if (!isObj(r)) return { error: `${at} is not an object.` };
    for (const k of Object.keys(r))
      if (!['origin', 'method', 'responseHeader', 'maxAgeSeconds'].includes(k)) return { error: `${at}: unknown field "${k}".` };
    if (!isStrArr(r.origin) || !(r.origin as string[]).length)
      return { error: `${at}: origin must be a list of origins, such as ["https://example.com"].` };
    if (!isStrArr(r.method) || !(r.method as string[]).length) return { error: `${at}: method must be a list, such as ["GET", "HEAD"].` };
    const bad = (r.method as string[]).find(
      (m) => !['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'PATCH', '*'].includes(m.toUpperCase()),
    );
    if (bad) return { error: `${at}: "${bad}" is not an HTTP method.` };
    if (r.responseHeader !== undefined && !isStrArr(r.responseHeader))
      return { error: `${at}: responseHeader must be a list of header names.` };
    if (r.maxAgeSeconds !== undefined && (!Number.isInteger(r.maxAgeSeconds) || (r.maxAgeSeconds as number) < 0))
      return { error: `${at}: maxAgeSeconds must be a whole number of seconds.` };
  }
  return { rules: v as CorsRule[] };
}

const CONDITION_KEYS: Record<string, 'int' | 'date' | 'bool' | 'list'> = {
  age: 'int',
  createdBefore: 'date',
  isLive: 'bool',
  numNewerVersions: 'int',
  matchesStorageClass: 'list',
  matchesPrefix: 'list',
  matchesSuffix: 'list',
  daysSinceNoncurrentTime: 'int',
  noncurrentTimeBefore: 'date',
  daysSinceCustomTime: 'int',
  customTimeBefore: 'date',
};

export function validateLifecycle(text: string): { rules: LifecycleRule[] } | { error: string } {
  let v: unknown;
  try {
    v = JSON.parse(text || '[]');
  } catch (err) {
    return { error: `Not JSON: ${(err as Error).message}` };
  }
  if (!Array.isArray(v)) return { error: 'Lifecycle rules are a JSON array.' };
  for (const [i, r] of v.entries()) {
    const at = `Rule ${i + 1}`;
    if (!isObj(r) || !isObj(r.action) || !isObj(r.condition)) return { error: `${at} needs an action and a condition.` };
    const t = r.action.type;
    if (t !== 'Delete' && t !== 'SetStorageClass' && t !== 'AbortIncompleteMultipartUpload')
      return { error: `${at}: unknown action "${String(t)}".` };
    if (t === 'SetStorageClass' && !(storageClasses as readonly unknown[]).includes(r.action.storageClass))
      return { error: `${at}: SetStorageClass needs a storageClass: ${storageClasses.join(', ')}.` };
    const keys = Object.keys(r.condition);
    if (keys.length === 0) return { error: `${at} needs at least one condition.` };
    for (const k of keys) {
      const kind = CONDITION_KEYS[k];
      const val = r.condition[k];
      if (!kind) return { error: `${at}: unknown condition "${k}".` };
      if (kind === 'int' && (!Number.isInteger(val) || (val as number) < 0)) return { error: `${at}: ${k} must be a whole number.` };
      if (kind === 'date' && !(typeof val === 'string' && DATE.test(val))) return { error: `${at}: ${k} must be a date as YYYY-MM-DD.` };
      if (kind === 'bool' && typeof val !== 'boolean') return { error: `${at}: ${k} must be true or false.` };
      if (kind === 'list' && !isStrArr(val)) return { error: `${at}: ${k} must be a list of strings.` };
    }
  }
  return { rules: v as LifecycleRule[] };
}

/** One line per rule, as the console shows it. */
export function describeRule(r: LifecycleRule): string {
  const a =
    r.action.type === 'Delete'
      ? 'Delete'
      : r.action.type === 'SetStorageClass'
        ? `Move to ${classLabel(r.action.storageClass)}`
        : 'Abort incomplete multipart uploads';
  const c = r.condition;
  const parts = [
    c.age !== undefined ? `${c.age} days after creation` : null,
    c.createdBefore ? `created before ${c.createdBefore}` : null,
    c.isLive === true ? 'live objects' : c.isLive === false ? 'noncurrent versions' : null,
    c.numNewerVersions !== undefined ? `${c.numNewerVersions} newer versions exist` : null,
    c.daysSinceNoncurrentTime !== undefined ? `${c.daysSinceNoncurrentTime} days noncurrent` : null,
    c.noncurrentTimeBefore ? `noncurrent before ${c.noncurrentTimeBefore}` : null,
    c.daysSinceCustomTime !== undefined ? `${c.daysSinceCustomTime} days after custom time` : null,
    c.customTimeBefore ? `custom time before ${c.customTimeBefore}` : null,
    c.matchesStorageClass?.length ? `class ${c.matchesStorageClass.join(' or ')}` : null,
    c.matchesPrefix?.length ? `name starts with ${c.matchesPrefix.join(' or ')}` : null,
    c.matchesSuffix?.length ? `name ends with ${c.matchesSuffix.join(' or ')}` : null,
  ].filter(Boolean);
  return `${a} when ${parts.join(', ')}`;
}

// ---- lifecycle rule form ----------------------------------------------------------------------------

interface RuleDraft {
  action: 'Delete' | 'SetStorageClass' | 'AbortIncompleteMultipartUpload';
  storageClass: (typeof storageClasses)[number];
  age: string;
  createdBefore: string;
  state: 'any' | 'live' | 'noncurrent';
  newerVersions: string;
  noncurrentDays: string;
  prefix: string;
  suffix: string;
}

const EMPTY_RULE: RuleDraft = {
  action: 'Delete',
  storageClass: 'NEARLINE',
  age: '30',
  createdBefore: '',
  state: 'any',
  newerVersions: '',
  noncurrentDays: '',
  prefix: '',
  suffix: '',
};

function ruleFromDraft(d: RuleDraft): LifecycleRule {
  const int = (s: string) => (s.trim() === '' ? undefined : Math.max(0, Math.round(Number(s))));
  const list = (s: string) => {
    const l = s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    return l.length ? l : undefined;
  };
  const condition = Object.fromEntries(
    Object.entries({
      age: int(d.age),
      createdBefore: d.createdBefore || undefined,
      isLive: d.state === 'any' ? undefined : d.state === 'live',
      numNewerVersions: int(d.newerVersions),
      daysSinceNoncurrentTime: int(d.noncurrentDays),
      matchesPrefix: list(d.prefix),
      matchesSuffix: list(d.suffix),
    }).filter(([, v]) => v !== undefined),
  ) as LifecycleRule['condition'];
  const action: LifecycleRule['action'] =
    d.action === 'SetStorageClass' ? { type: 'SetStorageClass', storageClass: d.storageClass } : { type: d.action };
  return { action, condition };
}

function RuleForm({ onAdd }: { onAdd: (r: LifecycleRule) => void }) {
  const [d, setD] = useState<RuleDraft>(EMPTY_RULE);
  const set = (p: Partial<RuleDraft>) => setD((x) => ({ ...x, ...p }));
  const rule = ruleFromDraft(d);
  const empty = Object.keys(rule.condition).length === 0;
  const num = (s: string) => s.replace(/\D/g, '');
  return (
    <div className="flex flex-col gap-3 rounded-control border border-rule p-3">
      <Legend>New rule</Legend>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Action">
          <Select
            value={d.action}
            onValueChange={(action) => set({ action })}
            options={[
              { value: 'Delete', label: 'Delete' },
              { value: 'SetStorageClass', label: 'Change storage class' },
              { value: 'AbortIncompleteMultipartUpload', label: 'Abort incomplete multipart uploads' },
            ]}
          />
        </Field>
        {d.action === 'SetStorageClass' ? (
          <Field label="To class">
            <Select
              value={d.storageClass}
              onValueChange={(storageClass) => set({ storageClass })}
              options={storageClasses.map((c) => ({ value: c, label: classLabel(c) }))}
            />
          </Field>
        ) : (
          <span />
        )}
        <Field label="Age (days)" help="Since the object was created.">
          <Input mono value={d.age} onChange={(e) => set({ age: num(e.target.value) })} inputMode="numeric" />
        </Field>
        <Field label="Created before">
          <Input mono type="date" value={d.createdBefore} onChange={(e) => set({ createdBefore: e.target.value })} />
        </Field>
        <Field label="Applies to">
          <Select
            value={d.state}
            onValueChange={(state) => set({ state })}
            options={[
              { value: 'any', label: 'Live and noncurrent' },
              { value: 'live', label: 'Live objects' },
              { value: 'noncurrent', label: 'Noncurrent versions' },
            ]}
          />
        </Field>
        <Field label="Newer versions" help="At least this many.">
          <Input mono value={d.newerVersions} onChange={(e) => set({ newerVersions: num(e.target.value) })} inputMode="numeric" />
        </Field>
        <Field label="Days noncurrent">
          <Input mono value={d.noncurrentDays} onChange={(e) => set({ noncurrentDays: num(e.target.value) })} inputMode="numeric" />
        </Field>
        <span />
        <Field label="Name prefixes" help="Comma separated.">
          <Input mono value={d.prefix} onChange={(e) => set({ prefix: e.target.value })} />
        </Field>
        <Field label="Name suffixes" help="Comma separated.">
          <Input mono value={d.suffix} onChange={(e) => set({ suffix: e.target.value })} />
        </Field>
      </div>
      <p className="m-0 text-meta text-ink-2">{empty ? 'Add at least one condition.' : describeRule(rule)}</p>
      <div>
        <Button
          icon={PlusIcon}
          disabled={empty}
          onClick={() => {
            onAdd(rule);
            setD(EMPTY_RULE);
          }}
        >
          Add rule
        </Button>
      </div>
    </div>
  );
}

// ---- configuration -----------------------------------------------------------------------------------

interface Draft {
  storageClass: (typeof storageClasses)[number];
  versioning: boolean;
  softDeleteDays: string;
  uniformAccess: boolean;
  publicAccessPrevention: boolean;
  labels: { name: string; value: string }[];
  requesterPays: boolean;
  website: boolean;
  mainPageSuffix: string;
  notFoundPage: string;
  kms: string;
  retentionDays: string;
  lifecycle: LifecycleRule[];
  lifecycleText: string;
  lifecycleAsJson: boolean;
  corsText: string;
}

const days = (sec: number | null | undefined) => (sec ? String(Math.round((sec / 86_400) * 1000) / 1000) : '');

function draftOf(b: StorageBucket): Draft {
  return {
    storageClass: (storageClasses as readonly string[]).includes(b.storageClass) ? (b.storageClass as Draft['storageClass']) : 'STANDARD',
    versioning: b.versioning,
    softDeleteDays: days(b.softDeleteSeconds) || '0',
    uniformAccess: b.uniformAccess,
    publicAccessPrevention: b.publicAccessPrevention === 'enforced',
    labels: labelRowsFrom(b.labels),
    requesterPays: b.requesterPays,
    website: !!b.website,
    mainPageSuffix: b.website?.mainPageSuffix ?? '',
    notFoundPage: b.website?.notFoundPage ?? '',
    kms: b.defaultKmsKeyName ?? '',
    retentionDays: days(b.retention?.periodSeconds),
    lifecycle: b.lifecycle,
    lifecycleText: JSON.stringify(b.lifecycle, null, 2),
    lifecycleAsJson: false,
    corsText: JSON.stringify(b.cors, null, 2),
  };
}

/** Bucket settings (SPEC-0006 D-10, CA-10). Saves only what changed. */
export function BucketConfiguration({
  projectId,
  bucket,
  readOnly,
  emulated,
}: {
  projectId: string;
  bucket: StorageBucket;
  readOnly: string | null;
  emulated: boolean;
}) {
  const invalidate = useInvalidateStorage(projectId);
  const [d, setD] = useState<Draft>(() => draftOf(bucket));
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);
  useEffect(() => setD(draftOf(bucket)), [bucket]);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const base = useMemo(() => draftOf(bucket), [bucket]);

  const lifecycle = d.lifecycleAsJson ? validateLifecycle(d.lifecycleText) : { rules: d.lifecycle };
  const cors = validateCors(d.corsText);
  const softDays = Number(d.softDeleteDays || '0');
  const softError = softDays !== 0 && (softDays < 7 || softDays > 90) ? 'Off (0), or 7 to 90 days.' : null;
  const retentionDays = d.retentionDays.trim() === '' ? null : Number(d.retentionDays);
  const locked = !!bucket.retention?.locked;
  const retentionError =
    locked && (retentionDays === null || retentionDays * 86_400 < (bucket.retention?.periodSeconds ?? 0))
      ? 'The policy is locked: its period can only grow.'
      : null;

  const patch: UpdateBucket = {};
  if (d.storageClass !== base.storageClass) patch.storageClass = d.storageClass;
  if (d.versioning !== base.versioning) patch.versioning = d.versioning;
  if (d.softDeleteDays !== base.softDeleteDays) patch.softDeleteSeconds = softDays ? Math.round(softDays * 86_400) : null;
  if (d.uniformAccess !== base.uniformAccess) patch.uniformAccess = d.uniformAccess;
  if (d.publicAccessPrevention !== base.publicAccessPrevention) patch.publicAccessPrevention = d.publicAccessPrevention;
  const labels = labelsFromRows(d.labels);
  if (JSON.stringify(labels) !== JSON.stringify(labelsFromRows(base.labels))) patch.labels = labels;
  if (d.requesterPays !== base.requesterPays) patch.requesterPays = d.requesterPays;
  if (d.website !== base.website || d.mainPageSuffix !== base.mainPageSuffix || d.notFoundPage !== base.notFoundPage)
    patch.website = d.website ? { mainPageSuffix: d.mainPageSuffix, notFoundPage: d.notFoundPage } : null;
  if (d.kms !== base.kms) patch.defaultKmsKeyName = d.kms.trim() || null;
  if (d.retentionDays !== base.retentionDays) patch.retentionSeconds = retentionDays ? Math.round(retentionDays * 86_400) : null;
  if ('rules' in lifecycle && JSON.stringify(lifecycle.rules) !== JSON.stringify(bucket.lifecycle)) patch.lifecycle = lifecycle.rules;
  if ('rules' in cors && JSON.stringify(cors.rules) !== JSON.stringify(bucket.cors)) patch.cors = cors.rules;
  const changed = Object.keys(patch).length > 0;
  const invalid = 'error' in lifecycle || 'error' in cors || !!softError || !!retentionError;
  const disabled = !!readOnly;

  const save = async () => {
    setSaving(true);
    try {
      await updateBucket(projectId, bucket.name, patch);
      toast.success(`Saved ${bucket.name}`);
      void invalidate('buckets');
    } catch (err) {
      failed('Saving the bucket')(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-8">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-rule bg-sheet px-6 py-2">
        <span className="text-meta text-ink-3">{changed ? `${Object.keys(patch).length} changed` : 'No changes'}</span>
        <span className="ml-auto flex gap-2">
          <Button onClick={() => setD(draftOf(bucket))} disabled={!changed}>
            Discard
          </Button>
          <Button
            variant="commit"
            icon={FloppyDiskIcon}
            loading={saving}
            disabled={!changed || invalid || disabled}
            disabledReason={readOnly}
            onClick={save}
          >
            Save settings
          </Button>
        </span>
      </div>
      {emulated ? (
        <Notes
          notes={[
            {
              id: 'emulator',
              tone: 'info',
              text: 'fake-gcs-server keeps versioning, but accepts and drops lifecycle rules, CORS, labels and most other settings. Real buckets keep them all.',
            },
          ]}
        />
      ) : null}

      <Section title="Storage">
        <div className="flex max-w-2xl flex-col gap-4 px-6">
          {bucket.autoclass ? (
            <p className="m-0 text-dense text-ink-2">Autoclass picks each object’s class.</p>
          ) : (
            <Field label="Default storage class" help="For new objects that do not set their own.">
              <Select
                value={d.storageClass}
                onValueChange={(storageClass) => set({ storageClass })}
                options={storageClasses.map((c) => ({ value: c, label: classLabel(c) }))}
                disabled={disabled}
              />
            </Field>
          )}
          <KeyValueEditor
            label="Labels"
            rows={d.labels}
            onChange={(labels) => set({ labels })}
            keyLabel="Label"
            keyPattern={LABEL_KEY}
            keyHint="Lowercase letters, digits, - and _."
          />
          <Switch
            checked={d.requesterPays}
            onCheckedChange={(requesterPays) => set({ requesterPays })}
            label="Requester pays"
            description="Readers pay for their own reads and transfers."
            disabled={disabled}
          />
          <Field label="Default encryption key" help="Customer-managed Cloud KMS key for new objects; empty uses Google’s.">
            <Input
              mono
              value={d.kms}
              onChange={(e) => set({ kms: e.target.value })}
              placeholder="projects/…/locations/…/keyRings/…/cryptoKeys/…"
              disabled={disabled}
            />
          </Field>
        </div>
      </Section>

      <Section title="Access">
        <div className="flex max-w-2xl flex-col gap-4 px-6">
          <Switch
            checked={d.uniformAccess}
            onCheckedChange={(uniformAccess) => set({ uniformAccess })}
            label="Uniform access"
            description="Permissions come only from IAM. Turning it off is possible for 90 days after it was turned on."
            disabled={disabled || bucket.hierarchicalNamespace}
          />
          <Switch
            checked={d.publicAccessPrevention}
            onCheckedChange={(publicAccessPrevention) => set({ publicAccessPrevention })}
            label="Prevent public access"
            description="Blocks allUsers and allAuthenticatedUsers on the bucket and its objects."
            disabled={disabled}
          />
        </div>
      </Section>

      <Section title="Data protection">
        <div className="flex max-w-2xl flex-col gap-4 px-6">
          <Switch
            checked={d.versioning}
            onCheckedChange={(versioning) => set({ versioning })}
            label="Object versioning"
            description="Overwritten and deleted objects become noncurrent versions."
            disabled={disabled || bucket.hierarchicalNamespace}
          />
          <Field
            label="Soft delete (days)"
            help="Deleted objects stay restorable for this long. 0 turns it off."
            error={softError ?? undefined}
          >
            <Input
              mono
              value={d.softDeleteDays}
              onChange={(e) => set({ softDeleteDays: e.target.value.replace(/[^\d.]/g, '') })}
              inputMode="decimal"
              disabled={disabled}
            />
          </Field>
          <Field
            label="Retention period (days)"
            help={
              locked
                ? 'Locked: the period can only grow, and the policy cannot be removed.'
                : 'Objects cannot be deleted or replaced until they are this old. Empty removes the policy.'
            }
            error={retentionError ?? undefined}
          >
            <Input
              mono
              value={d.retentionDays}
              onChange={(e) => set({ retentionDays: e.target.value.replace(/[^\d.]/g, '') })}
              inputMode="decimal"
              disabled={disabled}
            />
          </Field>
          {bucket.retention && !locked ? (
            <div className="flex flex-wrap items-center gap-3 rounded-control border border-rule bg-warn-tint px-3 py-2 text-dense text-warn-ink">
              <span className="min-w-0 flex-1">
                Locking the {duration(bucket.retention.periodSeconds * 1000)} policy is irreversible: no one, including project owners, can
                shorten or remove it, and the bucket cannot be deleted while it holds objects.
              </span>
              <Button
                icon={LockIcon}
                variant="danger"
                onClick={() => setLocking(true)}
                disabled={disabled || changed}
                disabledReason={readOnly ?? (changed ? 'Save or discard the other changes first' : null)}
              >
                Lock policy
              </Button>
            </div>
          ) : locked ? (
            <p className="m-0 flex items-center gap-2 text-dense text-ink-2">
              <LockIcon size={14} aria-hidden /> The retention policy is locked.
            </p>
          ) : null}
        </div>
      </Section>

      <Section title="Lifecycle" description="Rules Cloud Storage applies once a day to delete objects or change their class.">
        <div className="flex max-w-3xl flex-col gap-3 px-6">
          <div className="flex items-center gap-3">
            <Switch
              checked={d.lifecycleAsJson}
              onCheckedChange={(asJson) =>
                set(
                  asJson
                    ? { lifecycleAsJson: true, lifecycleText: JSON.stringify(d.lifecycle, null, 2) }
                    : 'rules' in lifecycle
                      ? { lifecycleAsJson: false, lifecycle: lifecycle.rules }
                      : {},
                )
              }
              label="Edit as JSON"
              disabled={d.lifecycleAsJson && 'error' in lifecycle}
            />
          </div>
          {d.lifecycleAsJson ? (
            <>
              <CodeEditor
                value={d.lifecycleText}
                onChange={(lifecycleText) => set({ lifecycleText })}
                language="json"
                height={280}
                label="Lifecycle rules as JSON"
              />
              {'error' in lifecycle ? <p className="m-0 text-meta text-redline-ink">{lifecycle.error}</p> : null}
            </>
          ) : (
            <>
              {d.lifecycle.length === 0 ? (
                <p className="m-0 text-meta text-ink-3">No rules.</p>
              ) : (
                <ol className="m-0 list-none border-t border-rule p-0">
                  {d.lifecycle.map((r, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rules are positional.
                    <li key={i} className="flex items-center gap-3 border-b border-rule py-1.5 text-dense">
                      <span className="text-meta text-ink-3 tnum">{i + 1}</span>
                      <span className="min-w-0 flex-1">{describeRule(r)}</span>
                      <IconButton
                        icon={TrashIcon}
                        size="sm"
                        label={`Remove rule ${i + 1}`}
                        disabled={disabled}
                        onClick={() => set({ lifecycle: d.lifecycle.filter((_, j) => j !== i) })}
                      />
                    </li>
                  ))}
                </ol>
              )}
              {!disabled ? <RuleForm onAdd={(r) => set({ lifecycle: [...d.lifecycle, r] })} /> : null}
            </>
          )}
        </div>
      </Section>

      <Section title="CORS" description="Which web origins may read this bucket from a browser.">
        <div className="flex max-w-3xl flex-col gap-2 px-6">
          <CodeEditor
            value={d.corsText}
            onChange={(corsText) => set({ corsText })}
            language="json"
            height={200}
            label="CORS rules as JSON"
            readOnly={disabled}
          />
          {'error' in cors ? (
            <p className="m-0 text-meta text-redline-ink">{cors.error}</p>
          ) : (
            <p className="m-0 text-meta text-ink-3">
              For example [{'{'}"origin": ["https://example.com"], "method": ["GET"], "responseHeader": ["Content-Type"], "maxAgeSeconds":
              3600{'}'}].
            </p>
          )}
        </div>
      </Section>

      <Section title="Website">
        <div className="flex max-w-2xl flex-col gap-4 px-6">
          <Switch
            checked={d.website}
            onCheckedChange={(website) => set({ website })}
            label="Serve as a website"
            description="Index and error pages when the bucket is served through a load balancer or storage.googleapis.com."
            disabled={disabled}
          />
          {d.website ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Index page">
                <Input
                  mono
                  value={d.mainPageSuffix}
                  onChange={(e) => set({ mainPageSuffix: e.target.value })}
                  placeholder="index.html"
                  disabled={disabled}
                />
              </Field>
              <Field label="Error page">
                <Input
                  mono
                  value={d.notFoundPage}
                  onChange={(e) => set({ notFoundPage: e.target.value })}
                  placeholder="404.html"
                  disabled={disabled}
                />
              </Field>
            </div>
          ) : null}
        </div>
      </Section>

      <ConfirmDestructive
        open={locking}
        onOpenChange={setLocking}
        title="Lock retention policy"
        consequence={`This cannot be undone. The ${duration((bucket.retention?.periodSeconds ?? 0) * 1000)} retention period can never be shortened or removed, and ${bucket.name} cannot be deleted until every object in it is older than that.`}
        expected={bucket.name}
        confirmLabel="Lock policy forever"
        command={`gcloud storage buckets update gs://${bucket.name} --lock-retention-period`}
        onConfirm={async (confirm) => {
          await lockRetention(projectId, bucket.name, bucket.metageneration ?? '', confirm);
          toast.success('Retention policy locked');
          void invalidate('buckets');
        }}
      />
    </div>
  );
}

// ---- permissions ---------------------------------------------------------------------------------------

interface BindingDraft {
  key: number;
  role: string;
  members: string;
  condition: IamBinding['condition'];
}

/** The bucket's IAM policy (D-10), saved with its etag so concurrent edits conflict instead of overwrite. */
export function BucketPermissions({ projectId, bucket, readOnly }: { projectId: string; bucket: StorageBucket; readOnly: string | null }) {
  const policy = useBucketIam(projectId, bucket.name, true);
  const [rows, setRows] = useState<BindingDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const fromPolicy = useMemo(
    () => (policy.data?.bindings ?? []).map((b, i) => ({ key: i, role: b.role, members: b.members.join('\n'), condition: b.condition })),
    [policy.data],
  );
  useEffect(() => setRows(fromPolicy), [fromPolicy]);
  if (policy.isPending) return <DelayedSkeleton rows={6} className="p-6" />;
  if (policy.error instanceof ApiError) return <ProblemState problem={policy.error.problem} onRetry={() => void policy.refetch()} />;
  const bindings = rows
    .map((r) => ({
      role: r.role.trim(),
      members: r.members
        .split(/[\n,]/)
        .map((m) => m.trim())
        .filter(Boolean),
      condition: r.condition,
    }))
    .filter((b) => b.role && b.members.length);
  const changed = JSON.stringify(bindings) !== JSON.stringify(policy.data?.bindings ?? []);
  const badMember = bindings
    .flatMap((b) => b.members)
    .find(
      (m) =>
        !/^(user|serviceAccount|group|domain|principal|principalSet|projectOwner|projectEditor|projectViewer):.+|^allUsers$|^allAuthenticatedUsers$/.test(
          m,
        ),
    );
  const publicGrant = bindings.some((b) => b.members.some((m) => m === 'allUsers' || m === 'allAuthenticatedUsers'));
  const set = (key: number, p: Partial<BindingDraft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  return (
    <div className="pb-8">
      <Section
        title="Permissions"
        description="Who can do what on this bucket, on top of project-level roles."
        actions={
          <Button
            variant="commit"
            icon={FloppyDiskIcon}
            loading={saving}
            disabled={!changed || !!badMember || !!readOnly}
            disabledReason={readOnly}
            onClick={async () => {
              setSaving(true);
              try {
                await setBucketIam(projectId, bucket.name, { etag: policy.data?.etag ?? null, bindings });
                toast.success('Permissions saved');
                void policy.refetch();
              } catch (err) {
                failed('Saving the permissions')(err);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save permissions
          </Button>
        }
      >
        <div className="flex max-w-4xl flex-col gap-3 px-6">
          {publicGrant && bucket.publicAccessPrevention === 'enforced' ? (
            <p className="m-0 text-meta text-warn-ink">
              Public access prevention is enforced, so allUsers and allAuthenticatedUsers cannot be granted.
            </p>
          ) : null}
          {badMember ? (
            <p className="m-0 text-meta text-redline-ink">
              <Mono value={badMember} /> is not a principal. Use user:, serviceAccount:, group:, domain:, allUsers or allAuthenticatedUsers.
            </p>
          ) : null}
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-[16rem_minmax(0,1fr)_2rem] items-start gap-3 border-b border-rule pb-3">
              <Field label="Role">
                <Input
                  mono
                  value={r.role}
                  onChange={(e) => set(r.key, { role: e.target.value })}
                  placeholder="roles/storage.objectViewer"
                  disabled={!!readOnly}
                />
              </Field>
              <Field label="Principals" help={r.condition ? `Condition: ${r.condition.title || r.condition.expression}` : 'One per line.'}>
                <Textarea
                  mono
                  rows={Math.min(6, Math.max(2, r.members.split('\n').length))}
                  value={r.members}
                  onChange={(e) => set(r.key, { members: e.target.value })}
                  disabled={!!readOnly}
                />
              </Field>
              <span className="pt-6">
                <IconButton
                  icon={TrashIcon}
                  size="sm"
                  label={`Remove ${r.role || 'binding'}`}
                  disabled={!!readOnly}
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                />
              </span>
            </div>
          ))}
          <div>
            <Button
              icon={PlusIcon}
              disabled={!!readOnly}
              onClick={() => setRows((rs) => [...rs, { key: Date.now(), role: '', members: '', condition: null }])}
            >
              Add role
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}
