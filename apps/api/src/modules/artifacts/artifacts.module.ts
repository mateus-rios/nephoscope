import {
  type ArtifactRepository,
  type DockerImage,
  type DockerImagesQuery,
  DockerImagesQuerySchema,
  type ListResponse,
  ProjectIdParamSchema,
} from '@nephoscope/contracts';
import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { ArtifactsService } from './artifacts.service.js';

@Controller('api/projects/:projectId/artifacts')
export class ArtifactsController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly artifacts: ArtifactsService,
  ) {}

  @Get('repositories')
  repositories(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', { schema: ProjectIdParamSchema }) projectId: string,
  ): Promise<ListResponse<ArtifactRepository>> {
    return this.artifacts.repositories(this.profiles.get(profileId), projectId);
  }

  @Get('docker-images')
  images(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', { schema: ProjectIdParamSchema }) projectId: string,
    @Query({ schema: DockerImagesQuerySchema }) q: DockerImagesQuery,
  ): Promise<ListResponse<DockerImage>> {
    // Repositories of other projects are allowed: images are often shared from a build project.
    void projectId;
    return this.artifacts.images(this.profiles.get(profileId), q.repository, q.pageToken);
  }
}

/** Minimal Artifact Registry for the image picker (SPEC-0003 D-17). */
@Module({ controllers: [ArtifactsController], providers: [ArtifactsService], exports: [ArtifactsService] })
export class ArtifactsModule {}
