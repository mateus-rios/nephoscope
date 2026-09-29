import { resolve } from 'node:path';
import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  NEPHOSCOPE_DATA_DIR: z.string().optional(),
  NEPHOSCOPE_READ_ONLY: booleanFlag,
  NEPHOSCOPE_ALLOWED_HOSTS: z.string().optional(),
  NEPHOSCOPE_SECRET: z.string().min(16, 'NEPHOSCOPE_SECRET must have at least 16 characters').optional(),
  NEPHOSCOPE_REQUIRE_TOKEN: booleanFlag,
  NEPHOSCOPE_ACCESS_TOKEN: z.string().min(24).optional(),
  NEPHOSCOPE_LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  NEPHOSCOPE_WEB_DIST: z.string().optional(),
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
  DATASTORE_EMULATOR_HOST: z.string().optional(),
  PUBSUB_EMULATOR_HOST: z.string().optional(),
  STORAGE_EMULATOR_HOST: z.string().optional(),
});

export interface NephoscopeConfig {
  host: string;
  port: number;
  credentialsFile: string | null;
  dataDir: string;
  readOnly: boolean;
  /** Extra host names accepted besides loopback (SPEC-0001 CA-12). Lowercase, without port. */
  allowedHosts: string[];
  secret: string | null;
  requireToken: boolean;
  accessToken: string | null;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  webDist: string | null;
  emulators: {
    firestore: string | null;
    datastore: string | null;
    pubsub: string | null;
    storage: string | null;
  };
  version: string;
}

export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'] as const;

export class ConfigError extends Error {}

/** Variables the Google SDKs read themselves; an empty value must not count as set. */
export const EMULATOR_VARIABLES = [
  'FIRESTORE_EMULATOR_HOST',
  'DATASTORE_EMULATOR_HOST',
  'PUBSUB_EMULATOR_HOST',
  'STORAGE_EMULATOR_HOST',
] as const;

/**
 * Compose passes `${VAR:-}` through as an empty string. Empty emulator variables are removed from the
 * process environment, so the SDKs talk to Google rather than to an empty host.
 */
export function clearEmptyEmulatorVariables(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of EMULATOR_VARIABLES) if (env[name] !== undefined && env[name].trim() === '') delete env[name];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NephoscopeConfig {
  // An empty variable means unset, as in a compose file that forwards optional values.
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = EnvSchema.safeParse(present);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const allowedHosts = (e.NEPHOSCOPE_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return {
    host: e.HOST,
    port: e.PORT,
    credentialsFile: e.GOOGLE_APPLICATION_CREDENTIALS?.trim() || null,
    dataDir: resolve(e.NEPHOSCOPE_DATA_DIR ?? '.nephoscope-data'),
    readOnly: e.NEPHOSCOPE_READ_ONLY,
    allowedHosts,
    secret: e.NEPHOSCOPE_SECRET ?? null,
    requireToken: e.NEPHOSCOPE_REQUIRE_TOKEN,
    accessToken: e.NEPHOSCOPE_ACCESS_TOKEN ?? null,
    logLevel: e.NEPHOSCOPE_LOG_LEVEL,
    webDist: e.NEPHOSCOPE_WEB_DIST ? resolve(e.NEPHOSCOPE_WEB_DIST) : null,
    emulators: {
      firestore: e.FIRESTORE_EMULATOR_HOST ?? null,
      datastore: e.DATASTORE_EMULATOR_HOST ?? null,
      pubsub: e.PUBSUB_EMULATOR_HOST ?? null,
      storage: e.STORAGE_EMULATOR_HOST ?? null,
    },
    version: process.env.npm_package_version ?? '0.1.0',
  };
}

export const NEPHOSCOPE_CONFIG = Symbol('NEPHOSCOPE_CONFIG');
