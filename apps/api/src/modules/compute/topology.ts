import type { LbAnnotation, LbEdge, LbNode, LbNodeKind, LbTopology, LoadBalancerView } from '@nephoscope/contracts';

// biome-ignore lint/suspicious/noExplicitAny: Compute resources are read field by field.
type Any = any;

/** The Compute lists the topology is built from (SPEC-0008 D-09). */
export interface TopologyInput {
  forwardingRules: Any[];
  targetHttpProxies: Any[];
  targetHttpsProxies: Any[];
  targetSslProxies: Any[];
  targetTcpProxies: Any[];
  urlMaps: Any[];
  backendServices: Any[];
  backendBuckets: Any[];
  targetPools: Any[];
  networkEndpointGroups: Any[];
  instanceGroupManagers: Any[];
}

const LINK = /^(?:https:)?\/\/(?:www|compute)\.googleapis\.com\/compute\/(?:v1|beta)\/projects\/[^/]+\//;

/** A Compute URL or self link as its path after the project: `global/urlMaps/web`. */
export function computePath(url: unknown): string {
  return typeof url === 'string' ? url.replace(LINK, '') : '';
}

const last = (p: string) => p.split('/').pop() ?? p;
/** `global`, or the region or zone of a Compute path. */
const scopeOfPath = (p: string) => (p.startsWith('global/') ? 'global' : (p.split('/')[1] ?? ''));

const PROXY_PROTOCOL: Record<string, string> = {
  targetHttpProxies: 'HTTP',
  targetHttpsProxies: 'HTTPS',
  targetSslProxies: 'SSL',
  targetTcpProxies: 'TCP',
};

function armorHref(project: string, policyPath: string): string | null {
  if (!policyPath) return null;
  return `/p/${project}/armor/${scopeOfPath(policyPath)}/${last(policyPath)}`;
}

