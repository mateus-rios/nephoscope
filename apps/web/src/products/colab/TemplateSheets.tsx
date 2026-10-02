import {
  COLAB_REGIONS,
  type ColabTemplate,
  type CreateColabTemplate,
  diskTypes,
  postStartupBehaviors,
  type UpdateColabTemplate,
} from '@nephoscope/contracts';
import { CpuIcon, PlusIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { Legend } from '../../design/Drafting';
import { Field, Input, Select, Switch, Textarea } from '../../design/Form';
import { Sheet } from '../../design/Overlays';
import { EquivalentCommand } from '../../kit/EquivalentCommand';
import { ENV_KEY, KeyValueEditor, LABEL_KEY, labelRowsFrom, labelsFromRows } from '../../kit/KeyValueEditor';
import { useActiveProfile } from '../../state/queries';
import { useAssignRuntime, useCreateTemplate, useTemplates, useUpdateTemplate } from './api';
import { machineSummary, useOnOpen } from './common';

type Row = { name: string; value: string };

const MACHINE_TYPES = [
  'e2-standard-2',
  'e2-standard-4',
  'e2-standard-8',
  'e2-highmem-4',
  'n1-standard-4',
  'n1-highmem-8',
  'n2-standard-4',
  'n2-standard-8',
  'n2-highmem-8',
  'c2-standard-8',
  'g2-standard-4',
  'g2-standard-8',
  'a2-highgpu-1g',
];

const ACCELERATORS = [
  '',
  'NVIDIA_TESLA_T4',
  'NVIDIA_L4',
  'NVIDIA_TESLA_V100',
  'NVIDIA_TESLA_P100',
  'NVIDIA_TESLA_A100',
  'NVIDIA_A100_80GB',
];

const BEHAVIOR_LABEL: Record<(typeof postStartupBehaviors)[number], string> = {
  RUN_ONCE: 'Run once',
  RUN_EVERY_START: 'Run at every start',
  DOWNLOAD_AND_RUN_EVERY_START: 'Download and run at every start',
};

interface FormState {
  region: string;
  id: string;
  displayName: string;
  description: string;
  machineType: string;
  acceleratorType: string;
  acceleratorCount: string;
  diskType: (typeof diskTypes)[number];
  diskSizeGb: string;
  network: string;
  subnetwork: string;
  internetAccess: boolean;
  networkTags: string;
  idleDisabled: boolean;
  idleMinutes: string;
  euc: boolean;
  secureBoot: boolean;
  script: string;
  scriptUrl: string;
  behavior: '' | (typeof postStartupBehaviors)[number];
  env: Row[];
  colabImageRelease: string;
  kmsKeyName: string;
  labels: Row[];
}

function initial(t: ColabTemplate | null, region: string): FormState {
  return {
    region,
    id: '',
    displayName: t?.displayName ?? '',
    description: t?.description ?? '',
    machineType: t?.machine.machineType ?? 'e2-standard-4',
    acceleratorType: t?.machine.acceleratorType ?? '',
    acceleratorCount: String(t?.machine.acceleratorCount ?? 1),
    diskType: (diskTypes as readonly string[]).includes(t?.machine.diskType ?? '')
      ? (t?.machine.diskType as FormState['diskType'])
      : 'pd-standard',
    diskSizeGb: String(t?.machine.diskSizeGb ?? 100),
    network: t?.network.network ?? '',
    subnetwork: t?.network.subnetwork ?? '',
    internetAccess: t?.network.internetAccess ?? true,
    networkTags: (t?.network.tags ?? []).join(', '),
    idleDisabled: t?.idleShutdown.disabled ?? false,
    idleMinutes: String(t?.idleShutdown.timeoutMinutes ?? 180),
    euc: t?.euc ?? true,
    secureBoot: t?.secureBoot ?? false,
    script: t?.postStartupScript.script ?? '',
    scriptUrl: t?.postStartupScript.url ?? '',
    behavior: (t?.postStartupScript.behavior as FormState['behavior']) ?? '',
    env: labelRowsFrom(t?.env ?? {}),
    colabImageRelease: t?.colabImage.releaseName ?? '',
    kmsKeyName: t?.kmsKeyName ?? '',
    labels: labelRowsFrom(t?.labels ?? {}),
  };
}

function updateBody(f: FormState): UpdateColabTemplate {
  return {
    displayName: f.displayName.trim(),
    postStartupScript: { script: f.script, url: f.scriptUrl.trim(), behavior: f.behavior || undefined },
    env: labelsFromRows(f.env),
    colabImageRelease: f.colabImageRelease.trim(),
  };
}

function createBody(f: FormState): CreateColabTemplate {
  return {
    ...updateBody(f),
    region: f.region,
    id: f.id.trim() || undefined,
    description: f.description,
    machineType: f.machineType.trim(),
    acceleratorType: f.acceleratorType,
    acceleratorCount: f.acceleratorType ? Number(f.acceleratorCount) || 1 : 0,
    diskType: f.diskType,
    diskSizeGb: Number(f.diskSizeGb) || 100,
    network: f.network.trim(),
    subnetwork: f.subnetwork.trim(),
    internetAccess: f.internetAccess,
    networkTags: f.networkTags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    idleShutdown: { disabled: f.idleDisabled, timeoutMinutes: Number(f.idleMinutes) || 180 },
    euc: f.euc,
    secureBoot: f.secureBoot,
    kmsKeyName: f.kmsKeyName.trim(),
    labels: labelsFromRows(f.labels),
  };
}

interface TemplateSheetProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template to edit; null creates one. */
  template: ColabTemplate | null;
  region?: string;
  readOnlyReason: string | null;
}

