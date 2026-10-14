import type {
  BqDatasetSummary,
  BqDatasetView,
  BqDryRunResult,
  BqJobDetail,
  BqJobSummary,
  BqResultsPage,
  BqTableSummary,
  BqTableView,
  DnsChangeView,
  DnsRecordSet,
  DnsZoneView,
  KitItem,
  LbTopology,
} from '@nephoscope/contracts';
import { list, PROJECT } from './fixtures';

type Route = [string, RegExp, (url: URL) => unknown];

/** Data and compute fixtures (SPEC-0008, M6). */

const now = Date.parse('2026-09-28T12:00:00Z');
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const P = `/api/projects/${PROJECT}`;
const CL = `https://www.googleapis.com/compute/v1/projects/${PROJECT}/`;

// ---- BigQuery ----------------------------------------------------------------------------------

export const JOB_ID = 'nephoscope_7b1c2d3e_4f50_4a6b_8c7d_9e0f1a2b3c4d';

const datasets: Record<string, BqDatasetSummary[]> = {
  [PROJECT]: [
    { projectId: PROJECT, datasetId: 'analytics', location: 'US', labels: {} },
    { projectId: PROJECT, datasetId: 'sales', location: 'US', labels: { team: 'finance' } },
  ],
  'bigquery-public-data': [{ projectId: 'bigquery-public-data', datasetId: 'samples', location: 'US', labels: {} }],
};

const salesTables: BqTableSummary[] = [
  { projectId: PROJECT, datasetId: 'sales', tableId: 'orders', type: 'TABLE', createTime: iso(90_000), expirationTime: null },
  { projectId: PROJECT, datasetId: 'sales', tableId: 'orders_by_day', type: 'VIEW', createTime: iso(40_000), expirationTime: null },
];

const field = (
  name: string,
  type: string,
  mode: 'NULLABLE' | 'REQUIRED' | 'REPEATED' = 'NULLABLE',
  fields: BqTableView['schema'] = [],
) => ({
  name,
  type,
  mode,
  description: null,
  policyTags: [],
  fields,
});

const ordersSchema = [
  field('order_id', 'INT64', 'REQUIRED'),
  field('customer', 'STRING'),
  field('total', 'NUMERIC'),
  field('created', 'TIMESTAMP'),
  field('items', 'STRUCT', 'REPEATED', [field('sku', 'STRING'), field('qty', 'INT64')]),
];

export const ordersTable: BqTableView = {
  ...(salesTables[0] as BqTableSummary),
  location: 'US',
  description: 'One row per checkout',
  labels: { team: 'finance' },
  schema: ordersSchema,
  numRows: '1834223',
  logicalBytes: '412316860',
  physicalBytes: '98566144',
  longTermBytes: '0',
  partitioning: 'DAY on created',
  clustering: ['customer'],
  modifiedTime: iso(30),
  viewQuery: null,
  materializedQuery: null,
  externalUris: [],
  etag: 'e1',
};

const salesDataset: BqDatasetView = {
  projectId: PROJECT,
  datasetId: 'sales',
  location: 'US',
  labels: { team: 'finance' },
  description: 'Checkout and refunds',
  defaultTableExpirationMs: null,
  createTime: iso(200_000),
  modifiedTime: iso(3_000),
  etag: 'd1',
};

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => [
    // BigInt: the API sends INT64 as text, and a JS number would round it.
    (9007199254740993n + BigInt(i)).toString(),
    `customer-${i % 7}`,
    `${(i * 13.37).toFixed(2)}`,
    `2026-09-28T1${i % 10}:00:00.000123Z`,
    [{ sku: `SKU-${i}`, qty: String(1 + (i % 3)) }],
  ]);

const results: BqResultsPage = { schema: ordersSchema, rows: rows(60), totalRows: '60', pageToken: null, jobComplete: true };

const jobSummary: BqJobSummary = {
  projectId: PROJECT,
  jobId: JOB_ID,
  location: 'US',
  type: 'QUERY',
  state: 'DONE',
  user: 'ana@example.com',
  createTime: iso(3),
  startTime: iso(3),
  endTime: iso(2.9),
  query: 'SELECT order_id, customer, total, created, items\nFROM `demo-project.sales.orders`\nLIMIT 60',
  totalBytesProcessed: '412316860',
  totalBytesBilled: '412316860',
  cacheHit: false,
  error: null,
};

