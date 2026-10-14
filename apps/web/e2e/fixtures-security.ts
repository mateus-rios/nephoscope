import type {
  ArmorPolicySummary,
  ArmorPolicyView,
  ArmorTarget,
  BuildDetail,
  BuildSummary,
  CryptoKeyView,
  DeployPipelineView,
  DeployReleaseView,
  DeployRolloutView,
  DeployTargetView,
  KeyRingView,
  KeyVersionView,
  ProjectIamView,
  RegistryDockerImageView,
  RegistryRepositoryView,
  RoleSummary,
  SecretUsage,
  SecretVersionView,
  SecretView,
  ServiceAccountKeyView,
  ServiceAccountView,
  TriggerView,
  WafExpressionSet,
} from '@nephoscope/contracts';
import { list, PROJECT } from './fixtures';

type Route = [string, RegExp, (url: URL) => unknown];

/** Security and delivery fixtures (SPEC-0007, M5). */

const now = Date.parse('2026-09-28T12:00:00Z');
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const P = `/api/projects/${PROJECT}`;
const SA = `nephoscope@${PROJECT}.iam.gserviceaccount.com`;

// ---- IAM ---------------------------------------------------------------------------------------

export const projectIam: ProjectIamView = {
  policy: {
    version: 3,
    etag: 'BwYkq1',
    bindings: [
      { role: 'roles/owner', members: ['user:ana@example.com'], condition: null },
      { role: 'roles/editor', members: [`serviceAccount:${SA}`, 'group:platform@example.com'], condition: null },
      {
        role: 'roles/run.developer',
        members: ['user:bruno@example.com'],
        condition: { title: 'Until year end', description: null, expression: 'request.time < timestamp("2027-01-01T00:00:00Z")' },
      },
      {
        role: 'roles/secretmanager.secretAccessor',
        members: [`serviceAccount:api-runtime@${PROJECT}.iam.gserviceaccount.com`],
        condition: null,
      },
    ],
    auditConfigs: [{ service: 'allServices', logTypes: [{ logType: 'ADMIN_READ', exemptedMembers: [] }] }],
  },
  inherited: [
    {
      resource: 'organizations/123456789',
      displayName: 'example.com',
      bindings: [{ role: 'roles/resourcemanager.organizationAdmin', members: ['group:admins@example.com'], condition: null }],
    },
  ],
  inheritedError: null,
  self: `serviceAccount:${SA}`,
};

export const roles: RoleSummary[] = [
  {
    name: 'roles/run.developer',
    title: 'Cloud Run Developer',
    description: 'Read and write access to all Cloud Run resources.',
    stage: 'GA',
    permissionCount: 32,
    custom: false,
    deleted: false,
  },
  {
    name: 'roles/viewer',
    title: 'Viewer',
    description: 'View most Google Cloud resources.',
    stage: 'GA',
    permissionCount: 3600,
    custom: false,
    deleted: false,
  },
  {
    name: `projects/${PROJECT}/roles/deployer`,
    title: 'Deployer',
    description: 'Deploys services and reads their logs.',
    stage: 'GA',
    permissionCount: 12,
    custom: true,
    deleted: false,
  },
];

export const serviceAccounts: ServiceAccountView[] = [
  {
    name: `projects/${PROJECT}/serviceAccounts/${SA}`,
    email: SA,
    uniqueId: '1048576000000000001',
    displayName: 'Nephoscope',
    description: 'Used by the console',
    disabled: false,
    keyCount: 1,
  },
  {
    name: `projects/${PROJECT}/serviceAccounts/api-runtime@${PROJECT}.iam.gserviceaccount.com`,
    email: `api-runtime@${PROJECT}.iam.gserviceaccount.com`,
    uniqueId: '1048576000000000002',
    displayName: 'API runtime',
    description: null,
    disabled: false,
    keyCount: 0,
  },
  {
    name: `projects/${PROJECT}/serviceAccounts/old-ci@${PROJECT}.iam.gserviceaccount.com`,
    email: `old-ci@${PROJECT}.iam.gserviceaccount.com`,
    uniqueId: '1048576000000000003',
    displayName: null,
    description: null,
    disabled: true,
    keyCount: 2,
  },
];

