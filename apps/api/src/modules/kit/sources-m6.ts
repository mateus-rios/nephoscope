import { ProblemException } from '../../core/problem/problem.js';
import type { ActionCtx, KitSource } from './sources.js';

// biome-ignore lint/suspicious/noExplicitAny: REST items are passed through as JSON.
type Any = any;

/**
 * REST sources of Compute Engine, VPC, GKE (SPEC-0008 D-07, D-08, D-11), Cloud SQL (D-05),
 * App Engine (SPEC-0003 D-15), BigQuery scheduled queries (SPEC-0008 D-01) and Cloud DNS
 * policies (D-10). All through the profile's REST client (SPEC-0001 D-29).
 */

const COMPUTE = 'https://compute.googleapis.com/compute/v1/';
const CONTAINER = 'https://container.googleapis.com/v1/';
const SQL = 'https://sqladmin.googleapis.com/v1/';
const APPENGINE = 'https://appengine.googleapis.com/v1/';
const SCHEDULER = 'https://cloudscheduler.googleapis.com/v1/';
const TRANSFER = 'https://bigquerydatatransfer.googleapis.com/v1/';
const DNS = 'https://dns.googleapis.com/dns/v1/';
const COMPUTE_LINK = /^https:\/\/(?:www|compute)\.googleapis\.com\/compute\/v1\/projects\/[^/]+\//;

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const short = (v: unknown): string => (typeof v === 'string' ? (v.split('/').pop() ?? v) : '');

/** A comma-separated field as a list. */
export function splitList(v: unknown): string[] {
  return String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `k=v, k2=v2` as a label map. */
export function parseLabels(v: unknown): Record<string, string> {
  return Object.fromEntries(
    splitList(v).map((pair) => {
      const i = pair.indexOf('=');
      return [pair.slice(0, i).trim(), pair.slice(i + 1).trim()];
    }),
  );
}

/** `tcp:80,tcp:8000-8080,udp` or `all` as Compute firewall rule entries, one per protocol. */
export function parseFirewallRules(v: unknown): { IPProtocol: string; ports?: string[] }[] {
  const text = String(v ?? '').trim();
  if (text === 'all') return [{ IPProtocol: 'all' }];
  const byProtocol = new Map<string, string[] | null>();
  for (const entry of splitList(text)) {
    const [protocol = '', port] = entry.split(':');
    const ports = byProtocol.get(protocol);
    // A protocol without ports covers every port, whatever else is listed for it.
    if (!port || ports === null) byProtocol.set(protocol, null);
    else byProtocol.set(protocol, [...(ports ?? []), port]);
  }
  return [...byProtocol].map(([IPProtocol, ports]) => (ports ? { IPProtocol, ports } : { IPProtocol }));
}

/** Compute firewall entries back to the text form of the edit field. */
export function firewallRulesText(rules: Any[]): string {
  return rules
    .map((r) =>
      Array.isArray(r?.ports) && r.ports.length
        ? r.ports.map((p: string) => `${r.IPProtocol}:${p}`).join(',')
        : String(r?.IPProtocol ?? ''),
    )
    .join(',');
}

/** `v1=0.9, v2=0.1` as App Engine allocations, which must add up to 1. */
export function parseAllocations(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of splitList(v)) {
    const [version = '', fraction = ''] = pair.split('=').map((s) => s.trim());
    out[version] = Number(fraction);
  }
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 0.001) {
    throw ProblemException.of('INVALID_ARGUMENT', `The fractions add up to ${Math.round(total * 1000) / 1000}; they must add up to 1.`, {
      errors: [{ path: 'allocations', message: 'Must add up to 1.' }],
    });
  }
  return out;
}

const zoneOf = (url: string) => /\/zones\/([^/]+)\//.exec(url)?.[1] ?? '';
const networkUrl = (project: string, name: unknown) => `projects/${project}/global/networks/${String(name)}`;
const post = (path: string, body: unknown = {}, query?: Record<string, string | number | boolean>) =>
  ({ method: 'POST', path, body, query }) as const;
const remove = (c: ActionCtx) => ({ method: 'DELETE', path: c.itemUrl }) as const;

