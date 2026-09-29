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