/** Builds one view per load balancer: forwarding rules to backends, with their policies (SPEC-0008 D-09). */
export function buildTopology(project: string, input: TopologyInput, unreachable: string[] = []): LbTopology {
  const byPath = new Map<string, Any>();
  const index = (items: Any[]) => {
    for (const i of items) byPath.set(computePath(i?.selfLink), i);
  };
  for (const list of Object.values(input)) index(list as Any[]);
  const managedGroups = new Set(input.instanceGroupManagers.map((m) => computePath(m?.instanceGroup)));

  // Forwarding rules grouped under the resource the load balancer is named after.
  const groups = new Map<string, { rules: Any[]; proxies: Map<string, Any> }>();
  for (const fr of input.forwardingRules) {
    const target = computePath(fr?.target);
    if (/\/serviceAttachments\//.test(String(fr?.target ?? '')) || fr?.target === 'all-apis' || fr?.target === 'vpc-sc') continue;
    let root = '';
    let proxy: Any = null;
    const proxyKind = target.split('/').at(-2) ?? '';
    if (PROXY_PROTOCOL[proxyKind]) {
      proxy = byPath.get(target) ?? null;
      root = computePath(proxy?.urlMap) || computePath(proxy?.service);
    } else if (target.includes('/targetPools/')) root = target;
    else root = computePath(fr?.backendService);
    if (!root) continue;
    const g = groups.get(root) ?? { rules: [], proxies: new Map<string, Any>() };
    g.rules.push(fr);
    if (proxy) g.proxies.set(target, proxy);
    groups.set(root, g);
  }

  const loadBalancers: LoadBalancerView[] = [];
  for (const [root, g] of groups) {
    const nodes = new Map<string, LbNode>();
    const edges = new Map<string, LbEdge>();
    const node = (id: string, kind: LbNodeKind, facts: string[], annotations: LbAnnotation[] = [], href: string | null = null) => {
      if (!nodes.has(id)) nodes.set(id, { id, kind, name: last(id), scope: scopeOfPath(id), facts, annotations, href });
    };
    const edge = (from: string, to: string, label: string | null = null) => {
      const key = `${from}>${to}`;
      const prev = edges.get(key);
      if (!prev) edges.set(key, { from, to, label });
      else if (label && prev.label !== label) prev.label = prev.label ? `${prev.label}; ${label}` : label;
    };

    const addBackend = (servicePath: string) => {
      const s = byPath.get(servicePath);
      if (servicePath.includes('/backendBuckets/')) {
        node(
          servicePath,
          'backendBucket',
          s?.bucketName ? [`gs://${s.bucketName}`] : [],
          s?.edgeSecurityPolicy
            ? [
                {
                  kind: 'edgeArmor',
                  name: last(computePath(s.edgeSecurityPolicy)),
                  href: armorHref(project, computePath(s.edgeSecurityPolicy)),
                },
              ]
            : [],
          s?.bucketName ? `/p/${project}/storage/${s.bucketName}` : null,
        );
        return;
      }
      const annotations: LbAnnotation[] = [
        ...((s?.healthChecks ?? []) as string[]).map((h) => ({ kind: 'healthCheck' as const, name: last(computePath(h)), href: null })),
        ...(s?.securityPolicy
          ? [{ kind: 'armor' as const, name: last(computePath(s.securityPolicy)), href: armorHref(project, computePath(s.securityPolicy)) }]
          : []),
        ...(s?.edgeSecurityPolicy
          ? [
              {
                kind: 'edgeArmor' as const,
                name: last(computePath(s.edgeSecurityPolicy)),
                href: armorHref(project, computePath(s.edgeSecurityPolicy)),
              },
            ]
          : []),
      ];
      node(servicePath, 'backendService', [s?.protocol, s?.loadBalancingScheme].filter(Boolean) as string[], annotations);
      for (const b of (s?.backends ?? []) as Any[]) {
        const group = computePath(b?.group);
        if (!group) continue;
        if (group.includes('/networkEndpointGroups/')) {
          const neg = byPath.get(group);
          const region = scopeOfPath(group);
          let href: string | null = null;
          let fact = String(neg?.networkEndpointType ?? 'NEG');
          if (neg?.cloudRun?.service) {
            href = `/p/${project}/run/services/${region}/${neg.cloudRun.service}`;
            fact = `Cloud Run: ${neg.cloudRun.service}`;
          } else if (neg?.cloudFunction?.function) {
            href = `/p/${project}/functions/${region}/${neg.cloudFunction.function}`;
            fact = `Function: ${neg.cloudFunction.function}`;
          } else if (neg?.appEngine) {
            href = `/p/${project}/appengine`;
            fact = `App Engine${neg.appEngine.service ? `: ${neg.appEngine.service}` : ''}`;
          }
          node(group, 'neg', [fact], [], href);
        } else {
          const managed = managedGroups.has(group);
          node(
            group,
            'instanceGroup',
            [managed ? 'Managed' : 'Unmanaged'],
            [],
            managed ? `/p/${project}/r/compute/migs/${group.replace('/instanceGroups/', '/instanceGroupManagers/')}` : null,
          );
        }
        edge(servicePath, group);
      }
    };

    // Front end: forwarding rules and proxies.
    for (const fr of g.rules) {
      const frPath = computePath(fr?.selfLink);
      const port = fr?.portRange || (fr?.ports ?? []).join(',') || (fr?.allPorts ? 'all ports' : '');
      node(frPath, 'forwardingRule', [`${fr?.IPAddress ?? ''}${port ? `:${port}` : ''}`, String(fr?.IPProtocol ?? '')].filter(Boolean));
      const target = computePath(fr?.target);
      const proxy = g.proxies.get(target);
      if (proxy) {
        const certs: LbAnnotation[] = [
          ...((proxy?.sslCertificates ?? []) as string[]).map((c) => {
            const path = computePath(c);
            return { kind: 'certificate' as const, name: last(path), href: `/p/${project}/r/certmanager/sslcerts/${path}` };
          }),
          ...(proxy?.certificateMap
            ? [
                {
                  kind: 'certificateMap' as const,
                  name: last(String(proxy.certificateMap)),
                  href: `/p/${project}/r/certmanager/maps/${String(proxy.certificateMap).replace(/^.*?projects\/[^/]+\//, '')}`,
                },
              ]
            : []),
        ];
        node(target, 'targetProxy', [PROXY_PROTOCOL[target.split('/').at(-2) ?? ''] ?? 'Proxy'], certs);
        edge(frPath, target);
        edge(target, root);
      } else edge(frPath, root);
    }

    // Back end.
    const rootItem = byPath.get(root);
    if (root.includes('/urlMaps/')) {
      const um = rootItem;
      node(root, 'urlMap', [`${(um?.hostRules ?? []).length} host rules`]);
      const def = computePath(um?.defaultService);
      if (def) {
        edge(root, def, 'default');
        addBackend(def);
      }
      const matchers = new Map<string, Any>(((um?.pathMatchers ?? []) as Any[]).map((m) => [m?.name, m]));
      for (const hr of (um?.hostRules ?? []) as Any[]) {
        const hosts = ((hr?.hosts ?? []) as string[]).join(', ');
        const m = matchers.get(hr?.pathMatcher);
        if (!m) continue;
        const md = computePath(m.defaultService);
        if (md) {
          edge(root, md, hosts);
          addBackend(md);
        }
        for (const pr of (m.pathRules ?? []) as Any[]) {
          const s = computePath(pr?.service);
          if (!s) continue;
          edge(root, s, `${hosts} ${((pr?.paths ?? []) as string[]).join(', ')}`);
          addBackend(s);
        }
        for (const rr of (m.routeRules ?? []) as Any[]) {
          const s = computePath(rr?.service);
          if (!s) continue;
          edge(root, s, `${hosts} route ${rr?.priority ?? ''}`.trim());
          addBackend(s);
        }
      }
    } else if (root.includes('/targetPools/')) {
      node(
        root,
        'targetPool',
        [`${(rootItem?.instances ?? []).length} instances`],
        ((rootItem?.healthChecks ?? []) as string[]).map((h) => ({ kind: 'healthCheck' as const, name: last(computePath(h)), href: null })),
      );
    } else addBackend(root);

    const protocols = new Set<string>();
    for (const fr of g.rules) {
      const proxyKind = computePath(fr?.target).split('/').at(-2) ?? '';
      protocols.add(PROXY_PROTOCOL[proxyKind] ?? String(fr?.IPProtocol ?? ''));
    }
    loadBalancers.push({
      id: root,
      name: last(root),
      scheme: String(g.rules[0]?.loadBalancingScheme ?? rootItem?.loadBalancingScheme ?? ''),
      protocols: [...protocols].filter(Boolean).sort(),
      addresses: g.rules.map((fr) => `${fr?.IPAddress ?? ''}${fr?.portRange ? `:${fr.portRange}` : ''}`),
      nodes: [...nodes.values()],
      edges: [...edges.values()],
    });
  }
  loadBalancers.sort((a, b) => a.name.localeCompare(b.name));
  return { loadBalancers, unreachable };
}
