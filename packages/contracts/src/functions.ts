import { z } from 'zod';

/** Cloud Run functions and Cloud Functions gen1 and gen2 (SPEC-0003 §7.3). */

/**
 * `gen1` and `gen2` come from the Cloud Functions API; `run` are Cloud Run services deployed from
 * function source, which exist only in Cloud Run (SPEC-0003 D-07).
 */
export const functionGenerations = ['gen1', 'gen2', 'run'] as const;
export type FunctionGeneration = (typeof functionGenerations)[number];

export const functionStates = ['active', 'deploying', 'failed', 'deleting', 'unknown'] as const;
export type FunctionState = (typeof functionStates)[number];

export interface FunctionTrigger {
  kind: 'http' | 'event';
  /** Event type such as google.cloud.pubsub.topic.v1.messagePublished. */
  eventType: string | null;
  /** Topic, bucket or other resource the trigger listens to. */
  resource: string | null;
  retry: boolean | null;
}

export interface FunctionSummary {
  /** Functions API name, or the Cloud Run service name for `run` functions. */
  name: string;
  id: string;
  location: string;
  generation: FunctionGeneration;
  runtime: string | null;
  trigger: FunctionTrigger;
  state: FunctionState;
  updateTime: string | null;
  url: string | null;
  /** The Cloud Run service that serves a gen2 or `run` function. */
  runService: string | null;
}

export interface CloudFunction extends FunctionSummary {
  description: string | null;
  stateMessages: { severity: string; type: string; message: string }[];
  entryPoint: string | null;
  memory: string | null;
  cpu: string | null;
  timeoutSeconds: number | null;
  serviceAccount: string | null;
  environment: Record<string, string>;
  secretEnvironment: { key: string; secret: string; version: string }[];
  minInstances: number | null;
  maxInstances: number | null;
  concurrency: number | null;
  ingress: string | null;
  vpcConnector: string | null;
  buildId: string | null;
  dockerRepository: string | null;
  source: { bucket: string; object: string; generation: string | null } | { repository: string } | null;
  labels: Record<string, string>;
  createTime: string | null;
  /** Gen2 functions deployed from an archive can be edited and redeployed (SPEC-0003 D-09). */
  sourceEditable: boolean;
}

export interface SourceFile {
  path: string;
  size: number;
  /** Null for binary files and files over the text limit. */
  text: string | null;
  binary: boolean;
}

export interface FunctionSource {
  files: SourceFile[];
  archiveBytes: number;
  /** Set when some files were too large to include as text. */
  note: string | null;
}

export const MAX_SOURCE_ARCHIVE_BYTES = 100 * 1024 * 1024;
export const MAX_SOURCE_TEXT_BYTES = 2 * 1024 * 1024;

const sourcePath = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.startsWith('/') && !p.split('/').includes('..') && !p.includes('\\'), 'A relative path inside the archive');

/** Edited files, sent as a patch over the current archive (SPEC-0003 D-09, CA-17). */
export const RedeploySourceSchema = z.object({
  changed: z.array(z.object({ path: sourcePath, content: z.string().max(MAX_SOURCE_TEXT_BYTES) })).max(500),
  deleted: z.array(sourcePath).max(500).default([]),
});
export type RedeploySource = z.infer<typeof RedeploySourceSchema>;

export const FunctionIdSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[A-Za-z]([-_A-Za-z0-9]*[A-Za-z0-9])?$/, 'Letters, digits, hyphens and underscores');

// ---- Gen1 upgrade and detach (SPEC-0003 D-18, M7) --------------------------------------------

export const upgradeSteps = ['setup', 'redirect', 'rollback', 'commit', 'abort'] as const;
export type UpgradeStep = (typeof upgradeSteps)[number];

export interface FunctionUpgradeView {
  /** `upgradeInfo.upgradeState` of the Functions v2 API, or null when the function is not gen1. */
  state: string | null;
  /** The Cloud Run service of the 2nd gen copy, once set up. */
  copyService: string | null;
  /** Where requests go right now, in a sentence. */
  traffic: string;
  /** Steps the state allows, in the order they are usually taken. */
  steps: UpgradeStep[];
  /** Why no step is possible, when none is. */
  blocked: string | null;
}

export const UpgradeStepSchema = z.object({
  /** Event-driven functions may need the service account their new Eventarc trigger uses. */
  triggerServiceAccount: z.string().email().optional(),
  /** Commit and abort delete something, so they need the function id typed (SPEC-0001 D-13). */
  confirm: z.string().max(200).optional(),
});
export type UpgradeStepBody = z.infer<typeof UpgradeStepSchema>;

/** The guided sequence of SPEC-0003 D-18: what each upgrade state allows and where traffic goes. */
export function upgradePlan(state: string | null): Pick<FunctionUpgradeView, 'traffic' | 'steps' | 'blocked'> {
  const gen1 = 'All traffic goes to the 1st gen function.';
  const copy = 'All traffic goes to the 2nd gen copy; the 1st gen function still exists and can take it back.';
  switch (state) {
    case 'ELIGIBLE_FOR_2ND_GEN_UPGRADE':
      return { traffic: gen1, steps: ['setup'], blocked: null };
    case 'SETUP_FUNCTION_UPGRADE_CONFIG_SUCCESSFUL':
      return { traffic: `${gen1} A 2nd gen copy is ready to take it.`, steps: ['redirect', 'abort'], blocked: null };
    case 'SETUP_FUNCTION_UPGRADE_CONFIG_ERROR':
      return { traffic: gen1, steps: ['setup', 'abort'], blocked: null };
    case 'REDIRECT_FUNCTION_UPGRADE_TRAFFIC_SUCCESSFUL':
      return { traffic: copy, steps: ['commit', 'rollback'], blocked: null };
    case 'REDIRECT_FUNCTION_UPGRADE_TRAFFIC_ERROR':
      return { traffic: gen1, steps: ['redirect', 'abort'], blocked: null };
    case 'ROLLBACK_FUNCTION_UPGRADE_TRAFFIC_ERROR':
      return { traffic: copy, steps: ['rollback'], blocked: null };
    case 'COMMIT_FUNCTION_UPGRADE_ERROR':
      return { traffic: copy, steps: ['commit'], blocked: null };
    case 'COMMIT_FUNCTION_UPGRADE_ERROR_ROLLBACK_SAFE':
      return { traffic: copy, steps: ['commit', 'rollback'], blocked: null };
    case 'ABORT_FUNCTION_UPGRADE_ERROR':
      return { traffic: gen1, steps: ['abort'], blocked: null };
    case 'UPGRADE_OPERATION_IN_PROGRESS':
      return { traffic: 'A step is running; traffic stays where it was until it ends.', steps: [], blocked: 'A step is in progress.' };
    case 'INELIGIBLE_FOR_UPGRADE_UNTIL_REDEPLOYMENT':
      return { traffic: gen1, steps: [], blocked: 'Redeploy the function on a supported runtime before upgrading it.' };
    case null:
      return { traffic: 'This function already runs on Cloud Run.', steps: [], blocked: 'Only 1st gen functions are upgraded.' };
    default:
      return { traffic: gen1, steps: [], blocked: `Nephoscope does not know the upgrade state ${state}.` };
  }
}
