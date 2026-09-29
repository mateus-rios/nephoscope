import { z } from 'zod';

/**
 * Cloud Run services, revisions, jobs, executions and tasks (SPEC-0003 §7.1, §7.2). Names are v2
 * resource names: `projects/{project}/locations/{region}/services/{service}`.
 */

export const conditionStates = ['PENDING', 'RECONCILING', 'FAILED', 'SUCCEEDED', 'UNSPECIFIED'] as const;
export const ConditionSchema = z.object({
  type: z.string(),
  state: z.enum(conditionStates),
  message: z.string().nullable(),
  reason: z.string().nullable(),
  severity: z.enum(['ERROR', 'WARNING', 'INFO', 'UNSPECIFIED']),
  lastTransitionTime: z.string().nullable(),
});
export type Condition = z.infer<typeof ConditionSchema>;

/** One status per resource, derived from the terminal condition and `reconciling`. */
export const runStatuses = ['ready', 'deploying', 'failed', 'unknown'] as const;
export type RunStatus = (typeof runStatuses)[number];

export const ingressValues = ['ALL', 'INTERNAL_ONLY', 'INTERNAL_LOAD_BALANCER', 'NONE', 'UNSPECIFIED'] as const;
export type Ingress = (typeof ingressValues)[number];

export const EnvVarSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Letters, digits and underscores, not starting with a digit'),
  value: z.string().max(32_768).nullable().default(null),
  /** Secret Manager reference; `version` is a number or `latest`. */
  secret: z
    .object({ secret: z.string().min(1).max(512), version: z.string().min(1).max(64) })
    .nullable()
    .default(null),
});
export type EnvVar = z.infer<typeof EnvVarSchema>;

export const ContainerSchema = z.object({
  name: z.string(),
  image: z.string(),
  command: z.array(z.string()),
  args: z.array(z.string()),
  env: z.array(EnvVarSchema),
  port: z.number().int().nullable(),
  cpu: z.string().nullable(),
  memory: z.string().nullable(),
  /** False means CPU always allocated. */
  cpuIdle: z.boolean().nullable(),
  startupCpuBoost: z.boolean().nullable(),
  workingDir: z.string().nullable(),
  hasProbes: z.boolean(),
  volumeMounts: z.array(z.object({ name: z.string(), mountPath: z.string() })),
});
export type Container = z.infer<typeof ContainerSchema>;

export const VpcAccessSchema = z.object({
  connector: z.string().nullable(),
  egress: z.enum(['ALL_TRAFFIC', 'PRIVATE_RANGES_ONLY', 'UNSPECIFIED']),
  networkInterfaces: z.array(z.object({ network: z.string().nullable(), subnetwork: z.string().nullable(), tags: z.array(z.string()) })),
});
export type VpcAccess = z.infer<typeof VpcAccessSchema>;

export const executionEnvironments = ['GEN1', 'GEN2', 'UNSPECIFIED'] as const;

export const RevisionTemplateSchema = z.object({
  /** Full revision name requested by the template, when a suffix was set. */
  revision: z.string().nullable(),
  containers: z.array(ContainerSchema),
  minInstances: z.number().int().nullable(),
  maxInstances: z.number().int().nullable(),
  concurrency: z.number().int().nullable(),
  timeoutSeconds: z.number().nullable(),
  serviceAccount: z.string().nullable(),
  executionEnvironment: z.enum(executionEnvironments),
  vpc: VpcAccessSchema.nullable(),
  labels: z.record(z.string(), z.string()),
  volumes: z.array(z.object({ name: z.string(), kind: z.string() })),
  sessionAffinity: z.boolean(),
});
export type RevisionTemplate = z.infer<typeof RevisionTemplateSchema>;

export const TrafficTargetSchema = z.object({
  type: z.enum(['LATEST', 'REVISION']),
  /** Short revision name, null for LATEST. */
  revision: z.string().nullable(),
  percent: z.number().int().min(0).max(100),
  tag: z.string().nullable(),
});
export type TrafficTarget = z.infer<typeof TrafficTargetSchema>;

