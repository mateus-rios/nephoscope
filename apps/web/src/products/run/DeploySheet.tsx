import type { CreateService, DeployService, RunService } from '@nephoscope/contracts';
import { RocketIcon } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { Legend } from '../../design/Drafting';
import { Field, Input, Select, Switch, Textarea } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { ENV_KEY, envFromRows, envRowsFrom, KeyValueEditor, LABEL_KEY, labelRowsFrom, labelsFromRows } from '../../kit/KeyValueEditor';
import { useCreateService, useDeploy } from './api';
import { deployCommand } from './commands';
import { runRoutes } from './common';
import { ImagePicker } from './ImagePicker';

type Row = { name: string; value: string; secret?: { secret: string; version: string } | null };
type VpcMode = 'none' | 'connector' | 'direct';

interface FormState {
  id: string;
  region: string;
  image: string;
  port: string;
  command: string;
  args: string;
  env: Row[];
  cpu: string;
  memory: string;
  cpuAlways: boolean;
  boost: boolean;
  min: string;
  max: string;
  concurrency: string;
  timeout: string;
  execEnv: 'UNSPECIFIED' | 'GEN1' | 'GEN2';
  serviceAccount: string;
  ingress: 'ALL' | 'INTERNAL_ONLY' | 'INTERNAL_LOAD_BALANCER';
  vpcMode: VpcMode;
  connector: string;
  network: string;
  subnetwork: string;
  egress: 'PRIVATE_RANGES_ONLY' | 'ALL_TRAFFIC';
  labels: Row[];
  suffix: string;
  serveNow: boolean;
  allowPublic: boolean;
}

export const RUN_REGIONS = [
  'us-central1',
  'us-east1',
  'us-east4',
  'us-east5',
  'us-south1',
  'us-west1',
  'us-west2',
  'northamerica-northeast1',
  'southamerica-east1',
  'southamerica-west1',
  'europe-west1',
  'europe-west2',
  'europe-west3',
  'europe-west4',
  'europe-west9',
  'europe-north1',
  'europe-southwest1',
  'asia-east1',
  'asia-northeast1',
  'asia-south1',
  'asia-southeast1',
  'australia-southeast1',
  'me-west1',
];

const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

