import {
  type AssignColabRuntime,
  AssignColabRuntimeSchema,
  type ColabCommit,
  type ColabExecution,
  type ColabExecutionList,
  type ColabExecutionOutput,
  type ColabNotebook,
  type ColabNotebookDetail,
  type ColabRegionQuery,
  ColabRegionQuerySchema,
  type ColabRuntime,
  type ColabRuntimeAction,
  type ColabSchedule,
  type ColabTemplate,
  CommitShaQuerySchema,
  type Confirm,
  ConfirmSchema,
  type CreateColabExecution,
  CreateColabExecutionSchema,
  type CreateColabNotebook,
  CreateColabNotebookSchema,
  type CreateColabSchedule,
  CreateColabScheduleSchema,
  type CreateColabTemplate,
  CreateColabTemplateSchema,
  colabRuntimeActions,
  type ListResponse,
  type NotebookDocument,
  type OperationAccepted,
  ProjectIdParamSchema,
  RegionSchema,
  type RenameColabNotebook,
  RenameColabNotebookSchema,
  type ResumeColabSchedule,
  ResumeColabScheduleSchema,
  type SaveColabNotebook,
  SaveColabNotebookSchema,
  type SaveColabSchedule,
  SaveColabScheduleSchema,
  type UpdateColabTemplate,
  UpdateColabTemplateSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { contentDisposition } from '../storage/storage-mapping.js';
import { ColabService } from './colab.service.js';
import { sameResource } from './colab-mapping.js';
import { NotebooksService } from './notebooks.service.js';

const p = { schema: ProjectIdParamSchema };
const loc = { schema: RegionSchema };
const rid = { schema: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'Invalid id') };
const region = { schema: ColabRegionQuerySchema };
const commit = { schema: CommitShaQuerySchema };

const n = (projectId: string, location: string, collection: string, id: string) =>
  `projects/${projectId}/locations/${location}/${collection}/${id}`;

const NB = 'projects/:projectId/locations/:location/repositories/:notebook';
const RT = 'projects/:projectId/locations/:location/notebookRuntimes/:runtime';
const TPL = 'projects/:projectId/locations/:location/notebookRuntimeTemplates/:template';
const EX = 'projects/:projectId/locations/:location/notebookExecutionJobs/:execution';
const SC = 'projects/:projectId/locations/:location/schedules/:schedule';
const COLAB = 'projects/:projectId/colab';

type CommitQueryValue = z.infer<typeof CommitShaQuerySchema>;