const saKeys: ServiceAccountKeyView[] = [
  {
    name: `projects/${PROJECT}/serviceAccounts/${SA}/keys/3f2a`,
    id: '3f2a9c0d1e',
    keyType: 'USER_MANAGED',
    algorithm: 'KEY_ALG_RSA_2048',
    origin: 'GOOGLE_PROVIDED',
    validAfter: iso(60_000),
    validBefore: '9999-12-31T23:59:59Z',
    disabled: false,
  },
  {
    name: `projects/${PROJECT}/serviceAccounts/${SA}/keys/9b1c`,
    id: '9b1c4e7f20',
    keyType: 'SYSTEM_MANAGED',
    algorithm: 'KEY_ALG_RSA_2048',
    origin: 'GOOGLE_PROVIDED',
    validAfter: iso(2_000),
    validBefore: iso(-20_000),
    disabled: false,
  },
];

// ---- Secret Manager ----------------------------------------------------------------------------

const secret = (id: string, extra: Partial<SecretView> = {}): SecretView => ({
  name: `projects/${PROJECT}/secrets/${id}`,
  id,
  location: 'global',
  replication: 'automatic',
  replicaLocations: [],
  labels: {},
  annotations: {},
  expireTime: null,
  rotation: null,
  topics: [],
  versionDestroyTtlSeconds: null,
  createTime: iso(30_000),
  etag: '"16a2"',
  ...extra,
});

const versions: SecretVersionView[] = [
  {
    name: `projects/${PROJECT}/secrets/db-password/versions/3`,
    id: '3',
    state: 'ENABLED',
    createTime: iso(1_200),
    destroyTime: null,
    scheduledDestroyTime: null,
    etag: '"3"',
  },
  {
    name: `projects/${PROJECT}/secrets/db-password/versions/2`,
    id: '2',
    state: 'DISABLED',
    createTime: iso(20_000),
    destroyTime: null,
    scheduledDestroyTime: null,
    etag: '"2"',
  },
  {
    name: `projects/${PROJECT}/secrets/db-password/versions/1`,
    id: '1',
    state: 'DESTROYED',
    createTime: iso(40_000),
    destroyTime: iso(30_000),
    scheduledDestroyTime: null,
    etag: '"1"',
  },
];

export const secrets = [
  {
    ...secret('db-password', {
      labels: { team: 'checkout' },
      rotation: { periodSeconds: 7_776_000, nextRotationTime: iso(-40_000) },
      topics: [`projects/${PROJECT}/topics/secret-events`],
    }),
    versionCount: 3,
    latest: versions[0] ?? null,
  },
  {
    ...secret('stripe-key', { replication: 'user-managed', replicaLocations: ['us-east1', 'us-central1'] }),
    versionCount: 1,
    latest: versions[0] ?? null,
  },
  {
    ...secret('regional-token', {
      name: `projects/${PROJECT}/locations/us-central1/secrets/regional-token`,
      location: 'us-central1',
      replication: 'regional',
    }),
    versionCount: 0,
    latest: null,
  },
];

const usage: SecretUsage[] = [
  { kind: 'service', name: 'api', location: 'us-central1', href: `/p/${PROJECT}/run/services/us-central1/api`, where: ['env DB_PASSWORD'] },
];

// ---- Cloud KMS ---------------------------------------------------------------------------------

const ring: KeyRingView = {
  name: `projects/${PROJECT}/locations/global/keyRings/app`,
  id: 'app',
  location: 'global',
  createTime: iso(80_000),
};

const cryptoKey = (id: string, purpose: string, algorithm: string, extra: Partial<CryptoKeyView> = {}): CryptoKeyView => ({
  name: `${ring.name}/cryptoKeys/${id}`,
  id,
  keyRing: ring.name,
  location: 'global',
  purpose,
  protectionLevel: 'SOFTWARE',
  algorithm,
  primary: purpose === 'ENCRYPT_DECRYPT' ? { id: '2', state: 'ENABLED' } : null,
  rotationPeriodSeconds: null,
  nextRotationTime: null,
  destroyScheduledDuration: '2592000s',
  labels: {},
  createTime: iso(70_000),
  ...extra,
});

