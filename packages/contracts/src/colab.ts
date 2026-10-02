import { z } from 'zod';
import type { ListResponse } from './common.js';
import { RegionSchema } from './run.js';

/** Colab Enterprise: notebooks, runtimes, runtime templates, executions and schedules (SPEC-0010). */

/**
 * Regions where Colab Enterprise runs, as listed on docs.cloud.google.com/colab/docs/locations on
 * 2026-10-02 (SPEC-0010 D-03). "All regions" lists these; a region outside the list still opens
 * when typed into the URL.
 */
export const COLAB_REGIONS = [
  'africa-south1',
  'asia-east1',
  'asia-east2',
  'asia-northeast1',
  'asia-northeast3',
  'asia-south1',
  'asia-south2',
  'asia-southeast1',
  'asia-southeast2',
  'australia-southeast1',
  'europe-central2',
  'europe-north1',
  'europe-southwest1',
  'europe-west1',
  'europe-west10',
  'europe-west12',
  'europe-west2',
  'europe-west3',
  'europe-west4',
  'europe-west6',
  'europe-west8',
  'europe-west9',
  'me-central1',
  'me-central2',
  'me-west1',
  'northamerica-northeast1',
  'southamerica-east1',
  'us-central1',
  'us-east1',
  'us-east4',
  'us-east5',
  'us-south1',
  'us-west1',
  'us-west2',
  'us-west4',
] as const;

/** `all` fans out over COLAB_REGIONS (SPEC-0010 D-03). */
export const ColabRegionQuerySchema = z.object({
  region: z.union([z.literal('all'), RegionSchema]).default('all'),
  pageToken: z.string().max(4096).optional(),
});
export type ColabRegionQuery = z.infer<typeof ColabRegionQuerySchema>;

/** Label Google puts on the Dataform repository behind each notebook (SPEC-0010 D-04). */
export const NOTEBOOK_LABEL = 'single-file-asset-type';
/** File name used for notebooks Nephoscope creates; existing notebooks keep theirs (SPEC-0010 D-04, R-02). */
export const NOTEBOOK_FILE = 'content.ipynb';
/** Largest notebook Nephoscope reads or writes, in bytes. */
export const NOTEBOOK_MAX_BYTES = 10 * 1024 * 1024;

// ---- Shared pieces -----------------------------------------------------------------------------------

export interface ColabMachine {
  machineType: string | null;
  acceleratorType: string | null;
  acceleratorCount: number | null;
  diskType: string | null;
  diskSizeGb: number | null;
}

export interface ColabNetwork {
  network: string | null;
  subnetwork: string | null;
  internetAccess: boolean;
  tags: string[];
}

export interface ColabIdleShutdown {
  disabled: boolean;
  /** Minutes of inactivity before the runtime stops. */
  timeoutMinutes: number | null;
}

export const colabRuntimeTypes = ['user_defined', 'one_click', 'unknown'] as const;
export type ColabRuntimeType = (typeof colabRuntimeTypes)[number];

// ---- Runtime templates -------------------------------------------------------------------------------

export interface ColabTemplate {
  name: string;
  id: string;
  location: string;
  displayName: string;
  description: string | null;
  type: ColabRuntimeType;
  machine: ColabMachine;
  network: ColabNetwork;
  idleShutdown: ColabIdleShutdown;
  /** End-user credentials; null when Google does not report it (the field is input only). */
  euc: boolean | null;
  secureBoot: boolean;
  postStartupScript: { script: string | null; url: string | null; behavior: string | null };
  env: Record<string, string>;
  colabImage: { releaseName: string | null; description: string | null };
  kmsKeyName: string | null;
  labels: Record<string, string>;
  createTime: string | null;
  updateTime: string | null;
}

const labelMap = z.record(z.string().min(1).max(63), z.string().max(63));
const envMap = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'A valid variable name'), z.string().max(32_768));

/** Optional ids of Vertex AI resources Nephoscope creates; Google generates one when it is left out. */
export const ColabResourceIdSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Lowercase letters, digits and hyphens');

export const postStartupBehaviors = ['RUN_ONCE', 'RUN_EVERY_START', 'DOWNLOAD_AND_RUN_EVERY_START'] as const;

const PostStartupSchema = z.object({
  script: z.string().max(65_536).default(''),
  url: z
    .string()
    .max(2048)
    .regex(/^(gs:\/\/.+)?$/, 'A Cloud Storage URI such as gs://bucket/script.sh')
    .default(''),
  behavior: z.enum(postStartupBehaviors).optional(),
});

