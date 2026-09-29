import { describe, expect, it } from 'vitest';
import { ConfigError, clearEmptyEmulatorVariables, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('defaults to loopback on 8080', () => {
    const config = loadConfig({});
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8080);
    expect(config.readOnly).toBe(false);
  });

  it('treats empty values as unset, as compose forwards them', () => {
    const config = loadConfig({
      FIRESTORE_EMULATOR_HOST: '',
      PUBSUB_EMULATOR_HOST: ' ',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      NEPHOSCOPE_SECRET: '',
      NEPHOSCOPE_READ_ONLY: '',
      PORT: '',
    });
    expect(config.emulators).toEqual({ firestore: null, datastore: null, pubsub: null, storage: null });
    expect(config.credentialsFile).toBeNull();
    expect(config.secret).toBeNull();
    expect(config.port).toBe(8080);
  });

  it('parses flags and the host allowlist', () => {
    const config = loadConfig({ NEPHOSCOPE_READ_ONLY: 'yes', NEPHOSCOPE_ALLOWED_HOSTS: 'nephoscope.lan, box ' });
    expect(config.readOnly).toBe(true);
    expect(config.allowedHosts).toEqual(['nephoscope.lan', 'box']);
  });

  it('rejects a short secret', () => {
    expect(() => loadConfig({ NEPHOSCOPE_SECRET: 'short' })).toThrow(ConfigError);
  });
});

describe('clearEmptyEmulatorVariables', () => {
  it('removes only empty emulator variables', () => {
    const env: NodeJS.ProcessEnv = { FIRESTORE_EMULATOR_HOST: '', PUBSUB_EMULATOR_HOST: 'pubsub:8085', OTHER: '' };
    clearEmptyEmulatorVariables(env);
    expect(env).toEqual({ PUBSUB_EMULATOR_HOST: 'pubsub:8085', OTHER: '' });
  });
});