/** Notebooks, stored as Dataform repositories (SPEC-0010 D-04 to D-06). */
@Controller('api/projects/:projectId/colab')
export class ColabNotebooksController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly notebooks: NotebooksService,
    private readonly colab: ColabService,
  ) {}

  @Get('notebooks')
  list(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query(region) q: ColabRegionQuery,
  ): Promise<ListResponse<ColabNotebook>> {
    return this.notebooks.list(this.profiles.get(profileId), projectId, q.region);
  }

  @Post('notebooks')
  @Mutation({ product: 'colab', verb: 'notebook.create', resource: COLAB })
  create(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateColabNotebookSchema }) body: CreateColabNotebook,
  ): Promise<ColabNotebookDetail> {
    return this.notebooks.create(this.profiles.get(profileId), projectId, body);
  }

  @Get('locations/:location/notebooks/:notebook')
  detail(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('notebook', rid) notebook: string,
  ): Promise<ColabNotebookDetail> {
    return this.notebooks.detail(this.profiles.get(profileId), n(projectId, location, 'repositories', notebook));
  }

  @Get('locations/:location/notebooks/:notebook/raw')
  raw(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('notebook', rid) notebook: string,
  ): Promise<unknown> {
    return this.notebooks.raw(this.profiles.get(profileId), n(projectId, location, 'repositories', notebook));
  }

  @Get('locations/:location/notebooks/:notebook/content')
  content(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('notebook', rid) notebook: string,
    @Query(commit) q: CommitQueryValue,
  ): Promise<NotebookDocument> {
    return this.notebooks.document(this.profiles.get(profileId), n(projectId, location, 'repositories', notebook), q.commit);
  }

  @Get('locations/:location/notebooks/:notebook/download')
  async download(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('notebook', rid) notebook: string,
    @Query(commit) q: CommitQueryValue,
  ): Promise<StreamableFile> {
    const file = await this.notebooks.download(this.profiles.get(profileId), n(projectId, location, 'repositories', notebook), q.commit);
    return new StreamableFile(file.bytes, {
      type: 'application/x-ipynb+json',
      disposition: contentDisposition('attachment', file.fileName),
      length: file.bytes.byteLength,
    });
  }

  @Get('locations/:location/notebooks/:notebook/history')
  history(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('notebook', rid) notebook: string,
    @Query({ schema: z.object({ pageToken: z.string().max(4096).optional() }) }) q: { pageToken?: string },
  ): Promise<ListResponse<ColabCommit>> {
    return this.notebooks.history(this.profiles.get(profileId), n(projectId, location, 'repositories', notebook), q.pageToken);
  }

  /** Runs of this notebook among the newest executions of its region (SPEC-0010 D-03). */
  @Get('locations/:location/notebooks/:notebook/executions')
  executions(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('notebook', rid) notebook: string,
  ): Promise<ColabExecutionList> {
    const repo = n(projectId, location, 'repositories', notebook);
    return this.colab.executionsWhere(this.profiles.get(profileId), projectId, location, (e) =>
      e.source.kind === 'notebook' ? sameResource(e.source.repository, repo) : false,
    );
  }

  @Get('locations/:location/notebooks/:notebook/schedules')
  async schedules(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('notebook', rid) notebook: string,
  ): Promise<ListResponse<ColabSchedule>> {
    const repo = n(projectId, location, 'repositories', notebook);
    const all = await this.colab.schedules(this.profiles.get(profileId), projectId, location);
    return { ...all, items: all.items.filter((s) => s.job.source.kind === 'notebook' && sameResource(s.job.source.repository, repo)) };
  }

  @Put('locations/:location/notebooks/:notebook/content')
  @Mutation({ product: 'colab', verb: 'notebook.save', resource: NB })
  save(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('notebook', rid) notebook: string,
    @Body({ schema: SaveColabNotebookSchema }) body: SaveColabNotebook,
  ): Promise<ColabNotebookDetail> {
    return this.notebooks.save(this.profiles.get(profileId), projectId, n(projectId, location, 'repositories', notebook), body);
  }

  @Patch('locations/:location/notebooks/:notebook')
  @Mutation({ product: 'colab', verb: 'notebook.rename', resource: NB })
  rename(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('notebook', rid) notebook: string,
    @Body({ schema: RenameColabNotebookSchema }) body: RenameColabNotebook,
  ): Promise<ColabNotebook> {
    return this.notebooks.rename(
      this.profiles.get(profileId),
      projectId,
      n(projectId, location, 'repositories', notebook),
      body.displayName,
    );
  }

  @Delete('locations/:location/notebooks/:notebook')
  @HttpCode(204)
  @Mutation({ product: 'colab', verb: 'notebook.delete', resource: NB })
  async remove(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('notebook', rid) notebook: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<void> {
    const h = this.profiles.get(profileId);
    const name = n(projectId, location, 'repositories', notebook);
    requireConfirmation(body.confirm, (await this.notebooks.detail(h, name)).displayName);
    await this.notebooks.remove(h, projectId, name);
  }
}