const jobDetail: BqJobDetail = {
  ...jobSummary,
  totalSlotMs: '2410',
  statementType: 'SELECT',
  destination: { projectId: PROJECT, datasetId: '_6f1d2c', tableId: 'anon3a2b' },
  stages: [
    { name: 'S00: Input', status: 'COMPLETE', recordsRead: '1834223', recordsWritten: '60', slotMs: '2100' },
    { name: 'S01: Output', status: 'COMPLETE', recordsRead: '60', recordsWritten: '60', slotMs: '310' },
  ],
  errors: [],
};

const dry: BqDryRunResult = { ok: true, totalBytesProcessed: '1320702443', statementType: 'SELECT', referencedTables: [], error: null };

// ---- Kit items: Compute, VPC, GKE, Cloud SQL, App Engine ---------------------------------------

export const VM_PATH = 'zones/us-central1-a/instances/web-1';

const vm: KitItem = {
  _path: VM_PATH,
  _location: 'us-central1-a',
  id: '4529812830163543210',
  name: 'web-1',
  status: 'RUNNING',
  machineType: `${CL}zones/us-central1-a/machineTypes/e2-standard-2`,
  _machineType: 'e2-standard-2',
  _internalIp: '10.128.0.4',
  _externalIp: '34.70.12.9',
  _tags: 'web, ssh',
  _labels: 'env=prod',
  tags: { items: ['web', 'ssh'] },
  labels: { env: 'prod' },
  deletionProtection: false,
  creationTimestamp: iso(60_000),
};

const vms: KitItem[] = [
  vm,
  {
    ...vm,
    _path: 'zones/us-east1-b/instances/batch-7',
    _location: 'us-east1-b',
    name: 'batch-7',
    status: 'TERMINATED',
    _externalIp: '',
    _tags: '',
    tags: {},
  },
];

const firewalls: KitItem[] = [
  {
    _path: 'global/firewalls/allow-web',
    _location: 'global',
    name: 'allow-web',
    network: `${CL}global/networks/default`,
    priority: 1000,
    direction: 'INGRESS',
    _action: 'Allow',
    _actionValue: 'allow',
    _rules: 'tcp:80,tcp:443',
    _ranges: '0.0.0.0/0',
    _targets: 'Tags: web',
    _targetTags: 'web',
    _logging: true,
    _state: 'ENABLED',
    creationTimestamp: iso(80_000),
  },
  {
    _path: 'global/firewalls/deny-telnet',
    _location: 'global',
    name: 'deny-telnet',
    network: `${CL}global/networks/default`,
    priority: 900,
    direction: 'INGRESS',
    _action: 'Deny',
    _actionValue: 'deny',
    _rules: 'tcp:23',
    _ranges: '0.0.0.0/0',
    _targets: 'All instances',
    _targetTags: '',
    _logging: false,
    _state: 'DISABLED',
    creationTimestamp: iso(70_000),
  },
];

const networks: KitItem[] = [
  {
    _path: 'global/networks/default',
    _location: 'global',
    name: 'default',
    _mode: 'Auto',
    mtu: 1460,
    routingConfig: { routingMode: 'REGIONAL' },
    subnetworks: ['a', 'b'],
    peerings: [],
    creationTimestamp: iso(300_000),
  },
];

const cluster: KitItem = {
  _path: 'locations/us-central1/clusters/prod',
  _location: 'us-central1',
  name: 'prod',
  status: 'RUNNING',
  _mode: 'Autopilot',
  _maintenance: 'Daily from 03:00 UTC',
  currentMasterVersion: '1.33.4-gke.1200',
  currentNodeVersion: '1.33.4-gke.1200',
  releaseChannel: { channel: 'REGULAR' },
  currentNodeCount: 6,
  endpoint: '34.123.4.5',
  network: 'default',
  subnetwork: 'default',
  createTime: iso(100_000),
};

export const SQL_PATH = 'instances/orders-db';

const sql: KitItem = {
  _path: SQL_PATH,
  _location: 'us-central1',
  name: 'orders-db',
  state: 'RUNNABLE',
  _state: 'RUNNABLE',
  databaseVersion: 'POSTGRES_16',
  gceZone: 'us-central1-c',
  connectionName: `${PROJECT}:us-central1:orders-db`,
  _publicIp: '35.192.0.10',
  _privateIp: '10.10.0.3',
  _pitr: true,
  _maintenance: 'Sunday 03:00 UTC',
  _denyPeriods: [],
  _networks: '203.0.113.0/24',
  instanceType: 'CLOUD_SQL_INSTANCE',
  settings: {
    tier: 'db-custom-2-7680',
    availabilityType: 'REGIONAL',
    dataDiskSizeGb: '100',
    dataDiskType: 'PD_SSD',
    storageAutoResize: true,
    deletionProtectionEnabled: true,
    backupConfiguration: { enabled: true, startTime: '02:00' },
    ipConfiguration: { sslMode: 'ENCRYPTED_ONLY', authorizedNetworks: [{ value: '203.0.113.0/24' }] },
    databaseFlags: [
      { name: 'max_connections', value: '200' },
      { name: 'log_min_duration_statement', value: '500' },
    ],
    userLabels: { team: 'checkout' },
  },
  createTime: iso(150_000),
};