export const TrafficStatusSchema = TrafficTargetSchema.extend({ uri: z.string().nullable() });
export type TrafficStatus = z.infer<typeof TrafficStatusSchema>;

export const RunServiceSummarySchema = z.object({
  name: z.string(),
  id: z.string(),
  location: z.string(),
  uri: z.string().nullable(),
  status: z.enum(runStatuses),
  statusMessage: z.string().nullable(),
  lastDeployTime: z.string().nullable(),
  lastDeployer: z.string().nullable(),
  traffic: z.array(TrafficStatusSchema),
  ingress: z.enum(ingressValues),
  /** `public` when invoker IAM checks are off; bindings are resolved by the access endpoint. */
  invokerIamDisabled: z.boolean(),
  isFunction: z.boolean(),
  /** Entry point and runtime of a service deployed from function source (SPEC-0003 D-07). */
  functionTarget: z.string().nullable(),
  functionRuntime: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
});
export type RunServiceSummary = z.infer<typeof RunServiceSummarySchema>;

export const RunServiceSchema = z.object({
  name: z.string(),
  id: z.string(),
  location: z.string(),
  uri: z.string().nullable(),
  urls: z.array(z.string()),
  status: z.enum(runStatuses),
  statusMessage: z.string().nullable(),
  conditions: z.array(ConditionSchema),
  reconciling: z.boolean(),
  generation: z.string(),
  creator: z.string().nullable(),
  lastModifier: z.string().nullable(),
  createTime: z.string().nullable(),
  updateTime: z.string().nullable(),
  description: z.string().nullable(),
  ingress: z.enum(ingressValues),
  invokerIamDisabled: z.boolean(),
  defaultUriDisabled: z.boolean(),
  latestReadyRevision: z.string().nullable(),
  latestCreatedRevision: z.string().nullable(),
  traffic: z.array(TrafficTargetSchema),
  trafficStatuses: z.array(TrafficStatusSchema),
  template: RevisionTemplateSchema,
  labels: z.record(z.string(), z.string()),
  /** Set for services deployed from function source (SPEC-0003 D-07). */
  functionTarget: z.string().nullable(),
  etag: z.string().nullable(),
});
export type RunService = z.infer<typeof RunServiceSchema>;

export const RevisionSchema = z.object({
  name: z.string(),
  id: z.string(),
  service: z.string(),
  status: z.enum(runStatuses),
  statusMessage: z.string().nullable(),
  createTime: z.string().nullable(),
  creator: z.string().nullable(),
  /** Percent of traffic currently served, from the service's traffic statuses. */
  percent: z.number().int(),
  tags: z.array(z.string()),
  images: z.array(z.string()),
  /** Image digests resolved at deploy time, from the revision's containers. */
  imageDigests: z.array(z.string().nullable()),
  template: RevisionTemplateSchema,
  conditions: z.array(ConditionSchema),
  logUri: z.string().nullable(),
});
export type Revision = z.infer<typeof RevisionSchema>;

export const executionOutcomes = ['succeeded', 'failed', 'running', 'cancelled', 'pending', 'unknown'] as const;
export type ExecutionOutcome = (typeof executionOutcomes)[number];

export const RunJobSummarySchema = z.object({
  name: z.string(),
  id: z.string(),
  location: z.string(),
  status: z.enum(runStatuses),
  statusMessage: z.string().nullable(),
  taskCount: z.number().int().nullable(),
  executionCount: z.number().int(),
  lastExecution: z
    .object({
      name: z.string(),
      outcome: z.enum(executionOutcomes),
      createTime: z.string().nullable(),
      completionTime: z.string().nullable(),
    })
    .nullable(),
  lastDeployer: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
});
export type RunJobSummary = z.infer<typeof RunJobSummarySchema>;