/** Create a runtime template, or edit the fields Google lets change afterwards (SPEC-0010 D-07, CA-03). */
export function TemplateSheet({ projectId, open, onOpenChange, template, region, readOnlyReason }: TemplateSheetProps) {
  const creating = template === null;
  const start = useMemo(
    () => initial(template, template?.location ?? (region && region !== 'all' ? region : 'us-central1')),
    [template, region],
  );
  const [f, setF] = useState(start);
  const [touched, setTouched] = useState(false);
  const create = useCreateTemplate(projectId);
  const update = useUpdateTemplate(projectId, template?.location ?? '', template?.id ?? '');
  useOnOpen(open, () => {
    setF(start);
    setTouched(false);
  });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!f.displayName.trim()) errors.displayName = 'A name for the template.';
  if (creating) {
    if (f.id && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(f.id)) errors.id = 'Lowercase letters, digits and hyphens.';
    if (!/^[a-z0-9-]+$/.test(f.machineType.trim())) errors.machineType = 'A machine type such as e2-standard-4.';
    if (!(Number(f.diskSizeGb) >= 10)) errors.diskSizeGb = 'At least 10 GB.';
    if (!f.idleDisabled && !(Number(f.idleMinutes) >= 10 && Number(f.idleMinutes) <= 1440)) errors.idleMinutes = '10 to 1440 minutes.';
  }
  if (f.scriptUrl && !f.scriptUrl.startsWith('gs://')) errors.scriptUrl = 'A Cloud Storage URI such as gs://bucket/setup.sh.';
  const valid = Object.keys(errors).length === 0;
  const err = (k: keyof FormState) => (touched ? errors[k] : undefined);
  const body = creating ? createBody(f) : updateBody(f);
  const host = `https://${f.region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${f.region}/notebookRuntimeTemplates`;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={creating ? 'Create runtime template' : `Edit ${template?.displayName}`}
      description={
        creating
          ? 'The machine, disk, network and software a runtime starts with.'
          : 'Google lets only the name and the software settings change after creation.'
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={creating ? PlusIcon : undefined}
            loading={create.isPending || update.isPending}
            disabled={!!readOnlyReason}
            disabledReason={readOnlyReason}
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              if (creating) create.mutate(createBody(f), { onSuccess: () => onOpenChange(false) });
              else update.mutate(updateBody(f), { onSuccess: () => onOpenChange(false) });
            }}
          >
            {creating ? 'Create template' : 'Save template'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" error={err('displayName')} required>
            <Input value={f.displayName} onChange={(e) => set('displayName', e.target.value)} autoFocus />
          </Field>
          <Field label="Region">
            {creating ? (
              <Select<string>
                value={f.region}
                onValueChange={(v) => set('region', v)}
                options={COLAB_REGIONS.map((r) => ({ value: r, label: r }))}
              />
            ) : (
              <Input mono value={f.region} readOnly />
            )}
          </Field>
        </div>
        {creating ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Template ID" error={err('id')} help="Leave empty to let Google choose one.">
                <Input mono value={f.id} onChange={(e) => set('id', e.target.value)} />
              </Field>
              <Field label="Description">
                <Input value={f.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
            </div>
            <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
              <Legend as="p" className="m-0">
                Machine
              </Legend>
              <div className="grid grid-cols-[1fr_1fr_6rem] gap-3">
                <Field label="Machine type" error={err('machineType')} required>
                  <Input mono value={f.machineType} onChange={(e) => set('machineType', e.target.value)} list="nephoscope-colab-machines" />
                </Field>
                <Field label="GPU">
                  <Select<string>
                    value={f.acceleratorType}
                    onValueChange={(v) => set('acceleratorType', v)}
                    options={ACCELERATORS.map((a) => ({ value: a, label: a || 'None' }))}
                  />
                </Field>
                <Field label="GPUs">
                  <Input
                    mono
                    value={f.acceleratorCount}
                    disabled={!f.acceleratorType}
                    onChange={(e) => set('acceleratorCount', e.target.value.replace(/[^\d]/g, ''))}
                    inputMode="numeric"
                  />
                </Field>
                <datalist id="nephoscope-colab-machines">
                  {MACHINE_TYPES.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Disk type">
                  <Select<FormState['diskType']>
                    value={f.diskType}
                    onValueChange={(v) => set('diskType', v)}
                    options={diskTypes.map((d) => ({ value: d, label: d }))}
                  />
                </Field>
                <Field label="Disk size (GB)" error={err('diskSizeGb')}>
                  <Input
                    mono
                    value={f.diskSizeGb}
                    onChange={(e) => set('diskSizeGb', e.target.value.replace(/[^\d]/g, ''))}
                    inputMode="numeric"
                  />
                </Field>
              </div>
              <Switch
                checked={f.secureBoot}
                onCheckedChange={(v) => set('secureBoot', v)}
                label="Secure Boot"
                description="Shielded VM: boot only verified software."
              />
            </fieldset>
            <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
              <Legend as="p" className="m-0">
                Network
              </Legend>
              <Switch
                checked={f.internetAccess}
                onCheckedChange={(v) => set('internetAccess', v)}
                label="Internet access"
                description="Off: the runtime reaches only the network below."
              />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Network" help="Empty: the default network.">
                  <Input
                    mono
                    value={f.network}
                    onChange={(e) => set('network', e.target.value)}
                    placeholder={`projects/${projectId}/global/networks/default`}
                  />
                </Field>
                <Field label="Subnetwork">
                  <Input mono value={f.subnetwork} onChange={(e) => set('subnetwork', e.target.value)} />
                </Field>
              </div>
              <Field label="Network tags" help="Comma separated.">
                <Input mono value={f.networkTags} onChange={(e) => set('networkTags', e.target.value)} />
              </Field>
            </fieldset>
            <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
              <Legend as="p" className="m-0">
                Lifecycle and access
              </Legend>
              <Switch
                checked={!f.idleDisabled}
                onCheckedChange={(v) => set('idleDisabled', !v)}
                label="Idle shutdown"
                description="Stops the runtime after a stretch without activity, so it stops costing."
              />
              {!f.idleDisabled ? (
                <Field label="Idle minutes" error={err('idleMinutes')} className="max-w-xs">
                  <Input
                    mono
                    value={f.idleMinutes}
                    onChange={(e) => set('idleMinutes', e.target.value.replace(/[^\d]/g, ''))}
                    inputMode="numeric"
                  />
                </Field>
              ) : null}
              <Switch
                checked={f.euc}
                onCheckedChange={(v) => set('euc', v)}
                label="End-user credentials"
                description="Code in the notebook calls Google APIs as the runtime's user."
              />
              <Field label="Customer-managed key" help="Empty: Google-managed encryption.">
                <Input
                  mono
                  value={f.kmsKeyName}
                  onChange={(e) => set('kmsKeyName', e.target.value)}
                  placeholder="projects/p/locations/l/keyRings/r/cryptoKeys/k"
                />
              </Field>
            </fieldset>
          </>
        ) : (
          <p className="m-0 text-dense text-ink-2">
            {machineSummary(template?.machine ?? null)}. To change the machine, disk or network, create a new template.
          </p>
        )}
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <Legend as="p" className="m-0">
            Software
          </Legend>
          <Field label="Colab image release" help="Empty: the latest release, such as py311.">
            <Input mono value={f.colabImageRelease} onChange={(e) => set('colabImageRelease', e.target.value)} />
          </Field>
          <Field label="Post-startup script">
            <Textarea mono rows={5} value={f.script} onChange={(e) => set('script', e.target.value)} placeholder="pip install -q polars" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Script URL" error={err('scriptUrl')}>
              <Input mono value={f.scriptUrl} onChange={(e) => set('scriptUrl', e.target.value)} placeholder="gs://bucket/setup.sh" />
            </Field>
            <Field label="Script behavior">
              <Select<FormState['behavior']>
                value={f.behavior}
                onValueChange={(v) => set('behavior', v)}
                options={[{ value: '', label: 'Default' }, ...postStartupBehaviors.map((b) => ({ value: b, label: BEHAVIOR_LABEL[b] }))]}
              />
            </Field>
          </div>
          <KeyValueEditor
            label="Environment variables"
            keyLabel="Variable"
            rows={f.env}
            onChange={(r) => set('env', r)}
            keyPattern={ENV_KEY}
          />
          {creating ? (
            <KeyValueEditor label="Labels" keyLabel="Label" rows={f.labels} onChange={(r) => set('labels', r)} keyPattern={LABEL_KEY} />
          ) : null}
        </fieldset>
        <EquivalentCommand
          rest={
            creating
              ? { method: 'POST', url: `${host}${f.id ? `?notebookRuntimeTemplateId=${f.id}` : ''}`, body }
              : { method: 'PATCH', url: `${host}/${template?.id}?updateMask=<the changed fields>`, body }
          }
        />
      </div>
    </Sheet>
  );
}