/** Fields Google lets a template change after creation (SPEC-0010 D-07). */
export const UpdateColabTemplateSchema = z.object({
  displayName: z.string().min(1).max(128),
  postStartupScript: PostStartupSchema.default({ script: '', url: '' }),
  env: envMap.default({}),
  colabImageRelease: z.string().max(64).default(''),
});
export type UpdateColabTemplate = z.infer<typeof UpdateColabTemplateSchema>;

export const diskTypes = ['pd-standard', 'pd-balanced', 'pd-ssd', 'pd-extreme'] as const;

export const CreateColabTemplateSchema = UpdateColabTemplateSchema.extend({
  region: RegionSchema,
  id: ColabResourceIdSchema.optional(),
  description: z.string().max(1000).default(''),
  machineType: z.string().min(1).max(64),
  acceleratorType: z.string().max(64).default(''),
  acceleratorCount: z.number().int().min(0).max(16).default(0),
  diskType: z.enum(diskTypes).default('pd-standard'),
  diskSizeGb: z.number().int().min(10).max(65_536).default(100),
  network: z.string().max(512).default(''),
  subnetwork: z.string().max(512).default(''),
  internetAccess: z.boolean().default(true),
  networkTags: z.array(z.string().min(1).max(63)).max(64).default([]),
  idleShutdown: z
    .object({ disabled: z.boolean().default(false), timeoutMinutes: z.number().int().min(10).max(1440).default(180) })
    .default({ disabled: false, timeoutMinutes: 180 }),
  euc: z.boolean().default(true),
  secureBoot: z.boolean().default(false),
  kmsKeyName: z.string().max(512).default(''),
  labels: labelMap.default({}),
});
export type CreateColabTemplate = z.infer<typeof CreateColabTemplateSchema>;

// ---- Runtimes ------------------------------------------------------------------------------------------

export const colabRuntimeStates = ['running', 'starting', 'stopping', 'stopped', 'upgrading', 'error', 'invalid', 'unknown'] as const;
export type ColabRuntimeState = (typeof colabRuntimeStates)[number];

export interface ColabRuntime {
  name: string;
  id: string;
  location: string;
  displayName: string;
  description: string | null;
  state: ColabRuntimeState;
  health: 'healthy' | 'unhealthy' | 'unknown';
  runtimeUser: string | null;
  /** Full name of the template the runtime came from. */
  template: string | null;
  type: ColabRuntimeType;
  machine: ColabMachine;
  network: ColabNetwork;
  idleShutdown: ColabIdleShutdown;
  upgradable: boolean;
  version: string | null;
  colabImage: string | null;
  /** "bigquery" when the runtime was started from BigQuery Studio. */
  entryService: 'bigquery' | 'vertex';
  expirationTime: string | null;
  createTime: string | null;
  updateTime: string | null;
  labels: Record<string, string>;
}

export const TemplateNameSchema = z
  .string()
  .max(512)
  .regex(/^projects\/[^/]+\/locations\/[^/]+\/notebookRuntimeTemplates\/[^/]+$/, 'A runtime template');

export const AssignColabRuntimeSchema = z.object({
  region: RegionSchema,
  template: TemplateNameSchema,
  displayName: z.string().min(1).max(128),
  description: z.string().max(1000).default(''),
  id: ColabResourceIdSchema.optional(),
});
export type AssignColabRuntime = z.infer<typeof AssignColabRuntimeSchema>;

export const colabRuntimeActions = ['start', 'stop', 'upgrade'] as const;
export type ColabRuntimeAction = (typeof colabRuntimeActions)[number];

// ---- Executions and schedules --------------------------------------------------------------------------

export const colabJobStates = [
  'queued',
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelling',
  'cancelled',
  'paused',
  'expired',
  'updating',
  'partially_succeeded',
  'unknown',
] as const;
export type ColabJobState = (typeof colabJobStates)[number];

export const RepositoryNameSchema = z
  .string()
  .max(512)
  .regex(/^projects\/[^/]+\/locations\/[^/]+\/repositories\/[^/]+$/, 'A notebook');

