import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeHandle } from '../../testing/fake-handle.js';
import { serialChannel, TopologyService } from './compute.module.js';
import { buildTopology, computePath, type TopologyInput } from './topology.js';

const L = 'https://www.googleapis.com/compute/v1/projects/demo/';

const empty: TopologyInput = {
  forwardingRules: [],
  targetHttpProxies: [],
  targetHttpsProxies: [],
  targetSslProxies: [],
  targetTcpProxies: [],
  urlMaps: [],
  backendServices: [],
  backendBuckets: [],
  targetPools: [],
  networkEndpointGroups: [],
  instanceGroupManagers: [],
};

describe('Load balancing topology (SPEC-0008 D-09)', () => {
  const https: TopologyInput = {
    ...empty,
    forwardingRules: [
      {
        selfLink: `${L}global/forwardingRules/web-https`,
        IPAddress: '34.1.2.3',
        IPProtocol: 'TCP',
        portRange: '443-443',
        target: `${L}global/targetHttpsProxies/web-proxy`,
        loadBalancingScheme: 'EXTERNAL_MANAGED',
      },
      { selfLink: `${L}global/forwardingRules/psc-apis`, IPAddress: '10.9.0.2', target: 'all-apis' },
    ],
    targetHttpsProxies: [
      {
        selfLink: `${L}global/targetHttpsProxies/web-proxy`,
        urlMap: `${L}global/urlMaps/web`,
        sslCertificates: [`${L}global/sslCertificates/web-cert`],
      },
    ],
    urlMaps: [
      {
        selfLink: `${L}global/urlMaps/web`,
        defaultService: `${L}global/backendServices/web-run`,
        hostRules: [{ hosts: ['static.example.com'], pathMatcher: 'static' }],
        pathMatchers: [
          {
            name: 'static',
            defaultService: `${L}global/backendBuckets/assets`,
            pathRules: [{ paths: ['/api/*'], service: `${L}global/backendServices/web-run` }],
          },
        ],
      },
    ],
    backendServices: [
      {
        selfLink: `${L}global/backendServices/web-run`,
        protocol: 'HTTPS',
        loadBalancingScheme: 'EXTERNAL_MANAGED',
        securityPolicy: `${L}global/securityPolicies/edge-waf`,
        backends: [{ group: `${L}regions/us-central1/networkEndpointGroups/web-neg` }],
      },
    ],
    backendBuckets: [{ selfLink: `${L}global/backendBuckets/assets`, bucketName: 'demo-assets' }],
    networkEndpointGroups: [
      {
        selfLink: `${L}regions/us-central1/networkEndpointGroups/web-neg`,
        networkEndpointType: 'SERVERLESS',
        cloudRun: { service: 'web' },
      },
    ],
  };

  it('draws an HTTPS chain to a serverless NEG, with its certificate and Armor policy', () => {
    const t = buildTopology('demo', https);
    expect(t.loadBalancers).toHaveLength(1);
    const lb = t.loadBalancers[0];
    expect(lb).toMatchObject({
      id: 'global/urlMaps/web',
      name: 'web',
      scheme: 'EXTERNAL_MANAGED',
      protocols: ['HTTPS'],
      addresses: ['34.1.2.3:443-443'],
    });
    const ids = lb?.nodes.map((n) => n.id) ?? [];
    expect(ids).toEqual(
      expect.arrayContaining([
        'global/forwardingRules/web-https',
        'global/targetHttpsProxies/web-proxy',
        'global/urlMaps/web',
        'global/backendServices/web-run',
        'global/backendBuckets/assets',
        'regions/us-central1/networkEndpointGroups/web-neg',
      ]),
    );
    expect(ids).not.toContain('global/forwardingRules/psc-apis');
    const neg = lb?.nodes.find((n) => n.kind === 'neg');
    expect(neg).toMatchObject({ href: '/p/demo/run/services/us-central1/web', facts: ['Cloud Run: web'] });
    const bs = lb?.nodes.find((n) => n.kind === 'backendService');
    expect(bs?.annotations).toContainEqual({ kind: 'armor', name: 'edge-waf', href: '/p/demo/armor/global/edge-waf' });
    const proxy = lb?.nodes.find((n) => n.kind === 'targetProxy');
    expect(proxy?.annotations).toContainEqual({
      kind: 'certificate',
      name: 'web-cert',
      href: '/p/demo/r/certmanager/sslcerts/global/sslCertificates/web-cert',
    });
    expect(lb?.edges).toContainEqual({
      from: 'global/urlMaps/web',
      to: 'global/backendServices/web-run',
      label: 'default; static.example.com /api/*',
    });
    expect(lb?.edges).toContainEqual({ from: 'global/urlMaps/web', to: 'global/backendBuckets/assets', label: 'static.example.com' });
  });

  it('groups a passthrough rule under its backend service and links managed groups', () => {
    const t = buildTopology('demo', {
      ...empty,
      forwardingRules: [
        {
          selfLink: `${L}regions/us-east1/forwardingRules/ilb`,
          IPAddress: '10.0.0.9',
          IPProtocol: 'TCP',
          ports: ['5432'],
          backendService: `${L}regions/us-east1/backendServices/db`,
          loadBalancingScheme: 'INTERNAL',
        },
      ],
      backendServices: [
        {
          selfLink: `${L}regions/us-east1/backendServices/db`,
          backends: [{ group: `${L}zones/us-east1-b/instanceGroups/db-mig` }],
          healthChecks: [`${L}regions/us-east1/healthChecks/pg`],
        },
      ],
      instanceGroupManagers: [{ instanceGroup: `${L}zones/us-east1-b/instanceGroups/db-mig` }],
    });
    const lb = t.loadBalancers[0];
    expect(lb).toMatchObject({ id: 'regions/us-east1/backendServices/db', scheme: 'INTERNAL', protocols: ['TCP'] });
    expect(lb?.nodes.find((n) => n.kind === 'instanceGroup')).toMatchObject({
      href: '/p/demo/r/compute/migs/zones/us-east1-b/instanceGroupManagers/db-mig',
    });
    expect(lb?.nodes.find((n) => n.kind === 'backendService')?.annotations).toEqual([{ kind: 'healthCheck', name: 'pg', href: null }]);
  });

  it('reads Compute links of both hosts as paths', () => {
    expect(computePath('https://compute.googleapis.com/compute/v1/projects/p/global/urlMaps/a')).toBe('global/urlMaps/a');
    expect(computePath('https://www.googleapis.com/compute/beta/projects/p/zones/z/instances/i')).toBe('zones/z/instances/i');
  });
});