interface RuntimeSheetProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  region?: string;
  /** Preselects a template, from a template page. */
  template?: ColabTemplate | null;
  readOnlyReason: string | null;
}

/** Assign a runtime from a template; it belongs to the profile's identity (SPEC-0010 D-09, CA-04). */
export function RuntimeSheet({ projectId, open, onOpenChange, region, template = null, readOnlyReason }: RuntimeSheetProps) {
  const { profile } = useActiveProfile();
  const startRegion = template?.location ?? (region && region !== 'all' ? region : 'us-central1');
  const [r, setR] = useState(startRegion);
  const [tpl, setTpl] = useState(template?.name ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [id, setId] = useState('');
  const [touched, setTouched] = useState(false);
  const templates = useTemplates(projectId, r, open);
  const assign = useAssignRuntime(projectId);
  useOnOpen(open, () => {
    setR(startRegion);
    setTpl(template?.name ?? '');
    setName(template ? `${template.displayName} runtime` : '');
    setDescription('');
    setId('');
    setTouched(false);
  });
  const user = profile?.principal ?? null;
  const errors: Record<string, string> = {};
  if (!name.trim()) errors.name = 'A name for the runtime.';
  if (!tpl) errors.tpl = 'Pick a runtime template.';
  if (id && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(id)) errors.id = 'Lowercase letters, digits and hyphens.';
  const noUser = !user?.includes('@');
  const options = (templates.data?.items ?? []).map((t) => ({ value: t.name, label: `${t.displayName} (${machineSummary(t.machine)})` }));
  const body = {
    notebookRuntimeTemplate: tpl,
    ...(id ? { notebookRuntimeId: id } : {}),
    notebookRuntime: { displayName: name, runtimeUser: user },
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create runtime"
      description="Starts a runtime from a template. Notebooks connect to it from Colab Enterprise."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={CpuIcon}
            loading={assign.isPending}
            disabled={!!readOnlyReason || noUser}
            disabledReason={readOnlyReason ?? (noUser ? 'The active profile has no email identity to own the runtime.' : null)}
            onClick={() => {
              setTouched(true);
              if (Object.keys(errors).length > 0) return;
              assign.mutate(
                { region: r, template: tpl, displayName: name.trim(), description, id: id || undefined },
                { onSuccess: () => onOpenChange(false) },
              );
            }}
          >
            Create runtime
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" error={touched ? errors.name : undefined} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Region">
            {template ? (
              <Input mono value={r} readOnly />
            ) : (
              <Select<string>
                value={r}
                onValueChange={(v) => {
                  setR(v);
                  setTpl('');
                }}
                options={COLAB_REGIONS.map((x) => ({ value: x, label: x }))}
              />
            )}
          </Field>
        </div>
        <Field
          label="Runtime template"
          error={touched ? errors.tpl : undefined}
          help={templates.data && options.length === 0 ? `No runtime templates in ${r}.` : undefined}
          required
        >
          <Select<string> value={tpl} onValueChange={setTpl} options={options} />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Runtime ID" error={touched ? errors.id : undefined} help="Leave empty to let Google choose one.">
          <Input mono value={id} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field
          label="Runtime user"
          help="A runtime belongs to the identity that creates it; only that identity can connect notebooks to it."
        >
          <Input mono value={user ?? 'No email identity'} readOnly />
        </Field>
        <EquivalentCommand
          rest={{
            method: 'POST',
            url: `https://${r}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${r}/notebookRuntimes:assign`,
            body,
          }}
        />
      </div>
    </Sheet>
  );
}