const keys: CryptoKeyView[] = [
  cryptoKey('db-key', 'ENCRYPT_DECRYPT', 'GOOGLE_SYMMETRIC_ENCRYPTION', {
    rotationPeriodSeconds: 7_776_000,
    nextRotationTime: iso(-30_000),
  }),
  cryptoKey('release-signing', 'ASYMMETRIC_SIGN', 'EC_SIGN_P256_SHA256', { protectionLevel: 'HSM' }),
];

const keyVersions: KeyVersionView[] = [
  {
    name: `${keys[0]?.name}/cryptoKeyVersions/2`,
    id: '2',
    state: 'ENABLED',
    algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION',
    protectionLevel: 'SOFTWARE',
    createTime: iso(10_000),
    destroyTime: null,
    primary: true,
  },
  {
    name: `${keys[0]?.name}/cryptoKeyVersions/1`,
    id: '1',
    state: 'DISABLED',
    algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION',
    protectionLevel: 'SOFTWARE',
    createTime: iso(70_000),
    destroyTime: null,
    primary: false,
  },
];

// ---- Cloud Armor -------------------------------------------------------------------------------

const armorSummary: ArmorPolicySummary = {
  path: 'global/securityPolicies/edge-waf',
  name: 'edge-waf',
  scope: 'global',
  type: 'CLOUD_ARMOR',
  description: 'In front of the public load balancer',
  ruleCount: 4,
  adaptiveProtection: true,
  labels: {},
  targets: ['global/backendServices/web-backend'],
};

export const armorPolicy: ArmorPolicyView = {
  ...armorSummary,
  fingerprint: 'q1w2e3',
  rules: [
    {
      priority: 100,
      action: 'deny(403)',
      description: 'Block SQL injection',
      preview: false,
      match: { kind: 'expr', srcIpRanges: [], expression: "evaluatePreconfiguredWaf('sqli-v33-stable')" },
      rateLimitOptions: null,
      redirectOptions: null,
      headerAction: null,
    },
    {
      priority: 200,
      action: 'allow',
      description: 'Office',
      preview: false,
      match: { kind: 'ip', srcIpRanges: ['203.0.113.0/24'], expression: null },
      rateLimitOptions: null,
      redirectOptions: null,
      headerAction: null,
    },
    {
      priority: 300,
      action: 'throttle',
      description: 'Per-client limit',
      preview: true,
      match: { kind: 'ip', srcIpRanges: ['*'], expression: null },
      rateLimitOptions: { conformAction: 'allow', exceedAction: 'deny(429)' },
      redirectOptions: null,
      headerAction: null,
    },
    {
      priority: 2147483647,
      action: 'allow',
      description: 'Default rule',
      preview: false,
      match: { kind: 'ip', srcIpRanges: ['*'], expression: null },
      rateLimitOptions: null,
      redirectOptions: null,
      headerAction: null,
    },
  ],
  raw: {},
};

const armorTargets: ArmorTarget[] = [
  {
    path: 'global/backendServices/web-backend',
    name: 'web-backend',
    scope: 'global',
    kind: 'backendService',
    scheme: 'EXTERNAL_MANAGED',
    securityPolicy: 'edge-waf',
    edgeSecurityPolicy: null,
  },
  {
    path: 'global/backendBuckets/static',
    name: 'static',
    scope: 'global',
    kind: 'backendBucket',
    scheme: null,
    securityPolicy: null,
    edgeSecurityPolicy: null,
  },
];

const waf: WafExpressionSet[] = [
  { id: 'sqli-v33-stable', aliases: ['sqli-v33-canary'], expressions: [{ id: 'owasp-crs-v030301-id942100-sqli', sensitivity: 1 }] },
  { id: 'xss-v33-stable', aliases: [], expressions: [{ id: 'owasp-crs-v030301-id941100-xss', sensitivity: 1 }] },
];

// ---- Artifact Registry -------------------------------------------------------------------------