function fromService(s: RunService | null): FormState {
  const c = s?.template.containers.find((x) => x.port !== null) ?? s?.template.containers[0];
  const vpc = s?.template.vpc;
  return {
    id: '',
    region: 'us-central1',
    image: c?.image ?? '',
    port: c?.port ? String(c.port) : '8080',
    command: (c?.command ?? []).join('\n'),
    args: (c?.args ?? []).join('\n'),
    env: envRowsFrom(c?.env ?? []),
    cpu: c?.cpu ?? '1',
    memory: c?.memory ?? '512Mi',
    cpuAlways: c?.cpuIdle === false,
    boost: c?.startupCpuBoost ?? false,
    min: s?.template.minInstances ? String(s.template.minInstances) : '0',
    max: s?.template.maxInstances ? String(s.template.maxInstances) : '',
    concurrency: String(s?.template.concurrency ?? 80),
    timeout: String(s?.template.timeoutSeconds ?? 300),
    execEnv: s?.template.executionEnvironment ?? 'UNSPECIFIED',
    serviceAccount: s?.template.serviceAccount ?? '',
    ingress: s && s.ingress !== 'UNSPECIFIED' && s.ingress !== 'NONE' ? s.ingress : 'ALL',
    vpcMode: vpc?.connector ? 'connector' : (vpc?.networkInterfaces.length ?? 0) > 0 ? 'direct' : 'none',
    connector: vpc?.connector ?? '',
    network: vpc?.networkInterfaces[0]?.network ?? '',
    subnetwork: vpc?.networkInterfaces[0]?.subnetwork ?? '',
    egress: vpc?.egress === 'ALL_TRAFFIC' ? 'ALL_TRAFFIC' : 'PRIVATE_RANGES_ONLY',
    labels: labelRowsFrom(s?.labels ?? {}),
    suffix: '',
    serveNow: true,
    allowPublic: false,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only the fields that changed, so the server keeps everything else (SPEC-0003 D-02). */
function toPatch(initial: FormState, f: FormState, create: boolean): DeployService {
  const changed = <K extends keyof FormState>(k: K) => create || !same(initial[k], f[k]);
  const container: DeployService['container'] = {};
  if (changed('image')) container.image = f.image.trim();
  if (changed('port')) container.port = f.port.trim() ? Number(f.port) : null;
  if (changed('command')) container.command = lines(f.command);
  if (changed('args')) container.args = lines(f.args);
  if (changed('env')) container.env = envFromRows(f.env);
  if (changed('cpu')) container.cpu = f.cpu.trim();
  if (changed('memory')) container.memory = f.memory.trim();
  if (changed('cpuAlways')) container.cpuIdle = !f.cpuAlways;
  if (changed('boost')) container.startupCpuBoost = f.boost;
  const patch: DeployService = { container, serveImmediately: f.serveNow };
  if (changed('min')) patch.minInstances = f.min.trim() ? Number(f.min) : null;
  if (changed('max')) patch.maxInstances = f.max.trim() ? Number(f.max) : null;
  if (changed('concurrency') && f.concurrency.trim()) patch.concurrency = Number(f.concurrency);
  if (changed('timeout') && f.timeout.trim()) patch.timeoutSeconds = Number(f.timeout);
  if (changed('execEnv')) patch.executionEnvironment = f.execEnv;
  if (changed('serviceAccount')) patch.serviceAccount = f.serviceAccount.trim() || null;
  if (changed('ingress')) patch.ingress = f.ingress;
  if (['vpcMode', 'connector', 'network', 'subnetwork', 'egress'].some((k) => changed(k as keyof FormState))) {
    patch.vpc =
      f.vpcMode === 'none'
        ? create
          ? undefined
          : null
        : f.vpcMode === 'connector'
          ? { connector: f.connector.trim(), egress: f.egress }
          : { network: f.network.trim() || null, subnetwork: f.subnetwork.trim() || null, egress: f.egress };
  }
  if (changed('labels')) patch.labels = labelsFromRows(f.labels);
  if (f.suffix.trim()) patch.revisionSuffix = f.suffix.trim();
  return patch;
}

function summarize(initial: FormState, f: FormState): string[] {
  const out: string[] = [];
  const c = (label: string, a: string, b: string) => {
    if (a !== b) out.push(`${label}: ${a || 'none'} to ${b || 'none'}`);
  };
  c('Image', initial.image, f.image);
  c('Port', initial.port, f.port);
  c('Command', initial.command.replaceAll('\n', ' '), f.command.replaceAll('\n', ' '));
  c('Arguments', initial.args.replaceAll('\n', ' '), f.args.replaceAll('\n', ' '));
  if (!same(initial.env, f.env)) {
    const before = new Map(initial.env.map((e) => [e.name, e]));
    const after = new Map(f.env.filter((e) => e.name.trim()).map((e) => [e.name.trim(), e]));
    const added = [...after.keys()].filter((k) => !before.has(k));
    const removed = [...before.keys()].filter((k) => !after.has(k));
    const modified = [...after.keys()].filter((k) => before.has(k) && !same(before.get(k), after.get(k)));
    if (added.length) out.push(`Variables added: ${added.join(', ')}`);
    if (modified.length) out.push(`Variables changed: ${modified.join(', ')}`);
    if (removed.length) out.push(`Variables removed: ${removed.join(', ')}`);
  }
  c('CPU', initial.cpu, f.cpu);
  c('Memory', initial.memory, f.memory);
  if (initial.cpuAlways !== f.cpuAlways) out.push(f.cpuAlways ? 'CPU always allocated' : 'CPU only during requests');
  if (initial.boost !== f.boost) out.push(f.boost ? 'Startup CPU boost on' : 'Startup CPU boost off');
  c('Minimum instances', initial.min, f.min);
  c('Maximum instances', initial.max, f.max);
  c('Concurrency', initial.concurrency, f.concurrency);
  c('Timeout', `${initial.timeout} s`, `${f.timeout} s`);
  c('Execution environment', initial.execEnv, f.execEnv);
  c('Service account', initial.serviceAccount, f.serviceAccount);
  c('Ingress', initial.ingress, f.ingress);
  if (
    !same(
      [initial.vpcMode, initial.connector, initial.network, initial.subnetwork, initial.egress],
      [f.vpcMode, f.connector, f.network, f.subnetwork, f.egress],
    )
  ) {
    out.push(
      `VPC egress: ${f.vpcMode === 'none' ? 'off' : f.vpcMode === 'connector' ? `connector ${f.connector}` : `Direct VPC ${f.network || f.subnetwork}`}`,
    );
  }
  if (!same(initial.labels, f.labels)) out.push('Labels changed');
  return out;
}

function validate(f: FormState, create: boolean): Partial<Record<keyof FormState, string>> {
  const e: Partial<Record<keyof FormState, string>> = {};
  if (create && !/^[a-z]([-a-z0-9]{0,47}[a-z0-9])?$/.test(f.id))
    e.id = 'Lowercase letters, digits and hyphens, starting with a letter; up to 49 characters.';
  if (create && !/^[a-z]+(-[a-z0-9]+)+$/.test(f.region)) e.region = 'A region such as us-central1.';
  if (!f.image.trim()) e.image = 'An image is required.';
  const int = (k: keyof FormState, min: number, max: number, label: string, optional = false) => {
    const v = String(f[k]).trim();
    if (!v && optional) return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) e[k] = `${label} must be a whole number from ${min} to ${max}.`;
  };
  int('port', 1, 65535, 'The port', true);
  int('min', 0, 1000, 'Minimum instances', true);
  int('max', 1, 1000, 'Maximum instances', true);
  int('concurrency', 1, 1000, 'Concurrency');
  int('timeout', 1, 3600, 'The timeout');
  if (f.min && f.max && Number(f.min) > Number(f.max)) e.max = 'Maximum instances must be at least the minimum.';
  if (f.suffix && !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(f.suffix)) e.suffix = 'Lowercase letters, digits and hyphens.';
  if (f.vpcMode === 'connector' && !f.connector.trim()) e.connector = 'Name the connector.';
  if (f.vpcMode === 'direct' && !f.network.trim() && !f.subnetwork.trim()) e.network = 'Name a network or a subnetwork.';
  if (f.env.some((r) => r.name && !ENV_KEY.test(r.name))) e.env = 'Variable names use letters, digits and underscores.';
  return e;
}

interface DeploySheetProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current service; null to create a new one. */
  service: RunService | null;
  readOnlyReason: string | null;
}