export const NotebookSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('notebook'), repository: RepositoryNameSchema, commitSha: z.string().max(64).optional() }),
  z.object({
    kind: z.literal('gcs'),
    uri: z
      .string()
      .max(2048)
      .regex(/^gs:\/\/[^/]+\/.+\.ipynb$/, 'A notebook in Cloud Storage, such as gs://bucket/path/report.ipynb'),
  }),
]);
export type NotebookSource = z.infer<typeof NotebookSourceSchema>;

/** Where a run reads its notebook, as Google reports it. */
export type ColabJobSource =
  | { kind: 'notebook'; repository: string; commitSha: string | null }
  | { kind: 'gcs'; uri: string; generation: string | null }
  | { kind: 'inline' }
  | { kind: 'unknown' };

export const ColabIdentitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('serviceAccount'), email: z.string().min(3).max(320).includes('@') }),
  z.object({ kind: z.literal('user'), email: z.string().min(3).max(320).includes('@') }),
]);
export type ColabIdentity = z.infer<typeof ColabIdentitySchema>;

/** One notebook run, as an execution and as the request a schedule repeats (SPEC-0010 D-08). */
export const ColabJobSpecSchema = z.object({
  displayName: z.string().min(1).max(128),
  source: NotebookSourceSchema,
  template: TemplateNameSchema,
  outputUri: z
    .string()
    .max(2048)
    .regex(/^gs:\/\/[a-z0-9][a-z0-9._-]{1,220}(\/.*)?$/, 'A Cloud Storage location such as gs://bucket/results'),
  identity: ColabIdentitySchema,
  timeoutSeconds: z
    .number()
    .int()
    .min(60)
    .max(7 * 86_400)
    .default(86_400),
  kernelName: z.string().max(128).default(''),
});
export type ColabJobSpec = z.infer<typeof ColabJobSpecSchema>;

/** The Vertex AI NotebookExecutionJob message for a run; the API sends it and forms show it (SPEC-0010 D-08). */
export function toNotebookExecutionJob(spec: ColabJobSpec): Record<string, unknown> {
  return {
    displayName: spec.displayName,
    ...(spec.source.kind === 'notebook'
      ? {
          dataformRepositorySource: {
            dataformRepositoryResourceName: spec.source.repository,
            ...(spec.source.commitSha ? { commitSha: spec.source.commitSha } : {}),
          },
        }
      : { gcsNotebookSource: { uri: spec.source.uri } }),
    notebookRuntimeTemplateResourceName: spec.template,
    gcsOutputUri: spec.outputUri.replace(/\/+$/, ''),
    ...(spec.identity.kind === 'serviceAccount' ? { serviceAccount: spec.identity.email } : { executionUser: spec.identity.email }),
    executionTimeout: `${spec.timeoutSeconds}s`,
    ...(spec.kernelName ? { kernelName: spec.kernelName } : {}),
  };
}

export interface ColabJobView {
  displayName: string;
  source: ColabJobSource;
  /** Full template name, or null when the job uses a custom machine. */
  template: string | null;
  customMachine: ColabMachine | null;
  outputUri: string | null;
  identity: { kind: 'serviceAccount' | 'user' | 'unknown'; email: string | null };
  timeoutSeconds: number | null;
  kernelName: string | null;
}

export interface ColabExecution extends ColabJobView {
  name: string;
  id: string;
  location: string;
  state: ColabJobState;
  status: { code: number; message: string | null } | null;
  /** Full name of the schedule that started it. */
  schedule: string | null;
  createTime: string | null;
  updateTime: string | null;
  labels: Record<string, string>;
}

export interface ColabExecutionList extends ListResponse<ColabExecution> {
  /** Regions with more executions than the newest page Nephoscope read (SPEC-0010 D-03). */
  truncated: string[];
}

export const CreateColabExecutionSchema = ColabJobSpecSchema.extend({
  region: RegionSchema,
  id: ColabResourceIdSchema.optional(),
});
export type CreateColabExecution = z.infer<typeof CreateColabExecutionSchema>;

export interface ColabExecutionOutput {
  /** The folder the run wrote to. */
  uri: string | null;
  bucket: string | null;
  prefix: string | null;
  objects: { name: string; size: number; updated: string | null }[];
  /** The executed notebook, when one was found. */
  notebook: string | null;
}

export const colabScheduleStates = ['active', 'paused', 'completed', 'unknown'] as const;
export type ColabScheduleState = (typeof colabScheduleStates)[number];