describe('Topology reads (SPEC-0008 D-09)', () => {
  it('lists SSL proxies globally, since Compute has no aggregated list of them', async () => {
    const empty = { items: {} };
    const { h, calls } = fakeHandle({
      'aggregated/forwardingRules': empty,
      'aggregated/targetHttpProxies': empty,
      'aggregated/targetHttpsProxies': empty,
      'aggregated/targetTcpProxies': empty,
      'aggregated/urlMaps': empty,
      'aggregated/backendServices': empty,
      'aggregated/targetPools': empty,
      'aggregated/networkEndpointGroups': empty,
      'aggregated/instanceGroupManagers': empty,
      'global/backendBuckets': { items: [] },
      'global/targetSslProxies': { items: [] },
    });
    await expect(new TopologyService().topology(h, 'demo')).resolves.toEqual({ loadBalancers: [], unreachable: [] });
    expect(calls.some((c) => c.url.includes('aggregated/targetSslProxies'))).toBe(false);
  });
});

describe('compute.serial (SPEC-0008 D-07)', () => {
  afterEach(() => vi.useRealTimers());

  it('reads from the last offset and reports what Google dropped', async () => {
    vi.useFakeTimers();
    const responses = [
      { contents: 'boot\n', start: '0', next: '5' },
      { contents: 'later\n', start: '40', next: '46' },
    ];
    const { h, calls } = fakeHandle({ serialPort: () => responses.shift() ?? { contents: '', start: '46', next: '46' } });
    const data: unknown[] = [];
    const handle = await serialChannel(10).open(
      { profile: h, projectId: 'demo', params: { zone: 'us-central1-a', instance: 'web-1' } },
      { data: (d) => data.push(d), gap: () => undefined, error: () => undefined, end: () => undefined },
    );
    await vi.advanceTimersByTimeAsync(25);
    handle.close();
    expect(data).toEqual([
      { text: 'boot\n', skipped: 0 },
      { text: 'later\n', skipped: 35 },
    ]);
    expect(calls[0]?.url).toBe(
      'https://compute.googleapis.com/compute/v1/projects/demo/zones/us-central1-a/instances/web-1/serialPort?port=1',
    );
    expect(calls[1]?.url).toContain('start=5');
  });
});
