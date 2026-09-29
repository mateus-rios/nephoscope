import type { SaveSchedulerJob, SchedulerJob, SchedulerTarget } from '@nephoscope/contracts';
import { CalendarPlusIcon } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { CodeEditor } from '../../design/code/CodeEditor';
import { Legend } from '../../design/Drafting';
import { Field, Input, Select } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { EquivalentCommand, sh } from '../../kit/EquivalentCommand';
import { KeyValueEditor } from '../../kit/KeyValueEditor';
import { RUN_REGIONS } from '../run/DeploySheet';
import { useCreateSchedulerJob, useUpdateSchedulerJob } from './api';
import { formatInZone, isValidTimeZone, previewCron, timeZones } from './cron';

type Kind = SchedulerTarget['kind'];
type AuthKind = 'none' | 'oidc' | 'oauth';
type Row = { name: string; value: string };

/** Values a shortcut fills in (SPEC-0003 D-12, CA-13, CA-23). */
export interface JobPrefill {
  id?: string;
  region?: string;
  description?: string;
  target: SchedulerTarget;
}

interface FormState {
  id: string;
  region: string;
  description: string;
  schedule: string;
  timeZone: string;
  kind: Kind;
  uri: string;
  method: typeof import('@nephoscope/contracts').httpMethods[number];
  headers: Row[];
  body: string;
  authKind: AuthKind;
  serviceAccount: string;
  audience: string;
  scope: string;
  topic: string;
  attributes: Row[];
  relativeUri: string;
  retryCount: string;
  deadline: string;
}

const toRows = (m: Record<string, string>): Row[] => Object.entries(m).map(([name, value]) => ({ name, value }));
const fromRows = (rows: Row[]) => Object.fromEntries(rows.filter((r) => r.name.trim()).map((r) => [r.name.trim(), r.value]));

function initial(job: SchedulerJob | null, prefill: JobPrefill | null): FormState {
  const t = job?.target ?? prefill?.target ?? { kind: 'http', uri: '', method: 'POST', headers: {}, body: '', auth: { kind: 'none' } };
  return {
    id: prefill?.id ?? '',
    region: prefill?.region ?? 'us-central1',
    description: job?.description ?? prefill?.description ?? '',
    schedule: job?.schedule ?? '0 * * * *',
    timeZone: job?.timeZone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC'),
    kind: t.kind,
    uri: t.kind === 'http' ? t.uri : '',
    method: t.kind === 'pubsub' ? 'POST' : t.method,
    headers: t.kind === 'pubsub' ? [] : toRows(t.headers),
    body: t.kind === 'pubsub' ? t.data : t.body,
    authKind: t.kind === 'http' ? t.auth.kind : 'none',
    serviceAccount: t.kind === 'http' && t.auth.kind !== 'none' ? t.auth.serviceAccount : '',
    audience: t.kind === 'http' && t.auth.kind === 'oidc' ? (t.auth.audience ?? '') : '',
    scope: t.kind === 'http' && t.auth.kind === 'oauth' ? (t.auth.scope ?? '') : '',
    topic: t.kind === 'pubsub' ? t.topic : '',
    attributes: t.kind === 'pubsub' ? toRows(t.attributes) : [],
    relativeUri: t.kind === 'appengine' ? t.relativeUri : '/',
    retryCount: String(job?.retry.retryCount ?? 0),
    deadline: job?.attemptDeadlineSeconds ? String(job.attemptDeadlineSeconds) : '',
  };
}

function toBody(f: FormState): SaveSchedulerJob {
  const headers = fromRows(f.headers);
  const target: SchedulerTarget =
    f.kind === 'pubsub'
      ? { kind: 'pubsub', topic: f.topic.trim(), data: f.body, attributes: fromRows(f.attributes) }
      : f.kind === 'appengine'
        ? { kind: 'appengine', relativeUri: f.relativeUri.trim() || '/', method: f.method, headers, body: f.body }
        : {
            kind: 'http',
            uri: f.uri.trim(),
            method: f.method,
            headers,
            body: f.body,
            auth:
              f.authKind === 'oidc'
                ? { kind: 'oidc', serviceAccount: f.serviceAccount.trim(), audience: f.audience.trim() || undefined }
                : f.authKind === 'oauth'
                  ? { kind: 'oauth', serviceAccount: f.serviceAccount.trim(), scope: f.scope.trim() || undefined }
                  : { kind: 'none' },
          };
  return {
    description: f.description,
    schedule: f.schedule.trim(),
    timeZone: f.timeZone,
    target,
    retry: { retryCount: Number(f.retryCount) || 0 },
    attemptDeadlineSeconds: f.deadline.trim() ? Number(f.deadline) : undefined,
  };
}

