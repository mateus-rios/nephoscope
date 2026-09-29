import { SaveSchedulerJobSchema } from '@nephoscope/contracts';
import { describe, expect, it } from 'vitest';
import { mapSchedulerJob, toSchedulerJob } from './scheduler-mapping.js';

const NAME = 'projects/demo/locations/us-central1/jobs/nightly';

describe('scheduler mapping', () => {
  it('round-trips an HTTP job with OAuth, as "Schedule this job" creates it (CA-13)', () => {
    const form = SaveSchedulerJobSchema.parse({
      description: 'Runs the ETL job',
      schedule: '0 3 * * *',
      timeZone: 'America/Sao_Paulo',
      target: {
        kind: 'http',
        uri: 'https://run.googleapis.com/v2/projects/demo/locations/us-central1/jobs/etl:run',
        method: 'POST',
        auth: { kind: 'oauth', serviceAccount: 'scheduler@demo.iam.gserviceaccount.com' },
      },
      retry: { retryCount: 2, minBackoffSeconds: 5 },
      attemptDeadlineSeconds: 180,
    });
    const message = toSchedulerJob(NAME, form);
    expect(message.httpTarget.oauthToken).toEqual({
      serviceAccountEmail: 'scheduler@demo.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
    });
    expect(message.attemptDeadline).toEqual({ seconds: 180, nanos: 0 });
    const back = mapSchedulerJob({ ...message, state: 'ENABLED', scheduleTime: { seconds: '1790000000' } });
    expect(back).toMatchObject({
      id: 'nightly',
      location: 'us-central1',
      schedule: '0 3 * * *',
      timeZone: 'America/Sao_Paulo',
      state: 'enabled',
      nextRunTime: '2026-09-21T14:13:20Z',
      target: { kind: 'http', method: 'POST', auth: { kind: 'oauth', serviceAccount: 'scheduler@demo.iam.gserviceaccount.com' } },
      retry: { retryCount: 2, minBackoffSeconds: 5 },
      attemptDeadlineSeconds: 180,
    });
  });

  it('maps Pub/Sub data as text and flags binary payloads', () => {
    const text = mapSchedulerJob({
      name: NAME,
      pubsubTarget: { topicName: 'projects/demo/topics/t', data: Buffer.from('{"go":true}'), attributes: { a: '1' } },
    });
    expect(text.target).toEqual({ kind: 'pubsub', topic: 'projects/demo/topics/t', data: '{"go":true}', attributes: { a: '1' } });
    expect(text.binaryPayload).toBe(false);
    const binary = mapSchedulerJob({ name: NAME, pubsubTarget: { topicName: 'projects/demo/topics/t', data: Buffer.from([0xff, 0xfe]) } });
    expect(binary.binaryPayload).toBe(true);
    expect(binary.target.kind === 'pubsub' && binary.target.data).toBe('//4=');
  });

  it('maps the last attempt status', () => {
    expect(mapSchedulerJob({ name: NAME, status: { code: 5, message: 'Not found' } }).lastAttemptStatus).toEqual({
      code: 5,
      message: 'Not found',
    });
    expect(mapSchedulerJob({ name: NAME }).lastAttemptStatus).toBeNull();
  });
});
