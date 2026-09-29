import { z } from 'zod';

/** Eventarc triggers (SPEC-0003 D-14, CA-28). */

export interface EventFilter {
  attribute: string;
  value: string;
  operator: string | null;
}

export type TriggerDestination =
  | { kind: 'cloudRun'; service: string; region: string; path: string | null }
  | { kind: 'workflow'; workflow: string }
  | { kind: 'cloudFunction'; function: string }
  | { kind: 'gke'; cluster: string; service: string }
  | { kind: 'http'; uri: string }
  | { kind: 'unknown' };

export interface EventarcTrigger {
  name: string;
  id: string;
  location: string;
  eventType: string | null;
  filters: EventFilter[];
  destination: TriggerDestination;
  serviceAccount: string | null;
  transportTopic: string | null;
  createTime: string | null;
  updateTime: string | null;
  labels: Record<string, string>;
  /** Condition messages, such as missing permissions on the service account. */
  conditions: { key: string; code: string; message: string }[];
}

export interface EventProvider {
  name: string;
  id: string;
  displayName: string;
  eventTypes: {
    type: string;
    description: string;
    filteringAttributes: { attribute: string; description: string; required: boolean; pathPatternSupported: boolean }[];
  }[];
}

export const TriggerIdSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z]([-a-z0-9]*[a-z0-9])?$/, 'Lowercase letters, digits and hyphens');

export const CreateTriggerSchema = z.object({
  id: TriggerIdSchema,
  region: z.string().min(2).max(40),
  filters: z
    .array(
      z.object({
        attribute: z.string().min(1).max(256),
        value: z.string().min(1).max(1024),
        operator: z.enum(['match-path-pattern']).optional(),
      }),
    )
    .min(1)
    .max(20)
    .refine((f) => f.some((x) => x.attribute === 'type'), 'An event type filter is required'),
  destination: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('cloudRun'),
      service: z.string().min(1).max(63),
      region: z.string().min(2).max(40),
      path: z.string().max(1024).optional(),
    }),
    z.object({
      kind: z.literal('workflow'),
      workflow: z
        .string()
        .regex(/^projects\/[^/]+\/locations\/[^/]+\/workflows\/[^/]+$/)
        .max(512),
    }),
  ]),
  serviceAccount: z.string().min(3).max(320),
  transportTopic: z
    .string()
    .regex(/^projects\/[^/]+\/topics\/[^/]+$/)
    .max(512)
    .optional(),
});
export type CreateTrigger = z.infer<typeof CreateTriggerSchema>;