function gcloud(projectId: string, f: FormState, create: boolean): string {
  const verb = create ? 'create' : 'update';
  const kind = f.kind === 'appengine' ? 'app-engine' : f.kind;
  const parts = [
    `gcloud scheduler jobs ${verb} ${kind} ${f.id || 'JOB'}`,
    `--location=${f.region}`,
    `--project=${projectId}`,
    `--schedule=${sh(f.schedule)}`,
    `--time-zone=${sh(f.timeZone)}`,
  ];
  if (f.kind === 'http') {
    parts.push(`--uri=${sh(f.uri)}`, `--http-method=${f.method}`);
    if (f.authKind === 'oidc') parts.push(`--oidc-service-account-email=${f.serviceAccount}`);
    if (f.authKind === 'oauth') parts.push(`--oauth-service-account-email=${f.serviceAccount}`);
    if (f.body) parts.push(`--message-body=${sh(f.body)}`);
  } else if (f.kind === 'pubsub') {
    parts.push(`--topic=${f.topic.split('/').pop()}`, `--message-body=${sh(f.body)}`);
  } else {
    parts.push(`--relative-url=${f.relativeUri}`, `--http-method=${f.method}`);
  }
  return parts.join(' \\\n  ');
}

interface JobSheetProps {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The job to edit; null creates a new one. */
  job: SchedulerJob | null;
  prefill?: JobPrefill | null;
  readOnlyReason: string | null;
}