export const repositories: RegistryRepositoryView[] = [
  {
    name: `projects/${PROJECT}/locations/us-central1/repositories/apps`,
    id: 'apps',
    location: 'us-central1',
    format: 'DOCKER',
    mode: 'STANDARD_REPOSITORY',
    description: 'Service images',
    sizeBytes: '1879048192',
    cleanupPolicies: { 'keep-recent': { id: 'keep-recent', action: 'KEEP', mostRecentVersions: { keepCount: 10 } } },
    cleanupPolicyDryRun: true,
    labels: {},
    createTime: iso(100_000),
    updateTime: iso(60),
    registryUri: `us-central1-docker.pkg.dev/${PROJECT}/apps`,
  },
  {
    name: `projects/${PROJECT}/locations/us/repositories/npm-internal`,
    id: 'npm-internal',
    location: 'us',
    format: 'NPM',
    mode: 'STANDARD_REPOSITORY',
    description: null,
    sizeBytes: '5242880',
    cleanupPolicies: {},
    cleanupPolicyDryRun: false,
    labels: {},
    createTime: iso(90_000),
    updateTime: iso(5_000),
    registryUri: null,
  },
];

const digest = (c: string) => `sha256:${c.repeat(64)}`;
const images: RegistryDockerImageView[] = [
  {
    name: `${repositories[0]?.name}/dockerImages/api@${digest('a')}`,
    uri: `us-central1-docker.pkg.dev/${PROJECT}/apps/api@${digest('a')}`,
    digest: digest('a'),
    image: 'api',
    tags: ['v42', 'latest'],
    sizeBytes: '84934656',
    uploadTime: iso(60),
    buildTime: iso(62),
    updateTime: iso(60),
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
  },
  {
    name: `${repositories[0]?.name}/dockerImages/api@${digest('b')}`,
    uri: `us-central1-docker.pkg.dev/${PROJECT}/apps/api@${digest('b')}`,
    digest: digest('b'),
    image: 'api',
    tags: [],
    sizeBytes: '84410368',
    uploadTime: iso(3_000),
    buildTime: null,
    updateTime: iso(3_000),
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
  },
];

// ---- Cloud Build -------------------------------------------------------------------------------

export const BUILD_ID = '7c1f3d2a-5b6e-4f80-9a1b-2c3d4e5f6a7b';

const buildSummary = (id: string, status: string, minutesAgo: number, extra: Partial<BuildSummary> = {}): BuildSummary => ({
  name: `projects/${PROJECT}/locations/global/builds/${id}`,
  id,
  location: 'global',
  status,
  createTime: iso(minutesAgo),
  startTime: iso(minutesAgo - 0.2),
  finishTime: status === 'WORKING' ? null : iso(minutesAgo - 4),
  triggerId: 'a1b2c3',
  source: 'shop@main 9f8e7d6',
  tags: ['deploy'],
  images: [`us-central1-docker.pkg.dev/${PROJECT}/apps/api:v42`],
  failure: null,
  approval: null,
  ...extra,
});

export const builds: BuildSummary[] = [
  buildSummary(BUILD_ID, 'SUCCESS', 65),
  buildSummary('0d9e8f7a-6b5c-4d3e-8f1a-0b2c3d4e5f60', 'FAILURE', 300, { failure: 'Step #1 - "test": exit status 1' }),
  buildSummary('1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d', 'WORKING', 2, { approval: null }),
  buildSummary('2b3c4d5e-6f7a-4b9c-8d0e-2f3a4b5c6d7e', 'PENDING', 1, { approval: 'PENDING' }),
];

export const buildDetail: BuildDetail = {
  ...(builds[0] as BuildSummary),
  steps: [
    { id: 'install', name: 'node:22', args: ['npm', 'ci'], entrypoint: null, status: 'SUCCESS', startTime: iso(65), endTime: iso(64) },
    { id: 'test', name: 'node:22', args: ['npm', 'test'], entrypoint: null, status: 'SUCCESS', startTime: iso(64), endTime: iso(63) },
    {
      id: 'image',
      name: 'gcr.io/cloud-builders/docker',
      args: ['build', '-t', `us-central1-docker.pkg.dev/${PROJECT}/apps/api:v42`, '.'],
      entrypoint: null,
      status: 'SUCCESS',
      startTime: iso(63),
      endTime: iso(61.5),
    },
  ],
  substitutions: { BRANCH_NAME: 'main', SHORT_SHA: '9f8e7d6', _REGION: 'us-central1' },
  serviceAccount: `projects/${PROJECT}/serviceAccounts/builder@${PROJECT}.iam.gserviceaccount.com`,
  logsBucket: 'gs://123456789.cloudbuild-logs.googleusercontent.com',
  logging: 'LEGACY',
  timeout: '600s',
  raw: { id: BUILD_ID },
};