export const RunJobSchema = z.object({
  name: z.string(),
  id: z.string(),
  location: z.string(),
  status: z.enum(runStatuses),
  statusMessage: z.string().nullable(),
  conditions: z.array(ConditionSchema),
  reconciling: z.boolean(),
  creator: z.string().nullable(),
  lastModifier: z.string().nullable(),
  createTime: z.string().nullable(),
  updateTime: z.string().nullable(),
  taskCount: z.number().int(),
  parallelism: z.number().int(),
  maxRetries: z.number().int().nullable(),
  timeoutSeconds: z.number().nullable(),
  serviceAccount: z.string().nullable(),
  executionEnvironment: z.enum(executionEnvironments),
  containers: z.array(ContainerSchema),
  vpc: VpcAccessSchema.nullable(),
  labels: z.record(z.string(), z.string()),
  executionCount: z.number().int(),
  latestExecution: z.string().nullable(),
  etag: z.string().nullable(),
});
export type RunJob = z.infer<typeof RunJobSchema>;

export const RunExecutionSchema = z.object({
  name: z.string(),
  id: z.string(),
  job: z.string(),
  outcome: z.enum(executionOutcomes),
  statusMessage: z.string().nullable(),
  createTime: z.string().nullable(),
  startTime: z.string().nullable(),
  completionTime: z.string().nullable(),
  taskCount: z.number().int(),
  parallelism: z.number().int(),
  running: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  cancelled: z.number().int(),
  retried: z.number().int(),
  conditions: z.array(ConditionSchema),
  logUri: z.string().nullable(),
  reconciling: z.boolean(),
});
export type RunExecution = z.infer<typeof RunExecutionSchema>;

export const RunTaskSchema = z.object({
  name: z.string(),
  index: z.number().int(),
  outcome: z.enum(executionOutcomes),
  retried: z.number().int(),
  exitCode: z.number().int().nullable(),
  lastAttemptMessage: z.string().nullable(),
  startTime: z.string().nullable(),
  completionTime: z.string().nullable(),
  logUri: z.string().nullable(),
});
export type RunTask = z.infer<typeof RunTaskSchema>;

// ---- Requests ------------------------------------------------------------------------------

const resourceId = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z]([-a-z0-9]*[a-z0-9])?$/, 'Lowercase letters, digits and hyphens; starts with a letter');
export const RunResourceIdSchema = resourceId;
export const RegionSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z]+(-[a-z0-9]+)+$/, 'A region such as us-central1');

const quantity = z
  .string()
  .max(16)
  .regex(/^\d+(\.\d+)?(m|Mi|Gi|Ki|M|G)?$/, 'A quantity such as 1, 1000m, 512Mi or 2Gi');

/** Fields the deploy form edits (SPEC-0003 D-02). Anything left out stays as it is. */
export const ContainerPatchSchema = z.object({
  /** Which container to edit; defaults to the one that receives requests. */
  name: z.string().max(63).optional(),
  image: z.string().min(1).max(1024).optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  command: z.array(z.string().max(4096)).max(100).optional(),
  args: z.array(z.string().max(4096)).max(1000).optional(),
  env: z.array(EnvVarSchema).max(1000).optional(),
  cpu: quantity.optional(),
  memory: quantity.optional(),
  cpuIdle: z.boolean().optional(),
  startupCpuBoost: z.boolean().optional(),
});
export type ContainerPatch = z.infer<typeof ContainerPatchSchema>;

export const VpcPatchSchema = z
  .object({
    connector: z.string().max(512).nullable().optional(),
    egress: z.enum(['ALL_TRAFFIC', 'PRIVATE_RANGES_ONLY']).optional(),
    network: z.string().max(512).nullable().optional(),
    subnetwork: z.string().max(512).nullable().optional(),
    tags: z.array(z.string().max(63)).max(20).optional(),
  })
  .nullable();

