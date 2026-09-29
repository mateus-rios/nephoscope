import {
  type Confirm,
  ConfirmSchema,
  type CreateService,
  CreateServiceSchema,
  DEFAULT_PAGE_SIZE,
  type DeployService,
  DeployServiceSchema,
  type ExecuteJob,
  ExecuteJobSchema,
  type InvokeRequest,
  InvokeRequestSchema,
  type InvokeResponse,
  type ListResponse,
  type OperationAccepted,
  ProjectIdParamSchema,
  type PublicAccess,
  PublicAccessSchema,
  RegionSchema,
  type Revision,
  type RunExecution,
  type RunJob,
  type RunJobSummary,
  RunResourceIdSchema,
  type RunService as RunServiceDto,
  type RunServiceSummary,
  type RunTask,
  type ServiceAccess,
  type UpdateJob,
  UpdateJobSchema,
  type UpdateTraffic,
  UpdateTrafficSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { RunService } from './run.service.js';

const PageQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
  pageToken: z.string().max(4096).optional(),
});
type PageQuery = z.infer<typeof PageQuerySchema>;

const AccessQuerySchema = z.object({
  names: z
    .string()
    .max(20_000)
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.string().regex(/^projects\/[^/]+\/locations\/[^/]+\/services\/[^/]+$/)).max(100)),
});

const RollbackSchema = z.object({ revision: RunResourceIdSchema });

const SERVICE = 'projects/:projectId/locations/:location/services/:service';
const JOB = 'projects/:projectId/locations/:location/jobs/:job';

const p = { schema: ProjectIdParamSchema };
const loc = { schema: RegionSchema };
const id = { schema: RunResourceIdSchema };