export interface ColabSchedule {
  name: string;
  id: string;
  location: string;
  displayName: string;
  /** As stored, including any CRON_TZ= or TZ= prefix. */
  cron: string;
  state: ColabScheduleState;
  maxConcurrentRunCount: number;
  maxRunCount: number | null;
  startedRunCount: number;
  allowQueueing: boolean;
  catchUp: boolean;
  startTime: string | null;
  endTime: string | null;
  nextRunTime: string | null;
  lastPauseTime: string | null;
  lastResumeTime: string | null;
  lastRun: { scheduledRunTime: string | null; response: string | null } | null;
  createTime: string | null;
  updateTime: string | null;
  job: ColabJobView;
}

export const SaveColabScheduleSchema = z.object({
  displayName: z.string().min(1).max(128),
  cron: z.string().min(9).max(256),
  maxConcurrentRunCount: z.number().int().min(1).max(100).default(1),
  maxRunCount: z.number().int().min(1).max(1_000_000).optional(),
  startTime: z.iso.datetime({ offset: true }).optional(),
  endTime: z.iso.datetime({ offset: true }).optional(),
  allowQueueing: z.boolean().default(false),
  job: ColabJobSpecSchema,
});
export type SaveColabSchedule = z.infer<typeof SaveColabScheduleSchema>;

export const CreateColabScheduleSchema = SaveColabScheduleSchema.extend({ region: RegionSchema });
export type CreateColabSchedule = z.infer<typeof CreateColabScheduleSchema>;

export const ResumeColabScheduleSchema = z.object({ catchUp: z.boolean().default(false) });
export type ResumeColabSchedule = z.infer<typeof ResumeColabScheduleSchema>;

// ---- Notebooks ---------------------------------------------------------------------------------------------

export interface ColabNotebook {
  /** The Dataform repository that stores the notebook. */
  name: string;
  id: string;
  location: string;
  displayName: string;
  createTime: string | null;
  labels: Record<string, string>;
  kmsKeyName: string | null;
}

export interface ColabCommit {
  sha: string;
  message: string | null;
  authorName: string | null;
  authorEmail: string | null;
  time: string | null;
}

export interface ColabNotebookDetail extends ColabNotebook {
  /** Path of the .ipynb file in the repository; null for an empty repository. */
  path: string | null;
  head: ColabCommit | null;
}

export type NotebookOutput =
  | { kind: 'stream'; name: string; text: string }
  | {
      kind: 'result';
      executionCount: number | null;
      text: string | null;
      /** Raster images and SVG, shown only through <img> (SPEC-0001 D-22). */
      image: { mime: string; data: string } | null;
      /** HTML is never rendered; its source is offered as text (SPEC-0001 D-22). */
      html: string | null;
      markdown: string | null;
      json: string | null;
      /** Other MIME types present but not shown. */
      omitted: string[];
    }
  | { kind: 'error'; name: string; value: string; traceback: string };

export interface NotebookCell {
  index: number;
  type: 'code' | 'markdown' | 'raw';
  source: string;
  executionCount: number | null;
  outputs: NotebookOutput[];
}

export interface RenderedNotebook {
  nbformat: string;
  kernel: string | null;
  language: string | null;
  cells: NotebookCell[];
}

export interface NotebookDocument {
  path: string;
  commitSha: string | null;
  size: number;
  notebook: RenderedNotebook | null;
  /** Why the file could not be read as a notebook; it can still be downloaded. */
  error: string | null;
}

const notebookText = z.string().min(2).max(NOTEBOOK_MAX_BYTES, 'Notebooks up to 10 MiB');

export const CreateColabNotebookSchema = z.object({
  region: RegionSchema,
  displayName: z.string().min(1).max(256),
  /** The .ipynb text; an empty notebook when left out. */
  content: notebookText.optional(),
});
export type CreateColabNotebook = z.infer<typeof CreateColabNotebookSchema>;

/** A new version of the notebook, rejected when someone saved since `baseCommitSha` (SPEC-0010 D-05). */
export const SaveColabNotebookSchema = z.object({
  content: notebookText,
  message: z.string().max(1000).default(''),
  baseCommitSha: z.string().max(64).nullable(),
});
export type SaveColabNotebook = z.infer<typeof SaveColabNotebookSchema>;

export const RenameColabNotebookSchema = z.object({ displayName: z.string().min(1).max(256) });
export type RenameColabNotebook = z.infer<typeof RenameColabNotebookSchema>;

export const CommitShaQuerySchema = z.object({
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/)
    .optional(),
});