/** Runtime templates and runtimes (SPEC-0010 D-07, D-09). */
@Controller('api/projects/:projectId/colab')
export class ColabRuntimesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly colab: ColabService,
  ) {}

  @Get('templates')
  templates(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query(region) q: ColabRegionQuery,
  ): Promise<ListResponse<ColabTemplate>> {
    return this.colab.templates(this.profiles.get(profileId), projectId, q.region);
  }

  @Post('templates')
  @HttpCode(202)
  @Mutation({ product: 'colab', verb: 'template.create', resource: COLAB })
  async createTemplate(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateColabTemplateSchema }) body: CreateColabTemplate,
  ): Promise<OperationAccepted> {
    return { operation: await this.colab.createTemplate(this.profiles.get(profileId), projectId, body) };
  }

  @Get('locations/:location/templates/:template')
  template(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('template', rid) template: string,
  ): Promise<ColabTemplate> {
    return this.colab.template(this.profiles.get(profileId), n(projectId, location, 'notebookRuntimeTemplates', template));
  }

  @Get('locations/:location/templates/:template/raw')
  templateRaw(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('template', rid) template: string,
  ): Promise<unknown> {
    return this.colab.templateRaw(this.profiles.get(profileId), n(projectId, location, 'notebookRuntimeTemplates', template));
  }

  @Patch('locations/:location/templates/:template')
  @Mutation({ product: 'colab', verb: 'template.update', resource: TPL })
  updateTemplate(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('template', rid) template: string,
    @Body({ schema: UpdateColabTemplateSchema }) body: UpdateColabTemplate,
  ): Promise<ColabTemplate> {
    return this.colab.updateTemplate(this.profiles.get(profileId), n(projectId, location, 'notebookRuntimeTemplates', template), body);
  }

  @Delete('locations/:location/templates/:template')
  @HttpCode(202)
  @Mutation({ product: 'colab', verb: 'template.delete', resource: TPL })
  async deleteTemplate(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('template', rid) template: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<OperationAccepted> {
    const h = this.profiles.get(profileId);
    const name = n(projectId, location, 'notebookRuntimeTemplates', template);
    requireConfirmation(body.confirm, (await this.colab.template(h, name)).displayName);
    return { operation: await this.colab.deleteTemplate(h, projectId, name) };
  }

  @Get('runtimes')
  runtimes(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query(region) q: ColabRegionQuery,
  ): Promise<ListResponse<ColabRuntime>> {
    return this.colab.runtimes(this.profiles.get(profileId), projectId, q.region);
  }

  @Post('runtimes')
  @HttpCode(202)
  @Mutation({ product: 'colab', verb: 'runtime.assign', resource: COLAB })
  async assign(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: AssignColabRuntimeSchema }) body: AssignColabRuntime,
  ): Promise<OperationAccepted> {
    return { operation: await this.colab.assignRuntime(this.profiles.get(profileId), projectId, body) };
  }

  @Get('locations/:location/runtimes/:runtime')
  runtime(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('runtime', rid) runtime: string,
  ): Promise<ColabRuntime> {
    return this.colab.runtime(this.profiles.get(profileId), n(projectId, location, 'notebookRuntimes', runtime));
  }

  @Get('locations/:location/runtimes/:runtime/raw')
  runtimeRaw(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('runtime', rid) runtime: string,
  ): Promise<unknown> {
    return this.colab.runtimeRaw(this.profiles.get(profileId), n(projectId, location, 'notebookRuntimes', runtime));
  }

  @Post('locations/:location/runtimes/:runtime/:action')
  @HttpCode(202)
  @Mutation({ product: 'colab', verb: 'runtime.action', resource: RT })
  async runtimeAction(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('runtime', rid) runtime: string,
    @Param('action', { schema: z.enum(colabRuntimeActions) }) action: ColabRuntimeAction,
  ): Promise<OperationAccepted> {
    return {
      operation: await this.colab.runtimeAction(
        this.profiles.get(profileId),
        projectId,
        n(projectId, location, 'notebookRuntimes', runtime),
        action,
      ),
    };
  }

  @Delete('locations/:location/runtimes/:runtime')
  @HttpCode(202)
  @Mutation({ product: 'colab', verb: 'runtime.delete', resource: RT })
  async deleteRuntime(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('runtime', rid) runtime: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<OperationAccepted> {
    const h = this.profiles.get(profileId);
    const name = n(projectId, location, 'notebookRuntimes', runtime);
    requireConfirmation(body.confirm, (await this.colab.runtime(h, name)).displayName);
    return { operation: await this.colab.deleteRuntime(h, projectId, name) };
  }
}

