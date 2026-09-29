import { type DynamicModule, Module } from '@nestjs/common';
import type { NephoscopeConfig } from './core/config/config.js';
import { CoreModule } from './core/core.module.js';
import type { AccessToken } from './core/security/access-token.js';
import { ArtifactsModule } from './modules/artifacts/artifacts.module.js';
import { DatastoreModule } from './modules/datastore/datastore.module.js';
import { EventarcModule } from './modules/eventarc/eventarc.module.js';
import { FirestoreModule } from './modules/firestore/firestore.module.js';
import { FunctionsModule } from './modules/functions/functions.module.js';
import { InstanceController } from './modules/instance/instance.controller.js';
import { ObservabilityModule } from './modules/observability/observability.module.js';
import { ProfilesController } from './modules/profiles/profiles.controller.js';
import { ProjectsController } from './modules/projects/projects.controller.js';
import { ProjectsService } from './modules/projects/projects.service.js';
import { PubSubModule } from './modules/pubsub/pubsub.module.js';
import { RunModule } from './modules/run/run.module.js';
import { SchedulerModule } from './modules/scheduler/scheduler.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { WorkflowsModule } from './modules/workflows/workflows.module.js';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
class ProjectsModule {}

@Module({ controllers: [ProfilesController, InstanceController] })
class PlatformModule {}

@Module({})
export class AppModule {
  static forRoot(config: NephoscopeConfig, token: AccessToken): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config, token),
        PlatformModule,
        ProjectsModule,
        ObservabilityModule,
        RunModule,
        ArtifactsModule,
        FunctionsModule,
        WorkflowsModule,
        SchedulerModule,
        TasksModule,
        EventarcModule,
        FirestoreModule,
        DatastoreModule,
        PubSubModule,
        StorageModule,
      ],
    };
  }
}