const computeList = (collection: string): KitSource => ({
  root: COMPUTE,
  list: { mode: 'path', path: `projects/{project}/global/${collection}` },
  itemsKey: 'items',
});
const aggregated = (collection: string): KitSource => ({ root: COMPUTE, list: { mode: 'aggregated', collection }, itemsKey: collection });
const usersShort = (i: Any) => ({ _users: ((i?.users ?? []) as unknown[]).map(short) });

// ---- Compute Engine ----------------------------------------------------------------------------

function instanceDecorate(i: Any) {
  const nic = i?.networkInterfaces?.[0];
  return {
    _machineType: short(i?.machineType),
    _internalIp: nic?.networkIP ?? '',
    _externalIp: nic?.accessConfigs?.[0]?.natIP ?? '',
    _tags: ((i?.tags?.items ?? []) as string[]).join(', '),
    _labels: Object.entries((i?.labels ?? {}) as Record<string, string>)
      .map(([k, v]) => `${k}=${v}`)
      .join(', '),
  };
}

async function metadataWith(c: ActionCtx, change: (items: { key: string; value: string }[]) => { key: string; value: string }[]) {
  const i = await c.item();
  const before = (i?.metadata?.items ?? []) as { key: string; value: string }[];
  const items = change(before);
  return post(`${c.itemUrl}/setMetadata`, { fingerprint: i?.metadata?.fingerprint, items });
}

