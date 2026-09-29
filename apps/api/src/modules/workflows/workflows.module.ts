import {
  type Confirm,
  ConfirmSchema,
  type CreateWorkflow,
  CreateWorkflowSchema,
  type DeployWorkflow,
  DeployWorkflowSchema,
  type ExecuteWorkflow,
  ExecuteWorkflowSchema,
  type ListResponse,
  type OperationAccepted,
  ProjectIdParamSchema,
  RegionSchema,
  StepEntriesQuerySchema,
  type StepEntry,
  type Workflow,
  type WorkflowExecution,
  WorkflowExecutionChannelParamsSchema,
  WorkflowIdSchema,
  type WorkflowRevision,
  type WorkflowSummary,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Module, type OnModuleInit, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { LiveGateway } from '../../core/live/live.gateway.js';
import { pollingChannel } from '../../core/live/polling-channel.js';
import { ProblemException } from '../../core/problem/problem.js';
import { WorkflowsService } from './workflows.service.js';

const p = { schema: ProjectIdParamSchema };
const loc = { schema: RegionSchema };
const wid = { schema: WorkflowIdSchema };
const eid = {
  schema: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
};
const WF = 'projects/:projectId/locations/:location/workflows/:workflow';
const name = (projectId: string, location: string, workflow: string) => `projects/${projectId}/locations/${location}/workflows/${workflow}`;

@Controller('api/projects/:projectId/workflows')
export class WorkflowsController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly workflows: WorkflowsService,
  ) {}

  @Get()
  list(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ListResponse<WorkflowSummary>> {
    return this.workflows.list(this.profiles.get(profileId), projectId);
  }

  @Post()
  @HttpCode(202)
  @Mutation({ product: 'workflows', verb: 'workflow.create', resource: 'projects/:projectId/workflows' })
  async create(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateWorkflowSchema }) body: CreateWorkflow,
  ): Promise<OperationAccepted> {
    return { operation: await this.workflows.create(this.profiles.get(profileId), projectId, body) };
  }

  @Get('locations/:location/workflows/:workflow')
  get(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('workflow', wid) workflow: string,
  ): Promise<Workflow> {
    return this.workflows.get(this.profiles.get(profileId), name(projectId, location, workflow));
  }

  @Get('locations/:location/workflows/:workflow/raw')
  raw(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('workflow', wid) workflow: string,
  ): Promise<unknown> {
    return this.workflows.raw(this.profiles.get(profileId), name(projectId, location, workflow));
  }

  @Get('locations/:location/workflows/:workflow/revisions')
  revisions(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('workflow', wid) workflow: string,
  ): Promise<WorkflowRevision[]> {
    return this.workflows.revisions(this.profiles.get(profileId), name(projectId, location, workflow));
  }

  @Post('locations/:location/workflows/:workflow/deploy')
  @HttpCode(202)
  @Mutation({ product: 'workflows', verb: 'workflow.deploy', resource: WF })
  async deploy(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('workflow', wid) workflow: string,
    @Body({ schema: DeployWorkflowSchema }) body: DeployWorkflow,
  ): Promise<OperationAccepted> {
    return { operation: await this.workflows.deploy(this.profiles.get(profileId), name(projectId, location, workflow), body) };
  }

  @Delete('locations/:location/workflows/:workflow')
  @HttpCode(202)
  @Mutation({ product: 'workflows', verb: 'workflow.delete', resource: WF })
  async remove(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('workflow', wid) workflow: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<OperationAccepted> {
    requireConfirmation(body.confirm, workflow);
    return { operation: await this.workflows.remove(this.profiles.get(profileId), name(projectId, location, workflow)) };
  }

  @Get('locations/:location/workflows/:workflow/executions')
  executions(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('workflow', wid) workflow: string,
    @Query({ schema: z.object({ pageToken: z.string().max(4096).optional() }) }) q: { pageToken?: string },
  ): Promise<ListResponse<WorkflowExecution>> {
    return this.workflows.listExecutions(this.profiles.get(profileId), name(projectId, location, workflow), q.pageToken);
  }

  @Post('locations/:location/workflows/:workflow/executions')
  @HttpCode(200)
  @Mutation({ product: 'workflows', verb: 'execution.create', resource: WF })
  execute(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('workflow', wid) workflow: string,
    @Body({ schema: ExecuteWorkflowSchema }) body: ExecuteWorkflow,
  ): Promise<WorkflowExecution> {
    return this.workflows.execute(this.profiles.get(profileId), name(projectId, location, workflow), body);
  }

  @Get('locations/:location/workflows/:workflow/executions/:execution')
  execution(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('workflow', wid) workflow: string,
    @Param('execution', eid) execution: string,
  ): Promise<WorkflowExecution> {
    return this.workflows.getExecution(this.profiles.get(profileId), `${name(projectId, location, workflow)}/executions/${execution}`);
  }

  @Get('locations/:location/workflows/:workflow/executions/:execution/steps')
  steps(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('workflow', wid) workflow: string,
    @Param('execution', eid) execution: string,
    @Query({ schema: StepEntriesQuerySchema }) q: { detailed?: '0' | '1' },
  ): Promise<StepEntry[]> {
    return this.workflows.stepEntries(
      this.profiles.get(profileId),
      `${name(projectId, location, workflow)}/executions/${execution}`,
      q.detailed === '1',
    );
  }

  @Post('locations/:location/workflows/:workflow/executions/:execution/cancel')
  @HttpCode(200)
  @Mutation({ product: 'workflows', verb: 'execution.cancel', resource: `${WF}/executions/:execution` })
  cancel(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('workflow', wid) workflow: string,
    @Param('execution', eid) execution: string,
  ): Promise<WorkflowExecution> {
    return this.workflows.cancel(this.profiles.get(profileId), `${name(projectId, location, workflow)}/executions/${execution}`);
  }
}

/** Workflows (SPEC-0003 §7.4). */
@Module({ controllers: [WorkflowsController], providers: [WorkflowsService], exports: [WorkflowsService] })
export class WorkflowsModule implements OnModuleInit {
  constructor(
    private readonly live: LiveGateway,
    private readonly workflows: WorkflowsService,
  ) {}

  onModuleInit(): void {
    // SPEC-0003 CA-22: the execution page updates live while the execution runs.
    this.live.register(
      pollingChannel({
        channel: 'workflows.execution',
        params: WorkflowExecutionChannelParamsSchema,
        read: (ctx) => {
          if (!ctx.params.name.startsWith(`projects/${ctx.projectId}/`)) {
            throw ProblemException.of('INVALID_ARGUMENT', 'The execution belongs to another project.');
          }
          return this.workflows.snapshot(ctx.profile, ctx.params.name);
        },
        finished: (v) => v.execution.state !== 'active' && v.execution.state !== 'queued',
      }),
    );
  }
}