export const DeployServiceSchema = z.object({
  etag: z.string().max(256).optional(),
  container: ContainerPatchSchema.default({}),
  minInstances: z.number().int().min(0).max(1000).nullable().optional(),
  maxInstances: z.number().int().min(1).max(1000).nullable().optional(),
  concurrency: z.number().int().min(1).max(1000).optional(),
  timeoutSeconds: z.number().int().min(1).max(3600).optional(),
  executionEnvironment: z.enum(executionEnvironments).optional(),
  serviceAccount: z.string().max(320).nullable().optional(),
  ingress: z.enum(['ALL', 'INTERNAL_ONLY', 'INTERNAL_LOAD_BALANCER']).optional(),
  vpc: VpcPatchSchema.optional(),
  labels: z.record(z.string().max(63), z.string().max(63)).optional(),
  revisionSuffix: z
    .string()
    .max(40)
    .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, 'Lowercase letters, digits and hyphens')
    .nullable()
    .optional(),
  /** On: the new revision gets 100%. Off: the current split stays (SPEC-0003 D-02). */
  serveImmediately: z.boolean().default(true),
});
export type DeployService = z.infer<typeof DeployServiceSchema>;

export const CreateServiceSchema = DeployServiceSchema.extend({
  id: resourceId,
  region: RegionSchema,
  container: ContainerPatchSchema.extend({ image: z.string().min(1).max(1024) }),
  allowPublic: z.boolean().default(false),
});
export type CreateService = z.infer<typeof CreateServiceSchema>;

export const UpdateTrafficSchema = z
  .object({
    etag: z.string().max(256).optional(),
    traffic: z.array(TrafficTargetSchema).min(1).max(100),
  })
  .refine((v) => v.traffic.reduce((s, t) => s + t.percent, 0) === 100, {
    message: 'Traffic must add up to 100%',
    path: ['traffic'],
  });
export type UpdateTraffic = z.infer<typeof UpdateTrafficSchema>;

export const publicAccessModes = ['none', 'allUsers', 'invokerIamDisabled'] as const;
export type PublicAccessMode = (typeof publicAccessModes)[number];
export const PublicAccessSchema = z.object({ mode: z.enum(publicAccessModes) });
export type PublicAccess = z.infer<typeof PublicAccessSchema>;

export const ServiceAccessSchema = z.object({
  name: z.string(),
  /** `unknown` when the policy could not be read. */
  mode: z.enum([...publicAccessModes, 'unknown']),
  invokers: z.array(z.string()),
});
export type ServiceAccess = z.infer<typeof ServiceAccessSchema>;

export const ExecuteJobSchema = z.object({
  containerName: z.string().max(63).optional(),
  args: z.array(z.string().max(4096)).max(1000).optional(),
  env: z
    .array(z.object({ name: EnvVarSchema.shape.name, value: z.string().max(32_768) }))
    .max(1000)
    .optional(),
  taskCount: z.number().int().min(1).max(10_000).optional(),
  timeoutSeconds: z.number().int().min(1).max(604_800).optional(),
});
export type ExecuteJob = z.infer<typeof ExecuteJobSchema>;

export const UpdateJobSchema = z.object({
  etag: z.string().max(256).optional(),
  container: ContainerPatchSchema.omit({ port: true, cpuIdle: true, startupCpuBoost: true }).default({}),
  taskCount: z.number().int().min(1).max(10_000).optional(),
  parallelism: z.number().int().min(0).max(10_000).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeoutSeconds: z.number().int().min(1).max(604_800).optional(),
  serviceAccount: z.string().max(320).nullable().optional(),
  executionEnvironment: z.enum(executionEnvironments).optional(),
  labels: z.record(z.string().max(63), z.string().max(63)).optional(),
});
export type UpdateJob = z.infer<typeof UpdateJobSchema>;

/** Live `run.execution` channel params and messages (SPEC-0003 CA-11). */
export const RunExecutionChannelParamsSchema = z.object({ name: z.string().min(1).max(512) });
export type RunExecutionChannelParams = z.infer<typeof RunExecutionChannelParamsSchema>;
export interface RunExecutionUpdate {
  execution: RunExecution;
  tasks: RunTask[];
}
