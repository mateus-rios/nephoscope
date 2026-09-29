import {
  type Confirm,
  ConfirmSchema,
  type CreateQueue,
  CreateQueueSchema,
  type CreateTask,
  CreateTaskSchema,
  type ListResponse,
  ProjectIdParamSchema,
  type QueueAction,
  QueueIdSchema,
  type QueueTask,
  queueActions,
  RegionSchema,
  type SaveQueue,
  SaveQueueSchema,
  type TaskAttempt,
  type TaskQueue,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { fanOut, WildcardSupport } from '../../core/gcp/fan-out.js';
import { durationToSeconds, rawJson, secondsToDuration, timestampToIso, toInt } from '../../core/gcp/proto.js';
import { sdk } from '../../core/gcp/sdk.js';
import { OperationsService } from '../../core/operations/operations.service.js';

// biome-ignore lint/suspicious/noExplicitAny: Cloud Tasks messages are read and built field by field.
type Any = any;

const projectOf = (name: string) => /^projects\/([^/]+)\//.exec(name)?.[1] ?? '';
const locationOf = (name: string) => /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '';
const shortName = (name: string) => name.split('/').pop() ?? name;

const STATES: Record<string, TaskQueue['state']> = { RUNNING: 'running', PAUSED: 'paused', DISABLED: 'disabled' };

export function mapQueue(q: Any): TaskQueue {
  const name = String(q?.name ?? '');
  const r = q?.retryConfig ?? {};
  const rate = q?.rateLimits ?? {};
  return {
    name,
    id: shortName(name),
    location: locationOf(name),
    state: STATES[String(q?.state)] ?? 'unknown',
    maxDispatchesPerSecond: typeof rate.maxDispatchesPerSecond === 'number' ? rate.maxDispatchesPerSecond : null,
    maxBurstSize: toInt(rate.maxBurstSize),
    maxConcurrentDispatches: toInt(rate.maxConcurrentDispatches),
    maxAttempts: toInt(r.maxAttempts),
    maxRetryDurationSeconds: durationToSeconds(r.maxRetryDuration),
    minBackoffSeconds: durationToSeconds(r.minBackoff),
    maxBackoffSeconds: durationToSeconds(r.maxBackoff),
    maxDoublings: toInt(r.maxDoublings),
    purgeTime: timestampToIso(q?.purgeTime),
    loggingSamplingRatio: typeof q?.stackdriverLoggingConfig?.samplingRatio === 'number' ? q.stackdriverLoggingConfig.samplingRatio : null,
  };
}

function mapAttempt(a: Any): TaskAttempt | null {
  if (!a) return null;
  return {
    scheduleTime: timestampToIso(a.scheduleTime),
    dispatchTime: timestampToIso(a.dispatchTime),
    responseTime: timestampToIso(a.responseTime),
    status: a.responseStatus ? { code: toInt(a.responseStatus.code) ?? 0, message: a.responseStatus.message || null } : null,
  };
}

export function mapTask(t: Any): QueueTask {
  const name = String(t?.name ?? '');
  const http = t?.httpRequest;
  const ae = t?.appEngineHttpRequest;
  return {
    name,
    id: shortName(name),
    kind: http ? 'http' : 'appengine',
    method: String(http?.httpMethod ?? ae?.httpMethod ?? 'POST'),
    url: String(http?.url ?? ae?.relativeUri ?? ''),
    scheduleTime: timestampToIso(t?.scheduleTime),
    createTime: timestampToIso(t?.createTime),
    dispatchCount: toInt(t?.dispatchCount) ?? 0,
    responseCount: toInt(t?.responseCount) ?? 0,
    dispatchDeadlineSeconds: durationToSeconds(t?.dispatchDeadline),
    firstAttempt: mapAttempt(t?.firstAttempt),
    lastAttempt: mapAttempt(t?.lastAttempt),
  };
}

function queueMessage(name: string, s: SaveQueue): { queue: Any; paths: string[] } {
  const queue: Any = { name, rateLimits: {}, retryConfig: {} };
  const paths: string[] = [];
  const set = (path: string, apply: () => void, v: unknown) => {
    if (v === undefined) return;
    apply();
    paths.push(path);
  };
  set(
    'rate_limits.max_dispatches_per_second',
    () => (queue.rateLimits.maxDispatchesPerSecond = s.maxDispatchesPerSecond),
    s.maxDispatchesPerSecond,
  );
  set(
    'rate_limits.max_concurrent_dispatches',
    () => (queue.rateLimits.maxConcurrentDispatches = s.maxConcurrentDispatches),
    s.maxConcurrentDispatches,
  );
  set('retry_config.max_attempts', () => (queue.retryConfig.maxAttempts = s.maxAttempts), s.maxAttempts);
  set(
    'retry_config.max_retry_duration',
    () => (queue.retryConfig.maxRetryDuration = secondsToDuration(s.maxRetryDurationSeconds ?? 0)),
    s.maxRetryDurationSeconds,
  );
  set('retry_config.min_backoff', () => (queue.retryConfig.minBackoff = secondsToDuration(s.minBackoffSeconds ?? 0)), s.minBackoffSeconds);
  set('retry_config.max_backoff', () => (queue.retryConfig.maxBackoff = secondsToDuration(s.maxBackoffSeconds ?? 0)), s.maxBackoffSeconds);
  set('retry_config.max_doublings', () => (queue.retryConfig.maxDoublings = s.maxDoublings), s.maxDoublings);
  set(
    'stackdriver_logging_config.sampling_ratio',
    () => (queue.stackdriverLoggingConfig = { samplingRatio: s.loggingSamplingRatio }),
    s.loggingSamplingRatio,
  );
  return { queue, paths };
}

/** Cloud Tasks (SPEC-0003 D-13). Every call finishes at once: no operations. */
@Injectable()
export class TasksService {
  private readonly wildcard = new WildcardSupport();

  constructor(
    private readonly clients: GcpClientFactory,
    private readonly operations: OperationsService,
  ) {}

  private async client(profileId: string) {
    const { CloudTasksClient } = await sdk.tasks();
    return this.clients.get(profileId, 'tasks', (auth) => new CloudTasksClient({ auth }));
  }

  private record(h: ProfileHandle, kind: string, name: string, displayName: string) {
    const queue = name.replace(/\/tasks\/[^/]+$/, '');
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId: projectOf(name),
      product: 'tasks',
      kind,
      resource: { name, displayName, href: `/p/${projectOf(name)}/tasks/${locationOf(name)}/${shortName(queue)}` },
    });
  }

  async listQueues(h: ProfileHandle, projectId: string): Promise<ListResponse<TaskQueue>> {
    const client = await this.client(h.profile.id);
    const inLocation = async (location: string) => {
      const [items] = await client.listQueues({ parent: `projects/${projectId}/locations/${location}`, pageSize: 1000 });
      return items.map(mapQueue);
    };
    const result = await this.wildcard.list(
      'tasks',
      async () => ({ items: await inLocation('-'), nextPageToken: null }),
      async () => {
        const locations: string[] = [];
        for await (const l of client.listLocationsAsync({ name: `projects/${projectId}` })) if (l.locationId) locations.push(l.locationId);
        return fanOut(locations, inLocation);
      },
    );
    result.items.sort((a, b) => a.id.localeCompare(b.id));
    return result;
  }

  async getQueue(h: ProfileHandle, name: string): Promise<TaskQueue> {
    const [q] = await (await this.client(h.profile.id)).getQueue({ name });
    return mapQueue(q);
  }

  async rawQueue(h: ProfileHandle, name: string): Promise<unknown> {
    const [q] = await (await this.client(h.profile.id)).getQueue({ name });
    return rawJson(q);
  }

  async createQueue(h: ProfileHandle, projectId: string, body: CreateQueue): Promise<TaskQueue> {
    const parent = `projects/${projectId}/locations/${body.region}`;
    const { queue } = queueMessage(`${parent}/queues/${body.id}`, body);
    const [q] = await (await this.client(h.profile.id)).createQueue({ parent, queue });
    this.record(h, 'tasks.queue.create', q.name ?? '', `Create queue ${body.id}`);
    return mapQueue(q);
  }

  async updateQueue(h: ProfileHandle, name: string, body: SaveQueue): Promise<TaskQueue> {
    const { queue, paths } = queueMessage(name, body);
    const [q] = await (await this.client(h.profile.id)).updateQueue({ queue, updateMask: { paths } });
    this.record(h, 'tasks.queue.update', name, `Update queue ${shortName(name)}`);
    return mapQueue(q);
  }

  async actQueue(h: ProfileHandle, name: string, action: QueueAction): Promise<TaskQueue> {
    const client = await this.client(h.profile.id);
    const [q] = action === 'pause' ? await client.pauseQueue({ name }) : await client.resumeQueue({ name });
    this.record(h, `tasks.queue.${action}`, name, `${action === 'pause' ? 'Pause' : 'Resume'} queue ${shortName(name)}`);
    return mapQueue(q);
  }

  async purgeQueue(h: ProfileHandle, name: string): Promise<TaskQueue> {
    const [q] = await (await this.client(h.profile.id)).purgeQueue({ name });
    this.record(h, 'tasks.queue.purge', name, `Purge queue ${shortName(name)}`);
    return mapQueue(q);
  }

  async deleteQueue(h: ProfileHandle, name: string): Promise<void> {
    await (await this.client(h.profile.id)).deleteQueue({ name });
    this.record(h, 'tasks.queue.delete', name, `Delete queue ${shortName(name)}`);
  }

  async listTasks(h: ProfileHandle, queue: string, pageToken?: string): Promise<ListResponse<QueueTask>> {
    const [items, , response] = await (await this.client(h.profile.id)).listTasks(
      { parent: queue, pageSize: 500, pageToken, responseView: 'BASIC' },
      { autoPaginate: false },
    );
    return { items: items.map(mapTask), nextPageToken: response?.nextPageToken || null };
  }

  async createTask(h: ProfileHandle, queue: string, body: CreateTask): Promise<QueueTask> {
    const task: Any = {
      httpRequest: {
        url: body.url,
        httpMethod: body.method,
        headers: body.headers,
        body: body.body ? Buffer.from(body.body) : undefined,
        oidcToken: body.serviceAccount ? { serviceAccountEmail: body.serviceAccount, audience: body.audience ?? '' } : undefined,
      },
    };
    if (body.scheduleTime) {
      const ms = Date.parse(body.scheduleTime);
      task.scheduleTime = { seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1e6 };
    }
    const [t] = await (await this.client(h.profile.id)).createTask({ parent: queue, task });
    this.record(h, 'tasks.task.create', t.name ?? queue, `Create task in ${shortName(queue)}`);
    return mapTask(t);
  }

  async runTask(h: ProfileHandle, name: string): Promise<QueueTask> {
    const [t] = await (await this.client(h.profile.id)).runTask({ name });
    this.record(h, 'tasks.task.run', name, `Run task ${shortName(name)}`);
    return mapTask(t);
  }

  async deleteTask(h: ProfileHandle, name: string): Promise<void> {
    await (await this.client(h.profile.id)).deleteTask({ name });
    this.record(h, 'tasks.task.delete', name, `Delete task ${shortName(name)}`);
  }
}

