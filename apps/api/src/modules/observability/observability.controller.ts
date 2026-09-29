import {
  type AddHistory,
  AddHistorySchema,
  HistoryKeySchema,
  type LogPage,
  type LogQuery,
  LogQuerySchema,
  MetricPresetKindSchema,
  type MetricsResponse,
  ProjectIdParamSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { HistoryService } from '../../core/store/history.service.js';
import { LogsService } from './logs.service.js';
import { MetricsService } from './metrics.service.js';

const MetricsHttpQuerySchema = z.object({
  kind: MetricPresetKindSchema,
  /** JSON object of monitored resource labels. */
  labels: z
    .string()
    .max(2048)
    .transform((s, ctx) => {
      try {
        const parsed = z.record(z.string().max(64), z.string().max(256)).safeParse(JSON.parse(s));
        if (parsed.success) return parsed.data;
      } catch {
        /* Reported below. */
      }
      ctx.addIssue({ code: 'custom', message: 'labels must be a JSON object of strings' });
      return z.NEVER;
    }),
  since: z.string().datetime({ offset: true }),
  until: z.string().datetime({ offset: true }).optional(),
});

@Controller('api')
export class ObservabilityController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly logs: LogsService,
    private readonly metrics: MetricsService,
    private readonly history: HistoryService,
  ) {}

  /** The shared Logs panel (SPEC-0005 D-01, D-02). */
  @Get('projects/:projectId/logs')
  listLogs(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', { schema: ProjectIdParamSchema }) projectId: string,
    @Query({ schema: LogQuerySchema }) q: LogQuery,
  ): Promise<LogPage> {
    return this.logs.list(this.profiles.get(profileId), projectId, q);
  }

  /** Metrics tab presets (SPEC-0005 D-07). */
  @Get('projects/:projectId/metrics')
  presetMetrics(
    @ProfileId() profileId: string | undefined,
    @Param('projectId', { schema: ProjectIdParamSchema }) projectId: string,
    @Query({ schema: MetricsHttpQuerySchema }) q: z.infer<typeof MetricsHttpQuerySchema>,
  ): Promise<MetricsResponse> {
    return this.metrics.presets(this.profiles.get(profileId), projectId, q);
  }

  /** Recent arguments (SPEC-0001 CA-53). Keys are chosen by the page, such as `workflows.args:{name}`. */
  @Get('history/:key')
  getHistory(@Param('key', { schema: HistoryKeySchema }) key: string): Promise<string[]> {
    return this.history.get(key);
  }

  @Post('history/:key')
  @Mutation({ product: 'nephoscope', verb: 'history.add', scope: 'local' })
  addHistory(
    @Param('key', { schema: HistoryKeySchema }) key: string,
    @Body({ schema: AddHistorySchema }) body: AddHistory,
  ): Promise<string[]> {
    return this.history.add(key, body.value);
  }
}
