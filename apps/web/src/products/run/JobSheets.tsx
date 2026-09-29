import type { ExecuteJob, RunJob, UpdateJob } from '@nephoscope/contracts';
import { PlayIcon } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { Legend } from '../../design/Drafting';
import { Field, Input, Select, Switch, Textarea } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { ENV_KEY, envFromRows, envRowsFrom, KeyValueEditor, LABEL_KEY, labelRowsFrom, labelsFromRows } from '../../kit/KeyValueEditor';
import { useExecuteJob, useUpdateJob } from './api';
import { executeCommand } from './commands';
import { runRoutes } from './common';
import { ImagePicker } from './ImagePicker';

type Row = { name: string; value: string; secret?: { secret: string; version: string } | null };
const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** Execute with overrides (SPEC-0003 D-06, CA-10). */
export function ExecuteSheet({
  projectId,
  job,
  open,
  onOpenChange,
  readOnlyReason,
}: {
  projectId: string;
  job: RunJob;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnlyReason: string | null;
}) {
  const container = job.containers[0];
  const [overrideArgs, setOverrideArgs] = useState(false);
  const [args, setArgs] = useState('');
  const [env, setEnv] = useState<Row[]>([]);
  const [tasks, setTasks] = useState('');
  const [timeout, setTimeout_] = useState('');
  const mutation = useExecuteJob(projectId, job.location, job.id);
  const navigate = useNavigate();
  useEffect(() => {
    if (open) {
      setOverrideArgs(false);
      setArgs((container?.args ?? []).join('\n'));
      setEnv([]);
      setTasks('');
      setTimeout_('');
    }
  }, [open, container]);

  const body: ExecuteJob = {};
  if (overrideArgs) body.args = lines(args);
  const envOverrides = env.filter((e) => e.name.trim()).map((e) => ({ name: e.name.trim(), value: e.value }));
  if (envOverrides.length > 0) body.env = envOverrides;
  if (tasks.trim()) body.taskCount = Number(tasks);
  if (timeout.trim()) body.timeoutSeconds = Number(timeout);
  if (container?.name && (body.args || body.env)) body.containerName = container.name;
  const errors: string[] = [];
  if (tasks.trim() && !(Number.isInteger(Number(tasks)) && Number(tasks) >= 1 && Number(tasks) <= 10_000))
    errors.push('Tasks must be a whole number from 1 to 10000.');
  if (timeout.trim() && !(Number.isInteger(Number(timeout)) && Number(timeout) >= 1))
    errors.push('The timeout must be a whole number of seconds.');
  if (env.some((e) => e.name && !ENV_KEY.test(e.name))) errors.push('Variable names use letters, digits and underscores.');

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Execute ${job.id}`}
      description="Overrides apply to this execution only; the job keeps its configuration."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PlayIcon}
            loading={mutation.isPending}
            disabled={errors.length > 0 || !!readOnlyReason}
            disabledReason={readOnlyReason ?? errors[0]}
            onClick={() =>
              mutation.mutate(body, {
                onSuccess: (r) => {
                  onOpenChange(false);
                  const execution = r.execution?.split('/').pop();
                  if (execution) void navigate({ to: runRoutes(projectId).execution(job.location, job.id, execution) });
                },
              })
            }
          >
            Execute job
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Switch
          checked={overrideArgs}
          onCheckedChange={setOverrideArgs}
          label="Override the arguments"
          description={`The job runs with ${container?.args.length ? container.args.join(' ') : 'no arguments'} unless you override them.`}
        />
        {overrideArgs ? (
          <Field label="Arguments" help="One argument per line. Empty runs without arguments.">
            <Textarea mono rows={4} value={args} onChange={(e) => setArgs(e.target.value)} />
          </Field>
        ) : null}
        <KeyValueEditor
          label="Extra or changed environment variables"
          rows={env}
          onChange={setEnv}
          keyPattern={ENV_KEY}
          keyHint="Letters, digits and underscores"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tasks" help={`The job runs ${job.taskCount} ${job.taskCount === 1 ? 'task' : 'tasks'}.`}>
            <Input mono value={tasks} onChange={(e) => setTasks(e.target.value)} inputMode="numeric" placeholder={String(job.taskCount)} />
          </Field>
          <Field label="Task timeout (s)" help={job.timeoutSeconds ? `The job uses ${job.timeoutSeconds} s.` : undefined}>
            <Input
              mono
              value={timeout}
              onChange={(e) => setTimeout_(e.target.value)}
              inputMode="numeric"
              placeholder={job.timeoutSeconds ? String(job.timeoutSeconds) : ''}
            />
          </Field>
        </div>
        {errors.map((e) => (
          <p key={e} className="m-0 text-meta text-redline-ink">
            {e}
          </p>
        ))}
        <EquivalentCommand {...executeCommand(projectId, job.location, job.id, body)} />
      </div>
    </Sheet>
  );
}

interface JobForm {
  image: string;
  command: string;
  args: string;
  env: Row[];
  cpu: string;
  memory: string;
  taskCount: string;
  parallelism: string;
  maxRetries: string;
  timeout: string;
  serviceAccount: string;
  execEnv: 'UNSPECIFIED' | 'GEN1' | 'GEN2';
  labels: Row[];
}

function jobForm(job: RunJob): JobForm {
  const c = job.containers[0];
  return {
    image: c?.image ?? '',
    command: (c?.command ?? []).join('\n'),
    args: (c?.args ?? []).join('\n'),
    env: envRowsFrom(c?.env ?? []),
    cpu: c?.cpu ?? '',
    memory: c?.memory ?? '',
    taskCount: String(job.taskCount),
    parallelism: String(job.parallelism),
    maxRetries: job.maxRetries === null ? '' : String(job.maxRetries),
    timeout: job.timeoutSeconds === null ? '' : String(job.timeoutSeconds),
    serviceAccount: job.serviceAccount ?? '',
    execEnv: job.executionEnvironment,
    labels: labelRowsFrom(job.labels),
  };
}

/** Edits a job's configuration; fields left alone stay as they are (SPEC-0003 D-06). */
export function JobEditSheet({
  projectId,
  job,
  open,
  onOpenChange,
  readOnlyReason,
}: {
  projectId: string;
  job: RunJob;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  readOnlyReason: string | null;
}) {
  const initial = useMemo(() => jobForm(job), [job]);
  const [f, setF] = useState(initial);
  const mutation = useUpdateJob(projectId, job.location, job.id);
  useEffect(() => {
    if (open) setF(initial);
  }, [open, initial]);
  const set = <K extends keyof JobForm>(k: K, v: JobForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const changed = <K extends keyof JobForm>(k: K) => JSON.stringify(initial[k]) !== JSON.stringify(f[k]);

  const patch: UpdateJob = { container: {} };
  if (changed('image')) patch.container.image = f.image.trim();
  if (changed('command')) patch.container.command = lines(f.command);
  if (changed('args')) patch.container.args = lines(f.args);
  if (changed('env')) patch.container.env = envFromRows(f.env);
  if (changed('cpu') && f.cpu.trim()) patch.container.cpu = f.cpu.trim();
  if (changed('memory') && f.memory.trim()) patch.container.memory = f.memory.trim();
  if (changed('taskCount')) patch.taskCount = Number(f.taskCount);
  if (changed('parallelism')) patch.parallelism = Number(f.parallelism);
  if (changed('maxRetries') && f.maxRetries.trim()) patch.maxRetries = Number(f.maxRetries);
  if (changed('timeout') && f.timeout.trim()) patch.timeoutSeconds = Number(f.timeout);
  if (changed('serviceAccount')) patch.serviceAccount = f.serviceAccount.trim() || null;
  if (changed('execEnv')) patch.executionEnvironment = f.execEnv;
  if (changed('labels')) patch.labels = labelsFromRows(f.labels);
  const dirty = Object.keys(patch).length > 1 || Object.keys(patch.container).length > 0;

  const errors: string[] = [];
  const whole = (v: string, min: number, max: number) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max;
  if (!f.image.trim()) errors.push('An image is required.');
  if (!whole(f.taskCount, 1, 10_000)) errors.push('Tasks must be from 1 to 10000.');
  if (!whole(f.parallelism, 0, 10_000)) errors.push('Parallelism must be from 0 to 10000.');
  if (f.maxRetries.trim() && !whole(f.maxRetries, 0, 10)) errors.push('Retries must be from 0 to 10.');
  if (f.timeout.trim() && !whole(f.timeout, 1, 604_800)) errors.push('The timeout must be from 1 to 604800 seconds.');

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${job.id}`}
      description="Changes apply to executions started after saving."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            loading={mutation.isPending}
            disabled={!dirty || errors.length > 0 || !!readOnlyReason}
            disabledReason={readOnlyReason ?? errors[0] ?? 'Nothing changed'}
            onClick={() => mutation.mutate(patch, { onSuccess: () => onOpenChange(false) })}
          >
            Save job
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-end gap-2">
          <Field label="Image" className="flex-1" required>
            <Input mono value={f.image} onChange={(e) => set('image', e.target.value)} />
          </Field>
          <ImagePicker projectId={projectId} onPick={(p) => set('image', p.reference)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Command" help="One part per line.">
            <Textarea mono rows={2} value={f.command} onChange={(e) => set('command', e.target.value)} />
          </Field>
          <Field label="Arguments" help="One argument per line.">
            <Textarea mono rows={2} value={f.args} onChange={(e) => set('args', e.target.value)} />
          </Field>
        </div>
        <KeyValueEditor
          label="Environment variables"
          rows={f.env}
          onChange={(r) => set('env', r)}
          allowSecrets
          keyPattern={ENV_KEY}
          keyHint="Letters, digits and underscores"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="CPU">
            <Input mono value={f.cpu} onChange={(e) => set('cpu', e.target.value)} placeholder="1" />
          </Field>
          <Field label="Memory">
            <Input mono value={f.memory} onChange={(e) => set('memory', e.target.value)} placeholder="512Mi" />
          </Field>
          <Field label="Tasks">
            <Input mono value={f.taskCount} onChange={(e) => set('taskCount', e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Parallelism" help="0 runs as many as possible.">
            <Input mono value={f.parallelism} onChange={(e) => set('parallelism', e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Retries per task">
            <Input mono value={f.maxRetries} onChange={(e) => set('maxRetries', e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Task timeout (s)">
            <Input mono value={f.timeout} onChange={(e) => set('timeout', e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Service account">
            <Input mono value={f.serviceAccount} onChange={(e) => set('serviceAccount', e.target.value)} />
          </Field>
          <Field label="Execution environment">
            <Select<JobForm['execEnv']>
              value={f.execEnv}
              onValueChange={(v) => set('execEnv', v)}
              options={[
                { value: 'UNSPECIFIED', label: 'Default' },
                { value: 'GEN1', label: 'First generation' },
                { value: 'GEN2', label: 'Second generation' },
              ]}
            />
          </Field>
        </div>
        <KeyValueEditor label="Labels" keyLabel="Key" rows={f.labels} onChange={(r) => set('labels', r)} keyPattern={LABEL_KEY} />
        {errors.map((e) => (
          <p key={e} className="m-0 text-meta text-redline-ink">
            {e}
          </p>
        ))}
        <Legend as="p" className="m-0">
          Equivalent command
        </Legend>
        <pre className="m-0 overflow-auto rounded-control bg-well p-3 font-mono text-[11px] text-ink">{`gcloud run jobs update ${job.id} --region=${job.location} --project=${projectId}${patch.container.image ? ` --image=${patch.container.image}` : ''}${patch.taskCount !== undefined ? ` --tasks=${patch.taskCount}` : ''}${patch.parallelism !== undefined ? ` --parallelism=${patch.parallelism}` : ''}${patch.maxRetries !== undefined ? ` --max-retries=${patch.maxRetries}` : ''}${patch.timeoutSeconds !== undefined ? ` --task-timeout=${patch.timeoutSeconds}s` : ''}`}</pre>
      </div>
    </Sheet>
  );
}