const flagCatalog = [
  { name: 'max_connections', type: 'INTEGER', appliesTo: ['POSTGRES_16'], requiresRestart: true, minValue: '14', maxValue: '262143' },
  { name: 'log_min_duration_statement', type: 'INTEGER', appliesTo: ['POSTGRES_16'], requiresRestart: false, minValue: '-1' },
  {
    name: 'cloudsql.iam_authentication',
    type: 'BOOLEAN',
    appliesTo: ['POSTGRES_16'],
    requiresRestart: false,
    allowedStringValues: ['on', 'off'],
  },
];

const app: KitItem = {
  _path: 'app',
  _location: '',
  id: PROJECT,
  servingStatus: 'SERVING',
  locationId: 'us-central',
  defaultHostname: `${PROJECT}.uc.r.appspot.com`,
  databaseType: 'CLOUD_FIRESTORE',
  serviceAccount: `${PROJECT}@appspot.gserviceaccount.com`,
  defaultBucket: `${PROJECT}.appspot.com`,
  dispatchRules: [{ domain: '*', path: '/api/*', service: 'api' }],
};

const aeServices: KitItem[] = [
  {
    _path: 'services/default',
    _location: '',
    id: 'default',
    _split: 'v12 90%, v11 10%',
    split: { shardBy: 'IP', allocations: { v12: 0.9, v11: 0.1 } },
  },
  { _path: 'services/api', _location: '', id: 'api', _split: 'v3 100%', split: { allocations: { v3: 1 } } },
];

// ---- Cloud DNS -------------------------------------------------------------------------------

const zone: DnsZoneView = {
  name: 'example-com',
  dnsName: 'example.com.',
  description: 'Public site',
  visibility: 'public',
  dnssec: 'on',
  networks: [],
  nameServers: ['ns-cloud-a1.googledomains.com.', 'ns-cloud-a2.googledomains.com.'],
  createTime: iso(400_000),
};

const records: DnsRecordSet[] = [
  {
    name: 'example.com.',
    type: 'SOA',
    ttl: 21600,
    rrdatas: ['ns-cloud-a1.googledomains.com. cloud-dns-hostmaster.google.com. 1 21600 3600 259200 300'],
    routingPolicy: null,
  },
  {
    name: 'example.com.',
    type: 'NS',
    ttl: 21600,
    rrdatas: ['ns-cloud-a1.googledomains.com.', 'ns-cloud-a2.googledomains.com.'],
    routingPolicy: null,
  },
  { name: 'example.com.', type: 'A', ttl: 300, rrdatas: ['34.1.2.3'], routingPolicy: null },
  { name: 'www.example.com.', type: 'CNAME', ttl: 300, rrdatas: ['example.com.'], routingPolicy: null },
  { name: 'geo.example.com.', type: 'A', ttl: 60, rrdatas: [], routingPolicy: 'Geolocation: us-east1 → 1.1.1.1; europe-west1 → 2.2.2.2' },
];

const changes: DnsChangeView[] = [
  { id: '12', status: 'done', startTime: iso(500), additions: [records[3] as DnsRecordSet], deletions: [] },
];

// ---- Load balancing ------------------------------------------------------------------------