/** Executions and schedules (SPEC-0010 D-08, D-10). */
@Controller('api/projects/:projectId/colab')
export class ColabRunsController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly colab: ColabService,
  ) {}

  @Get('executions')
  executions(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query(region) q: ColabRegionQuery,
  ): Promise<ColabExecutionList> {
    return this.colab.executions(this.profiles.get(profileId), projectId, q.region, q.pageToken);
  }

  @Post('executions')
  @HttpCode(202)
  @Mutation({ product: 'colab', verb: 'execution.create', resource: COLAB })
  async createExecution(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateColabExecutionSchema }) body: CreateColabExecution,
  ): Promise<OperationAccepted> {
    return { operation: await this.colab.createExecution(this.profiles.get(profileId), projectId, body) };
  }

  @Get('locations/:location/executions/:execution')
  execution(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('execution', rid) execution: string,
  ): Promise<ColabExecution> {
    return this.colab.execution(this.profiles.get(profileId), n(projectId, location, 'notebookExecutionJobs', execution));
  }

  @Get('locations/:location/executions/:execution/raw')
  executionRaw(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('execution', rid) execution: string,
  ): Promise<unknown> {
    return this.colab.executionRaw(this.profiles.get(profileId), n(projectId, location, 'notebookExecutionJobs', execution));
  }

  @Get('locations/:location/executions/:execution/output')
  output(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('execution', rid) execution: string,
  ): Promise<ColabExecutionOutput> {
    return this.colab.executionOutput(this.profiles.get(profileId), projectId, n(projectId, location, 'notebookExecutionJobs', execution));
  }

  @Get('locations/:location/executions/:execution/output/notebook')
  outputNotebook(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('execution', rid) execution: string,
    @Query({ schema: z.object({ object: z.string().min(1).max(1024) }) }) q: { object: string },
  ): Promise<NotebookDocument> {
    return this.colab.executionOutputNotebook(
      this.profiles.get(profileId),
      projectId,
      n(projectId, location, 'notebookExecutionJobs', execution),
      q.object,
    );
  }

  @Delete('locations/:location/executions/:execution')
  @HttpCode(202)
  @Mutation({ product: 'colab', verb: 'execution.delete', resource: EX })
  async deleteExecution(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('execution', rid) execution: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<OperationAccepted> {
    requireConfirmation(body.confirm, execution);
    return {
      operation: await this.colab.deleteExecution(
        this.profiles.get(profileId),
        projectId,
        n(projectId, location, 'notebookExecutionJobs', execution),
      ),
    };
  }

  @Get('schedules')
  schedules(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Query(region) q: ColabRegionQuery,
  ): Promise<ListResponse<ColabSchedule>> {
    return this.colab.schedules(this.profiles.get(profileId), projectId, q.region);
  }

  @Post('schedules')
  @Mutation({ product: 'colab', verb: 'schedule.create', resource: COLAB })
  createSchedule(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Body({ schema: CreateColabScheduleSchema }) body: CreateColabSchedule,
  ): Promise<ColabSchedule> {
    return this.colab.createSchedule(this.profiles.get(profileId), projectId, body);
  }

  @Get('locations/:location/schedules/:schedule')
  schedule(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('schedule', rid) schedule: string,
  ): Promise<ColabSchedule> {
    return this.colab.schedule(this.profiles.get(profileId), n(projectId, location, 'schedules', schedule));
  }

  @Get('locations/:location/schedules/:schedule/raw')
  scheduleRaw(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('schedule', rid) schedule: string,
  ): Promise<unknown> {
    return this.colab.scheduleRaw(this.profiles.get(profileId), n(projectId, location, 'schedules', schedule));
  }

  @Get('locations/:location/schedules/:schedule/runs')
  runs(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('schedule', rid) schedule: string,
  ): Promise<ColabExecutionList> {
    const name = n(projectId, location, 'schedules', schedule);
    return this.colab.executionsWhere(this.profiles.get(profileId), projectId, location, (e) => sameResource(e.schedule, name));
  }

  @Put('locations/:location/schedules/:schedule')
  @Mutation({ product: 'colab', verb: 'schedule.update', resource: SC })
  updateSchedule(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('schedule', rid) schedule: string,
    @Body({ schema: SaveColabScheduleSchema }) body: SaveColabSchedule,
  ): Promise<ColabSchedule> {
    return this.colab.updateSchedule(this.profiles.get(profileId), projectId, n(projectId, location, 'schedules', schedule), body);
  }

  @Post('locations/:location/schedules/:schedule/pause')
  @HttpCode(200)
  @Mutation({ product: 'colab', verb: 'schedule.pause', resource: SC })
  pause(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('schedule', rid) schedule: string,
  ): Promise<ColabSchedule> {
    return this.colab.pauseSchedule(this.profiles.get(profileId), projectId, n(projectId, location, 'schedules', schedule));
  }

  @Post('locations/:location/schedules/:schedule/resume')
  @HttpCode(200)
  @Mutation({ product: 'colab', verb: 'schedule.resume', resource: SC })
  resume(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('schedule', rid) schedule: string,
    @Body({ schema: ResumeColabScheduleSchema }) body: ResumeColabSchedule,
  ): Promise<ColabSchedule> {
    return this.colab.resumeSchedule(this.profiles.get(profileId), projectId, n(projectId, location, 'schedules', schedule), body.catchUp);
  }

  @Delete('locations/:location/schedules/:schedule')
  @HttpCode(202)
  @Mutation({ product: 'colab', verb: 'schedule.delete', resource: SC })
  async deleteSchedule(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('schedule', rid) schedule: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<OperationAccepted> {
    const h = this.profiles.get(profileId);
    const name = n(projectId, location, 'schedules', schedule);
    requireConfirmation(body.confirm, (await this.colab.schedule(h, name)).displayName);
    return { operation: await this.colab.deleteSchedule(h, projectId, name) };
  }
}

/** Colab Enterprise (SPEC-0010). */
@Module({
  imports: [StorageModule],
  controllers: [ColabNotebooksController, ColabRuntimesController, ColabRunsController],
  providers: [ColabService, NotebooksService],
})
export class ColabModule {}
