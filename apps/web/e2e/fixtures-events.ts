import type { EventarcTrigger, EventProvider, QueueTask, SchedulerJob, TaskQueue } from '@nephoscope/contracts';
import { PROJECT } from './fixtures';

const now = Date.parse('2026-09-28T12:00:00Z');
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

export const schedulerJobs: SchedulerJob[] = [
  {
    name: `projects/${PROJECT}/locations/us-central1/jobs/nightly-etl-schedule`,
    id: 'nightly-etl-schedule',
    location: 'us-central1',
    description: 'Runs the Cloud Run job nightly-etl',
    schedule: '0 3 * * *',
    timeZone: 'America/Sao_Paulo',
    state: 'enabled',
    target: {
      kind: 'http',
      uri: `https://run.googleapis.com/v2/projects/${PROJECT}/locations/us-central1/jobs/nightly-etl:run`,
      method: 'POST',
      headers: {},
      body: '',
      auth: {
        kind: 'oauth',
        serviceAccount: `scheduler@${PROJECT}.iam.gserviceaccount.com`,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
      },
    },
    binaryPayload: false,
    lastAttemptTime: iso(540),
    lastAttemptStatus: { code: 0, message: null },
    nextRunTime: iso(-900),
    retry: { retryCount: 1 },
    attemptDeadlineSeconds: 180,
    userUpdateTime: iso(60 * 24 * 5),
  },
  {
    name: `projects/${PROJECT}/locations/us-central1/jobs/report-weekly`,
    id: 'report-weekly',
    location: 'us-central1',
    description: null,
    schedule: '30 8 * * 1',
    timeZone: 'Etc/UTC',
    state: 'paused',
    target: { kind: 'pubsub', topic: `projects/${PROJECT}/topics/reports`, data: '{"kind":"weekly"}', attributes: {} },
    binaryPayload: false,
    lastAttemptTime: iso(60 * 24 * 8),
    lastAttemptStatus: { code: 7, message: 'Permission denied on topic reports' },
    nextRunTime: null,
    retry: {},
    attemptDeadlineSeconds: null,
    userUpdateTime: iso(60 * 24 * 9),
  },
];

export const queues: TaskQueue[] = [
  {
    name: `projects/${PROJECT}/locations/us-central1/queues/emails`,
    id: 'emails',
    location: 'us-central1',
    state: 'running',
    maxDispatchesPerSecond: 10,
    maxBurstSize: 20,
    maxConcurrentDispatches: 5,
    maxAttempts: 7,
    maxRetryDurationSeconds: 3600,
    minBackoffSeconds: 1,
    maxBackoffSeconds: 60,
    maxDoublings: 3,
    purgeTime: null,
    loggingSamplingRatio: 1,
  },
];

export const queueTasks: QueueTask[] = [
  {
    name: `${queues[0]!.name}/tasks/8423150172395621`,
    id: '8423150172395621',
    kind: 'http',
    method: 'POST',
    url: 'https://mailer-abc123-uc.a.run.app/send',
    scheduleTime: iso(1),
    createTime: iso(3),
    dispatchCount: 3,
    responseCount: 3,
    dispatchDeadlineSeconds: 600,
    firstAttempt: null,
    lastAttempt: { scheduleTime: iso(2), dispatchTime: iso(2), responseTime: iso(2), status: { code: 14, message: 'HTTP 503' } },
  },
];

export const triggers: EventarcTrigger[] = [
  {
    name: `projects/${PROJECT}/locations/us-central1/triggers/api-on-upload`,
    id: 'api-on-upload',
    location: 'us-central1',
    eventType: 'google.cloud.storage.object.v1.finalized',
    filters: [
      { attribute: 'type', value: 'google.cloud.storage.object.v1.finalized', operator: null },
      { attribute: 'bucket', value: 'uploads-demo', operator: null },
    ],
    destination: { kind: 'cloudRun', service: 'api', region: 'us-central1', path: '/events' },
    serviceAccount: `events@${PROJECT}.iam.gserviceaccount.com`,
    transportTopic: `projects/${PROJECT}/topics/eventarc-us-central1-api-on-upload`,
    createTime: iso(60 * 24 * 20),
    updateTime: iso(60 * 24 * 20),
    labels: {},
    conditions: [],
  },
];

export const providers: EventProvider[] = [
  {
    name: `projects/${PROJECT}/locations/us-central1/providers/storage.googleapis.com`,
    id: 'storage.googleapis.com',
    displayName: 'Cloud Storage',
    eventTypes: [
      {
        type: 'google.cloud.storage.object.v1.finalized',
        description: 'The object is created or overwritten',
        filteringAttributes: [
          { attribute: 'type', description: 'Event type', required: true, pathPatternSupported: false },
          { attribute: 'bucket', description: 'The bucket name', required: true, pathPatternSupported: false },
        ],
      },
    ],
  },
];
