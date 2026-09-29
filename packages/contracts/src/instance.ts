import { z } from 'zod';

/** Instance-wide state the shell needs for its banners and badges. */
export const InstanceInfoSchema = z.object({
  version: z.string(),
  readOnly: z.boolean(),
  requireToken: z.boolean(),
  host: z.object({
    name: z.string(),
    /** False when the page was served through a host from NEPHOSCOPE_ALLOWED_HOSTS (SPEC-0001 CA-17). */
    isLoopback: z.boolean(),
  }),
  emulators: z.object({
    firestore: z.string().nullable(),
    datastore: z.string().nullable(),
    pubsub: z.string().nullable(),
    storage: z.string().nullable(),
  }),
  dataDir: z.object({
    writable: z.boolean(),
    /** True when saved profiles exist but could not be decrypted (SPEC-0001 CA-05). */
    profilesUnreadable: z.boolean(),
  }),
  credentials: z.object({
    /** True when no Environment profile could be loaded (SPEC-0001 CA-01). */
    environmentMissing: z.boolean(),
    /** True when GOOGLE_APPLICATION_CREDENTIALS is set, whether or not its file loaded. */
    environmentFileSet: z.boolean(),
    /** Why the Environment profile failed to load; never contains key material (SPEC-0001 CA-01). */
    environmentError: z.string().nullable(),
  }),
});
export type InstanceInfo = z.infer<typeof InstanceInfoSchema>;

export const themes = ['system', 'light', 'dark'] as const;
export const densities = ['compact', 'default', 'comfortable'] as const;

export const PrefsSchema = z.object({
  density: z.enum(densities).default('default'),
  pageSize: z.number().int().min(25).max(500).default(50),
  pinnedProducts: z.array(z.string()).default([]),
  pinnedProjects: z.array(z.string()).default([]),
});
export type Prefs = z.infer<typeof PrefsSchema>;

export const UpdatePrefsSchema = PrefsSchema.partial();
export type UpdatePrefs = z.infer<typeof UpdatePrefsSchema>;
