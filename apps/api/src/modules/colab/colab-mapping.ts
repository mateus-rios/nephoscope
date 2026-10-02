import {
  type ColabCommit,
  type ColabExecution,
  type ColabIdleShutdown,
  type ColabJobSource,
  type ColabJobSpec,
  type ColabJobState,
  type ColabJobView,
  type ColabMachine,
  type ColabNetwork,
  type ColabNotebook,
  type ColabRuntime,
  type ColabRuntimeState,
  type ColabRuntimeType,
  type ColabSchedule,
  type ColabScheduleState,
  type ColabTemplate,
  type CreateColabTemplate,
  colabJobStates,
  type SaveColabSchedule,
  toNotebookExecutionJob,
  type UpdateColabTemplate,
} from '@nephoscope/contracts';

// biome-ignore lint/suspicious/noExplicitAny: REST JSON of Vertex AI and Dataform is read field by field.
type Any = any;

export const projectOf = (name: string) => /^projects\/([^/]+)\//.exec(name)?.[1] ?? '';
export const locationOf = (name: string) => /\/locations\/([^/]+)/.exec(name)?.[1] ?? '';
export const shortName = (name: string) => name.split('/').pop() ?? name;

/**
 * Google answers with the project number where Nephoscope sent the project id, so two names of
 * one resource compare by location, collection and id only.
 */
