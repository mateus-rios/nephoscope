import { Module, type OnModuleInit } from '@nestjs/common';
import { GcpClientFactory } from '../../core/gcp/client-factory.js';
import { LiveGateway } from '../../core/live/live.gateway.js';
import { logTailChannel } from './log-tail.channel.js';
import { LogsService } from './logs.service.js';
import { MetricsService } from './metrics.service.js';
import { ObservabilityController } from './observability.controller.js';

/** Shared Logs panel, live tail and Metrics tabs (SPEC-0005 M1 scope). */
@Module({
  controllers: [ObservabilityController],
  providers: [LogsService, MetricsService],
  exports: [LogsService, MetricsService],
})
export class ObservabilityModule implements OnModuleInit {
  constructor(
    private readonly live: LiveGateway,
    private readonly clients: GcpClientFactory,
  ) {}

  onModuleInit(): void {
    this.live.register(logTailChannel(this.clients));
  }
}
