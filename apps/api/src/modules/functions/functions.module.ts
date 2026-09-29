import {
  type CloudFunction,
  type Confirm,
  ConfirmSchema,
  FunctionIdSchema,
  type FunctionSource,
  type FunctionSummary,
  type InvokeRequest,
  InvokeRequestSchema,
  type InvokeResponse,
  type ListResponse,
  type OperationAccepted,
  ProjectIdParamSchema,
  type RedeploySource,
  RedeploySourceSchema,
  RegionSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, StreamableFile } from '@nestjs/common';
import { requireConfirmation } from '../../core/audit/confirm.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { RunModule } from '../run/run.module.js';
import { FunctionsService } from './functions.service.js';

const p = { schema: ProjectIdParamSchema };
const loc = { schema: RegionSchema };
const fid = { schema: FunctionIdSchema };
const FN = 'projects/:projectId/locations/:location/functions/:fn';
const name = (projectId: string, location: string, fn: string) => `projects/${projectId}/locations/${location}/functions/${fn}`;

@Controller('api/projects/:projectId/functions')
export class FunctionsController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly functions: FunctionsService,
  ) {}

  @Get()
  list(@ProfileId() profileId: string | undefined, @Param('projectId', p) projectId: string): Promise<ListResponse<FunctionSummary>> {
    return this.functions.list(this.profiles.get(profileId), projectId);
  }

  @Get('locations/:location/functions/:fn')
  get(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('fn', fid) fn: string,
  ): Promise<CloudFunction> {
    return this.functions.get(this.profiles.get(profileId), name(projectId, location, fn));
  }

  @Get('locations/:location/functions/:fn/raw')
  raw(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('fn', fid) fn: string,
  ): Promise<unknown> {
    return this.functions.rawJson(this.profiles.get(profileId), name(projectId, location, fn));
  }

  @Get('locations/:location/functions/:fn/source')
  source(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('fn', fid) fn: string,
  ): Promise<FunctionSource> {
    return this.functions.source(this.profiles.get(profileId), name(projectId, location, fn));
  }

  @Get('locations/:location/functions/:fn/source/archive')
  async archive(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('fn', fid) fn: string,
  ): Promise<StreamableFile> {
    const zip = await this.functions.sourceArchive(this.profiles.get(profileId), name(projectId, location, fn));
    return new StreamableFile(Buffer.from(zip), {
      type: 'application/zip',
      disposition: `attachment; filename="${fn}-source.zip"`,
      length: zip.byteLength,
    });
  }

  @Post('locations/:location/functions/:fn/source')
  @HttpCode(202)
  @Mutation({ product: 'functions', verb: 'function.redeploy', resource: FN })
  async redeploy(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('fn', fid) fn: string,
    @Body({ schema: RedeploySourceSchema }) body: RedeploySource,
  ): Promise<OperationAccepted> {
    return { operation: await this.functions.redeploy(this.profiles.get(profileId), name(projectId, location, fn), body) };
  }

  @Post('locations/:location/functions/:fn/invoke')
  @HttpCode(200)
  @Mutation({ product: 'functions', verb: 'function.invoke', resource: FN })
  invoke(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('fn', fid) fn: string,
    @Body({ schema: InvokeRequestSchema }) body: InvokeRequest,
  ): Promise<InvokeResponse> {
    return this.functions.invoke(this.profiles.get(profileId), name(projectId, location, fn), body);
  }

  @Delete('locations/:location/functions/:fn')
  @HttpCode(202)
  @Mutation({ product: 'functions', verb: 'function.delete', resource: FN })
  async remove(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('location', loc) location: string,
    @Param('fn', fid) fn: string,
    @Body({ schema: ConfirmSchema }) body: Confirm,
  ): Promise<OperationAccepted> {
    requireConfirmation(body.confirm, fn);
    return { operation: await this.functions.remove(this.profiles.get(profileId), name(projectId, location, fn)) };
  }
}

/** Cloud Run functions (SPEC-0003 §7.3). */
@Module({ imports: [RunModule], controllers: [FunctionsController], providers: [FunctionsService] })
export class FunctionsModule {}
