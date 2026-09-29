import { describe, expect, it } from 'vitest';
import { mapProvider, mapTrigger } from '../eventarc/eventarc.module.js';
import { mapQueue, mapTask } from './tasks.module.js';

describe('Cloud Tasks mapping', () => {
  it('maps a queue with rate and retry settings', () => {
    expect(
      mapQueue({
        name: 'projects/demo/locations/us-central1/queues/emails',
        state: 'PAUSED',
        rateLimits: { maxDispatchesPerSecond: 10, maxBurstSize: 20, maxConcurrentDispatches: 5 },
        retryConfig: { maxAttempts: 7, minBackoff: { seconds: '1', nanos: 500000000 }, maxBackoff: { seconds: '60' }, maxDoublings: 3 },
        stackdriverLoggingConfig: { samplingRatio: 0.5 },
      }),
    ).toMatchObject({
      id: 'emails',
      location: 'us-central1',
      state: 'paused',
      maxDispatchesPerSecond: 10,
      maxConcurrentDispatches: 5,
      maxAttempts: 7,
      minBackoffSeconds: 1.5,
      maxBackoffSeconds: 60,
      loggingSamplingRatio: 0.5,
    });
  });

  it('maps a task and its attempts', () => {
    const t = mapTask({
      name: 'projects/demo/locations/us-central1/queues/emails/tasks/123',
      httpRequest: { url: 'https://api.example.com/send', httpMethod: 'POST' },
      dispatchCount: '3',
      responseCount: '2',
      lastAttempt: { responseStatus: { code: 14, message: 'Unavailable' }, dispatchTime: { seconds: '1790000000' } },
    });
    expect(t).toMatchObject({
      id: '123',
      kind: 'http',
      method: 'POST',
      url: 'https://api.example.com/send',
      dispatchCount: 3,
      responseCount: 2,
    });
    expect(t.lastAttempt).toEqual({
      scheduleTime: null,
      dispatchTime: '2026-09-21T14:13:20Z',
      responseTime: null,
      status: { code: 14, message: 'Unavailable' },
    });
  });
});

describe('Eventarc mapping', () => {
  it('maps a trigger with its event type and Cloud Run destination', () => {
    const t = mapTrigger({
      name: 'projects/demo/locations/us-central1/triggers/on-upload',
      eventFilters: [
        { attribute: 'type', value: 'google.cloud.storage.object.v1.finalized' },
        { attribute: 'bucket', value: 'uploads' },
      ],
      destination: { cloudRun: { service: 'resize', region: 'us-central1', path: '/events' } },
      serviceAccount: 'events@demo.iam.gserviceaccount.com',
      transport: { pubsub: { topic: 'projects/demo/topics/eventarc-us-central1-on-upload' } },
      conditions: { SERVICE_ACCOUNT: { code: 'PERMISSION_DENIED', message: 'Missing roles/eventarc.eventReceiver' } },
    });
    expect(t).toMatchObject({
      id: 'on-upload',
      eventType: 'google.cloud.storage.object.v1.finalized',
      destination: { kind: 'cloudRun', service: 'resize', region: 'us-central1', path: '/events' },
      transportTopic: 'projects/demo/topics/eventarc-us-central1-on-upload',
      conditions: [{ key: 'SERVICE_ACCOUNT', code: 'PERMISSION_DENIED', message: 'Missing roles/eventarc.eventReceiver' }],
    });
    expect(mapTrigger({ name: 'x', destination: { workflow: 'projects/demo/locations/us-central1/workflows/w' } }).destination).toEqual({
      kind: 'workflow',
      workflow: 'projects/demo/locations/us-central1/workflows/w',
    });
  });

  it('maps a provider catalog entry', () => {
    const p = mapProvider({
      name: 'projects/demo/locations/us-central1/providers/storage.googleapis.com',
      displayName: 'Cloud Storage',
      eventTypes: [
        {
          type: 'google.cloud.storage.object.v1.finalized',
          description: 'Object created',
          filteringAttributes: [{ attribute: 'bucket', required: true }],
        },
      ],
    });
    expect(p.eventTypes[0]?.filteringAttributes[0]).toEqual({
      attribute: 'bucket',
      description: '',
      required: true,
      pathPatternSupported: false,
    });
  });
});
