import type {
  BillingView,
  FunctionUpgradeView,
  OrgPoliciesView,
  QuotasView,
  RawApiEntry,
  RawApiTree,
  RawCallResult,
  RawMethodDetail,
  RecommendationsView,
} from '@nephoscope/contracts';
import { PROJECT } from './fixtures';

type Route = [string, RegExp, (url: URL) => unknown];

/** Long-tail fixtures (SPEC-0009, M7). */

const P = `/api/projects/${PROJECT}`;

const directory: RawApiEntry[] = [
  {
    id: 'serviceusage:v1',
    name: 'serviceusage',
    version: 'v1',
    title: 'Service Usage API',
    description: 'Enables services.',
    preferred: true,
  },
  { id: 'run:v2', name: 'run', version: 'v2', title: 'Cloud Run Admin API', description: 'Deploy and manage services.', preferred: true },
  { id: 'run:v1', name: 'run', version: 'v1', title: 'Cloud Run Admin API', description: 'Deploy and manage services.', preferred: false },
];

const tree: RawApiTree = {
  name: 'serviceusage',
  version: 'v1',
  title: 'Service Usage API',
  baseUrl: 'https://serviceusage.googleapis.com/',
  methods: [],
  resources: [
    {
      name: 'services',
      methods: [
        {
          id: 'serviceusage.services.list',
          httpMethod: 'GET',
          path: 'v1/{+parent}/services',
          description: 'Lists all services available to the specified project.',
        },
        { id: 'serviceusage.services.enable', httpMethod: 'POST', path: 'v1/{+name}:enable', description: 'Enables a service.' },
      ],
      resources: [],
    },
  ],
};

export const listMethod: RawMethodDetail = {
  ...(tree.resources[0]?.methods[0] as RawMethodDetail),
  description: 'Lists all services available to the specified project, and the current state of those services.',
  baseUrl: 'https://serviceusage.googleapis.com/',
  parameters: [
    {
      name: 'parent',
      location: 'path',
      type: 'string',
      required: true,
      repeated: false,
      description: 'Parent to search for services on.',
      pattern: '^[^/]+/[^/]+$',
      enum: [],
    },
    {
      name: 'filter',
      location: 'query',
      type: 'string',
      required: false,
      repeated: false,
      description: 'Only list services that conform to the given filter.',
      pattern: null,
      enum: [],
    },
    {
      name: 'pageSize',
      location: 'query',
      type: 'integer',
      required: false,
      repeated: false,
      description: 'Requested size of the next page of data.',
      pattern: null,
      enum: [],
    },
  ],
  requestSchema: null,
  requestRef: null,
  responseRef: 'ListServicesResponse',
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
};

const enableMethod: RawMethodDetail = {
  ...(tree.resources[0]?.methods[1] as RawMethodDetail),
  baseUrl: 'https://serviceusage.googleapis.com/',
  parameters: [
    {
      name: 'name',
      location: 'path',
      type: 'string',
      required: true,
      repeated: false,
      description: 'Name of the consumer and service to enable.',
      pattern: null,
      enum: [],
    },
  ],
  requestSchema: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $ref: '#/definitions/EnableServiceRequest',
    definitions: { EnableServiceRequest: { type: 'object', properties: {} } },
  },
  requestRef: 'EnableServiceRequest',
  responseRef: 'Operation',
  scopes: [],
};

const callResult: RawCallResult = {
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'application/json; charset=UTF-8' },
  body: {
    services: [
      {
        name: `projects/123/services/run.googleapis.com`,
        state: 'ENABLED',
        config: { name: 'run.googleapis.com', title: 'Cloud Run Admin API' },
      },
    ],
  },
  durationMs: 184,
  url: `https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services?filter=state%3AENABLED`,
};

const billing: BillingView = {
  billingEnabled: true,
  account: 'billingAccounts/012345-6789AB-CDEF01',
  accountDisplayName: 'Engineering',
  accountOpen: true,
  accountError: null,
  budgets: [
    {
      name: 'billingAccounts/012345-6789AB-CDEF01/budgets/b1',
      displayName: 'Platform monthly',
      amount: { currency: 'USD', amount: '1500.00' },
      lastPeriod: false,
      thresholds: [
        { percent: 50, basis: 'CURRENT_SPEND' },
        { percent: 90, basis: 'CURRENT_SPEND' },
        { percent: 100, basis: 'FORECASTED_SPEND' },
      ],
      calendarPeriod: 'MONTH',
      coversProject: true,
    },
  ],
  budgetsError: null,
};