export const computeSources: Record<string, KitSource> = {
  'compute/instances': {
    ...aggregated('instances'),
    decorate: instanceDecorate,
    extras: {
      firewalls: (c) => ({ url: `${c.itemUrl}/getEffectiveFirewalls?networkInterface=nic0` }),
      screenshot: (c) => ({ url: `${c.itemUrl}/screenshot`, pick: (d) => d?.contents ?? '' }),
    },
    actions: {
      start: (c) => post(`${c.itemUrl}/start`),
      stop: (c) => post(`${c.itemUrl}/stop`),
      suspend: (c) => post(`${c.itemUrl}/suspend`),
      resume: (c) => post(`${c.itemUrl}/resume`),
      reset: (c) => post(`${c.itemUrl}/reset`),
      machineType: (c) =>
        post(`${c.itemUrl}/setMachineType`, { machineType: `zones/${zoneOf(c.itemUrl)}/machineTypes/${c.values.machineType}` }),
      labels: async (c) => {
        const i = await c.item();
        return post(`${c.itemUrl}/setLabels`, { labels: parseLabels(c.values.labels), labelFingerprint: i?.labelFingerprint });
      },
      tags: async (c) => {
        const i = await c.item();
        return post(`${c.itemUrl}/setTags`, { items: splitList(c.values.tags), fingerprint: i?.tags?.fingerprint });
      },
      setMetadata: (c) =>
        metadataWith(c, (items) => [
          ...items.filter((x) => x.key !== c.values.key),
          { key: String(c.values.key), value: String(c.values.value) },
        ]),
      removeMetadata: (c) =>
        metadataWith(c, (items) => {
          if (!items.some((x) => x.key === c.values.key))
            throw ProblemException.of('NOT_FOUND', `The instance has no metadata key ${String(c.values.key)}.`);
          return items.filter((x) => x.key !== c.values.key);
        }),
      protection: (c) => post(`${c.itemUrl}/setDeletionProtection`, {}, { deletionProtection: c.values.enabled === true }),
      delete: remove,
    },
  },
  'compute/disks': {
    ...aggregated('disks'),
    decorate: usersShort,
    actions: { snapshot: (c) => post(`${c.itemUrl}/createSnapshot`, { name: c.values.id }) },
  },
  'compute/snapshots': { ...computeList('snapshots'), actions: { delete: remove } },
  'compute/images': {
    ...computeList('images'),
    actions: {
      create: (c) => ({
        method: 'POST',
        path: `projects/${c.project}/global/images`,
        query: c.values.force === true ? { forceCreate: true } : undefined,
        body: { name: c.values.id, sourceDisk: `projects/${c.project}/${c.values.sourceDisk}`, family: c.values.family },
      }),
      delete: remove,
    },
  },
  'compute/templates': { ...aggregated('instanceTemplates'), actions: { delete: remove } },
  'compute/migs': {
    ...aggregated('instanceGroupManagers'),
    actions: { resize: (c) => post(`${c.itemUrl}/resize`, {}, { size: Number(c.values.size) }) },
  },
  'compute/miginstances': {
    root: COMPUTE,
    list: { mode: 'path', path: '{parent}/listManagedInstances', method: 'POST' },
    itemsKey: 'managedInstances',
    pathOf: (m) => String(m?.instance ?? '').replace(COMPUTE_LINK, ''),
  },

  // ---- VPC network ----------------------------------------------------------------------------
  'vpc/networks': {
    ...computeList('networks'),
    decorate: (n) => ({ _mode: n?.IPv4Range ? 'Legacy' : n?.autoCreateSubnetworks ? 'Auto' : 'Custom' }),
    actions: {
      create: (c) =>
        post(`projects/${c.project}/global/networks`, {
          name: c.values.id,
          autoCreateSubnetworks: c.values.mode === 'auto',
          mtu: c.values.mtu,
          routingConfig: c.values.routingMode ? { routingMode: c.values.routingMode } : undefined,
        }),
      delete: remove,
    },
  },
  'vpc/peerings': {
    root: COMPUTE,
    list: { mode: 'inline', field: 'peerings' },
    itemsKey: 'peerings',
    pathOf: (p, _l, parent) => `${parent}/peerings/${p?.name}`,
    // Peerings have no get method: the network is read and the peering picked from it.
    itemRequest: (project, path) => {
      const [network, name] = path.split('/peerings/');
      return { url: `${COMPUTE}projects/${project}/${network}`, pick: (d) => ((d?.peerings ?? []) as Any[]).find((p) => p?.name === name) };
    },
  },
  'vpc/subnets': {
    ...aggregated('subnetworks'),
    actions: {
      create: (c) =>
        post(`projects/${c.project}/regions/${c.values.region}/subnetworks`, {
          name: c.values.id,
          network: networkUrl(c.project, c.values.network),
          ipCidrRange: c.values.range,
          privateIpGoogleAccess: c.values.pga === true,
          logConfig: c.values.flowLogs === true ? { enable: true } : undefined,
        }),
      pga: (c) => post(`${c.itemUrl}/setPrivateIpGoogleAccess`, { privateIpGoogleAccess: c.values.enabled === true }),
      flowLogs: async (c) => {
        const s = await c.item();
        return {
          method: 'PATCH',
          path: c.itemUrl,
          body: { logConfig: { enable: c.values.enabled === true }, fingerprint: s?.fingerprint },
        };
      },
      expand: (c) => post(`${c.itemUrl}/expandIpCidrRange`, { ipCidrRange: c.values.range }),
      delete: remove,
    },
  },
  'vpc/firewalls': {
    ...computeList('firewalls'),
    decorate: (f) => {
      const egress = f?.direction === 'EGRESS';
      const tags = (f?.targetTags ?? []) as string[];
      const accounts = (f?.targetServiceAccounts ?? []) as string[];
      return {
        _actionValue: f?.denied ? 'deny' : 'allow',
        _action: f?.denied ? 'Deny' : 'Allow',
        _rules: firewallRulesText((f?.denied ?? f?.allowed ?? []) as Any[]),
        _ranges: (((egress ? f?.destinationRanges : f?.sourceRanges) ?? []) as string[]).join(', '),
        _targetTags: tags.join(', '),
        _targets: tags.length ? `Tags: ${tags.join(', ')}` : accounts.length ? `Accounts: ${accounts.join(', ')}` : 'All instances',
        _logging: !!f?.logConfig?.enable,
        _state: f?.disabled ? 'DISABLED' : 'ENABLED',
      };
    },
    actions: {
      create: (c) => {
        const egress = c.values.direction === 'EGRESS';
        return post(`projects/${c.project}/global/firewalls`, {
          name: c.values.id,
          network: networkUrl(c.project, c.values.network),
          direction: c.values.direction,
          priority: c.values.priority,
          [c.values.action === 'deny' ? 'denied' : 'allowed']: parseFirewallRules(c.values.rules),
          [egress ? 'destinationRanges' : 'sourceRanges']: splitList(c.values.ranges),
          targetTags: c.values.targetTags ? splitList(c.values.targetTags) : undefined,
          logConfig: { enable: c.values.logging === true },
          description: c.values.description,
        });
      },
      // The whole rule is replaced, so that switching allow and deny clears the other list.
      edit: async (c) => {
        const f = await c.item();
        const egress = f?.direction === 'EGRESS';
        const { allowed: _a, denied: _d, sourceRanges: _s, destinationRanges: _t, targetTags: _g, ...rest } = f ?? {};
        return {
          method: 'PUT',
          path: c.itemUrl,
          body: {
            ...rest,
            priority: c.values.priority,
            [c.values.action === 'deny' ? 'denied' : 'allowed']: parseFirewallRules(c.values.rules),
            [egress ? 'destinationRanges' : 'sourceRanges']: splitList(c.values.ranges),
            ...(c.values.targetTags ? { targetTags: splitList(c.values.targetTags) } : {}),
            logConfig: { ...(f?.logConfig ?? {}), enable: c.values.logging === true },
            description: c.values.description ?? '',
          },
        };
      },
      disable: (c) => ({ method: 'PATCH', path: c.itemUrl, body: { disabled: true } }),
      enable: (c) => ({ method: 'PATCH', path: c.itemUrl, body: { disabled: false } }),
      delete: remove,
    },
  },
  'vpc/firewallpolicies': aggregated('firewallPolicies'),
  'vpc/routes': {
    ...computeList('routes'),
    decorate: (r) => ({
      _nextHop:
        short(r?.nextHopGateway) ||
        r?.nextHopIp ||
        short(r?.nextHopInstance) ||
        short(r?.nextHopIlb) ||
        r?.nextHopPeering ||
        short(r?.nextHopVpnTunnel) ||
        (r?.nextHopNetwork ? `network ${short(r.nextHopNetwork)}` : ''),
    }),
    actions: {
      create: (c) => {
        const hop = c.values.hop;
        if (hop !== 'gateway' && !c.values.hopValue)
          throw ProblemException.of('INVALID_ARGUMENT', 'Give the next hop address or instance.', {
            errors: [{ path: 'hopValue', message: 'Required for this next hop.' }],
          });
        return post(`projects/${c.project}/global/routes`, {
          name: c.values.id,
          network: networkUrl(c.project, c.values.network),
          destRange: c.values.dest,
          priority: c.values.priority,
          tags: c.values.tags ? splitList(c.values.tags) : undefined,
          nextHopGateway: hop === 'gateway' ? `projects/${c.project}/global/gateways/default-internet-gateway` : undefined,
          nextHopIp: hop === 'ip' ? c.values.hopValue : undefined,
          nextHopInstance: hop === 'instance' ? `projects/${c.project}/${c.values.hopValue}` : undefined,
        });
      },
      delete: remove,
    },
  },
  'vpc/routers': aggregated('routers'),
  'vpc/nats': {
    root: COMPUTE,
    list: { mode: 'inline', field: 'nats' },
    itemsKey: 'nats',
    pathOf: (n, _l, parent) => `${parent}/nats/${n?.name}`,
    itemRequest: (project, path) => {
      const [router, name] = path.split('/nats/');
      return { url: `${COMPUTE}projects/${project}/${router}`, pick: (d) => ((d?.nats ?? []) as Any[]).find((n) => n?.name === name) };
    },
  },
  'vpc/addresses': {
    ...aggregated('addresses'),
    decorate: usersShort,
    actions: {
      create: (c) => {
        const scope = String(c.values.scope);
        const where = scope === 'global' ? 'global' : `regions/${scope}`;
        return post(`projects/${c.project}/${where}/addresses`, {
          name: c.values.id,
          addressType: c.values.type,
          subnetwork:
            c.values.type === 'INTERNAL' && c.values.subnet
              ? `projects/${c.project}/regions/${scope}/subnetworks/${c.values.subnet}`
              : undefined,
        });
      },
      delete: remove,
    },
  },
  'vpc/psc': {
    ...aggregated('forwardingRules'),
    keep: (r) =>
      !!r?.pscConnectionId || /\/serviceAttachments\//.test(String(r?.target ?? '')) || r?.target === 'all-apis' || r?.target === 'vpc-sc',
  },
  'vpc/serviceattachments': aggregated('serviceAttachments'),
  'vpc/connectors': {
    root: 'https://vpcaccess.googleapis.com/v1/',
    list: { mode: 'wildcard', path: 'projects/{project}/locations/-/connectors' },
    itemsKey: 'connectors',
  },

  // ---- GKE ------------------------------------------------------------------------------------
  'gke/clusters': {
    root: CONTAINER,
    list: { mode: 'wildcard', path: 'projects/{project}/locations/-/clusters' },
    itemsKey: 'clusters',
    pathOf: (c) => `locations/${c?.location}/clusters/${c?.name}`,
    decorate: (c) => {
      const w = c?.maintenancePolicy?.window;
      const maintenance = w?.dailyMaintenanceWindow?.startTime
        ? `Daily from ${w.dailyMaintenanceWindow.startTime} UTC`
        : w?.recurringWindow?.recurrence
          ? `${w.recurringWindow.recurrence}, from ${w.recurringWindow.window?.startTime ?? ''}`
          : 'Any time';
      return { _mode: c?.autopilot?.enabled ? 'Autopilot' : 'Standard', _maintenance: maintenance };
    },
    extras: {
      upgrades: (c) => ({
        url: `${CONTAINER}projects/${c.project}/${c.path.replace(/\/clusters\/[^/]+$/, '')}/serverConfig`,
        pick: (d) => ({
          defaultClusterVersion: d?.defaultClusterVersion,
          validMasterVersions: ((d?.validMasterVersions ?? []) as string[]).slice(0, 12),
          channels: d?.channels,
        }),
      }),
    },
  },
  'gke/nodepools': {
    root: CONTAINER,
    list: { mode: 'path', path: '{parent}/nodePools' },
    itemsKey: 'nodePools',
    pathOf: (np, _l, parent) => `${parent}/nodePools/${np?.name}`,
    actions: {
      resize: (c) => post(`${c.itemUrl}:setSize`, { nodeCount: c.values.nodeCount }),
      autoscaling: (c) =>
        post(`${c.itemUrl}:setAutoscaling`, {
          autoscaling:
            c.values.enabled === true ? { enabled: true, minNodeCount: c.values.min, maxNodeCount: c.values.max } : { enabled: false },
        }),
    },
  },
  'gke/operations': {
    root: CONTAINER,
    list: { mode: 'path', path: 'projects/{project}/locations/{location}/operations' },
    itemsKey: 'operations',
    keep: (op, ctx) => {
      const cluster = ctx.parent.split('/').pop() ?? '';
      return (
        String(op?.targetLink ?? '')
          .split('/clusters/')[1]
          ?.split('/')[0] === cluster
      );
    },
    pathOf: (op, location) => `locations/${location}/operations/${op?.name}`,
  },
};