/** "Deploy revision" and "Create service" (SPEC-0003 D-02, CA-03, T-01). */
export function DeploySheet({ projectId, open, onOpenChange, service, readOnlyReason }: DeploySheetProps) {
  const create = service === null;
  const initial = useMemo(() => fromService(service), [service]);
  const [f, setF] = useState<FormState>(initial);
  const [digest, setDigest] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const navigate = useNavigate();
  const deploy = useDeploy(projectId, service?.location ?? '', service?.id ?? '');
  const createService = useCreateService(projectId);

  useEffect(() => {
    if (open) {
      setF(initial);
      setDigest(null);
      setTouched(false);
    }
  }, [open, initial]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const errors = validate(f, create);
  const valid = Object.keys(errors).length === 0;
  const changes = create ? [] : summarize(initial, f);
  const patch = toPatch(initial, f, create);
  const region = create ? f.region : (service?.location ?? '');
  const serviceId = create ? f.id || 'SERVICE' : (service?.id ?? '');
  const busy = deploy.isPending || createService.isPending;
  const err = (k: keyof FormState) => (touched ? errors[k] : undefined);

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    if (create) {
      const body: CreateService = {
        ...patch,
        id: f.id,
        region: f.region,
        container: { ...patch.container, image: f.image.trim() },
        allowPublic: f.allowPublic,
      };
      createService.mutate(body, {
        onSuccess: () => {
          onOpenChange(false);
          void navigate({ to: runRoutes(projectId).service(f.region, f.id) });
        },
      });
    } else {
      deploy.mutate(patch, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={create ? 'Create service' : `Deploy a revision of ${service?.id}`}
      description={
        create
          ? 'Deploys a container image as a new Cloud Run service.'
          : 'Creates a new revision from the current template with your changes. Fields you do not change stay as they are.'
      }
      footer={
        <>
          {!create && changes.length === 0 ? (
            <span className="mr-auto text-meta text-ink-3">Nothing changed yet; deploying creates an identical revision.</span>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={RocketIcon}
            loading={busy}
            onClick={submit}
            disabled={!!readOnlyReason}
            disabledReason={readOnlyReason}
          >
            {create ? 'Create service' : 'Deploy revision'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {create ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Service name" error={err('id')} required>
              <Input mono value={f.id} onChange={(e) => set('id', e.target.value)} placeholder="hello" autoFocus />
            </Field>
            <Field label="Region" error={err('region')} required>
              <Input mono value={f.region} onChange={(e) => set('region', e.target.value)} list="nephoscope-run-regions" />
            </Field>
            <datalist id="nephoscope-run-regions">
              {RUN_REGIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
        ) : null}

        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <Legend as="p" className="m-0">
            Container
          </Legend>
          <div className="flex items-end gap-2">
            <Field label="Image" error={err('image')} className="flex-1" required>
              <Input
                mono
                value={f.image}
                onChange={(e) => {
                  set('image', e.target.value);
                  setDigest(null);
                }}
                placeholder="us-docker.pkg.dev/cloudrun/container/hello"
              />
            </Field>
            <ImagePicker
              projectId={projectId}
              onPick={(p) => {
                set('image', p.reference);
                setDigest(p.byDigest);
              }}
            />
          </div>
          {digest && digest !== f.image ? (
            <div>
              <Button size="sm" variant="ghost" onClick={() => set('image', digest)}>
                Pin by digest
              </Button>
              <span className="ml-2 text-meta text-ink-3">Deploys exactly this build, even if the tag moves later.</span>
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Port" error={err('port')} help="The port the container listens on.">
              <Input mono value={f.port} onChange={(e) => set('port', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="CPU">
              <Select<string>
                value={f.cpu}
                onValueChange={(v) => set('cpu', v)}
                options={[
                  '1',
                  '2',
                  '4',
                  '6',
                  '8',
                  '0.5',
                  '0.25',
                  '0.08',
                  ...(['1', '2', '4', '6', '8', '0.5', '0.25', '0.08'].includes(f.cpu) ? [] : [f.cpu]),
                ].map((v) => ({ value: v, label: v }))}
              />
            </Field>
            <Field label="Memory">
              <Select<string>
                value={f.memory}
                onValueChange={(v) => set('memory', v)}
                options={[
                  '128Mi',
                  '256Mi',
                  '512Mi',
                  '1Gi',
                  '2Gi',
                  '4Gi',
                  '8Gi',
                  '16Gi',
                  '32Gi',
                  ...(['128Mi', '256Mi', '512Mi', '1Gi', '2Gi', '4Gi', '8Gi', '16Gi', '32Gi'].includes(f.memory) ? [] : [f.memory]),
                ].map((v) => ({ value: v, label: v }))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Command" help="Overrides the image's entrypoint. One part per line.">
              <Textarea mono rows={2} value={f.command} onChange={(e) => set('command', e.target.value)} />
            </Field>
            <Field label="Arguments" help="One argument per line.">
              <Textarea mono rows={2} value={f.args} onChange={(e) => set('args', e.target.value)} />
            </Field>
          </div>
          <KeyValueEditor
            label="Environment variables"
            rows={f.env}
            onChange={(rows) => set('env', rows)}
            allowSecrets
            keyPattern={ENV_KEY}
            keyHint="Letters, digits and underscores"
          />
          {err('env') ? <p className="m-0 text-meta text-redline-ink">{err('env')}</p> : null}
          <Switch
            checked={f.cpuAlways}
            onCheckedChange={(v) => set('cpuAlways', v)}
            label="CPU always allocated"
            description="Keeps CPU between requests, for background work. Billed per instance time."
          />
          <Switch
            checked={f.boost}
            onCheckedChange={(v) => set('boost', v)}
            label="Startup CPU boost"
            description="More CPU while an instance starts."
          />
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <Legend as="p" className="m-0">
            Scaling and requests
          </Legend>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Min instances" error={err('min')}>
              <Input mono value={f.min} onChange={(e) => set('min', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Max instances" error={err('max')}>
              <Input mono value={f.max} onChange={(e) => set('max', e.target.value)} inputMode="numeric" placeholder="Default" />
            </Field>
            <Field label="Concurrency" error={err('concurrency')}>
              <Input mono value={f.concurrency} onChange={(e) => set('concurrency', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Timeout (s)" error={err('timeout')}>
              <Input mono value={f.timeout} onChange={(e) => set('timeout', e.target.value)} inputMode="numeric" />
            </Field>
          </div>
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <Legend as="p" className="m-0">
            Runtime and networking
          </Legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Execution environment">
              <Select<FormState['execEnv']>
                value={f.execEnv}
                onValueChange={(v) => set('execEnv', v)}
                options={[
                  { value: 'UNSPECIFIED', label: 'Default' },
                  { value: 'GEN1', label: 'First generation' },
                  { value: 'GEN2', label: 'Second generation' },
                ]}
              />
            </Field>
            <Field label="Service account" help="Leave empty for the Compute Engine default account.">
              <Input
                mono
                value={f.serviceAccount}
                onChange={(e) => set('serviceAccount', e.target.value)}
                placeholder="runtime@project.iam.gserviceaccount.com"
              />
            </Field>
            <Field label="Ingress">
              <Select<FormState['ingress']>
                value={f.ingress}
                onValueChange={(v) => set('ingress', v)}
                options={[
                  { value: 'ALL', label: 'All traffic' },
                  { value: 'INTERNAL_ONLY', label: 'Internal only' },
                  { value: 'INTERNAL_LOAD_BALANCER', label: 'Internal and Cloud Load Balancing' },
                ]}
              />
            </Field>
            <Field label="VPC egress">
              <Select<VpcMode>
                value={f.vpcMode}
                onValueChange={(v) => set('vpcMode', v)}
                options={[
                  { value: 'none', label: 'No VPC access' },
                  { value: 'direct', label: 'Direct VPC' },
                  { value: 'connector', label: 'Serverless VPC connector' },
                ]}
              />
            </Field>
          </div>
          {f.vpcMode === 'connector' ? (
            <Field label="Connector" error={err('connector')}>
              <Input
                mono
                value={f.connector}
                onChange={(e) => set('connector', e.target.value)}
                placeholder="projects/p/locations/r/connectors/name"
              />
            </Field>
          ) : null}
          {f.vpcMode === 'direct' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Network" error={err('network')}>
                <Input mono value={f.network} onChange={(e) => set('network', e.target.value)} placeholder="default" />
              </Field>
              <Field label="Subnetwork">
                <Input mono value={f.subnetwork} onChange={(e) => set('subnetwork', e.target.value)} placeholder="default" />
              </Field>
            </div>
          ) : null}
          {f.vpcMode !== 'none' ? (
            <Field label="Route to the VPC" className="max-w-xs">
              <Select<FormState['egress']>
                value={f.egress}
                onValueChange={(v) => set('egress', v)}
                options={[
                  { value: 'PRIVATE_RANGES_ONLY', label: 'Private ranges only' },
                  { value: 'ALL_TRAFFIC', label: 'All traffic' },
                ]}
              />
            </Field>
          ) : null}
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <Legend as="p" className="m-0">
            Revision
          </Legend>
          <KeyValueEditor
            label="Labels"
            keyLabel="Key"
            rows={f.labels}
            onChange={(rows) => set('labels', rows)}
            keyPattern={LABEL_KEY}
            keyHint="Lowercase letters, digits, hyphens and underscores"
          />
          <Field
            label="Revision suffix"
            error={err('suffix')}
            help={`The revision is named ${serviceId}-suffix. Leave empty for a generated name.`}
            className="max-w-xs"
          >
            <Input mono value={f.suffix} onChange={(e) => set('suffix', e.target.value)} />
          </Field>
          {create ? (
            <Switch
              checked={f.allowPublic}
              onCheckedChange={(v) => set('allowPublic', v)}
              label="Allow public access"
              description="Grants roles/run.invoker to allUsers once the service exists. Anyone on the internet can call it."
            />
          ) : (
            <Switch
              checked={f.serveNow}
              onCheckedChange={(v) => set('serveNow', v)}
              label="Serve this revision immediately"
              description="On: the new revision gets 100% of the traffic. Off: it starts at 0% and the current split stays."
            />
          )}
        </fieldset>

        {!create && changes.length > 0 ? (
          <section aria-label="Changes" className="flex flex-col gap-1.5">
            <Legend>What changes</Legend>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-dense text-ink">
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
              {!f.serveNow ? <li className="text-ink-2">The new revision starts with no traffic.</li> : null}
            </ul>
          </section>
        ) : null}

        <EquivalentCommand {...deployCommand(projectId, region, serviceId, patch, create)} />
      </form>
    </Sheet>
  );
}