export function sameResource(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const tail = (n: string) => n.replace(/^projects\/[^/]+\//, '');
  return tail(a) === tail(b);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const labels = (v: unknown): Record<string, string> => ({ ...((v as Record<string, string> | null) ?? {}) });

/** "86400s" or "1.5s" to seconds. */
export function durationSeconds(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(-?\d+(?:\.\d+)?)s$/.exec(v);
  return m ? Number(m[1]) : null;
}

function mapMachine(machine: Any, disk: Any): ColabMachine {
  return {
    machineType: str(machine?.machineType),
    acceleratorType: str(machine?.acceleratorType) === 'ACCELERATOR_TYPE_UNSPECIFIED' ? null : str(machine?.acceleratorType),
    acceleratorCount: num(machine?.acceleratorCount),
    diskType: str(disk?.diskType),
    diskSizeGb: num(disk?.diskSizeGb),
  };
}

function mapNetwork(network: Any, tags: unknown): ColabNetwork {
  return {
    network: str(network?.network),
    subnetwork: str(network?.subnetwork),
    internetAccess: network?.enableInternetAccess === true,
    tags: Array.isArray(tags) ? tags.map(String) : [],
  };
}

function mapIdle(config: Any): ColabIdleShutdown {
  const seconds = durationSeconds(config?.idleTimeout);
  return { disabled: config?.idleShutdownDisabled === true, timeoutMinutes: seconds === null ? null : Math.round(seconds / 60) };
}

function runtimeType(v: unknown): ColabRuntimeType {
  return v === 'USER_DEFINED' ? 'user_defined' : v === 'ONE_CLICK' ? 'one_click' : 'unknown';
}

function envMap(env: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(env)) for (const e of env) if (e?.name) out[String(e.name)] = String(e.value ?? '');
  return out;
}

export function mapTemplate(t: Any): ColabTemplate {
  const name = String(t?.name ?? '');
  const script = t?.softwareConfig?.postStartupScriptConfig ?? {};
  return {
    name,
    id: shortName(name),
    location: locationOf(name),
    displayName: str(t?.displayName) ?? shortName(name),
    description: str(t?.description),
    type: runtimeType(t?.notebookRuntimeType),
    machine: mapMachine(t?.machineSpec, t?.dataPersistentDiskSpec),
    network: mapNetwork(t?.networkSpec, t?.networkTags),
    idleShutdown: mapIdle(t?.idleShutdownConfig),
    euc: typeof t?.eucConfig?.eucDisabled === 'boolean' ? !t.eucConfig.eucDisabled : null,
    secureBoot: t?.shieldedVmConfig?.enableSecureBoot === true,
    postStartupScript: {
      script: str(script.postStartupScript),
      url: str(script.postStartupScriptUrl),
      behavior:
        str(script.postStartupScriptBehavior) === 'POST_STARTUP_SCRIPT_BEHAVIOR_UNSPECIFIED' ? null : str(script.postStartupScriptBehavior),
    },
    env: envMap(t?.softwareConfig?.env),
    colabImage: {
      releaseName: str(t?.softwareConfig?.colabImage?.releaseName),
      description: str(t?.softwareConfig?.colabImage?.description),
    },
    kmsKeyName: str(t?.encryptionSpec?.kmsKeyName),
    labels: labels(t?.labels),
    createTime: str(t?.createTime),
    updateTime: str(t?.updateTime),
  };
}

const RUNTIME_STATES: Record<string, ColabRuntimeState> = {
  RUNNING: 'running',
  BEING_STARTED: 'starting',
  BEING_STOPPED: 'stopping',
  STOPPED: 'stopped',
  BEING_UPGRADED: 'upgrading',
  ERROR: 'error',
  INVALID: 'invalid',
};

export function mapRuntime(r: Any): ColabRuntime {
  const name = String(r?.name ?? '');
  const l = labels(r?.labels);
  return {
    name,
    id: shortName(name),
    location: locationOf(name),
    displayName: str(r?.displayName) ?? shortName(name),
    description: str(r?.description),
    state: RUNTIME_STATES[String(r?.runtimeState)] ?? 'unknown',
    health: r?.healthState === 'HEALTHY' ? 'healthy' : r?.healthState === 'UNHEALTHY' ? 'unhealthy' : 'unknown',
    runtimeUser: str(r?.runtimeUser),
    template: str(r?.notebookRuntimeTemplateRef?.notebookRuntimeTemplate),
    type: runtimeType(r?.notebookRuntimeType),
    machine: mapMachine(r?.machineSpec, r?.dataPersistentDiskSpec),
    network: mapNetwork(r?.networkSpec, r?.networkTags),
    idleShutdown: mapIdle(r?.idleShutdownConfig),
    upgradable: r?.isUpgradable === true,
    version: str(r?.version),
    colabImage: str(r?.softwareConfig?.colabImage?.description) ?? str(r?.softwareConfig?.colabImage?.releaseName),
    entryService: l['aiplatform.googleapis.com/colab_enterprise_entry_service'] === 'bigquery' ? 'bigquery' : 'vertex',
    expirationTime: str(r?.expirationTime),
    createTime: str(r?.createTime),
    updateTime: str(r?.updateTime),
    labels: l,
  };
}

function jobState(v: unknown): ColabJobState {
  const s = String(v ?? '')
    .replace(/^JOB_STATE_/, '')
    .toLowerCase();
  return (colabJobStates as readonly string[]).includes(s) ? (s as ColabJobState) : 'unknown';
}

function jobSource(j: Any): ColabJobSource {
  if (j?.dataformRepositorySource?.dataformRepositoryResourceName) {
    return {
      kind: 'notebook',
      repository: String(j.dataformRepositorySource.dataformRepositoryResourceName),
      commitSha: str(j.dataformRepositorySource.commitSha),
    };
  }
  if (j?.gcsNotebookSource?.uri)
    return { kind: 'gcs', uri: String(j.gcsNotebookSource.uri), generation: str(j.gcsNotebookSource.generation) };
  if (j?.directNotebookSource) return { kind: 'inline' };
  return { kind: 'unknown' };
}

/** The part of a NotebookExecutionJob that describes the run, shared by executions and schedules. */
export function mapJobView(j: Any): ColabJobView {
  const custom = j?.customEnvironmentSpec;
  return {
    displayName: str(j?.displayName) ?? '',
    source: jobSource(j),
    template: str(j?.notebookRuntimeTemplateResourceName),
    customMachine: custom ? mapMachine(custom.machineSpec, custom.persistentDiskSpec) : null,
    outputUri: str(j?.gcsOutputUri),
    identity: j?.serviceAccount
      ? { kind: 'serviceAccount', email: String(j.serviceAccount) }
      : j?.executionUser
        ? { kind: 'user', email: String(j.executionUser) }
        : { kind: 'unknown', email: null },
    timeoutSeconds: durationSeconds(j?.executionTimeout),
    kernelName: str(j?.kernelName),
  };
}

export function mapExecution(j: Any): ColabExecution {
  const name = String(j?.name ?? '');
  const status = j?.status;
  return {
    ...mapJobView(j),
    name,
    id: shortName(name),
    location: locationOf(name),
    state: jobState(j?.jobState),
    status: status && (status.code || status.message) ? { code: num(status.code) ?? 0, message: str(status.message) } : null,
    schedule: str(j?.scheduleResourceName),
    createTime: str(j?.createTime),
    updateTime: str(j?.updateTime),
    labels: labels(j?.labels),
  };
}

const SCHEDULE_STATES: Record<string, ColabScheduleState> = { ACTIVE: 'active', PAUSED: 'paused', COMPLETED: 'completed' };

export function mapSchedule(s: Any): ColabSchedule {
  const name = String(s?.name ?? '');
  const last = s?.lastScheduledRunResponse;
  return {
    name,
    id: shortName(name),
    location: locationOf(name),
    displayName: str(s?.displayName) ?? shortName(name),
    cron: String(s?.cron ?? ''),
    state: SCHEDULE_STATES[String(s?.state)] ?? 'unknown',
    maxConcurrentRunCount: num(s?.maxConcurrentRunCount) ?? 1,
    maxRunCount: num(s?.maxRunCount),
    startedRunCount: num(s?.startedRunCount) ?? 0,
    allowQueueing: s?.allowQueueing === true,
    catchUp: s?.catchUp === true,
    startTime: str(s?.startTime),
    endTime: str(s?.endTime),
    nextRunTime: str(s?.nextRunTime),
    lastPauseTime: str(s?.lastPauseTime),
    lastResumeTime: str(s?.lastResumeTime),
    lastRun: last ? { scheduledRunTime: str(last.scheduledRunTime), response: str(last.runResponse) } : null,
    createTime: str(s?.createTime),
    updateTime: str(s?.updateTime),
    job: mapJobView(s?.createNotebookExecutionJobRequest?.notebookExecutionJob),
  };
}

export function mapNotebook(r: Any): ColabNotebook {
  const name = String(r?.name ?? '');
  return {
    name,
    id: shortName(name),
    location: locationOf(name),
    displayName: str(r?.displayName) ?? shortName(name),
    createTime: str(r?.createTime),
    labels: labels(r?.labels),
    kmsKeyName: str(r?.kmsKeyName),
  };
}

export function mapCommit(c: Any): ColabCommit {
  return {
    sha: String(c?.commitSha ?? ''),
    message: str(c?.commitMessage),
    authorName: str(c?.author?.name),
    authorEmail: str(c?.author?.emailAddress),
    time: str(c?.commitTime),
  };
}

// ---- Requests ------------------------------------------------------------------------------------

/** The NotebookExecutionJob message for a run (SPEC-0010 D-08). */
export const toJob = (spec: ColabJobSpec): Any => toNotebookExecutionJob(spec);

function softwareConfig(body: UpdateColabTemplate): Any {
  const s = body.postStartupScript;
  const env = Object.entries(body.env).map(([name, value]) => ({ name, value }));
  return {
    ...(env.length ? { env } : {}),
    ...(s.script || s.url
      ? {
          postStartupScriptConfig: {
            ...(s.script ? { postStartupScript: s.script } : {}),
            ...(s.url ? { postStartupScriptUrl: s.url } : {}),
            ...(s.behavior ? { postStartupScriptBehavior: s.behavior } : {}),
          },
        }
      : {}),
    ...(body.colabImageRelease ? { colabImage: { releaseName: body.colabImageRelease } } : {}),
  };
}

export function toTemplate(body: CreateColabTemplate): Any {
  return {
    displayName: body.displayName,
    ...(body.description ? { description: body.description } : {}),
    notebookRuntimeType: 'USER_DEFINED',
    machineSpec: {
      machineType: body.machineType,
      ...(body.acceleratorType ? { acceleratorType: body.acceleratorType, acceleratorCount: Math.max(1, body.acceleratorCount) } : {}),
    },
    dataPersistentDiskSpec: { diskType: body.diskType, diskSizeGb: String(body.diskSizeGb) },
    networkSpec: {
      enableInternetAccess: body.internetAccess,
      ...(body.network ? { network: body.network } : {}),
      ...(body.subnetwork ? { subnetwork: body.subnetwork } : {}),
    },
    ...(body.networkTags.length ? { networkTags: body.networkTags } : {}),
    idleShutdownConfig: { idleShutdownDisabled: body.idleShutdown.disabled, idleTimeout: `${body.idleShutdown.timeoutMinutes * 60}s` },
    eucConfig: { eucDisabled: !body.euc },
    shieldedVmConfig: { enableSecureBoot: body.secureBoot },
    softwareConfig: softwareConfig(body),
    ...(body.kmsKeyName ? { encryptionSpec: { kmsKeyName: body.kmsKeyName } } : {}),
    ...(Object.keys(body.labels).length ? { labels: body.labels } : {}),
  };
}

const sameEnv = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/**
 * The patch of a template: only fields that changed go in the mask, since Google accepts a short
 * list of paths and rejects the rest (SPEC-0010 D-07).
 */
export function templatePatch(current: ColabTemplate, body: UpdateColabTemplate): { mask: string[]; template: Any } {
  const mask: string[] = [];
  const s = body.postStartupScript;
  if (body.displayName !== current.displayName) mask.push('display_name');
  const base = 'software_config.post_startup_script_config';
  if ((s.script || null) !== current.postStartupScript.script) mask.push(`${base}.post_startup_script`);
  if ((s.url || null) !== current.postStartupScript.url) mask.push(`${base}.post_startup_script_url`);
  if ((s.behavior ?? null) !== current.postStartupScript.behavior && s.behavior) mask.push(`${base}.post_startup_script_behavior`);
  if (!sameEnv(body.env, current.env)) mask.push('software_config.env');
  if ((body.colabImageRelease || null) !== current.colabImage.releaseName && body.colabImageRelease)
    mask.push('software_config.colab_image.release_name');
  return { mask, template: { displayName: body.displayName, softwareConfig: softwareConfig(body) } };
}

function sameJob(view: ColabJobView, spec: ColabJobSpec): boolean {
  const source = view.source;
  const sameSource =
    spec.source.kind === 'notebook'
      ? source.kind === 'notebook' &&
        sameResource(source.repository, spec.source.repository) &&
        (source.commitSha ?? '') === (spec.source.commitSha ?? '')
      : source.kind === 'gcs' && source.uri === spec.source.uri;
  return (
    sameSource &&
    view.displayName === spec.displayName &&
    sameResource(view.template, spec.template) &&
    (view.outputUri ?? '').replace(/\/+$/, '') === spec.outputUri.replace(/\/+$/, '') &&
    view.identity.kind === spec.identity.kind &&
    view.identity.email === spec.identity.email &&
    view.timeoutSeconds === spec.timeoutSeconds &&
    (view.kernelName ?? '') === spec.kernelName
  );
}

export function toSchedule(parent: string, body: SaveColabSchedule): Any {
  return {
    displayName: body.displayName,
    cron: body.cron,
    maxConcurrentRunCount: String(body.maxConcurrentRunCount),
    ...(body.maxRunCount ? { maxRunCount: String(body.maxRunCount) } : {}),
    ...(body.startTime ? { startTime: body.startTime } : {}),
    ...(body.endTime ? { endTime: body.endTime } : {}),
    allowQueueing: body.allowQueueing,
    createNotebookExecutionJobRequest: { parent, notebookExecutionJob: toJob(body.job) },
  };
}

/** The patch of a schedule, limited to the fields that changed (SPEC-0010 D-08). */
export function schedulePatch(current: ColabSchedule, parent: string, body: SaveColabSchedule): { mask: string[]; schedule: Any } {
  const mask: string[] = [];
  if (body.displayName !== current.displayName) mask.push('display_name');
  if (body.cron !== current.cron) mask.push('cron');
  if (body.maxConcurrentRunCount !== current.maxConcurrentRunCount) mask.push('max_concurrent_run_count');
  if ((body.maxRunCount ?? null) !== current.maxRunCount) mask.push('max_run_count');
  const sameTime = (a: string | undefined, b: string | null) => (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null);
  if (body.startTime && !sameTime(body.startTime, current.startTime)) mask.push('start_time');
  if (!sameTime(body.endTime, current.endTime)) mask.push('end_time');
  if (body.allowQueueing !== current.allowQueueing) mask.push('allow_queueing');
  if (!sameJob(current.job, body.job)) mask.push('create_notebook_execution_job_request');
  return { mask, schedule: toSchedule(parent, body) };
}