// ---- Cloud SQL ---------------------------------------------------------------------------------

function sqlDecorate(i: Any) {
  const ips = (i?.ipAddresses ?? []) as Any[];
  const s = i?.settings ?? {};
  const w = s.maintenanceWindow;
  return {
    _state: i?.state === 'RUNNABLE' && s.activationPolicy === 'NEVER' ? 'STOPPED' : String(i?.state ?? ''),
    _publicIp: ips.find((a) => a?.type === 'PRIMARY')?.ipAddress ?? '',
    _privateIp: ips.find((a) => a?.type === 'PRIVATE')?.ipAddress ?? '',
    _pitr: !!(s.backupConfiguration?.pointInTimeRecoveryEnabled || s.backupConfiguration?.binaryLogEnabled),
    _maintenance: w?.day ? `${DAYS[Number(w.day)] ?? w.day} ${String(w.hour ?? 0).padStart(2, '0')}:00 UTC` : 'Any time',
    _denyPeriods: ((s.denyMaintenancePeriods ?? []) as Any[]).map((p) => `${p?.startDate} to ${p?.endDate}`),
    _networks: ((s.ipConfiguration?.authorizedNetworks ?? []) as Any[]).map((n) => n?.value).join(', '),
  };
}

const patchSettings = (c: ActionCtx, settings: Any) => ({ method: 'PATCH', path: c.itemUrl, body: { settings } }) as const;