@Controller('api/projects/:projectId/run')
export class RunController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly run: RunService,
  ) {}

  // ---- services ------------------------------------------------------------------------------

  @Get('services')
  listServices(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: PageQuerySchema }) q: PageQuery,
  ): Promise<ListResponse<RunServiceSummary>> {
    return this.run.listServices(this.profiles.get(profileId), projectId, q.pageSize ?? DEFAULT_PAGE_SIZE * 4, q.pageToken);
  }

  /** Public or private, for the list's authentication column (SPEC-0003 CA-01). */
  @Get('service-access')
  access(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) _projectId: string,
    @Query({ schema: AccessQuerySchema }) q: z.infer<typeof AccessQuerySchema>,
  ): Promise<ServiceAccess[]> {
    return this.run.accessMany(this.profiles.get(profileId), q.names);
  }

  @Post('services')
  @HttpCode(202)
  @Mutation({ product: 'run', verb: 'service.create', resource: 'projects/:projectId/services' })
  async create(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateServiceSchema }) body: CreateService,
  ): Promise<OperationAccepted> {
    return { operation: await this.run.createService(this.profiles.get(profileId), projectId, body) };
  }

  @Get('locations/:location/services/:service')
  getService(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('service', id) service: string,
  ): Promise<RunServiceDto> {
    return this.run.getService(this.profiles.get(profileId), `projects/${projectId}/locations/${location}/services/${service}`);
  }

  @Get('locations/:location/services/:service/yaml')
  rawService(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('service', id) service: string,
  ): Promise<unknown> {
    return this.run.rawService(this.profiles.get(profileId), `projects/${projectId}/locations/${location}/services/${service}`);
  }

  @Post('locations/:location/services/:service/deploy')
  @HttpCode(202)
  @Mutation({ product: 'run', verb: 'service.deploy', resource: SERVICE })
  async deploy(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('service', id) service: string,
    @Body({ schema: DeployServiceSchema }) body: DeployService,
  ): Promise<OperationAccepted> {
    return {
      operation: await this.run.deploy(
        this.profiles.get(profileId),
        `projects/${projectId}/locations/${location}/services/${service}`,
        body,
      ),
    };
  }

  @Put('locations/:location/services/:service/traffic')
  @HttpCode(202)
  @Mutation({ product: 'run', verb: 'service.traffic', resource: SERVICE })
  async traffic(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('service', id) service: string,
    @Body({ schema: UpdateTrafficSchema }) body: UpdateTraffic,
  ): Promise<OperationAccepted> {
    const name = `projects/${projectId}/locations/${location}/services/${service}`;
    return { operation: await this.run.setTraffic(this.profiles.get(profileId), name, body.traffic, body.etag) };
  }

  @Post('locations/:location/services/:service/rollback')
  @HttpCode(202)
  @Mutation({ product: 'run', verb: 'service.rollback', resource: SERVICE })
  async rollback(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('service', id) service: string,
    @Body({ schema: RollbackSchema }) body: z.infer<typeof RollbackSchema>,
  ): Promise<OperationAccepted> {
    const name = `projects/${projectId}/locations/${location}/services/${service}`;
    return { operation: await this.run.rollback(this.profiles.get(profileId), name, body.revision) };
  }

  @Get('locations/:location/services/:service/access')
  getAccess(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('service', id) service: string,
  ): Promise<ServiceAccess> {
    return this.run.getAccess(this.profiles.get(profileId), `projects/${projectId}/locations/${location}/services/${service}`);
  }

  @Put('locations/:location/services/:service/access')
  @HttpCode(202)
  @Mutation({ product: 'run', verb: 'service.access', resource: SERVICE })
  async setAccess(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('service', id) service: string,
    @Body({ schema: PublicAccessSchema }) body: PublicAccess,
  ): Promise<OperationAccepted> {
    const name = `projects/${projectId}/locations/${location}/services/${service}`;
    return { operation: await this.run.setAccess(this.profiles.get(profileId), name, body.mode) };
  }

  @Delete('locations/:location/services/:service')
  @HttpCode(202)
  @Mutation({ product: 'run', verb: 'service.delete', resource: SERVICE })
  async deleteService(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('service', id) service: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<OperationAccepted> {
    requireConfirmation(body.confirm, service);
    return {
      operation: await this.run.deleteService(
        this.profiles.get(profileId),
        `projects/${projectId}/locations/${location}/services/${service}`,
      ),
    };
  }

  @Post('locations/:location/services/:service/invoke')
  @HttpCode(200)
  @Mutation({ product: 'run', verb: 'service.invoke', resource: SERVICE })
  invoke(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('service', id) service: string,
    @Body({ schema: InvokeRequestSchema }) body: InvokeRequest,
  ): Promise<InvokeResponse> {
    return this.run.invoke(this.profiles.get(profileId), `projects/${projectId}/locations/${location}/services/${service}`, body);
  }

  // ---- revisions -----------------------------------------------------------------------------

  @Get('locations/:location/services/:service/revisions')
  listRevisions(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('service', id) service: string,
    @Query({ schema: PageQuerySchema }) q: PageQuery,
  ): Promise<ListResponse<Revision>> {
    const name = `projects/${projectId}/locations/${location}/services/${service}`;
    return this.run.listRevisions(this.profiles.get(profileId), name, q.pageSize ?? DEFAULT_PAGE_SIZE, q.pageToken);
  }

  @Get('locations/:location/services/:service/revisions/:revision')
  getRevision(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('service', id) service: string,
    @Param('revision', id) revision: string,
  ): Promise<Revision> {
    return this.run.getRevision(
      this.profiles.get(profileId),
      `projects/${projectId}/locations/${location}/services/${service}/revisions/${revision}`,
    );
  }

  @Get('locations/:location/services/:service/revisions/:revision/raw')
  rawRevision(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('service', id) service: string,
    @Param('revision', id) revision: string,
  ): Promise<unknown> {
    return this.run.rawRevision(
      this.profiles.get(profileId),
      `projects/${projectId}/locations/${location}/services/${service}/revisions/${revision}`,
    );
  }

  @Delete('locations/:location/services/:service/revisions/:revision')
  @HttpCode(202)
  @Mutation({ product: 'run', verb: 'revision.delete', resource: `${SERVICE}/revisions/:revision` })
  async deleteRevision(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('service', id) service: string,
    @Param('revision', id) revision: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<OperationAccepted> {
    requireConfirmation(body.confirm, revision);
    const name = `projects/${projectId}/locations/${location}/services/${service}/revisions/${revision}`;
    return { operation: await this.run.deleteRevision(this.profiles.get(profileId), name) };
  }

  // ---- jobs ----------------------------------------------------------------------------------

  @Get('jobs')
  listJobs(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query({ schema: PageQuerySchema }) q: PageQuery,
  ): Promise<ListResponse<RunJobSummary>> {
    return this.run.listJobs(this.profiles.get(profileId), projectId, q.pageSize ?? DEFAULT_PAGE_SIZE * 4, q.pageToken);
  }

  @Get('locations/:location/jobs/:job')
  getJob(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', id) job: string,
  ): Promise<RunJob> {
    return this.run.getJob(this.profiles.get(profileId), `projects/${projectId}/locations/${location}/jobs/${job}`);
  }

  @Get('locations/:location/jobs/:job/yaml')
  rawJob(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', id) job: string,
  ): Promise<unknown> {
    return this.run.rawJob(this.profiles.get(profileId), `projects/${projectId}/locations/${location}/jobs/${job}`);
  }

  @Patch('locations/:location/jobs/:job')
  @HttpCode(202)
  @Mutation({ product: 'run', verb: 'job.update', resource: JOB })
  async updateJob(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', id) job: string,
    @Body({ schema: UpdateJobSchema }) body: UpdateJob,
  ): Promise<OperationAccepted> {
    return {
      operation: await this.run.updateJob(this.profiles.get(profileId), `projects/${projectId}/locations/${location}/jobs/${job}`, body),
    };
  }

  @Post('locations/:location/jobs/:job/run')
  @HttpCode(202)
  @Mutation({ product: 'run', verb: 'job.run', resource: JOB })
  runJob(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', id) job: string,
    @Body({ schema: ExecuteJobSchema }) body: ExecuteJob,
  ): Promise<OperationAccepted & { execution: string | null }> {
    return this.run.runJob(this.profiles.get(profileId), `projects/${projectId}/locations/${location}/jobs/${job}`, body);
  }

  @Delete('locations/:location/jobs/:job')
  @HttpCode(202)
  @Mutation({ product: 'run', verb: 'job.delete', resource: JOB })
  async deleteJob(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', id) job: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<OperationAccepted> {
    requireConfirmation(body.confirm, job);
    return { operation: await this.run.deleteJob(this.profiles.get(profileId), `projects/${projectId}/locations/${location}/jobs/${job}`) };
  }

  @Get('locations/:location/jobs/:job/executions')
  listExecutions(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', id) job: string,
    @Query({ schema: PageQuerySchema }) q: PageQuery,
  ): Promise<ListResponse<RunExecution>> {
    const name = `projects/${projectId}/locations/${location}/jobs/${job}`;
    return this.run.listExecutions(this.profiles.get(profileId), name, q.pageSize ?? DEFAULT_PAGE_SIZE, q.pageToken);
  }

  @Get('locations/:location/jobs/:job/executions/:execution')
  getExecution(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', id) job: string,
    @Param('execution', id) execution: string,
  ): Promise<RunExecution> {
    return this.run.getExecution(
      this.profiles.get(profileId),
      `projects/${projectId}/locations/${location}/jobs/${job}/executions/${execution}`,
    );
  }

  @Get('locations/:location/jobs/:job/executions/:execution/raw')
  rawExecution(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', id) job: string,
    @Param('execution', id) execution: string,
  ): Promise<unknown> {
    return this.run.rawExecution(
      this.profiles.get(profileId),
      `projects/${projectId}/locations/${location}/jobs/${job}/executions/${execution}`,
    );
  }

  @Get('locations/:location/jobs/:job/executions/:execution/tasks')
  listTasks(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', id) job: string,
    @Param('execution', id) execution: string,
  ): Promise<RunTask[]> {
    return this.run.listTasks(
      this.profiles.get(profileId),
      `projects/${projectId}/locations/${location}/jobs/${job}/executions/${execution}`,
    );
  }

  @Post('locations/:location/jobs/:job/executions/:execution/cancel')
  @HttpCode(202)
  @Mutation({ product: 'run', verb: 'execution.cancel', resource: `${JOB}/executions/:execution` })
  async cancelExecution(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', id) job: string,
    @Param('execution', id) execution: string,
  ): Promise<OperationAccepted> {
    const name = `projects/${projectId}/locations/${location}/jobs/${job}/executions/${execution}`;
    return { operation: await this.run.cancelExecution(this.profiles.get(profileId), name) };
  }

  @Delete('locations/:location/jobs/:job/executions/:execution')
  @HttpCode(202)
  @Mutation({ product: 'run', verb: 'execution.delete', resource: `${JOB}/executions/:execution` })
  async deleteExecution(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('job', id) job: string,
    @Param('execution', id) execution: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<OperationAccepted> {
    requireConfirmation(body.confirm, execution);
    const name = `projects/${projectId}/locations/${location}/jobs/${job}/executions/${execution}`;
    return { operation: await this.run.deleteExecution(this.profiles.get(profileId), name) };
  }
}
