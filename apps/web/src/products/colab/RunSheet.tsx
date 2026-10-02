import {
  COLAB_REGIONS,
  type ColabIdentity,
  type ColabJobSpec,
  type ColabSchedule,
  type SaveColabSchedule,
  toNotebookExecutionJob,
} from '@nephoscope/contracts';
import { CalendarPlusIcon, PlayIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { Legend } from '../../design/Drafting';
import { Field, Input, Select, Switch } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { useActiveProfile } from '../../state/queries';
import { formatInZone, isValidTimeZone, previewCron, timeZones } from '../scheduler/cron';
import { sameResource, shortName, useCreateExecution, useCreateSchedule, useNotebooks, useTemplates, useUpdateSchedule } from './api';
import { machineSummary, useOnOpen } from './common';

/** The notebook a run starts from, when the sheet opens from a notebook page. */
export interface RunNotebook {
  name: string;
  displayName: string;
  location: string;
  headSha: string | null;
}

interface FormState {
  region: string;
  sourceKind: 'notebook' | 'gcs';
  notebook: string;
  pin: boolean;
  gcsUri: string;
  displayName: string;
  id: string;
  template: string;
  outputUri: string;
  identityKind: ColabIdentity['kind'];
  email: string;
  timeoutHours: string;
  kernelName: string;
  cron: string;
  timeZone: string;
  maxConcurrent: string;
  maxRuns: string;
  endTime: string;
  allowQueueing: boolean;
}

/** "TZ=America/Sao_Paulo 0 3 * * *" into its zone and expression. */
export function splitCron(cron: string): { zone: string | null; expression: string } {
  const m = /^(?:CRON_TZ|TZ)=(\S+)\s+(.*)$/.exec(cron.trim());
  return m ? { zone: m[1] ?? null, expression: m[2] ?? '' } : { zone: null, expression: cron.trim() };
}

const localInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface RunSheetProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'run' | 'schedule';
  /** The schedule to edit; mode must be "schedule". */
  schedule?: ColabSchedule | null;
  notebook?: RunNotebook | null;
  /** Region to start with when nothing else fixes it. */
  region?: string;
  readOnlyReason: string | null;
}

