import { DeployServiceSchema, UpdateTrafficSchema } from '@nephoscope/contracts';
import { describe, expect, it } from 'vitest';
import { runHref } from './run.service.js';
import { applyDeploy, applyJobUpdate, applyRollback, applyTraffic, newService, pinLatest, serveLatest } from './run-deploy.js';
import { executionOutcome, mapKnativeJob, mapKnativeService, mapRevision, mapService, mapTask } from './run-mapping.js';

/** A v2 service as gax returns it: enums as names, int64 as strings, defaults filled. */
const service = {
  name: 'projects/demo/locations/us-central1/services/api',
  uid: 'u1',
  generation: '7',
  labels: { team: 'core' },
  annotations: { 'run.googleapis.com/custom': 'keep-me' },
  createTime: { seconds: '1790000000', nanos: 0 },
  updateTime: { seconds: '1790000600', nanos: 0 },
  creator: 'alice@example.com',
  lastModifier: 'deploy-bot@demo.iam.gserviceaccount.com',
  ingress: 'INGRESS_TRAFFIC_ALL',
  invokerIamDisabled: false,
  template: {
    revision: 'api-v7',
    labels: {},
    annotations: {},
    scaling: { minInstanceCount: 0, maxInstanceCount: 20 },
    timeout: { seconds: '300', nanos: 0 },
    serviceAccount: 'runtime@demo.iam.gserviceaccount.com',
    maxInstanceRequestConcurrency: 80,
    executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2',
    containers: [
      {
        name: 'app',
        image: 'us-docker.pkg.dev/demo/app/api:1.4.0',
        command: [],
        args: ['--serve'],
        env: [
          { name: 'MODE', value: 'prod' },
          { name: 'DB_PASSWORD', valueSource: { secretKeyRef: { secret: 'db-pass', version: '3' } } },
        ],
        ports: [{ name: 'http1', containerPort: 8080 }],
        resources: { limits: { cpu: '1', memory: '512Mi' }, cpuIdle: true, startupCpuBoost: false },
        volumeMounts: [{ name: 'cfg', mountPath: '/etc/cfg' }],
        startupProbe: { tcpSocket: { port: 8080 } },
      },
      { name: 'otel', image: 'otel/collector:0.99', ports: [], env: [] },
    ],
    volumes: [{ name: 'cfg', secret: { secret: 'config' } }],
    vpcAccess: {
      connector: '',
      egress: 'PRIVATE_RANGES_ONLY',
      networkInterfaces: [{ network: 'default', subnetwork: 'default', tags: ['web'] }],
    },
  },
  traffic: [
    { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', revision: '', percent: 90, tag: '' },
    { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'api-v6', percent: 10, tag: 'canary' },
  ],
  trafficStatuses: [
    { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', revision: '', percent: 90, tag: '', uri: '' },
    {
      type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',
      revision: 'api-v6',
      percent: 10,
      tag: 'canary',
      uri: 'https://canary---api-xyz.run.app',
    },
  ],
  uri: 'https://api-xyz.run.app',
  urls: ['https://api-xyz.run.app'],
  latestReadyRevision: 'projects/demo/locations/us-central1/services/api/revisions/api-v7',
  latestCreatedRevision: 'projects/demo/locations/us-central1/services/api/revisions/api-v7',
  terminalCondition: {
    type: 'Ready',
    state: 'CONDITION_SUCCEEDED',
    message: '',
    lastTransitionTime: { seconds: '1790000600' },
    severity: 'SEVERITY_UNSPECIFIED',
  },
  conditions: [],
  reconciling: false,
  etag: '"abc"',
  buildConfig: null,
};

const deploy = (v: unknown) => DeployServiceSchema.parse(v);

describe('Cloud Run mapping', () => {
  it('maps a v2 service', () => {
    const s = mapService(service);
    expect(s).toMatchObject({
      id: 'api',
      location: 'us-central1',
      status: 'ready',
      ingress: 'ALL',
      latestReadyRevision: 'api-v7',
      createTime: '2026-09-21T14:13:20Z',
    });
    expect(s.template.containers[0]).toMatchObject({ port: 8080, cpu: '1', memory: '512Mi', cpuIdle: true, hasProbes: true });
    expect(s.template.containers[0]?.env[1]).toEqual({ name: 'DB_PASSWORD', value: null, secret: { secret: 'db-pass', version: '3' } });
    expect(s.template.timeoutSeconds).toBe(300);
    expect(s.template.volumes).toEqual([{ name: 'cfg', kind: 'secret' }]);
    expect(s.traffic).toEqual([
      { type: 'LATEST', revision: null, percent: 90, tag: null },
      { type: 'REVISION', revision: 'api-v6', percent: 10, tag: 'canary' },
    ]);
  });

  it('derives the status from the terminal condition', () => {
    expect(mapService({ ...service, reconciling: true }).status).toBe('deploying');
    expect(
      mapService({ ...service, terminalCondition: { type: 'Ready', state: 'CONDITION_FAILED', message: 'Image not found' } }),
    ).toMatchObject({
      status: 'failed',
      statusMessage: 'Image not found',
    });
  });

  it('gives each revision its share of the traffic', () => {
    const s = mapService(service);
    expect(
      mapRevision({ name: `${service.name}/revisions/api-v7`, service: service.name, containers: [{ image: 'x@sha256:ab12' }] }, s),
    ).toMatchObject({
      percent: 90,
      imageDigests: ['sha256:ab12'],
    });
    expect(mapRevision({ name: `${service.name}/revisions/api-v6` }, s)).toMatchObject({ percent: 10, tags: ['canary'] });
    expect(mapRevision({ name: `${service.name}/revisions/api-v5` }, s).percent).toBe(0);
  });

  it('maps a v1 list item to its v2 name', () => {
    const summary = mapKnativeService(
      {
        metadata: {
          name: 'hello',
          namespace: '123456',
          generation: 3,
          labels: { 'cloud.googleapis.com/location': 'europe-west1', 'goog-managed-by': 'cloudfunctions' },
          annotations: {
            'serving.knative.dev/lastModifier': 'bob@example.com',
            'run.googleapis.com/ingress': 'internal-and-cloud-load-balancing',
            'run.googleapis.com/invoker-iam-disabled': 'true',
          },
        },
        status: {
          observedGeneration: 3,
          url: 'https://hello-abc.a.run.app',
          conditions: [{ type: 'Ready', status: 'True', lastTransitionTime: '2026-09-28T10:00:00Z' }],
          traffic: [{ revisionName: 'hello-00003-abc', percent: 100, latestRevision: true }],
        },
      },
      'demo',
    );
    expect(summary).toMatchObject({
      name: 'projects/demo/locations/europe-west1/services/hello',
      status: 'ready',
      ingress: 'INTERNAL_LOAD_BALANCER',
      invokerIamDisabled: true,
      isFunction: true,
      lastDeployer: 'bob@example.com',
      lastDeployTime: '2026-09-28T10:00:00Z',
    });
    expect(summary.traffic[0]).toMatchObject({ type: 'LATEST', revision: 'hello-00003-abc', percent: 100 });
  });

  it('reports a generation that is not yet observed as deploying', () => {
    const s = mapKnativeService(
      {
        metadata: { name: 'x', generation: 4, labels: {} },
        status: { observedGeneration: 3, conditions: [{ type: 'Ready', status: 'True' }] },
      },
      'demo',
    );
    expect(s.status).toBe('deploying');
  });

  it('maps a v1 job with its last execution', () => {
    const j = mapKnativeJob(
      {
        metadata: { name: 'etl', labels: { 'cloud.googleapis.com/location': 'us-east1' } },
        spec: { template: { spec: { taskCount: 3 } } },
        status: {
          conditions: [{ type: 'Ready', status: 'True' }],
          executionCount: 12,
          latestCreatedExecution: { name: 'etl-abcde', completionStatus: 'EXECUTION_FAILED', creationTimestamp: '2026-09-28T09:00:00Z' },
        },
      },
      'demo',
    );
    expect(j).toMatchObject({
      taskCount: 3,
      executionCount: 12,
      lastExecution: { outcome: 'failed', name: 'projects/demo/locations/us-east1/jobs/etl/executions/etl-abcde' },
    });
  });

  it('derives execution and task outcomes', () => {
    expect(executionOutcome({ completionTime: { seconds: '10' }, succeededCount: 3 })).toBe('succeeded');
    expect(executionOutcome({ completionTime: { seconds: '10' }, failedCount: 1 })).toBe('failed');
    expect(executionOutcome({ completionTime: { seconds: '10' }, cancelledCount: 2 })).toBe('cancelled');
    expect(executionOutcome({ startTime: { seconds: '5' }, runningCount: 1 })).toBe('running');
    expect(executionOutcome({})).toBe('pending');
    expect(
      mapTask({ index: 2, completionTime: { seconds: '9' }, lastAttemptResult: { exitCode: 1, status: { message: 'Container exited' } } }),
    ).toMatchObject({
      index: 2,
      outcome: 'failed',
      exitCode: 1,
      lastAttemptMessage: 'Container exited',
    });
  });

  it('links operations to web routes', () => {
    expect(runHref('projects/demo/locations/us-central1/services/api')).toBe('/p/demo/run/services/us-central1/api');
    expect(runHref('projects/demo/locations/us-central1/jobs/etl/executions/etl-1')).toBe(
      '/p/demo/run/jobs/us-central1/etl/executions/etl-1',
    );
  });
});

describe('deploy keeps what it does not edit (SPEC-0003 R-01)', () => {
  it('changes only the image and leaves everything else as it was', () => {
    const next = applyDeploy(service, deploy({ container: { image: 'us-docker.pkg.dev/demo/app/api:1.5.0' } }));
    const before = structuredClone(service);
    expect(next.template.containers[0].image).toBe('us-docker.pkg.dev/demo/app/api:1.5.0');
    // Everything the form does not cover survives.
    expect(next.annotations).toEqual(before.annotations);
    expect(next.template.containers[0].volumeMounts).toEqual(before.template.containers[0]?.volumeMounts);
    expect(next.template.containers[0].startupProbe).toEqual(before.template.containers[0]?.startupProbe);
    expect(next.template.containers[0].env).toEqual(before.template.containers[0]?.env);
    expect(next.template.containers[1]).toEqual(before.template.containers[1]);
    expect(next.template.volumes).toEqual(before.template.volumes);
    expect(next.template.vpcAccess).toEqual(before.template.vpcAccess);
    expect(next.template.scaling).toEqual(before.template.scaling);
    // The input is never mutated.
    expect(service).toEqual(before);
  });

  it('lets Google name the revision unless a suffix is given', () => {
    expect(applyDeploy(service, deploy({})).template.revision).toBe('');
    expect(applyDeploy(service, deploy({ revisionSuffix: 'fix-1' })).template.revision).toBe('api-fix-1');
  });

  it('edits the ingress container even when a sidecar comes first', () => {
    const sidecarFirst = { ...service, template: { ...service.template, containers: [...service.template.containers].reverse() } };
    const next = applyDeploy(sidecarFirst, deploy({ container: { memory: '1Gi' } }));
    expect(next.template.containers[1].resources.limits).toEqual({ cpu: '1', memory: '1Gi' });
    expect(next.template.containers[0].resources).toBeUndefined();
  });

  it('writes env vars and secret references in v2 form', () => {
    const next = applyDeploy(
      service,
      deploy({
        container: {
          env: [
            { name: 'A', value: '1' },
            { name: 'S', secret: { secret: 'tok', version: 'latest' } },
          ],
        },
      }),
    );
    expect(next.template.containers[0].env).toEqual([
      { name: 'A', value: '1' },
      { name: 'S', valueSource: { secretKeyRef: { secret: 'tok', version: 'latest' } } },
    ]);
  });

  it('serves the new revision immediately, keeping tags at 0%', () => {
    const next = applyDeploy(service, deploy({ serveImmediately: true }));
    expect(next.traffic).toEqual([
      { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100, tag: '' },
      { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'api-v6', percent: 0, tag: 'canary' },
    ]);
  });

  it('keeps the current split when not serving immediately (T-02)', () => {
    const next = applyDeploy(service, deploy({ container: { env: [{ name: 'MODE', value: 'staging' }] }, serveImmediately: false }));
    expect(next.traffic).toEqual([
      { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'api-v7', percent: 90, tag: '' },
      { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'api-v6', percent: 10, tag: 'canary' },
    ]);
  });

  it('pins an empty traffic list to the ready revision', () => {
    expect(pinLatest([], 'projects/p/locations/l/services/s/revisions/s-1')).toEqual([
      { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', percent: 100, revision: 's-1' },
    ]);
    expect(serveLatest([])).toEqual([{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100, tag: '' }]);
  });

  it('switches VPC egress from Direct VPC to a connector', () => {
    const next = applyDeploy(service, deploy({ vpc: { connector: 'projects/demo/locations/us-central1/connectors/c1' } }));
    expect(next.template.vpcAccess).toMatchObject({
      connector: 'projects/demo/locations/us-central1/connectors/c1',
      networkInterfaces: [],
      egress: 'PRIVATE_RANGES_ONLY',
    });
    expect(applyDeploy(service, deploy({ vpc: null })).template.vpcAccess).toBeNull();
  });

  it('sets scaling, timeout, concurrency and ingress', () => {
    const next = applyDeploy(
      service,
      deploy({ minInstances: 1, maxInstances: null, timeoutSeconds: 60, concurrency: 10, ingress: 'INTERNAL_ONLY' }),
    );
    expect(next.template.scaling).toEqual({ minInstanceCount: 1, maxInstanceCount: 0 });
    expect(next.template.timeout).toEqual({ seconds: 60, nanos: 0 });
    expect(next.template.maxInstanceRequestConcurrency).toBe(10);
    expect(next.ingress).toBe('INGRESS_TRAFFIC_INTERNAL_ONLY');
  });

  it('builds a new service without a name in the body', () => {
    const s = newService('demo', {
      ...deploy({ container: { image: 'us-docker.pkg.dev/cloudrun/container/hello' } }),
      id: 'hello',
      region: 'us-east1',
    });
    expect(s.name).toBe('');
    expect(s.template.containers[0]).toMatchObject({
      image: 'us-docker.pkg.dev/cloudrun/container/hello',
      ports: [{ containerPort: 8080 }],
    });
    expect(s.traffic[0]).toMatchObject({ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 });
  });
});

describe('traffic and rollback', () => {
  it('requires the split to add up to 100 (CA-04)', () => {
    expect(UpdateTrafficSchema.safeParse({ traffic: [{ type: 'LATEST', revision: null, percent: 60, tag: null }] }).success).toBe(false);
    const ok = UpdateTrafficSchema.parse({
      traffic: [
        { type: 'REVISION', revision: 'api-v7', percent: 50, tag: null },
        { type: 'REVISION', revision: 'api-v6', percent: 50, tag: 'canary' },
      ],
    });
    expect(applyTraffic(service, ok.traffic).traffic).toEqual([
      { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'api-v7', percent: 50, tag: '' },
      { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'api-v6', percent: 50, tag: 'canary' },
    ]);
  });

  it('rolls back to one revision and keeps other tags at 0% (CA-05)', () => {
    expect(applyRollback(service, 'api-v5').traffic).toEqual([
      { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'api-v5', percent: 100 },
      { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'api-v6', percent: 0, tag: 'canary' },
    ]);
  });
});

describe('job update', () => {
  it('edits the task template and keeps the rest', () => {
    const job = {
      name: 'projects/demo/locations/us-east1/jobs/etl',
      template: {
        taskCount: 1,
        parallelism: 0,
        template: {
          maxRetries: 3,
          timeout: { seconds: '600' },
          containers: [{ name: 'etl', image: 'etl:1', args: ['--all'], env: [] }],
          volumes: [{ name: 'v' }],
        },
      },
    };
    const next = applyJobUpdate(job, { container: { image: 'etl:2' }, taskCount: 5, timeoutSeconds: 1200 });
    expect(next.template.taskCount).toBe(5);
    expect(next.template.template.containers[0]).toEqual({ name: 'etl', image: 'etl:2', args: ['--all'], env: [] });
    expect(next.template.template.timeout).toEqual({ seconds: 1200, nanos: 0 });
    expect(next.template.template.volumes).toEqual([{ name: 'v' }]);
    expect(next.template.template.maxRetries).toBe(3);
  });
});