/** Create and edit Scheduler jobs, with cron preview while typing (SPEC-0003 D-12, CA-25). */
export function JobSheet({ projectId, open, onOpenChange, job, prefill = null, readOnlyReason }: JobSheetProps) {
  const create = job === null;
  const start = useMemo(() => initial(job, prefill), [job, prefill]);
  const [f, setF] = useState(start);
  const [touched, setTouched] = useState(false);
  const createJob = useCreateSchedulerJob(projectId);
  const updateJob = useUpdateSchedulerJob(projectId, job?.location ?? '', job?.id ?? '');
  const navigate = useNavigate();
  useEffect(() => {
    if (open) {
      setF(start);
      setTouched(false);
    }
  }, [open, start]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const zoneOk = isValidTimeZone(f.timeZone);
  const preview = useMemo(() => previewCron(f.schedule, zoneOk ? f.timeZone : 'Etc/UTC'), [f.schedule, f.timeZone, zoneOk]);
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = useMemo(() => timeZones(), []);

  const errors: Partial<Record<keyof FormState, string>> = {};
  if (create && !/^[A-Za-z0-9_-]{1,500}$/.test(f.id)) errors.id = 'Letters, digits, hyphens and underscores.';
  if (!preview.valid) errors.schedule = preview.error ?? 'Invalid schedule';
  if (!zoneOk) errors.timeZone = 'Not a time zone Nephoscope knows, such as America/Sao_Paulo.';
  if (f.kind === 'http' && !/^https?:\/\/.+/.test(f.uri.trim())) errors.uri = 'A full URL, starting with https://.';
  if (f.kind === 'http' && f.authKind !== 'none' && !f.serviceAccount.includes('@')) errors.serviceAccount = 'A service account email.';
  if (f.kind === 'pubsub' && !/^projects\/[^/]+\/topics\/[^/]+$/.test(f.topic.trim()))
    errors.topic = 'A topic such as projects/p/topics/t.';
  const valid = Object.keys(errors).length === 0;
  const err = (k: keyof FormState) => (touched ? errors[k] : undefined);
  const busy = createJob.isPending || updateJob.isPending;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={create ? 'Create Scheduler job' : `Edit ${job?.id}`}
      description="Runs a target on a cron schedule."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={CalendarPlusIcon}
            loading={busy}
            disabled={!!readOnlyReason}
            disabledReason={readOnlyReason}
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              const body = toBody(f);
              if (create) {
                createJob.mutate(
                  { ...body, id: f.id, region: f.region },
                  {
                    onSuccess: (j) => {
                      onOpenChange(false);
                      void navigate({ to: `/p/${projectId}/scheduler/${j.location}/${j.id}` as string });
                    },
                  },
                );
              } else updateJob.mutate(body, { onSuccess: () => onOpenChange(false) });
            }}
          >
            {create ? 'Create job' : 'Save job'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {create ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={err('id')} required>
              <Input mono value={f.id} onChange={(e) => set('id', e.target.value)} autoFocus />
            </Field>
            <Field label="Region" required>
              <Input mono value={f.region} onChange={(e) => set('region', e.target.value)} list="nephoscope-scheduler-regions" />
            </Field>
            <datalist id="nephoscope-scheduler-regions">
              {RUN_REGIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
        ) : null}
        <Field label="Description">
          <Input value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <Legend as="p" className="m-0">
            Schedule
          </Legend>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Cron expression"
              error={err('schedule') ?? (preview.valid ? undefined : preview.error)}
              help={preview.description ?? undefined}
              required
            >
              <Input mono value={f.schedule} onChange={(e) => set('schedule', e.target.value)} placeholder="0 */2 * * 1-5" />
            </Field>
            <Field label="Time zone" error={err('timeZone')} required>
              <Input mono value={f.timeZone} onChange={(e) => set('timeZone', e.target.value)} list="nephoscope-time-zones" />
            </Field>
            <datalist id="nephoscope-time-zones">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </div>
          {preview.valid ? (
            <table aria-label="Next runs" className="border-collapse text-dense">
              <thead>
                <tr>
                  <th className="legend py-1 pr-6 text-left">Next runs in {f.timeZone}</th>
                  {localZone !== f.timeZone ? <th className="legend py-1 text-left">Your time ({localZone})</th> : null}
                </tr>
              </thead>
              <tbody>
                {preview.next.map((d) => (
                  <tr key={d.toISOString()} className="border-t border-rule">
                    <td className="tnum py-1 pr-6 font-mono text-[12px]">{formatInZone(d, f.timeZone)}</td>
                    {localZone !== f.timeZone ? (
                      <td className="tnum py-1 font-mono text-[12px] text-ink-2">{formatInZone(d, localZone)}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </fieldset>
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <Legend as="p" className="m-0">
            Target
          </Legend>
          <Field label="Target type" className="max-w-xs">
            <Select<Kind>
              value={f.kind}
              onValueChange={(v) => set('kind', v)}
              options={[
                { value: 'http', label: 'HTTP' },
                { value: 'pubsub', label: 'Pub/Sub' },
                { value: 'appengine', label: 'App Engine HTTP' },
              ]}
            />
          </Field>
          {f.kind === 'http' ? (
            <>
              <div className="grid grid-cols-[7rem_1fr] gap-3">
                <Field label="Method">
                  <Select
                    value={f.method}
                    onValueChange={(v) => set('method', v)}
                    options={['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => ({
                      value: m as FormState['method'],
                      label: m,
                    }))}
                  />
                </Field>
                <Field label="URL" error={err('uri')} required>
                  <Input mono value={f.uri} onChange={(e) => set('uri', e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Authentication" help="OIDC for Cloud Run and functions URLs; OAuth for Google APIs.">
                  <Select<AuthKind>
                    value={f.authKind}
                    onValueChange={(v) => set('authKind', v)}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'oidc', label: 'OIDC token' },
                      { value: 'oauth', label: 'OAuth token' },
                    ]}
                  />
                </Field>
                {f.authKind !== 'none' ? (
                  <Field label="Service account" error={err('serviceAccount')}>
                    <Input mono value={f.serviceAccount} onChange={(e) => set('serviceAccount', e.target.value)} />
                  </Field>
                ) : null}
              </div>
            </>
          ) : null}
          {f.kind === 'pubsub' ? (
            <>
              <Field label="Topic" error={err('topic')} required>
                <Input
                  mono
                  value={f.topic}
                  onChange={(e) => set('topic', e.target.value)}
                  placeholder={`projects/${projectId}/topics/name`}
                />
              </Field>
              <KeyValueEditor label="Attributes" keyLabel="Attribute" rows={f.attributes} onChange={(r) => set('attributes', r)} />
            </>
          ) : null}
          {f.kind === 'appengine' ? (
            <div className="grid grid-cols-[7rem_1fr] gap-3">
              <Field label="Method">
                <Select
                  value={f.method}
                  onValueChange={(v) => set('method', v)}
                  options={['POST', 'GET', 'PUT', 'DELETE'].map((m) => ({ value: m as FormState['method'], label: m }))}
                />
              </Field>
              <Field label="Relative URL">
                <Input mono value={f.relativeUri} onChange={(e) => set('relativeUri', e.target.value)} />
              </Field>
            </div>
          ) : null}
          {f.kind !== 'pubsub' ? (
            <KeyValueEditor label="Headers" keyLabel="Header" rows={f.headers} onChange={(r) => set('headers', r)} />
          ) : null}
          {f.method !== 'GET' || f.kind === 'pubsub' ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-dense font-medium text-ink">{f.kind === 'pubsub' ? 'Message' : 'Body'}</span>
              <CodeEditor
                value={f.body}
                onChange={(v) => set('body', v)}
                language="json"
                height={140}
                label={f.kind === 'pubsub' ? 'Message data' : 'Request body'}
              />
            </div>
          ) : null}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Retries" help="Attempts after a failure, 0 to 5.">
            <Input
              mono
              value={f.retryCount}
              onChange={(e) => set('retryCount', e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
            />
          </Field>
          <Field label="Attempt deadline (s)" help="15 to 1800. Leave empty for the default.">
            <Input mono value={f.deadline} onChange={(e) => set('deadline', e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" />
          </Field>
        </div>
        <EquivalentCommand gcloud={gcloud(projectId, f, create)} />
      </div>
    </Sheet>
  );
}
