import {
  type BulkResult,
  type BulkScheduler,
  BulkSchedulerSchema,
  type Confirm,
  ConfirmSchema,
  type CreateSchedulerJob,
  CreateSchedulerJobSchema,
  type ListResponse,
  ProjectIdParamSchema,
  RegionSchema,
  type SaveSchedulerJob,
  SaveSchedulerJobSchema,
  type SchedulerAction,
  type SchedulerJob,
  SchedulerJobIdSchema,
  schedulerActions,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { type ProfileHandle, ProfilesService } from '../../core/credentials/profiles.service.js';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { fanOut, WildcardSupport } from '../../core/gcp/fan-out.js';
import { rawJson } from '../../core/gcp/proto.js';
import { sdk } from '../../core/gcp/sdk.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { toProblem } from '../../core/problem/google-error.mapper.js';
import { ProblemException } from '../../core/problem/problem.js';
import { mapSchedulerJob, toSchedulerJob } from './scheduler-mapping.js';

const projectOf = (name: string) => /^projects\/([^/]+)\//.exec(name)?.[1] ?? '';
const locationOf = (name: string) => /\/locations\/([^/]+)\//.exec(name)?.[1] ?? '';
const shortName = (name: string) => name.split('/').pop() ?? name;
const href = (name: string) => `/p/${projectOf(name)}/scheduler/${locationOf(name)}/${shortName(name)}`;

const MASK = [
  'description',
  'schedule',
  'time_zone',
  'http_target',
  'pubsub_target',
  'app_engine_http_target',
  'retry_config',
  'attempt_deadline',
];

/** Cloud Scheduler (SPEC-0003 D-12, CA-24 to CA-26). Scheduler calls finish at once: no operations. */
@Injectable()
export class SchedulerService {
  private readonly wildcard = new WildcardSupport();

  constructor(
    private readonly clients: GcpClientFactory,
    private readonly operations: OperationsService,
  ) {}

  private async client(profileId: string) {
    const { CloudSchedulerClient } = await sdk.scheduler();
    return this.clients.get(profileId, 'scheduler', (auth) => new CloudSchedulerClient({ auth }));
  }

  private record(h: ProfileHandle, kind: string, name: string, displayName: string) {
    this.operations.recordInstant({
      profileId: h.profile.id,
      projectId: projectOf(name),
      product: 'scheduler',
      kind,
      resource: { name, displayName, href: href(name) },
    });
  }

  async list(h: ProfileHandle, projectId: string): Promise<ListResponse<SchedulerJob>> {
    const client = await this.client(h.profile.id);
    const inLocation = async (location: string) => {
      const [items] = await client.listJobs({ parent: `projects/${projectId}/locations/${location}`, pageSize: 500 });
      return items.map(mapSchedulerJob);
    };
    const result = await this.wildcard.list(
      'scheduler',
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

  async get(h: ProfileHandle, name: string): Promise<SchedulerJob> {
    const [j] = await (await this.client(h.profile.id)).getJob({ name });
    return mapSchedulerJob(j);
  }

  async raw(h: ProfileHandle, name: string): Promise<unknown> {
    const [j] = await (await this.client(h.profile.id)).getJob({ name });
    return rawJson(j);
  }

  async create(h: ProfileHandle, projectId: string, body: CreateSchedulerJob): Promise<SchedulerJob> {
    const parent = `projects/${projectId}/locations/${body.region}`;
    const [j] = await (await this.client(h.profile.id)).createJob({ parent, job: toSchedulerJob(`${parent}/jobs/${body.id}`, body) });
    const job = mapSchedulerJob(j);
    this.record(h, 'scheduler.job.create', job.name, `Create ${job.id}`);
    return job;
  }

  async update(h: ProfileHandle, name: string, body: SaveSchedulerJob): Promise<SchedulerJob> {
    const [j] = await (await this.client(h.profile.id)).updateJob({ job: toSchedulerJob(name, body), updateMask: { paths: MASK } });
    this.record(h, 'scheduler.job.update', name, `Update ${shortName(name)}`);
    return mapSchedulerJob(j);
  }

  async act(h: ProfileHandle, name: string, action: SchedulerAction): Promise<SchedulerJob> {
    const client = await this.client(h.profile.id);
    const [j] =
      action === 'pause'
        ? await client.pauseJob({ name })
        : action === 'resume'
          ? await client.resumeJob({ name })
          : await client.runJob({ name });
    const verb = action === 'pause' ? 'Pause' : action === 'resume' ? 'Resume' : 'Run';
    this.record(h, `scheduler.job.${action}`, name, `${verb} ${shortName(name)}`);
    return mapSchedulerJob(j);
  }

  async remove(h: ProfileHandle, name: string): Promise<void> {
    await (await this.client(h.profile.id)).deleteJob({ name });
    this.record(h, 'scheduler.job.delete', name, `Delete ${shortName(name)}`);
  }

  /** Each job on its own; one failure does not stop the others (SPEC-0003 CA-26). */
  async bulk(h: ProfileHandle, body: BulkScheduler): Promise<BulkResult[]> {
    const out: BulkResult[] = [];
    for (const name of body.names) {
      try {
        if (body.action === 'delete') await this.remove(h, name);
        else await this.act(h, name, body.action);
        out.push({ name, ok: true, error: null });
      } catch (err) {
        out.push({ name, ok: false, error: toProblem(err).detail });
      }
    }
    return out;
  }
}

const p = { schema: ProjectIdParamSchema };
const loc = { schema: RegionSchema };
const jid = { schema: SchedulerJobIdSchema };
const JOB = 'projects/:projectId/locations/:location/jobs/:job';
const name = (projectId: string, location: string, job: string) => `projects/${projectId}/locations/${location}/jobs/${job}`;

@Controller('api/projects/:projectId/scheduler')
export class SchedulerController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly scheduler: SchedulerService,
  ) {}

  @Get('jobs')
  list(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ListResponse<SchedulerJob>> {
    return this.scheduler.list(this.profiles.get(profileId), projectId);
  }

  @Post('jobs')
  @Mutation({ product: 'scheduler', verb: 'job.create', resource: 'projects/:projectId/scheduler' })
  create(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateSchedulerJobSchema }) body: CreateSchedulerJob,
  ): Promise<SchedulerJob> {
    return this.scheduler.create(this.profiles.get(profileId), projectId, body);
  }

  @Post('bulk')
  @HttpCode(200)
  @Mutation({ product: 'scheduler', verb: 'job.bulk', resource: 'projects/:projectId/scheduler' })
  bulk(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: BulkSchedulerSchema }) body: BulkScheduler,
  ): Promise<BulkResult[]> {
    if (body.action === 'delete') requireConfirmation(body.confirm ?? '', String(body.names.length));
    const foreign = body.names.find((n) => !n.startsWith(`projects/${projectId}/`));
    if (foreign) throw ProblemException.of('INVALID_ARGUMENT', `${foreign} belongs to another project.`);
    return this.scheduler.bulk(this.profiles.get(profileId), body);
  }

  @Get('locations/:location/jobs/:job')
  get(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', jid) job: string,
  ): Promise<SchedulerJob> {
    return this.scheduler.get(this.profiles.get(profileId), name(projectId, location, job));
  }

  @Get('locations/:location/jobs/:job/raw')
  raw(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', jid) job: string,
  ): Promise<unknown> {
    return this.scheduler.raw(this.profiles.get(profileId), name(projectId, location, job));
  }

  @Put('locations/:location/jobs/:job')
  @Mutation({ product: 'scheduler', verb: 'job.update', resource: JOB })
  update(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', jid) job: string,
    @Body({ schema: SaveSchedulerJobSchema }) body: SaveSchedulerJob,
  ): Promise<SchedulerJob> {
    return this.scheduler.update(this.profiles.get(profileId), name(projectId, location, job), body);
  }

  @Post('locations/:location/jobs/:job/:action')
  @HttpCode(200)
  @Mutation({ product: 'scheduler', verb: 'job.action', resource: JOB })
  act(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', jid) job: string,
    @Param('action', { schema: z.enum(schedulerActions) }) action: SchedulerAction,
  ): Promise<SchedulerJob> {
    return this.scheduler.act(this.profiles.get(profileId), name(projectId, location, job), action);
  }

  @Delete('locations/:location/jobs/:job')
  @HttpCode(204)
  @Mutation({ product: 'scheduler', verb: 'job.delete', resource: JOB })
  async remove(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', jid) job: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    requireConfirmation(body.confirm, job);
    await this.scheduler.remove(this.profiles.get(profileId), name(projectId, location, job));
  }
}

/** Cloud Scheduler (SPEC-0003 §7.5). */
@Module({ controllers: [SchedulerController], providers: [SchedulerService], exports: [SchedulerService] })
export class SchedulerModule {}