/** Run a notebook now, or create and edit the schedule that runs it (SPEC-0010 D-08, CA-05, CA-06). */
export function RunSheet({ projectId, open, onOpenChange, mode, schedule = null, notebook = null, region, readOnlyReason }: RunSheetProps) {
  const { profile } = useActiveProfile();
  const userIdentity = profile?.type === 'authorized_user';
  const start = useMemo<FormState>(() => {
    const job = schedule?.job;
    const src = job?.source;
    const cron = splitCron(schedule?.cron ?? '0 3 * * *');
    const fixedRegion = schedule?.location ?? notebook?.location ?? null;
    return {
      region: fixedRegion ?? (region && region !== 'all' ? region : 'us-central1'),
      sourceKind: src?.kind === 'gcs' ? 'gcs' : 'notebook',
      notebook: src?.kind === 'notebook' ? src.repository : (notebook?.name ?? ''),
      pin: src?.kind === 'notebook' ? !!src.commitSha : false,
      gcsUri: src?.kind === 'gcs' ? src.uri : '',
      displayName: (mode === 'schedule' ? schedule?.displayName : null) ?? notebook?.displayName.replace(/\.ipynb$/, '') ?? '',
      id: '',
      template: job?.template ?? '',
      outputUri: job?.outputUri ?? '',
      identityKind:
        job?.identity.kind === 'user'
          ? 'user'
          : job?.identity.kind === 'serviceAccount'
            ? 'serviceAccount'
            : userIdentity
              ? 'user'
              : 'serviceAccount',
      email: job?.identity.email ?? profile?.principal ?? '',
      timeoutHours: job?.timeoutSeconds ? String(job.timeoutSeconds / 3600) : '24',
      kernelName: job?.kernelName ?? '',
      cron: cron.expression,
      // A stored cron without a zone runs in UTC; only a new schedule starts in the browser's zone.
      timeZone: cron.zone ?? (schedule ? 'Etc/UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC'),
      maxConcurrent: String(schedule?.maxConcurrentRunCount ?? 1),
      maxRuns: schedule?.maxRunCount ? String(schedule.maxRunCount) : '',
      endTime: localInput(schedule?.endTime ?? null),
      allowQueueing: schedule?.allowQueueing ?? false,
    };
  }, [schedule, notebook, region, mode, profile, userIdentity]);
  const [f, setF] = useState(start);
  const [touched, setTouched] = useState(false);
  useOnOpen(open, () => {
    setF(start);
    setTouched(false);
  });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const regionFixed = !!schedule || !!notebook;
  const templates = useTemplates(projectId, f.region, open);
  const notebooks = useNotebooks(projectId, f.region, open && !notebook && f.sourceKind === 'notebook');
  const run = useCreateExecution(projectId);
  const create = useCreateSchedule(projectId);
  const update = useUpdateSchedule(projectId, schedule?.location ?? '', schedule?.id ?? '');
  const zones = useMemo(() => timeZones(), []);
  const zoneOk = isValidTimeZone(f.timeZone);
  const preview = useMemo(() => previewCron(f.cron, zoneOk ? f.timeZone : 'Etc/UTC'), [f.cron, f.timeZone, zoneOk]);

  const commitSha = f.pin && notebook?.headSha && f.notebook === notebook.name ? notebook.headSha : undefined;
  const keepSha = schedule?.job.source.kind === 'notebook' && f.pin ? (schedule.job.source.commitSha ?? undefined) : undefined;
  const spec: ColabJobSpec = {
    displayName: f.displayName.trim(),
    source:
      f.sourceKind === 'notebook'
        ? { kind: 'notebook', repository: f.notebook, ...((commitSha ?? keepSha) ? { commitSha: commitSha ?? keepSha } : {}) }
        : { kind: 'gcs', uri: f.gcsUri.trim() },
    template: f.template,
    outputUri: f.outputUri.trim(),
    identity: { kind: f.identityKind, email: f.email.trim() },
    timeoutSeconds: Math.max(60, Math.round(Number(f.timeoutHours || '24') * 3600)),
    kernelName: f.kernelName.trim(),
  };

  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!spec.displayName) errors.displayName = 'A name for the run.';
  if (f.sourceKind === 'notebook' && !f.notebook) errors.notebook = 'Pick a notebook.';
  if (f.sourceKind === 'gcs' && !/^gs:\/\/[^/]+\/.+\.ipynb$/.test(spec.source.kind === 'gcs' ? spec.source.uri : ''))
    errors.gcsUri = 'A notebook such as gs://bucket/path/report.ipynb.';
  if (!f.template) errors.template = 'Pick a runtime template.';
  if (!/^gs:\/\/[a-z0-9][a-z0-9._-]{1,220}(\/.*)?$/.test(spec.outputUri))
    errors.outputUri = 'A Cloud Storage location such as gs://bucket/results.';
  if (!spec.identity.email.includes('@')) errors.email = 'An email address.';
  if (!(Number(f.timeoutHours) > 0 && Number(f.timeoutHours) <= 168)) errors.timeoutHours = 'Between a minute and 168 hours.';
  if (mode === 'run' && f.id && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(f.id)) errors.id = 'Lowercase letters, digits and hyphens.';
  if (mode === 'schedule') {
    if (!preview.valid) errors.cron = preview.error ?? 'Invalid schedule';
    if (!zoneOk) errors.timeZone = 'Not a time zone Nephoscope knows, such as America/Sao_Paulo.';
    if (!(Number(f.maxConcurrent) >= 1 && Number(f.maxConcurrent) <= 100)) errors.maxConcurrent = '1 to 100.';
    if (f.maxRuns && !(Number(f.maxRuns) >= 1)) errors.maxRuns = 'At least 1, or empty for no limit.';
  }
  const valid = Object.keys(errors).length === 0;
  const err = (k: keyof FormState) => (touched ? errors[k] : undefined);

  const scheduleBody: SaveColabSchedule = {
    displayName: spec.displayName,
    cron: `TZ=${f.timeZone} ${f.cron.trim()}`,
    maxConcurrentRunCount: Number(f.maxConcurrent) || 1,
    maxRunCount: f.maxRuns ? Number(f.maxRuns) : undefined,
    endTime: f.endTime ? new Date(f.endTime).toISOString() : undefined,
    allowQueueing: f.allowQueueing,
    job: spec,
  };
  const host = `https://${f.region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${f.region}`;
  const rest =
    mode === 'run'
      ? {
          method: 'POST',
          url: `${host}/notebookExecutionJobs${f.id ? `?notebookExecutionJobId=${f.id}` : ''}`,
          body: toNotebookExecutionJob(spec),
        }
      : {
          method: schedule ? 'PATCH' : 'POST',
          url: schedule ? `${host}/schedules/${schedule.id}?updateMask=<the changed fields>` : `${host}/schedules`,
          body: {
            displayName: scheduleBody.displayName,
            cron: scheduleBody.cron,
            maxConcurrentRunCount: String(scheduleBody.maxConcurrentRunCount),
            ...(scheduleBody.maxRunCount ? { maxRunCount: String(scheduleBody.maxRunCount) } : {}),
            ...(scheduleBody.endTime ? { endTime: scheduleBody.endTime } : {}),
            allowQueueing: scheduleBody.allowQueueing,
            createNotebookExecutionJobRequest: {
              parent: `projects/${projectId}/locations/${f.region}`,
              notebookExecutionJob: toNotebookExecutionJob(spec),
            },
          },
        };
  const busy = run.isPending || create.isPending || update.isPending;
  const submit = () => {
    setTouched(true);
    if (!valid) return;
    const done = { onSuccess: () => onOpenChange(false) };
    if (mode === 'run') run.mutate({ ...spec, region: f.region, id: f.id || undefined }, done);
    else if (schedule) update.mutate(scheduleBody, done);
    else create.mutate({ ...scheduleBody, region: f.region }, done);
  };

  const templateOptions = (templates.data?.items ?? []).map((t) => ({
    value: t.name,
    label: `${t.displayName} (${machineSummary(t.machine)})`,
  }));
  // Google names the project by number in stored requests; the lists name it by id.
  const templateValue = templateOptions.find((o) => sameResource(o.value, f.template))?.value ?? f.template;
  if (f.template && templateValue === f.template && !templateOptions.some((o) => o.value === f.template))
    templateOptions.unshift({ value: f.template, label: shortName(f.template) });
  const notebookOptions = (notebooks.data?.items ?? []).map((n) => ({ value: n.name, label: n.displayName }));
  const notebookValue = notebookOptions.find((o) => sameResource(o.value, f.notebook))?.value ?? f.notebook;
  if (f.notebook && !notebook && notebookValue === f.notebook && !notebookOptions.some((o) => o.value === f.notebook))
    notebookOptions.unshift({ value: f.notebook, label: shortName(f.notebook) });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'run' ? 'Run notebook' : schedule ? `Edit ${schedule.displayName}` : 'Schedule notebook'}
      description={
        mode === 'run'
          ? 'Runs the notebook once on a runtime from the template and writes the executed notebook to Cloud Storage.'
          : 'Runs the notebook on a cron schedule; each run is an execution.'
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={mode === 'run' ? PlayIcon : CalendarPlusIcon}
            loading={busy}
            disabled={!!readOnlyReason}
            disabledReason={readOnlyReason}
            onClick={submit}
          >
            {mode === 'run' ? 'Run' : schedule ? 'Save schedule' : 'Create schedule'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" error={err('displayName')} required>
            <Input value={f.displayName} onChange={(e) => set('displayName', e.target.value)} autoFocus />
          </Field>
          <Field label="Region" help={regionFixed ? 'The region of the notebook.' : undefined}>
            {regionFixed ? (
              <Input mono value={f.region} readOnly />
            ) : (
              <Select<string>
                value={f.region}
                onValueChange={(v) => setF((p) => ({ ...p, region: v, template: '', notebook: '' }))}
                options={COLAB_REGIONS.map((r) => ({ value: r, label: r }))}
              />
            )}
          </Field>
        </div>

        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <Legend as="p" className="m-0">
            Notebook
          </Legend>
          {notebook ? (
            <div className="flex flex-col gap-2">
              <span className="text-dense text-ink">{notebook.displayName}</span>
              {notebook.headSha ? (
                <Switch
                  checked={f.pin}
                  onCheckedChange={(v) => set('pin', v)}
                  label={`Pin this version (${notebook.headSha.slice(0, 7)})`}
                  description={
                    mode === 'schedule'
                      ? 'Off: every run reads the latest version at that moment.'
                      : 'Off: the run reads the latest version when it starts.'
                  }
                />
              ) : null}
            </div>
          ) : (
            <>
              <Field label="Source" className="max-w-xs">
                <Select<'notebook' | 'gcs'>
                  value={f.sourceKind}
                  onValueChange={(v) => set('sourceKind', v)}
                  options={[
                    { value: 'notebook', label: 'Colab notebook' },
                    { value: 'gcs', label: 'File in Cloud Storage' },
                  ]}
                />
              </Field>
              {f.sourceKind === 'notebook' ? (
                <Field
                  label="Notebook"
                  error={err('notebook')}
                  help={notebooks.data && notebookOptions.length === 0 ? `No notebooks in ${f.region}.` : undefined}
                  required
                >
                  <Select<string> value={notebookValue} onValueChange={(v) => set('notebook', v)} options={notebookOptions} />
                </Field>
              ) : null}
              {f.sourceKind === 'notebook' && schedule?.job.source.kind === 'notebook' && schedule.job.source.commitSha ? (
                <Switch
                  checked={f.pin}
                  onCheckedChange={(v) => set('pin', v)}
                  label={`Keep version ${schedule.job.source.commitSha.slice(0, 7)}`}
                  description="Off: every run reads the latest version at that moment."
                />
              ) : null}
              {f.sourceKind === 'notebook' ? null : (
                <Field label="Notebook file" error={err('gcsUri')} required>
                  <Input
                    mono
                    value={f.gcsUri}
                    onChange={(e) => set('gcsUri', e.target.value)}
                    placeholder="gs://bucket/notebooks/report.ipynb"
                  />
                </Field>
              )}
            </>
          )}
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <Legend as="p" className="m-0">
            Runtime and output
          </Legend>
          <Field
            label="Runtime template"
            error={err('template')}
            help={
              templates.data && templateOptions.length === 0
                ? `No runtime templates in ${f.region}; create one on the Runtime templates tab.`
                : undefined
            }
            required
          >
            <Select<string> value={templateValue} onValueChange={(v) => set('template', v)} options={templateOptions} />
          </Field>
          <Field label="Output location" error={err('outputUri')} help="The executed notebook is written under this folder." required>
            <Input mono value={f.outputUri} onChange={(e) => set('outputUri', e.target.value)} placeholder="gs://bucket/colab-results" />
          </Field>
          <div className="grid grid-cols-[12rem_1fr] gap-3">
            <Field label="Run as">
              <Select<ColabIdentity['kind']>
                value={f.identityKind}
                onValueChange={(v) => set('identityKind', v)}
                options={[
                  { value: 'serviceAccount', label: 'Service account' },
                  { value: 'user', label: 'User' },
                ]}
              />
            </Field>
            <Field
              label={f.identityKind === 'user' ? 'User email' : 'Service account email'}
              error={err('email')}
              help={f.identityKind === 'user' ? 'Runs with that user’s credentials; Colab runtimes only.' : undefined}
              required
            >
              <Input mono value={f.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Timeout (hours)" error={err('timeoutHours')}>
              <Input
                mono
                value={f.timeoutHours}
                onChange={(e) => set('timeoutHours', e.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
              />
            </Field>
            <Field label="Kernel" help="Leave empty for the notebook's default kernel.">
              <Input mono value={f.kernelName} onChange={(e) => set('kernelName', e.target.value)} placeholder="python3" />
            </Field>
          </div>
          {mode === 'run' ? (
            <Field label="Execution ID" error={err('id')} help="Leave empty to let Google choose one.">
              <Input mono value={f.id} onChange={(e) => set('id', e.target.value)} />
            </Field>
          ) : null}
        </fieldset>

        {mode === 'schedule' ? (
          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <Legend as="p" className="m-0">
              Schedule
            </Legend>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Cron expression"
                error={err('cron') ?? (preview.valid ? undefined : preview.error)}
                help={preview.description ?? undefined}
                required
              >
                <Input mono value={f.cron} onChange={(e) => set('cron', e.target.value)} placeholder="0 3 * * 1-5" />
              </Field>
              <Field label="Time zone" error={err('timeZone')} required>
                <Input mono value={f.timeZone} onChange={(e) => set('timeZone', e.target.value)} list="nephoscope-colab-zones" />
              </Field>
              <datalist id="nephoscope-colab-zones">
                {zones.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </div>
            {preview.valid ? (
              <ol aria-label="Next runs" className="m-0 flex list-none flex-col gap-0.5 p-0 font-mono text-[12px] text-ink-2">
                {preview.next.map((d) => (
                  <li key={d.toISOString()}>{formatInZone(d, f.timeZone)}</li>
                ))}
              </ol>
            ) : null}
            <div className="grid grid-cols-3 gap-3">
              <Field label="Concurrent runs" error={err('maxConcurrent')}>
                <Input
                  mono
                  value={f.maxConcurrent}
                  onChange={(e) => set('maxConcurrent', e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Stop after runs" error={err('maxRuns')} help="Empty: no limit.">
                <Input mono value={f.maxRuns} onChange={(e) => set('maxRuns', e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" />
              </Field>
              <Field label="End" help="Empty: never.">
                <Input type="datetime-local" value={f.endTime} onChange={(e) => set('endTime', e.target.value)} />
              </Field>
            </div>
            <Switch
              checked={f.allowQueueing}
              onCheckedChange={(v) => set('allowQueueing', v)}
              label="Queue runs over the limit"
              description="Off: a run is skipped when the concurrent limit is reached."
            />
          </fieldset>
        ) : null}
        <EquivalentCommand rest={rest} />
      </div>
    </Sheet>
  );
}