const quotas: QuotasView = {
  service: 'compute.googleapis.com',
  usageError: null,
  rows: [
    {
      quotaId: 'CPUS-per-project-region',
      displayName: 'CPUs',
      metric: 'compute.googleapis.com/cpus',
      unit: '1/{project}/{region}',
      rate: null,
      dimensions: 'region=us-central1',
      location: 'us-central1',
      limit: '24',
      usage: 22,
      percent: 91.7,
      increaseEligible: true,
    },
    {
      quotaId: 'IN-USE-ADDRESSES-per-project-region',
      displayName: 'In-use IP addresses',
      metric: 'compute.googleapis.com/addresses',
      unit: '1/{project}/{region}',
      rate: null,
      dimensions: 'region=us-central1',
      location: 'us-central1',
      limit: '8',
      usage: 2,
      percent: 25,
      increaseEligible: true,
    },
    {
      quotaId: 'ReadRequestsPerMinutePerProject',
      displayName: 'Read requests per minute',
      metric: 'compute.googleapis.com/read_requests',
      unit: '1/min/{project}',
      rate: 'per minute',
      dimensions: 'global',
      location: 'global',
      limit: '1500',
      usage: null,
      percent: null,
      increaseEligible: false,
    },
  ],
};

const recommendations: RecommendationsView = {
  unreachable: [],
  recommendations: [
    {
      name: `projects/123/locations/us-central1-a/recommenders/google.compute.instance.MachineTypeRecommender/recommendations/r1`,
      recommender: 'google.compute.instance.MachineTypeRecommender',
      location: 'us-central1-a',
      description: 'Save cost by changing machine type from e2-standard-4 to e2-standard-2.',
      priority: 'P2',
      state: 'ACTIVE',
      category: 'COST',
      cost: { currency: 'USD', amount: '-48.91' },
      costPeriod: '2592000s',
      targets: [`compute.googleapis.com/projects/${PROJECT}/zones/us-central1-a/instances/web-1`],
      lastRefreshTime: '2026-09-28T06:00:00Z',
      content: { operationGroups: [{ operations: [{ action: 'replace', path: '/machineType' }] }] },
    },
  ],
  insights: [
    {
      name: 'projects/123/locations/global/insightTypes/google.iam.policy.Insight/insights/i1',
      insightType: 'google.iam.policy.Insight',
      location: 'global',
      description: '3 permissions of roles/editor were not used in the last 90 days.',
      category: 'SECURITY',
      severity: 'MEDIUM',
      state: 'ACTIVE',
      targets: [],
      lastRefreshTime: '2026-09-28T06:00:00Z',
      content: {},
    },
  ],
};

const orgPolicies: OrgPoliciesView = {
  unreadable: [],
  policies: [
    {
      constraint: 'constraints/iam.allowedPolicyMemberDomains',
      id: 'iam.allowedPolicyMemberDomains',
      displayName: 'Domain restricted sharing',
      description: 'Defines the set of identities that can be added to IAM policies.',
      type: 'list',
      important: true,
      setOnProject: false,
      effective: 'Allowed: C0abc123',
      restricts: true,
      rules: [{ values: { allowedValues: ['C0abc123'] } }],
    },
    {
      constraint: 'constraints/gcp.resourceLocations',
      id: 'gcp.resourceLocations',
      displayName: 'Resource location restriction',
      description: 'Defines where location-based resources can be created.',
      type: 'list',
      important: true,
      setOnProject: true,
      effective: 'Allowed: in:us-locations',
      restricts: true,
      rules: [{ values: { allowedValues: ['in:us-locations'] } }],
    },
    {
      constraint: 'constraints/compute.disableSerialPortAccess',
      id: 'compute.disableSerialPortAccess',
      displayName: 'Disable VM serial port access',
      description: 'When enforced, serial port access to VMs is disabled.',
      type: 'boolean',
      important: false,
      setOnProject: false,
      effective: 'Default',
      restricts: false,
      rules: [],
    },
  ],
};

export const upgrade: FunctionUpgradeView = {
  state: 'SETUP_FUNCTION_UPGRADE_CONFIG_SUCCESSFUL',
  copyService: `projects/${PROJECT}/locations/us-central1/services/hello`,
  traffic: 'All traffic goes to the 1st gen function. A 2nd gen copy is ready to take it.',
  steps: ['redirect', 'abort'],
  blocked: null,
};

export const longTailRoutes: Route[] = [
  ['GET', new RegExp(`^${P}/rawapi/apis$`), () => directory],
  ['GET', new RegExp(`^${P}/rawapi/apis/serviceusage/v1$`), () => tree],
  ['GET', new RegExp(`^${P}/rawapi/apis/serviceusage/v1/methods/serviceusage\\.services\\.list$`), () => listMethod],
  ['GET', new RegExp(`^${P}/rawapi/apis/serviceusage/v1/methods/serviceusage\\.services\\.enable$`), () => enableMethod],
  ['GET', new RegExp(`^${P}/rawapi/history$`), () => []],
  ['POST', new RegExp(`^${P}/rawapi/read$`), () => callResult],
  ['GET', new RegExp(`^${P}/billing$`), () => billing],
  ['GET', new RegExp(`^${P}/quotas$`), () => quotas],
  ['GET', new RegExp(`^${P}/quotas/pending$`), () => []],
  ['GET', new RegExp(`^${P}/recommendations$`), () => recommendations],
  ['GET', new RegExp(`^${P}/orgpolicies$`), () => orgPolicies],
  ['GET', new RegExp(`^${P}/functions/locations/us-central1/functions/[^/]+/upgrade$`), () => upgrade],
];