const p = { schema: ProjectIdParamSchema };
const loc = { schema: RegionSchema };
const qid = { schema: QueueIdSchema };
const tid = {
  schema: z
    .string()
    .min(1)
    .max(500)
    .regex(/^[A-Za-z0-9_-]+$/),
};
const QUEUE = 'projects/:projectId/locations/:location/queues/:queue';
const qname = (projectId: string, location: string, queue: string) => `projects/${projectId}/locations/${location}/queues/${queue}`;

@Controller('api/projects/:projectId/tasks')
export class TasksController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly tasks: TasksService,
  ) {}

  @Get('queues')
  queues(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ListResponse<TaskQueue>> {
    return this.tasks.listQueues(this.profiles.get(profileId), projectId);
  }

  @Post('queues')
  @Mutation({ product: 'tasks', verb: 'queue.create', resource: 'projects/:projectId/tasks' })
  createQueue(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateQueueSchema }) body: CreateQueue,
  ): Promise<TaskQueue> {
    return this.tasks.createQueue(this.profiles.get(profileId), projectId, body);
  }

  @Get('locations/:location/queues/:queue')
  getQueue(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('queue', qid) queue: string,
  ): Promise<TaskQueue> {
    return this.tasks.getQueue(this.profiles.get(profileId), qname(projectId, location, queue));
  }

  @Get('locations/:location/queues/:queue/raw')
  rawQueue(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('queue', qid) queue: string,
  ): Promise<unknown> {
    return this.tasks.rawQueue(this.profiles.get(profileId), qname(projectId, location, queue));
  }

  @Put('locations/:location/queues/:queue')
  @Mutation({ product: 'tasks', verb: 'queue.update', resource: QUEUE })
  updateQueue(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('queue', qid) queue: string,
    @Body({ schema: SaveQueueSchema }) body: SaveQueue,
  ): Promise<TaskQueue> {
    return this.tasks.updateQueue(this.profiles.get(profileId), qname(projectId, location, queue), body);
  }

  @Post('locations/:location/queues/:queue/purge')
  @HttpCode(200)
  @Mutation({ product: 'tasks', verb: 'queue.purge', resource: QUEUE })
  purge(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('queue', qid) queue: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<TaskQueue> {
    // SPEC-0003 CA-27: purging cannot be undone, so the queue name is typed.
    requireConfirmation(body.confirm, queue);
    return this.tasks.purgeQueue(this.profiles.get(profileId), qname(projectId, location, queue));
  }

  @Post('locations/:location/queues/:queue/:action')
  @HttpCode(200)
  @Mutation({ product: 'tasks', verb: 'queue.action', resource: QUEUE })
  act(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('queue', qid) queue: string,
    @Param('action', { schema: z.enum(queueActions) }) action: QueueAction,
  ): Promise<TaskQueue> {
    return this.tasks.actQueue(this.profiles.get(profileId), qname(projectId, location, queue), action);
  }

  @Delete('locations/:location/queues/:queue')
  @HttpCode(204)
  @Mutation({ product: 'tasks', verb: 'queue.delete', resource: QUEUE })
  async deleteQueue(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('queue', qid) queue: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, queue);
    await this.tasks.deleteQueue(this.profiles.get(profileId), qname(projectId, location, queue));
  }

  @Get('locations/:location/queues/:queue/tasks')
  listTasks(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('queue', qid) queue: string,
  ): Promise<ListResponse<QueueTask>> {
    return this.tasks.listTasks(this.profiles.get(profileId), qname(projectId, location, queue));
  }

  @Post('locations/:location/queues/:queue/tasks')
  @Mutation({ product: 'tasks', verb: 'task.create', resource: QUEUE })
  createTask(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('queue', qid) queue: string,
    @Body({ schema: CreateTaskSchema }) body: CreateTask,
  ): Promise<QueueTask> {
    return this.tasks.createTask(this.profiles.get(profileId), qname(projectId, location, queue), body);
  }

  @Post('locations/:location/queues/:queue/tasks/:task/run')
  @HttpCode(200)
  @Mutation({ product: 'tasks', verb: 'task.run', resource: `${QUEUE}/tasks/:task` })
  runTask(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('queue', qid) queue: string,
    @Param('task', tid) task: string,
  ): Promise<QueueTask> {
    return this.tasks.runTask(this.profiles.get(profileId), `${qname(projectId, location, queue)}/tasks/${task}`);
  }

  @Delete('locations/:location/queues/:queue/tasks/:task')
  @HttpCode(204)
  @Mutation({ product: 'tasks', verb: 'task.delete', resource: `${QUEUE}/tasks/:task` })
  async deleteTask(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('queue', qid) queue: string,
    @Param('task', tid) task: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, task);
    await this.tasks.deleteTask(this.profiles.get(profileId), `${qname(projectId, location, queue)}/tasks/${task}`);
  }
}

/** Cloud Tasks (SPEC-0003 §7.6). */
@Module({ controllers: [TasksController], providers: [TasksService] })
export class TasksModule {}
