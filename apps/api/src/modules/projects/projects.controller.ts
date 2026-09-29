import {
  type Capabilities,
  type Confirm,
  ConfirmSchema,
  DEFAULT_PAGE_SIZE,
  type EnableService,
  EnableServiceSchema,
  type ListResponse,
  type OperationAccepted,
  ProjectIdParamSchema,
  type ProjectSummary,
  type ServiceSummary,
} from '@nephoscope/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { CapabilitiesService } from '../../core/capabilities/capabilities.service.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { PrefsService } from '../../core/store/prefs.service.js';
import { type AssetResult, ProjectsService } from './projects.service.js';

const ServiceNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]*\.[a-z]+$/, 'Use a service name such as run.googleapis.com')
  .max(120);

const SearchProjectsQuerySchema = z.object({
  q: z.string().max(100).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
  pageToken: z.string().max(4096).optional(),
});

const ServicesQuerySchema = z.object({
  state: z.enum(['ENABLED', 'DISABLED']).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  pageToken: z.string().max(4096).optional(),
});

const CapabilitiesQuerySchema = z.object({ refresh: z.enum(['0', '1']).optional() });
const SearchQuerySchema = z.object({ q: z.string().trim().min(2).max(200) });

@Controller('api/projects')
export class ProjectsController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly projects: ProjectsService,
    private readonly capabilities: CapabilitiesService,
    private readonly prefs: PrefsService,
  ) {}

  @Get()
  search(
    @ProfileId() profileId: string | undefined,
    @Query({ schema: SearchProjectsQuerySchema }) q: z.infer<typeof SearchProjectsQuerySchema>,
  ): Promise<ListResponse<ProjectSummary>> {
    return this.projects.search(this.profiles.get(profileId), q.q, q.pageSize ?? DEFAULT_PAGE_SIZE, q.pageToken);
  }

  @Get(':projectId')
  async get(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', { schema: ProjectIdParamSchema }) projectId: string,
  ): Promise<ProjectSummary> {
    const handle = this.profiles.get(profileId);
    const project = await this.projects.get(handle, projectId);
    await this.prefs.touchProject(handle.profile.id, projectId);
    return project;
  }

  @Get(':projectId/capabilities')
  caps(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', { schema: ProjectIdParamSchema }) projectId: string,
    @Query({ schema: CapabilitiesQuerySchema }) q: z.infer<typeof CapabilitiesQuerySchema>,
  ): Promise<Capabilities> {
    return this.capabilities.get(this.profiles.get(profileId), projectId, q.refresh === '1');
  }

  @Get(':projectId/services')
  services(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', { schema: ProjectIdParamSchema }) projectId: string,
    @Query({ schema: ServicesQuerySchema }) q: z.infer<typeof ServicesQuerySchema>,
  ): Promise<ListResponse<ServiceSummary>> {
    return this.projects.listServices(this.profiles.get(profileId), projectId, q.state, q.pageSize ?? 100, q.pageToken);
  }

  @Post(':projectId/services/:service/enable')
  @HttpCode(202)
  @Mutation({ product: 'apis', verb: 'service.enable', resource: 'projects/:projectId/services/:service' })
  async enable(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', { schema: ProjectIdParamSchema }) projectId: string,
    @Param('service', { schema: ServiceNameSchema }) service: string,
    @Body({ schema: EnableServiceSchema }) body: EnableService,
  ): Promise<OperationAccepted> {
    const handle = this.profiles.get(profileId);
    const operation = await this.projects.enableService(handle, projectId, service, body.consumerProject);
    this.capabilities.invalidate(handle.profile.id, projectId);
    return { operation };
  }

  @Post(':projectId/services/:service/disable')
  @HttpCode(202)
  @Mutation({ product: 'apis', verb: 'service.disable', resource: 'projects/:projectId/services/:service' })
  async disable(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', { schema: ProjectIdParamSchema }) projectId: string,
    @Param('service', { schema: ServiceNameSchema }) service: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<OperationAccepted> {
    requireConfirmation(body.confirm, service);
    const handle = this.profiles.get(profileId);
    const operation = await this.projects.disableService(handle, projectId, service);
    this.capabilities.invalidate(handle.profile.id, projectId);
    return { operation };
  }

  @Get(':projectId/search')
  searchResources(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', { schema: ProjectIdParamSchema }) projectId: string,
    @Query({ schema: SearchQuerySchema }) q: z.infer<typeof SearchQuerySchema>,
  ): Promise<AssetResult[]> {
    return this.projects.searchResources(this.profiles.get(profileId), projectId, q.q);
  }
}