const triggers: TriggerView[] = [
  {
    name: `projects/${PROJECT}/locations/global/triggers/a1b2c3`,
    id: 'a1b2c3',
    triggerName: 'deploy-main',
    location: 'global',
    description: 'Builds and deploys main',
    disabled: false,
    event: 'push',
    repo: 'example/shop',
    branch: '^main$',
    tag: null,
    filename: 'cloudbuild.yaml',
    createTime: iso(50_000),
  },
  {
    name: `projects/${PROJECT}/locations/global/triggers/d4e5f6`,
    id: 'd4e5f6',
    triggerName: 'pr-checks',
    location: 'global',
    description: null,
    disabled: true,
    event: 'pull_request',
    repo: 'example/shop',
    branch: '.*',
    tag: null,
    filename: 'ci/pr.yaml',
    createTime: iso(40_000),
  },
];

// ---- Cloud Deploy ------------------------------------------------------------------------------

export const pipeline: DeployPipelineView = {
  name: `projects/${PROJECT}/locations/us-central1/deliveryPipelines/web`,
  id: 'web',
  location: 'us-central1',
  description: 'Shop front end',
  stages: [
    { targetId: 'dev', profiles: ['dev'], strategy: 'standard' },
    { targetId: 'staging', profiles: ['staging'], strategy: 'standard' },
    { targetId: 'prod', profiles: ['prod'], strategy: 'canary' },
  ],
  suspended: false,
  createTime: iso(60_000),
  updateTime: iso(2_000),
};

const deployTargets: DeployTargetView[] = ['dev', 'staging', 'prod'].map((id) => ({
  name: `projects/${PROJECT}/locations/us-central1/targets/${id}`,
  id,
  location: 'us-central1',
  description: null,
  kind: 'Cloud Run',
  detail: `projects/${PROJECT}/locations/us-central1`,
  requireApproval: id === 'prod',
}));

const releases: DeployReleaseView[] = [
  {
    name: `${pipeline.name}/releases/web-042`,
    id: 'web-042',
    renderState: 'SUCCEEDED',
    abandoned: false,
    createTime: iso(90),
    targetRenders: { dev: 'SUCCEEDED', staging: 'SUCCEEDED', prod: 'SUCCEEDED' },
  },
  {
    name: `${pipeline.name}/releases/web-041`,
    id: 'web-041',
    renderState: 'SUCCEEDED',
    abandoned: true,
    createTime: iso(3_000),
    targetRenders: {},
  },
];

const rollouts: DeployRolloutView[] = [
  {
    name: `${releases[0]?.name}/rollouts/web-042-to-staging-0001`,
    id: 'web-042-to-staging-0001',
    targetId: 'staging',
    state: 'SUCCEEDED',
    approvalState: 'DOES_NOT_NEED_APPROVAL',
    createTime: iso(60),
    deployStartTime: iso(59),
    deployEndTime: iso(55),
    failureReason: null,
    phases: [{ id: 'stable', state: 'SUCCEEDED', jobs: [{ id: 'deploy', state: 'SUCCEEDED' }] }],
  },
  {
    name: `${releases[0]?.name}/rollouts/web-042-to-dev-0001`,
    id: 'web-042-to-dev-0001',
    targetId: 'dev',
    state: 'SUCCEEDED',
    approvalState: 'DOES_NOT_NEED_APPROVAL',
    createTime: iso(85),
    deployStartTime: iso(84),
    deployEndTime: iso(80),
    failureReason: null,
    phases: [{ id: 'stable', state: 'SUCCEEDED', jobs: [{ id: 'deploy', state: 'SUCCEEDED' }] }],
  },
];

