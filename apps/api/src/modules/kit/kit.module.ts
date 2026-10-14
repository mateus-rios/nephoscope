import {
  type KitActionBody,
  KitActionBodySchema,
  type KitItem,
  type KitListQuery,
  KitListQuerySchema,
  KitPathSchema,
  type ListResponse,
  type OperationAccepted,
  ProjectIdParamSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Get, Module, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { KitService } from './kit.service.js';

const p = { schema: ProjectIdParamSchema };
const seg = { schema: z.string().regex(/^[a-z0-9]{1,40}$/) };
const PathQuerySchema = z.object({ path: KitPathSchema });

/** Generic routes of the resource kit (SPEC-0001 D-16, D-30). */
@Controller('api/projects/:projectId/kit/:product/:collection')
export class KitController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly kit: KitService,
  ) {}

  @Get()
  list(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('product', seg) product: string,
    @Param('collection', seg) collection: string,
    @Query({ schema: KitListQuerySchema }) q: KitListQuery,
  ): Promise<ListResponse<KitItem>> {
    return this.kit.list(this.profiles.get(profileId), projectId, `${product}/${collection}`, q);
  }

  @Get('item')
  get(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('product', seg) product: string,
    @Param('collection', seg) collection: string,
    @Query({ schema: PathQuerySchema }) q: { path: string },
  ): Promise<KitItem> {
    return this.kit.get(this.profiles.get(profileId), projectId, `${product}/${collection}`, q.path);
  }

  @Get('item/extras/:extra')
  extra(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('product', seg) product: string,
    @Param('collection', seg) collection: string,
    @Param('extra', { schema: z.string().regex(/^[A-Za-z0-9]{1,40}$/) }) extra: string,
    @Query({ schema: PathQuerySchema }) q: { path: string },
  ): Promise<{ value: unknown }> {
    return this.kit.extra(this.profiles.get(profileId), projectId, `${product}/${collection}`, q.path, extra);
  }

  @Post('actions/:action')
  @Mutation({ product: ':product', verb: ':collection.:action', resource: 'projects/:projectId/:product/:collection' })
  async act(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', p) projectId: string,
    @Param('product', seg) product: string,
    @Param('collection', seg) collection: string,
    @Param('action', seg) action: string,
    @Body({ schema: KitActionBodySchema }) body: KitActionBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OperationAccepted> {
    const operation = await this.kit.action(this.profiles.get(profileId), projectId, `${product}/${collection}`, action, body);
    // SPEC-0001 CA-27: 202 when Google started an operation, 200 when the change is done.
    res.status(operation.family === 'instant' ? 200 : 202);
    return { operation };
  }
}

/** The resource kit: L1 products and simple lifecycle actions (SPEC-0001 D-16). */
@Module({ controllers: [KitController], providers: [KitService], exports: [KitService] })
export class KitModule {}
