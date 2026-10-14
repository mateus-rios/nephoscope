import { COLAB_REGIONS, GCP_REGIONS } from '@nephoscope/contracts';
import type { QueryValue } from '../../core/gcp/rest.js';
import { computeSources, dataSources } from './sources-m6.js';

// biome-ignore lint/suspicious/noExplicitAny: REST items are passed through as JSON.
type Any = any;

export const COMPUTE = 'https://compute.googleapis.com/compute/v1/';

/** A request an action sends, relative to the source root unless it is a full URL. */
export interface ActionRequest {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

export interface ActionCtx {
  project: string;
  /** Full URL of the item, for item actions. */
  itemUrl: string;
  values: Record<string, string | number | boolean>;
  /** The item's REST JSON, read when the builder needs it (fingerprints, current lists). */
  item: () => Promise<Any>;
  /** Parent item path of a child collection's create action, already checked; '' otherwise. */
  parent: string;
  /** Item path of an item action, already checked; '' otherwise. */
  path: string;
}

export type ListMode =
  /**
   * One call; `{project}`, `{parent}` (the parent's full name) and `{location}` (the parent's) are
   * filled in. `POST` lists, such as Compute's `listManagedInstances`, send the page token in the query.
   */
  | { mode: 'path'; path: string; method?: 'POST' }
  /** Tries `locations/-`, then one call per location of the API (or per region). */
  | { mode: 'wildcard'; path: string }
  /** One call per region; `{location}` is filled in. */
  | { mode: 'regions'; path: string; regions?: readonly string[] }
  /** Compute Engine aggregated list, `items` keyed by scope. */
  | { mode: 'aggregated'; collection: string }
  /** A singleton read as a one-item list, such as an App Engine application. */
  | { mode: 'single'; path: string }
  /** Children read from a field of the parent item. */
  | { mode: 'inline'; field: string };

export interface KitSource {
  /** API root with a trailing slash; `{location}` is filled in for regional endpoints. */
  root: string;
  list: ListMode;
  /** Response field holding the items. */
  itemsKey: string;
  query?: Record<string, QueryValue>;
  /** Unwraps a listed element, such as SCC's `{ finding }`. */
  unwrap?: (raw: Any) => Any;
  /**
   * Item path of a listed item; by default the name without `projects/{p}/`, or the Compute self
   * link. `parent` is the parent's item path for child lists.
   */
  pathOf?: (item: Any, location: string, parent: string) => string;
  /** Computed `_` fields added to each item, for columns and conditions that need more than a path. */
  decorate?: (item: Any) => Record<string, unknown>;
  /** Keeps only the listed items that belong, such as a cluster's own operations. */
  keep?: (item: Any, ctx: { parent: string; parentName: string }) => boolean;
  /**
   * URL and query of an item; by default `{root}projects/{project}/{path}`. `{number}` in the URL
   * or query is replaced by the project number. `pick` reads the item out of the response.
   */
  itemRequest?: (project: string, path: string) => { url: string; query?: Record<string, QueryValue>; pick?: (data: Any) => Any };
  /** Extra sub-resources (KitCollection.extras), read with the item at hand. */
  extras?: Record<
    string,
    (ctx: { project: string; path: string; itemUrl: string; projectNumber: () => Promise<string> }) => {
      url: string;
      pick?: (data: Any) => unknown;
    }
  >;
  actions?: Record<string, (ctx: ActionCtx) => ActionRequest | Promise<ActionRequest>>;
}

const wild = (root: string, collection: string, itemsKey = collection): KitSource => ({
  root,
  list: { mode: 'wildcard', path: `projects/{project}/locations/-/${collection}` },
  itemsKey,
});
const child = (root: string, collection: string, itemsKey = collection, query?: Record<string, QueryValue>): KitSource => ({
  root,
  list: { mode: 'path', path: `{parent}/${collection}` },
  itemsKey,
  query,
});
const regional = (root: string, collection: string, itemsKey = collection, regions: readonly string[] = GCP_REGIONS): KitSource => ({
  root,
  list: { mode: 'regions', path: `projects/{project}/locations/{location}/${collection}`, regions },
  itemsKey,
});

const FILE = 'https://file.googleapis.com/v1/';
const CERTS = 'https://certificatemanager.googleapis.com/v1/';
const APIGW = 'https://apigateway.googleapis.com/v1/';
const REDIS = 'https://redis.googleapis.com/v1/';
const SPANNER = 'https://spanner.googleapis.com/v1/';
const BIGTABLE = 'https://bigtableadmin.googleapis.com/v2/';
const ALLOYDB = 'https://alloydb.googleapis.com/v1/';
const BATCH = 'https://batch.googleapis.com/v1/';
const VERTEX = 'https://{location}-aiplatform.googleapis.com/v1/';
const DATAPROC = 'https://dataproc.googleapis.com/v1/';
const TRANSFER = 'https://storagetransfer.googleapis.com/v1/';

const networkPath = (project: string, v: string) => (v.includes('/') ? v : `projects/${project}/global/networks/${v}`);

export const kitSources: Record<string, KitSource> = {
  'filestore/instances': wild(FILE, 'instances'),
  'filestore/backups': wild(FILE, 'backups'),
  'filestore/snapshots': child(FILE, 'snapshots'),

  'certmanager/certificates': wild(CERTS, 'certificates'),
  'certmanager/maps': wild(CERTS, 'certificateMaps'),
  'certmanager/entries': child(CERTS, 'certificateMapEntries'),
  'certmanager/dnsauth': wild(CERTS, 'dnsAuthorizations'),
  'certmanager/issuance': wild(CERTS, 'certificateIssuanceConfigs'),
  'certmanager/sslcerts': { root: COMPUTE, list: { mode: 'aggregated', collection: 'sslCertificates' }, itemsKey: 'sslCertificates' },

  'apigateway/apis': { root: APIGW, list: { mode: 'path', path: 'projects/{project}/locations/global/apis' }, itemsKey: 'apis' },
  'apigateway/configs': child(APIGW, 'configs', 'apiConfigs'),
  'apigateway/gateways': wild(APIGW, 'gateways'),

  'memorystore/redis': {
    ...wild(REDIS, 'instances'),
    actions: {
      scale: (c) => ({
        method: 'PATCH',
        path: c.itemUrl,
        query: { updateMask: 'memorySizeGb' },
        body: { memorySizeGb: c.values.memorySizeGb },
      }),
      failover: (c) => ({ method: 'POST', path: `${c.itemUrl}:failover`, body: { dataProtectionMode: c.values.mode } }),
      export: (c) => ({ method: 'POST', path: `${c.itemUrl}:export`, body: { outputConfig: { gcsDestination: { uri: c.values.uri } } } }),
      import: (c) => ({ method: 'POST', path: `${c.itemUrl}:import`, body: { inputConfig: { gcsSource: { uri: c.values.uri } } } }),
      delete: (c) => ({ method: 'DELETE', path: c.itemUrl }),
      create: (c) => ({
        method: 'POST',
        path: `projects/${c.project}/locations/${c.values.region}/instances`,
        query: { instanceId: String(c.values.id) },
        body: {
          tier: c.values.tier,
          memorySizeGb: c.values.memorySizeGb,
          redisVersion: c.values.redisVersion,
          authorizedNetwork: c.values.network ? networkPath(c.project, String(c.values.network)) : undefined,
        },
      }),
    },
  },
  'memorystore/clusters': wild(REDIS, 'clusters'),
  'memorystore/valkey': wild('https://memorystore.googleapis.com/v1/', 'instances'),
  'memorystore/memcached': wild('https://memcache.googleapis.com/v1/', 'instances'),

  'spanner/instances': { root: SPANNER, list: { mode: 'path', path: 'projects/{project}/instances' }, itemsKey: 'instances' },
  'spanner/databases': {
    ...child(SPANNER, 'databases'),
    extras: {
      ddl: (c) => ({ url: `${c.itemUrl}/ddl`, pick: (d) => ((d?.statements ?? []) as string[]).map((s) => `${s};`).join('\n\n') }),
    },
  },
  'spanner/backups': child(SPANNER, 'backups'),

  'bigtable/instances': { root: BIGTABLE, list: { mode: 'path', path: 'projects/{project}/instances' }, itemsKey: 'instances' },
  'bigtable/clusters': child(BIGTABLE, 'clusters'),
  'bigtable/tables': child(BIGTABLE, 'tables', 'tables', { view: 'SCHEMA_VIEW' }),
  'bigtable/appprofiles': child(BIGTABLE, 'appProfiles'),
  'bigtable/backups': child(BIGTABLE, 'backups'),

  'alloydb/clusters': wild(ALLOYDB, 'clusters'),
  'alloydb/instances': child(ALLOYDB, 'instances'),
  'alloydb/backups': wild(ALLOYDB, 'backups'),

  'batch/jobs': wild(BATCH, 'jobs'),
  'batch/taskgroups': { root: BATCH, list: { mode: 'inline', field: 'taskGroups' }, itemsKey: 'taskGroups' },
  'batch/tasks': child(BATCH, 'tasks'),

  'vertexai/models': regional(VERTEX, 'models', 'models', COLAB_REGIONS),
  'vertexai/endpoints': regional(VERTEX, 'endpoints', 'endpoints', COLAB_REGIONS),
  'vertexai/pipelines': regional(VERTEX, 'pipelineJobs', 'pipelineJobs', COLAB_REGIONS),
  'vertexai/customjobs': regional(VERTEX, 'customJobs', 'customJobs', COLAB_REGIONS),

  'dataflow/jobs': {
    root: 'https://dataflow.googleapis.com/v1b3/',
    list: { mode: 'path', path: 'projects/{project}/jobs:aggregated' },
    itemsKey: 'jobs',
    pathOf: (j) => `locations/${j.location}/jobs/${j.id}`,
  },

  'dataproc/clusters': {
    root: DATAPROC,
    list: { mode: 'regions', path: 'projects/{project}/regions/{location}/clusters' },
    itemsKey: 'clusters',
    pathOf: (c, location) => `regions/${location}/clusters/${c.clusterName}`,
  },
  'dataproc/jobs': {
    root: DATAPROC,
    list: { mode: 'regions', path: 'projects/{project}/regions/{location}/jobs' },
    itemsKey: 'jobs',
    pathOf: (j, location) => `regions/${location}/jobs/${j.reference?.jobId}`,
  },
  'dataproc/batches': regional(DATAPROC, 'batches'),

  'composer/environments': regional('https://composer.googleapis.com/v1/', 'environments'),

  'storagetransfer/jobs': {
    root: TRANSFER,
    list: { mode: 'path', path: 'transferJobs' },
    itemsKey: 'transferJobs',
    query: { filter: '{"projectId":"{project}"}' },
    itemRequest: (project, path) => ({ url: `${TRANSFER}${path}`, query: { projectId: project } }),
  },
  'storagetransfer/operations': {
    root: TRANSFER,
    list: { mode: 'path', path: 'transferOperations' },
    itemsKey: 'operations',
    query: { filter: '{"projectId":"{project}","jobNames":["{parent}"]}' },
    itemRequest: (_project, path) => ({ url: `${TRANSFER}${path}` }),
  },

  'scc/findings': {
    root: 'https://securitycenter.googleapis.com/v1/',
    list: { mode: 'path', path: 'projects/{project}/sources/-/findings' },
    itemsKey: 'listFindingsResults',
    query: { filter: 'state="ACTIVE"' },
    unwrap: (r) => r?.finding ?? r,
    // Findings have no get method: the item is listed by its exact name.
    itemRequest: (project, path) => ({
      url: `https://securitycenter.googleapis.com/v1/projects/${project}/${path.replace(/\/findings\/[^/]+$/, '/findings')}`,
      query: { filter: `name="projects/{number}/${path}"` },
      pick: (d) => d?.listFindingsResults?.[0]?.finding,
    }),
  },

  'iap/backends': {
    root: COMPUTE,
    list: { mode: 'aggregated', collection: 'backendServices' },
    itemsKey: 'backendServices',
    extras: {
      iapSettings: (c) => ({ url: `https://iap.googleapis.com/v1/projects/{number}/iap_web/${iapScope(c.path)}:iapSettings` }),
    },
  },

  'connectivitytests/tests': {
    root: 'https://networkmanagement.googleapis.com/v1/',
    list: { mode: 'path', path: 'projects/{project}/locations/global/connectivityTests' },
    itemsKey: 'resources',
  },

  'iam/denypolicies': {
    root: 'https://iam.googleapis.com/v2/',
    list: { mode: 'path', path: 'policies/cloudresourcemanager.googleapis.com%2Fprojects%2F{project}/denypolicies' },
    itemsKey: 'policies',
    pathOf: (p) => String(p?.name ?? ''),
    itemRequest: (_project, path) => ({ url: `https://iam.googleapis.com/v2/${path}` }),
  },
  'iam/wipools': {
    root: 'https://iam.googleapis.com/v1/',
    list: { mode: 'path', path: 'projects/{project}/locations/global/workloadIdentityPools' },
    itemsKey: 'workloadIdentityPools',
  },
  'iam/wiproviders': child('https://iam.googleapis.com/v1/', 'providers', 'workloadIdentityPoolProviders'),

  'kms/keyrings': wild('https://cloudkms.googleapis.com/v1/', 'keyRings'),
  'kms/importjobs': child('https://cloudkms.googleapis.com/v1/', 'importJobs'),
  'kms/keyhandles': regional('https://cloudkms.googleapis.com/v1/', 'keyHandles'),

  'cloudbuild/connections': regional('https://cloudbuild.googleapis.com/v2/', 'connections'),
  'cloudbuild/workerpools': regional('https://cloudbuild.googleapis.com/v1/', 'workerPools'),
  'clouddeploy/pipelines': regional('https://clouddeploy.googleapis.com/v1/', 'deliveryPipelines'),
  'clouddeploy/automationruns': child('https://clouddeploy.googleapis.com/v1/', 'automationRuns'),

  'monitoring/services': {
    root: 'https://monitoring.googleapis.com/v3/',
    list: { mode: 'path', path: 'projects/{project}/services' },
    itemsKey: 'services',
  },
  'monitoring/slos': child('https://monitoring.googleapis.com/v3/', 'serviceLevelObjectives'),

  'workerpools/pools': regional('https://run.googleapis.com/v2/', 'workerPools'),
  'workerpools/instances': regional('https://run.googleapis.com/v2/', 'instances'),

  ...computeSources,
  ...dataSources,
};

/** IAP resource path of a backend service: `compute/services/{name}` or `compute-{region}/services/{name}`. */
export function iapScope(path: string): string {
  const regional = /^regions\/([^/]+)\/backendServices\/([^/]+)$/.exec(path);
  if (regional) return `compute-${regional[1]}/services/${regional[2]}`;
  return `compute/services/${path.split('/').pop()}`;
}