export const topology: LbTopology = {
  unreachable: [],
  loadBalancers: [
    {
      id: 'global/urlMaps/web',
      name: 'web',
      scheme: 'EXTERNAL_MANAGED',
      protocols: ['HTTPS'],
      addresses: ['34.1.2.3:443-443'],
      nodes: [
        {
          id: 'global/forwardingRules/web-https',
          kind: 'forwardingRule',
          name: 'web-https',
          scope: 'global',
          facts: ['34.1.2.3:443-443', 'TCP'],
          annotations: [],
          href: null,
        },
        {
          id: 'global/targetHttpsProxies/web-proxy',
          kind: 'targetProxy',
          name: 'web-proxy',
          scope: 'global',
          facts: ['HTTPS'],
          annotations: [
            { kind: 'certificate', name: 'web-cert', href: `/p/${PROJECT}/r/certmanager/sslcerts/global/sslCertificates/web-cert` },
          ],
          href: null,
        },
        { id: 'global/urlMaps/web', kind: 'urlMap', name: 'web', scope: 'global', facts: ['1 host rules'], annotations: [], href: null },
        {
          id: 'global/backendServices/web-run',
          kind: 'backendService',
          name: 'web-run',
          scope: 'global',
          facts: ['HTTPS', 'EXTERNAL_MANAGED'],
          annotations: [{ kind: 'armor', name: 'edge-waf', href: `/p/${PROJECT}/armor/global/edge-waf` }],
          href: null,
        },
        {
          id: 'global/backendBuckets/assets',
          kind: 'backendBucket',
          name: 'assets',
          scope: 'global',
          facts: ['gs://demo-assets'],
          annotations: [],
          href: `/p/${PROJECT}/storage/demo-assets`,
        },
        {
          id: 'regions/us-central1/networkEndpointGroups/web-neg',
          kind: 'neg',
          name: 'web-neg',
          scope: 'us-central1',
          facts: ['Cloud Run: api'],
          annotations: [],
          href: `/p/${PROJECT}/run/services/us-central1/api`,
        },
      ],
      edges: [
        { from: 'global/forwardingRules/web-https', to: 'global/targetHttpsProxies/web-proxy', label: null },
        { from: 'global/targetHttpsProxies/web-proxy', to: 'global/urlMaps/web', label: null },
        { from: 'global/urlMaps/web', to: 'global/backendServices/web-run', label: 'default' },
        { from: 'global/urlMaps/web', to: 'global/backendBuckets/assets', label: 'static.example.com' },
        { from: 'global/backendServices/web-run', to: 'regions/us-central1/networkEndpointGroups/web-neg', label: null },
      ],
    },
  ],
};

const kitList = (key: string, items: KitItem[]): Route => ['GET', new RegExp(`^${P}/kit/${key}$`), () => list(items)];
const kitItem = (key: string, items: KitItem[]): Route => [
  'GET',
  new RegExp(`^${P}/kit/${key}/item$`),
  (url) => items.find((i) => i._path === url.searchParams.get('path')) ?? items[0],
];

export const dataRoutes: Route[] = [
  ['GET', new RegExp(`^${P}/bigquery/datasets$`), (url) => datasets[url.searchParams.get('project') ?? PROJECT] ?? []],
  ['GET', new RegExp(`^${P}/bigquery/datasets/${PROJECT}/sales$`), () => salesDataset],
  ['GET', new RegExp(`^${P}/bigquery/datasets/[^/]+/[^/]+/tables$`), () => salesTables],
  ['GET', new RegExp(`^${P}/bigquery/datasets/[^/]+/[^/]+/(routines|models)$`), () => []],
  ['GET', new RegExp(`^${P}/bigquery/tables/${PROJECT}/sales/orders$`), () => ordersTable],
  ['GET', new RegExp(`^${P}/bigquery/tables/${PROJECT}/sales/orders/preview$`), () => results],
  ['POST', new RegExp(`^${P}/bigquery/query/dryrun$`), () => dry],
  ['GET', new RegExp(`^${P}/bigquery/jobs$`), () => list([jobSummary])],
  ['GET', new RegExp(`^${P}/bigquery/jobs/US/${JOB_ID}$`), () => jobDetail],
  ['GET', new RegExp(`^${P}/bigquery/jobs/US/${JOB_ID}/results$`), () => results],
  kitList('bigquery/scheduled', []),
  kitList('compute/instances', vms),
  kitItem('compute/instances', vms),
  kitList('vpc/networks', networks),
  kitList('vpc/firewalls', firewalls),
  kitList('gke/clusters', [cluster]),
  kitItem('gke/clusters', [cluster]),
  kitList('gke/(nodepools|operations)', []),
  kitList('cloudsql/instances', [sql]),
  kitItem('cloudsql/instances', [sql]),
  ['GET', new RegExp(`^${P}/kit/cloudsql/instances/item/extras/flagcatalog$`), () => ({ value: flagCatalog })],
  kitList('cloudsql/(databases|users|backups|replicas|operations)', []),
  kitItem('appengine/application', [app]),
  kitList('appengine/services', aeServices),
  kitList('appengine/(firewall|cron)', []),
  ['GET', new RegExp(`^${P}/dns/zones$`), () => [zone]],
  ['GET', new RegExp(`^${P}/dns/zones/example-com$`), () => zone],
  ['GET', new RegExp(`^${P}/dns/zones/example-com/records$`), () => records],
  ['GET', new RegExp(`^${P}/dns/zones/example-com/changes$`), () => changes],
  kitList('dns/(policies|responsepolicies)', []),
  ['GET', new RegExp(`^${P}/loadbalancing/topology$`), () => topology],
];
