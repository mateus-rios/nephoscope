import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeHandle } from '../../testing/fake-handle.js';
import { RawApiService } from './rawapi.module.js';

const doc = {
  name: 'run',
  version: 'v2',
  rootUrl: 'https://run.googleapis.com/',
  servicePath: '',
  schemas: { Service: { id: 'Service', type: 'object', properties: { description: { type: 'string' } } } },
  resources: {
    projects: {
      resources: {
        locations: {
          resources: {
            services: {
              methods: {
                list: {
                  id: 'run.projects.locations.services.list',
                  httpMethod: 'GET',
                  path: 'v2/{+parent}/services',
                  parameters: {
                    parent: { type: 'string', location: 'path', required: true },
                    pageSize: { type: 'integer', location: 'query' },
                  },
                },
                patch: {
                  id: 'run.projects.locations.services.patch',
                  httpMethod: 'PATCH',
                  path: 'v2/{+name}',
                  parameters: { name: { type: 'string', location: 'path', required: true } },
                  request: { $ref: 'Service' },
                },
                delete: {
                  id: 'run.projects.locations.services.delete',
                  httpMethod: 'DELETE',
                  path: 'v2/{+name}',
                  parameters: { name: { type: 'string', location: 'path', required: true } },
                },
              },
            },
          },
        },
      },
    },
  },
};

function setup(extraDocs: Record<string, unknown> = {}) {
  const directory = {
    items: [
      {
        name: 'run',
        version: 'v2',
        title: 'Cloud Run Admin API',
        discoveryRestUrl: 'https://run.googleapis.com/$discovery/rest?version=v2',
        preferred: true,
      },
      {
        name: 'secretmanager',
        version: 'v1',
        title: 'Secret Manager API',
        discoveryRestUrl: 'https://secretmanager.googleapis.com/$discovery/rest?version=v1',
        preferred: true,
      },
    ],
  };
  const { h } = fakeHandle({
    'discovery/v1/apis': directory,
    '$discovery/rest': (c: { url: string }) => (c.url.includes('secretmanager') ? extraDocs.secretmanager : doc),
  });
  (h.auth as unknown as { getClient: () => Promise<unknown> }).getClient = async () => ({
    getRequestHeaders: async () => ({ authorization: 'Bearer test' }),
  });
  const history = {
    add: vi.fn(async (_key: string, _value: string, _limit?: number): Promise<string[]> => []),
    get: vi.fn(async (): Promise<string[]> => []),
  };
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ services: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'set-cookie': 'x=y', etag: '"1"' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return { h, history, fetchMock, raw: new RawApiService(history as never) };
}

describe('Raw API console (SPEC-0009 D-01)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds the URL from the discovery document and forwards only declared parameters', async () => {
    const { h, raw, fetchMock } = setup();
    const r = await raw.call(
      h,
      {
        api: 'run',
        version: 'v2',
        methodId: 'run.projects.locations.services.list',
        params: { parent: 'projects/demo/locations/us-central1', pageSize: '5', access_token: 'leak' },
      },
      'read',
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://run.googleapis.com/v2/projects/demo/locations/us-central1/services?pageSize=5');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(r.headers).toEqual({ 'content-type': 'application/json', etag: '"1"' });
    expect(r.body).toEqual({ services: [] });
  });

  it('sends reads and writes through their own routes only (T-04)', async () => {
    const { h, raw, fetchMock } = setup();
    const patch = {
      api: 'run',
      version: 'v2',
      methodId: 'run.projects.locations.services.patch',
      params: { name: 'projects/demo/locations/us/services/api' },
      body: {},
    };
    await expect(raw.call(h, patch, 'read')).rejects.toMatchObject({ problem: { code: 'INVALID_ARGUMENT' } });
    const list = {
      api: 'run',
      version: 'v2',
      methodId: 'run.projects.locations.services.list',
      params: { parent: 'projects/demo/locations/us' },
    };
    await expect(raw.call(h, list, 'write')).rejects.toMatchObject({ problem: { code: 'INVALID_ARGUMENT' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('needs the last path segment typed before a DELETE (T-05)', async () => {
    const { h, raw, fetchMock } = setup();
    const del = {
      api: 'run',
      version: 'v2',
      methodId: 'run.projects.locations.services.delete',
      params: { name: 'projects/demo/locations/us/services/api' },
    };
    await expect(raw.call(h, del, 'write')).rejects.toMatchObject({ problem: { code: 'CONFIRMATION_REQUIRED' } });
    await expect(raw.call(h, { ...del, confirm: 'wrong' }, 'write')).rejects.toMatchObject({ problem: { code: 'CONFIRMATION_REQUIRED' } });
    expect(fetchMock).not.toHaveBeenCalled();
    await raw.call(h, { ...del, confirm: 'api' }, 'write');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('refuses path values that would reach another API path', async () => {
    const { h, raw, fetchMock } = setup();
    const list = {
      api: 'run',
      version: 'v2',
      methodId: 'run.projects.locations.services.list',
      params: { parent: 'projects/demo/../../v1/other' },
    };
    await expect(raw.call(h, list, 'read')).rejects.toMatchObject({ problem: { code: 'INVALID_ARGUMENT' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps request bodies of secret APIs out of the history', async () => {
    const secretDoc = {
      ...doc,
      name: 'secretmanager',
      version: 'v1',
      rootUrl: 'https://secretmanager.googleapis.com/',
      schemas: { AddSecretVersionRequest: { id: 'AddSecretVersionRequest', type: 'object' } },
      resources: {
        projects: {
          resources: {
            secrets: {
              methods: {
                addVersion: {
                  id: 'secretmanager.projects.secrets.addVersion',
                  httpMethod: 'POST',
                  path: 'v1/{+parent}:addVersion',
                  parameters: { parent: { type: 'string', location: 'path', required: true } },
                  request: { $ref: 'AddSecretVersionRequest' },
                },
              },
            },
          },
        },
      },
    };
    const { h, raw, history } = setup({ secretmanager: secretDoc });
    await raw.call(
      h,
      {
        api: 'secretmanager',
        version: 'v1',
        methodId: 'secretmanager.projects.secrets.addVersion',
        params: { parent: 'projects/demo/secrets/db' },
        body: { payload: { data: 'c2VjcmV0' } },
      },
      'write',
    );
    await raw.call(
      h,
      {
        api: 'run',
        version: 'v2',
        methodId: 'run.projects.locations.services.patch',
        params: { name: 'projects/demo/locations/us/services/api' },
        body: { description: 'x' },
      },
      'write',
    );
    const saved = history.add.mock.calls.map((c) => JSON.parse(c[1]));
    expect(saved[0]).not.toHaveProperty('body');
    expect(saved[0]).toMatchObject({ methodId: 'secretmanager.projects.secrets.addVersion', status: 200 });
    expect(saved[1]).toMatchObject({ body: { description: 'x' } });
    expect(history.add.mock.calls[0]?.[2]).toBe(50);
  });

  it('lists the API tree and a method with its body schema', async () => {
    const { h, raw } = setup();
    const tree = await raw.tree(h, 'run', 'v2');
    expect(tree.baseUrl).toBe('https://run.googleapis.com/');
    expect(tree.resources[0]?.name).toBe('projects');
    const m = await raw.method(h, 'run', 'v2', 'run.projects.locations.services.patch');
    expect(m).toMatchObject({
      httpMethod: 'PATCH',
      requestRef: 'Service',
      parameters: [{ name: 'name', location: 'path', required: true }],
    });
    expect(m.requestSchema).toMatchObject({ $ref: '#/definitions/Service' });
  });
});