export const securityRoutes: Route[] = [
  ['GET', new RegExp(`^${P}/iam/policy$`), () => projectIam],
  ['GET', new RegExp(`^${P}/iam/roles$`), () => roles],
  ['GET', new RegExp(`^${P}/iam/testable-permissions$`), () => []],
  ['GET', new RegExp(`^${P}/iam/service-accounts$`), () => serviceAccounts],
  ['GET', new RegExp(`^${P}/iam/service-accounts/[^/]+$`), () => serviceAccounts[0]],
  ['GET', new RegExp(`^${P}/iam/service-accounts/[^/]+/keys$`), () => saKeys],
  [
    'GET',
    new RegExp(`^${P}/iam/service-accounts/[^/]+/policy$`),
    () => ({
      version: 1,
      etag: 'ACAB',
      bindings: [{ role: 'roles/iam.serviceAccountUser', members: ['group:platform@example.com'], condition: null }],
      auditConfigs: [],
    }),
  ],
  ['GET', new RegExp(`^${P}/kit/iam/[a-z]+$`), () => list([])],
  ['GET', new RegExp(`^${P}/resource-iam$`), () => ({ version: 1, etag: 'ACAB', bindings: [], auditConfigs: [] })],
  ['GET', new RegExp(`^${P}/secretmanager/locations$`), () => ['global', 'us-central1']],
  ['GET', new RegExp(`^${P}/secretmanager/secrets$`), () => secrets],
  ['GET', new RegExp(`^${P}/secretmanager/secrets/global/db-password$`), () => secrets[0]],
  ['GET', new RegExp(`^${P}/secretmanager/secrets/global/db-password/versions$`), () => versions],
  ['GET', new RegExp(`^${P}/secretmanager/secrets/global/db-password/usage$`), () => usage],
  ['GET', new RegExp(`^${P}/kms/locations$`), () => ['global', 'us-central1']],
  ['GET', new RegExp(`^${P}/kms/keyrings$`), () => ({ items: [ring], unreachable: [] })],
  ['GET', new RegExp(`^${P}/kms/autokey$`), () => ({ keyProject: null })],
  ['GET', new RegExp(`^${P}/kms/keyrings/global/app/keys$`), () => keys],
  ['GET', new RegExp(`^${P}/kms/keyrings/global/app/keys/db-key$`), () => keys[0]],
  ['GET', new RegExp(`^${P}/kms/keyrings/global/app/keys/db-key/versions$`), () => keyVersions],
  ['GET', new RegExp(`^${P}/armor/policies$`), () => ({ items: [armorSummary], unreachable: [] })],
  ['GET', new RegExp(`^${P}/armor/targets$`), () => armorTargets],
  ['GET', new RegExp(`^${P}/armor/waf$`), () => waf],
  ['GET', new RegExp(`^${P}/armor/policies/global/edge-waf$`), () => armorPolicy],
  ['GET', new RegExp(`^${P}/artifactregistry/repositories$`), () => list(repositories)],
  ['GET', new RegExp(`^${P}/artifactregistry/repository$`), () => repositories[0]],
  ['GET', new RegExp(`^${P}/artifactregistry/docker-images$`), () => list(images)],
  ['GET', new RegExp(`^${P}/artifactregistry/packages$`), () => list([])],
  ['GET', new RegExp(`^${P}/cloudbuild/builds$`), () => list(builds)],
  ['GET', new RegExp(`^${P}/cloudbuild/builds/global/${BUILD_ID}$`), () => buildDetail],
  ['GET', new RegExp(`^${P}/cloudbuild/triggers$`), () => list(triggers)],
  ['GET', new RegExp(`^${P}/kit/cloudbuild/[a-z]+$`), () => list([])],
  ['GET', new RegExp(`^${P}/clouddeploy/pipelines$`), () => list([pipeline])],
  ['GET', new RegExp(`^${P}/clouddeploy/targets$`), () => list(deployTargets)],
  ['GET', new RegExp(`^${P}/clouddeploy/pipelines/us-central1/web$`), () => pipeline],
  ['GET', new RegExp(`^${P}/clouddeploy/pipelines/us-central1/web/releases$`), () => releases],
  ['GET', new RegExp(`^${P}/clouddeploy/pipelines/us-central1/web/releases/web-042/rollouts$`), () => rollouts],
  ['GET', new RegExp(`^${P}/kit/clouddeploy/[a-z]+$`), () => list([])],
];
