import { Module, type OnModuleInit } from '@nestjs/common';
import { LiveGateway } from '../../core/live/live.gateway.js';
import { BuildController, BuildService, buildLogsChannel } from './build.js';
import { DeployController, DeployService } from './deploy.js';

/** Cloud Build and Cloud Deploy (SPEC-0007 M5.4). */
@Module({ controllers: [BuildController, DeployController], providers: [BuildService, DeployService] })
export class DeliveryModule implements OnModuleInit {
  constructor(private readonly live: LiveGateway) {}

  onModuleInit(): void {
    this.live.register(buildLogsChannel());
  }
}