async function flagsWith(c: ActionCtx, change: (flags: { name: string; value?: string }[]) => { name: string; value?: string }[]) {
  const i = await c.item();
  return patchSettings(c, { databaseFlags: change((i?.settings?.databaseFlags ?? []) as { name: string; value?: string }[]) });
}

/** A Cloud SQL user is addressed by name and, for MySQL, host. */
async function userQuery(c: ActionCtx): Promise<Record<string, string>> {
  const u = await c.item();
  if (!u) throw ProblemException.of('NOT_FOUND', 'The user was not found.');
  return u.host !== undefined && u.host !== '' ? { name: String(u.name), host: String(u.host) } : { name: String(u.name) };
}

export const dataSources: Record<string, KitSource> = {
  'cloudsql/instances': {
    root: SQL,
    list: { mode: 'path', path: 'projects/{project}/instances' },
    itemsKey: 'items',
    pathOf: (i) => `instances/${i?.name}`,
    decorate: sqlDecorate,
    extras: { flagcatalog: () => ({ url: `${SQL}flags`, pick: (d) => d?.items ?? [] }) },
    actions: {
      start: (c) => patchSettings(c, { activationPolicy: 'ALWAYS' }),
      stop: (c) => patchSettings(c, { activationPolicy: 'NEVER' }),
      restart: (c) => post(`${c.itemUrl}/restart`),
      failover: async (c) => {
        const i = await c.item();
        return post(`${c.itemUrl}/failover`, { failoverContext: { settingsVersion: i?.settings?.settingsVersion } });
      },
      export: (c) => {
        const csv = c.values.fileType === 'CSV';
        if (csv && !c.values.query)
          throw ProblemException.of('INVALID_ARGUMENT', 'A CSV export needs the query.', {
            errors: [{ path: 'query', message: 'Required for CSV.' }],
          });
        return post(`${c.itemUrl}/export`, {
          exportContext: {
            fileType: c.values.fileType,
            uri: c.values.uri,
            databases: c.values.databases ? splitList(c.values.databases) : undefined,
            csvExportOptions: csv ? { selectQuery: c.values.query } : undefined,
          },
        });
      },
      import: (c) => {
        const csv = c.values.fileType === 'CSV';
        if (csv && (!c.values.database || !c.values.table))
          throw ProblemException.of('INVALID_ARGUMENT', 'A CSV import needs the database and the table.', {
            errors: [{ path: c.values.database ? 'table' : 'database', message: 'Required for CSV.' }],
          });
        return post(`${c.itemUrl}/import`, {
          importContext: {
            fileType: c.values.fileType,
            uri: c.values.uri,
            database: c.values.database,
            csvImportOptions: csv ? { table: c.values.table } : undefined,
          },
        });
      },
      setFlag: (c) =>
        flagsWith(c, (flags) => [
          ...flags.filter((f) => f.name !== c.values.name),
          c.values.value === undefined ? { name: String(c.values.name) } : { name: String(c.values.name), value: String(c.values.value) },
        ]),
      removeFlag: (c) =>
        flagsWith(c, (flags) => {
          if (!flags.some((f) => f.name === c.values.name))
            throw ProblemException.of('NOT_FOUND', `The flag ${String(c.values.name)} is not set on the instance.`);
          return flags.filter((f) => f.name !== c.values.name);
        }),
      networks: (c) =>
        patchSettings(c, { ipConfiguration: { authorizedNetworks: splitList(c.values.networks).map((value) => ({ value })) } }),
      ssl: (c) => patchSettings(c, { ipConfiguration: { sslMode: c.values.mode } }),
      maintenance: (c) => patchSettings(c, { maintenanceWindow: { day: Number(c.values.day), hour: c.values.hour } }),
      promote: (c) => post(`${c.itemUrl}/promoteReplica`),
      delete: remove,
    },
  },
  'cloudsql/databases': {
    root: SQL,
    list: { mode: 'path', path: '{parent}/databases' },
    itemsKey: 'items',
    pathOf: (d, _l, parent) => `${parent}/databases/${d?.name}`,
    actions: {
      create: (c) =>
        post(`projects/${c.project}/${c.parent}/databases`, {
          name: c.values.id,
          charset: c.values.charset,
          collation: c.values.collation,
        }),
      delete: remove,
    },
  },
  'cloudsql/users': {
    root: SQL,
    list: { mode: 'path', path: '{parent}/users' },
    itemsKey: 'items',
    pathOf: (u, _l, parent) => `${parent}/users/${u?.name}`,
    // Users have no get method that takes the host: the list is read and the user picked.
    itemRequest: (project, path) => {
      const [instance, name] = path.split('/users/');
      return {
        url: `${SQL}projects/${project}/${instance}/users`,
        pick: (d) => ((d?.items ?? []) as Any[]).find((u) => u?.name === decodeURIComponent(name ?? '')),
      };
    },
    actions: {
      create: (c) =>
        post(`projects/${c.project}/${c.parent}/users`, { name: c.values.id, password: c.values.password, host: c.values.host }),
      password: async (c) => {
        const q = await userQuery(c);
        return { method: 'PUT', path: c.itemUrl, query: q, body: { ...q, password: c.values.password } };
      },
      delete: async (c) => ({ method: 'DELETE', path: c.itemUrl, query: await userQuery(c) }),
    },
  },
  'cloudsql/backups': {
    root: SQL,
    list: { mode: 'path', path: '{parent}/backupRuns' },
    itemsKey: 'items',
    pathOf: (b, _l, parent) => `${parent}/backupRuns/${b?.id}`,
    actions: {
      create: (c) => post(`projects/${c.project}/${c.parent}/backupRuns`, { description: c.values.description }),
      restore: async (c) => {
        const b = await c.item();
        return post(`projects/${c.project}/instances/${c.values.target}/restoreBackup`, {
          restoreBackupContext: { backupRunId: b?.id, instanceId: b?.instance, project: c.project },
        });
      },
      delete: remove,
    },
  },
  'cloudsql/replicas': {
    root: SQL,
    list: { mode: 'path', path: 'projects/{project}/instances' },
    itemsKey: 'items',
    keep: (i, ctx) =>
      String(i?.masterInstanceName ?? '')
        .split(':')
        .pop() === ctx.parent.split('/').pop(),
    pathOf: (i) => `instances/${i?.name}`,
    decorate: sqlDecorate,
  },
  'cloudsql/operations': {
    root: SQL,
    list: { mode: 'path', path: 'projects/{project}/operations' },
    itemsKey: 'items',
    query: { instance: '{parentId}' },
    pathOf: (op) => `operations/${op?.name}`,
  },

  // ---- App Engine ---------------------------------------------------------------------------
  'appengine/application': {
    root: APPENGINE,
    list: { mode: 'single', path: 'apps/{project}' },
    itemsKey: '',
    pathOf: () => 'app',
    itemRequest: (project) => ({ url: `${APPENGINE}apps/${project}` }),
  },
  'appengine/services': {
    root: APPENGINE,
    list: { mode: 'path', path: 'apps/{project}/services' },
    itemsKey: 'services',
    pathOf: (s) => `services/${s?.id}`,
    itemRequest: (project, path) => ({ url: `${APPENGINE}apps/${project}/${path}` }),
    decorate: (s) => {
      const a = Object.entries((s?.split?.allocations ?? {}) as Record<string, number>);
      return {
        _split: a.map(([v, f]) => `${v} ${Math.round(Number(f) * 1000) / 10}%`).join(', '),
        _allocations: a.map(([v, f]) => `${v}=${f}`).join(', '),
      };
    },
    actions: {
      split: (c) => ({
        method: 'PATCH',
        path: c.itemUrl,
        query: { updateMask: 'split' },
        body: { split: { allocations: parseAllocations(c.values.allocations), shardBy: c.values.shardBy } },
      }),
      migrate: (c) => ({
        method: 'PATCH',
        path: c.itemUrl,
        query: { updateMask: 'split', migrateTraffic: true },
        body: { split: { allocations: { [String(c.values.version)]: 1 } } },
      }),
    },
  },
  'appengine/versions': {
    root: APPENGINE,
    list: { mode: 'path', path: 'apps/{project}/{parent}/versions' },
    itemsKey: 'versions',
    query: { view: 'FULL' },
    pathOf: (v, _l, parent) => `${parent}/versions/${v?.id}`,
    itemRequest: (project, path) => ({ url: `${APPENGINE}apps/${project}/${path}`, query: { view: 'FULL' } }),
    decorate: (v) => {
      const scaling = v?.manualScaling ? 'manual' : v?.basicScaling ? 'basic' : 'automatic';
      const startable = scaling !== 'automatic';
      return {
        _scaling: scaling,
        _startable: startable && v?.servingStatus === 'STOPPED' ? 'yes' : 'no',
        _stoppable: startable && v?.servingStatus === 'SERVING' ? 'yes' : 'no',
      };
    },
    actions: {
      start: (c) => ({ method: 'PATCH', path: c.itemUrl, query: { updateMask: 'servingStatus' }, body: { servingStatus: 'SERVING' } }),
      stop: (c) => ({ method: 'PATCH', path: c.itemUrl, query: { updateMask: 'servingStatus' }, body: { servingStatus: 'STOPPED' } }),
      delete: remove,
    },
  },
  'appengine/instances': {
    root: APPENGINE,
    list: { mode: 'path', path: 'apps/{project}/{parent}/instances' },
    itemsKey: 'instances',
    pathOf: (i, _l, parent) => `${parent}/instances/${i?.id}`,
    itemRequest: (project, path) => ({ url: `${APPENGINE}apps/${project}/${path}` }),
  },
  'appengine/firewall': {
    root: APPENGINE,
    list: { mode: 'path', path: 'apps/{project}/firewall/ingressRules' },
    itemsKey: 'ingressRules',
    pathOf: (r) => `firewall/ingressRules/${r?.priority}`,
    itemRequest: (project, path) => ({ url: `${APPENGINE}apps/${project}/${path}` }),
  },
  'appengine/cron': {
    root: SCHEDULER,
    list: { mode: 'wildcard', path: 'projects/{project}/locations/-/jobs' },
    itemsKey: 'jobs',
    keep: (j) => !!j?.appEngineHttpTarget,
  },

  // ---- BigQuery scheduled queries -----------------------------------------------------------
  'bigquery/scheduled': {
    root: TRANSFER,
    list: { mode: 'wildcard', path: 'projects/{project}/locations/-/transferConfigs' },
    itemsKey: 'transferConfigs',
    query: { dataSourceIds: 'scheduled_query' },
    extras: { query: (c) => ({ url: c.itemUrl, pick: (d) => String(d?.params?.query ?? '') }) },
    actions: { run: (c) => post(`${c.itemUrl}:startManualRuns`, { requestedRunTime: new Date().toISOString() }) },
  },
  'bigquery/runs': { root: TRANSFER, list: { mode: 'path', path: '{parent}/runs' }, itemsKey: 'transferRuns' },

  // ---- Cloud DNS policies -------------------------------------------------------------------
  'dns/policies': {
    root: DNS,
    list: { mode: 'path', path: 'projects/{project}/policies' },
    itemsKey: 'policies',
    pathOf: (p) => `policies/${p?.name}`,
  },
  'dns/responsepolicies': {
    root: DNS,
    list: { mode: 'path', path: 'projects/{project}/responsePolicies' },
    itemsKey: 'responsePolicies',
    pathOf: (p) => `responsePolicies/${p?.responsePolicyName}`,
  },
  'dns/responserules': {
    root: DNS,
    list: { mode: 'path', path: '{parent}/rules' },
    itemsKey: 'responsePolicyRules',
    pathOf: (r, _l, parent) => `${parent}/rules/${r?.ruleName}`,
  },
};
