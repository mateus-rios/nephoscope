import { RunExecutionChannelParamsSchema, type RunExecutionUpdate } from '@nephoscope/contracts';
import { Module, type OnModuleInit } from '@nestjs/common';
import { LiveGateway } from '../../core/live/live.gateway.js';
import { pollingChannel } from '../../core/live/polling-channel.js';
import { ProblemException } from '../../core/problem/problem.js';
import { RunController } from './run.controller.js';
import { RunService } from './run.service.js';

/** Cloud Run (SPEC-0003 §7.1, §7.2). */
@Module({
  controllers: [RunController],
  providers: [RunService],
  exports: [RunService],
})
export class RunModule implements OnModuleInit {
  constructor(
    private readonly live: LiveGateway,
    private readonly run: RunService,
  ) {}

  onModuleInit(): void {
    // SPEC-0003 CA-11: the execution page updates live until the execution ends.
    this.live.register(
      pollingChannel({
        channel: 'run.execution',
        params: RunExecutionChannelParamsSchema,
        read: (ctx): Promise<RunExecutionUpdate> => {
          if (!ctx.params.name.startsWith(`projects/${ctx.projectId}/`)) {
            throw ProblemException.of('INVALID_ARGUMENT', 'The execution belongs to another project.');
          }
          return this.run.executionSnapshot(ctx.profile, ctx.params.name);
        },
        finished: (v) => v.execution.completionTime !== null && v.tasks.every((t) => t.outcome !== 'running' && t.outcome !== 'pending'),
      }),
    );
  }
}
