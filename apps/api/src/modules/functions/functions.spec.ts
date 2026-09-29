import type { RunServiceSummary } from '@nephoscope/contracts';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { mapFunction, mapFunctionSummary, mergeFunctions } from './functions-mapping.js';
import { isBinary, patchArchive, readArchive } from './source-archive.js';

const gen2 = {
  name: 'projects/demo/locations/us-central1/functions/hello',
  environment: 'GEN_2',
  state: 'ACTIVE',
  url: 'https://us-central1-demo.cloudfunctions.net/hello',
  updateTime: { seconds: '1790000000' },
  buildConfig: {
    runtime: 'nodejs22',
    entryPoint: 'hello',
    source: { storageSource: { bucket: 'gcf-v2-sources', object: 'hello/function-source.zip', generation: '17' } },
  },
  serviceConfig: {
    service: 'projects/demo/locations/us-central1/services/hello',
    uri: 'https://hello-abc-uc.a.run.app',
    availableMemory: '256M',
    timeoutSeconds: 60,
    environmentVariables: { MODE: 'prod' },
    secretEnvironmentVariables: [{ key: 'TOKEN', secret: 'api-token', version: 'latest' }],
  },
};

const gen1 = {
  name: 'projects/demo/locations/europe-west1/functions/onUpload',
  environment: 'GEN_1',
  state: 'ACTIVE',
  buildConfig: { runtime: 'python312', entryPoint: 'on_upload' },
  eventTrigger: {
    eventType: 'google.storage.object.finalize',
    eventFilters: [{ attribute: 'bucket', value: 'uploads' }],
    retryPolicy: 'RETRY_POLICY_RETRY',
  },
};

const runService = (over: Partial<RunServiceSummary>): RunServiceSummary => ({
  name: 'projects/demo/locations/us-central1/services/x',
  id: 'x',
  location: 'us-central1',
  uri: null,
  status: 'ready',
  statusMessage: null,
  lastDeployTime: null,
  lastDeployer: null,
  traffic: [],
  ingress: 'ALL',
  invokerIamDisabled: false,
  isFunction: false,
  functionTarget: null,
  functionRuntime: null,
  labels: {},
  ...over,
});

describe('function mapping', () => {
  it('maps gen2 functions with their Cloud Run service', () => {
    const f = mapFunction(gen2);
    expect(f).toMatchObject({
      id: 'hello',
      generation: 'gen2',
      runtime: 'nodejs22',
      state: 'active',
      trigger: { kind: 'http' },
      runService: 'projects/demo/locations/us-central1/services/hello',
      memory: '256M',
      timeoutSeconds: 60,
      environment: { MODE: 'prod' },
      secretEnvironment: [{ key: 'TOKEN', secret: 'api-token', version: 'latest' }],
      sourceEditable: true,
    });
  });

  it('maps event triggers of gen1 functions, which are never editable', () => {
    const f = mapFunction(gen1);
    expect(f.generation).toBe('gen1');
    expect(f.trigger).toEqual({ kind: 'event', eventType: 'google.storage.object.finalize', resource: 'uploads', retry: true });
    expect(f.sourceEditable).toBe(false);
    expect(f.runService).toBeNull();
  });
});

describe('mergeFunctions (SPEC-0003 D-07, T-18)', () => {
  it('lists each function once, adding Cloud Run functions only Cloud Run knows', () => {
    const merged = mergeFunctions(
      [mapFunctionSummary(gen2), mapFunctionSummary(gen1)],
      [
        // Backs the gen2 function: already listed.
        runService({
          name: 'projects/demo/locations/us-central1/services/hello',
          id: 'hello',
          isFunction: true,
          labels: { 'goog-managed-by': 'cloudfunctions' },
        }),
        // Deployed with gcloud run deploy --function: only in Cloud Run.
        runService({
          name: 'projects/demo/locations/us-east1/services/resize',
          id: 'resize',
          location: 'us-east1',
          isFunction: true,
          functionRuntime: 'go123',
          uri: 'https://resize.run.app',
        }),
        // A plain service.
        runService({ name: 'projects/demo/locations/us-east1/services/api', id: 'api', location: 'us-east1' }),
      ],
    );
    expect(merged.map((f) => `${f.id}:${f.generation}`)).toEqual(['hello:gen2', 'onUpload:gen1', 'resize:run']);
    expect(merged[2]).toMatchObject({
      runtime: 'go123',
      url: 'https://resize.run.app',
      runService: 'projects/demo/locations/us-east1/services/resize',
    });
  });
});

describe('source archives (SPEC-0003 D-09)', () => {
  const zip = zipSync({
    'index.js': strToU8('exports.hello = (req, res) => res.send("hi");\n'),
    'package.json': strToU8('{"name":"hello"}'),
    'assets/': new Uint8Array(),
    'assets/logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]),
  });

  it('lists files, text where possible, without directory entries', () => {
    const source = readArchive(zip);
    expect(source.files.map((f) => f.path)).toEqual(['assets/logo.png', 'index.js', 'package.json']);
    expect(source.files[0]).toMatchObject({ binary: true, text: null });
    expect(source.files[1]?.text).toContain('exports.hello');
  });

  it('applies edits, additions and deletions to the archive', () => {
    const next = unzipSync(
      patchArchive(zip, {
        changed: [
          { path: 'index.js', content: 'exports.hello = () => {};' },
          { path: 'lib/new.js', content: '1' },
        ],
        deleted: ['package.json'],
      }),
    );
    expect(Object.keys(next).sort()).toEqual(['assets/logo.png', 'index.js', 'lib/new.js']);
    expect(new TextDecoder().decode(next['index.js'])).toBe('exports.hello = () => {};');
    expect(next['assets/logo.png']).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
  });

  it('detects binary content', () => {
    expect(isBinary(strToU8('plain text'))).toBe(false);
    expect(isBinary(new Uint8Array([0x66, 0x00, 0x67]))).toBe(true);
    expect(isBinary(new Uint8Array([0xff, 0xfe, 0xfd]))).toBe(true);
  });
});
