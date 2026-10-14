import { describe, expect, it } from 'vitest';
import { buildFilter, logObject, mapBuild, mapBuildDetail, mapTrigger } from './build.js';
import { mapPipeline, mapRollout, mapTarget, nextTarget } from './deploy.js';

describe('Cloud Build mapping (SPEC-0007 D-12)', () => {
  it('summarizes a triggered build and its source', () => {
    const b = mapBuild({
      name: 'projects/demo/locations/us-central1/builds/0b1c',
      id: '0b1c',
      status: 'FAILURE',
      statusDetail: 'step 2 failed',
      buildTriggerId: 't1',
      sourceProvenance: { resolvedRepoSource: { repoName: 'shop', branchName: 'main', commitSha: 'abcdef0123456' } },
      approval: { state: 'APPROVED' },
    });
    expect(b).toMatchObject({
      id: '0b1c',
      location: 'us-central1',
      status: 'FAILURE',
      triggerId: 't1',
      source: 'shop@main abcdef0',
      failure: 'step 2 failed',
      approval: 'APPROVED',
    });
    expect(
      mapBuild({ name: 'projects/demo/builds/x', id: 'x', source: { storageSource: { bucket: 'b', object: 'src.tgz' } } }).source,
    ).toBe('gs://b/src.tgz');
    expect(mapBuild({ name: 'projects/demo/builds/x', id: 'x' }).location).toBe('global');
  });

  it('reads steps and the logging mode', () => {
    const d = mapBuildDetail({
      name: 'projects/demo/builds/x',
      id: 'x',
      steps: [{ id: 'test', name: 'node:22', args: ['npm', 'test'], status: 'SUCCESS', timing: { startTime: 'a', endTime: 'b' } }],
      options: { logging: 'CLOUD_LOGGING_ONLY' },
    });
    expect(d.steps).toEqual([
      { id: 'test', name: 'node:22', args: ['npm', 'test'], entrypoint: null, status: 'SUCCESS', startTime: 'a', endTime: 'b' },
    ]);
    expect(d.logging).toBe('CLOUD_LOGGING_ONLY');
  });

  it('classifies trigger events', () => {
    expect(mapTrigger({ id: '1', name: 'push', github: { owner: 'o', name: 'r', push: { branch: '^main$' } } })).toMatchObject({
      event: 'push',
      repo: 'o/r',
      branch: '^main$',
    });
    expect(
      mapTrigger({
        id: '2',
        name: 'pr',
        repositoryEventConfig: { repository: 'projects/demo/locations/us/connections/c/repositories/r', pullRequest: { branch: '.*' } },
      }),
    ).toMatchObject({
      event: 'pull_request',
      branch: '.*',
    });
    expect(mapTrigger({ id: '3', name: 'm', sourceToBuild: { uri: 'https://example.com/r' } }).event).toBe('manual');
    expect(mapTrigger({ id: '4', name: 'p', pubsubConfig: { topic: 't' } }).event).toBe('pubsub');
    expect(mapTrigger({ id: '5', name: 'w', webhookConfig: {}, build: {} })).toMatchObject({ event: 'webhook', filename: 'inline build' });
  });

  it('builds the list filter from the page controls', () => {
    expect(buildFilter({})).toBeUndefined();
    expect(buildFilter({ status: 'FAILURE', trigger: 't1', tag: 'deploy' })).toBe('status="FAILURE" AND trigger_id="t1" AND tags="deploy"');
  });

  it('finds the log object of a build', () => {
    expect(logObject('gs://123.cloudbuild-logs.googleusercontent.com', 'abc')).toEqual({
      bucket: '123.cloudbuild-logs.googleusercontent.com',
      object: 'log-abc.txt',
    });
    expect(logObject('gs://logs/ci/', 'abc')).toEqual({ bucket: 'logs', object: 'ci/log-abc.txt' });
    expect(logObject('logs', 'abc')).toBeNull();
  });
});

describe('Cloud Deploy mapping (SPEC-0007 D-13)', () => {
  const pipeline = mapPipeline({
    name: 'projects/demo/locations/us-central1/deliveryPipelines/web',
    serialPipeline: {
      stages: [{ targetId: 'dev' }, { targetId: 'staging', profiles: ['stg'] }, { targetId: 'prod', strategy: { canary: {} } }],
    },
  });
  const rollout = (targetId: string, state: string) => mapRollout({ name: `x/rollouts/${targetId}-1`, targetId, state });

  it('maps stages and targets', () => {
    expect(pipeline.stages).toEqual([
      { targetId: 'dev', profiles: [], strategy: null },
      { targetId: 'staging', profiles: ['stg'], strategy: null },
      { targetId: 'prod', profiles: [], strategy: 'canary' },
    ]);
    expect(
      mapTarget({
        name: 'projects/demo/locations/us-central1/targets/prod',
        run: { location: 'projects/demo/locations/us-central1' },
        requireApproval: true,
      }),
    ).toMatchObject({
      id: 'prod',
      kind: 'Cloud Run',
      requireApproval: true,
    });
    expect(mapTarget({ name: 'projects/demo/locations/us-central1/targets/all', multiTarget: { targetIds: ['a', 'b'] } })).toMatchObject({
      kind: 'Multi-target',
      detail: 'a, b',
    });
  });

  it('collects deploy and verify jobs of each phase', () => {
    const r = mapRollout({
      name: 'projects/demo/locations/us-central1/deliveryPipelines/web/releases/r1/rollouts/r1-to-prod-0001',
      targetId: 'prod',
      state: 'FAILED',
      phases: [
        {
          id: 'stable',
          state: 'FAILED',
          deploymentJobs: { deployJob: { id: 'deploy', state: 'SUCCEEDED' }, verifyJob: { id: 'verify', state: 'FAILED' } },
        },
      ],
    });
    expect(r.phases).toEqual([
      {
        id: 'stable',
        state: 'FAILED',
        jobs: [
          { id: 'deploy', state: 'SUCCEEDED' },
          { id: 'verify', state: 'FAILED' },
        ],
      },
    ]);
  });

  it('promotes to the stage after the furthest successful rollout', () => {
    expect(nextTarget(pipeline, [])).toBe('dev');
    expect(nextTarget(pipeline, [rollout('dev', 'SUCCEEDED'), rollout('staging', 'FAILED')])).toBe('staging');
    expect(nextTarget(pipeline, [rollout('dev', 'SUCCEEDED'), rollout('staging', 'SUCCEEDED')])).toBe('prod');
    expect(nextTarget(pipeline, [rollout('prod', 'SUCCEEDED')])).toBeNull();
  });
});
