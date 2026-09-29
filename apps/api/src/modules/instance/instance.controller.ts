import {
  type AuditEntry,
  type AuditQuery,
  AuditQuerySchema,
  type InstanceInfo,
  type OperationSummary,
  type Prefs,
  ProjectIdParamSchema,
  type UpdatePrefs,
  UpdatePrefsSchema,
} from '@nephoscope/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../core/audit/audit.service.js';
import { Mutation } from '../../core/audit/mutation.decorator.js';
import { NEPHOSCOPE_CONFIG, type NephoscopeConfig } from '../../core/config/config.js';
import { ProfileId } from '../../core/context/profile-id.decorator.js';
import { ProfilesService } from '../../core/credentials/profiles.service.js';
import { OperationsService } from '../../core/operations/operations.service.js';
import { ProblemException } from '../../core/problem/problem.js';
import { hostnameOf, isLoopbackHost } from '../../core/security/host.js';
import { JsonStore } from '../../core/store/json-store.js';
import { PrefsService } from '../../core/store/prefs.service.js';

const TouchProjectSchema = z.object({ projectId: ProjectIdParamSchema });

@Controller('api')
export class InstanceController {
  constructor(
    @Inject(NEPHOSCOPE_CONFIG) private readonly config: NephoscopeConfig,
    private readonly profiles: ProfilesService,
    private readonly store: JsonStore,
    private readonly prefs: PrefsService,
    private readonly audit: AuditService,
    private readonly operations: OperationsService,
  ) {}

  @Get('instance')
  instance(@Req() req: Request): InstanceInfo & { notices: string[] } {
    const hostname = hostnameOf(req.headers.host) ?? '';
    const corrupted = this.store.takeCorruptions();
    return {
      version: this.config.version,
      readOnly: this.config.readOnly,
      requireToken: this.config.requireToken,
      host: { name: hostname, isLoopback: isLoopbackHost(hostname) },
      emulators: this.config.emulators,
      dataDir: { writable: this.store.isWritable, profilesUnreadable: this.profiles.profilesUnreadable },
      credentials: {
        environmentMissing: this.profiles.environmentMissing,
        environmentFileSet: this.config.credentialsFile !== null,
        environmentError: this.profiles.environmentMissing ? this.profiles.environmentError : null,
      },
      notices: corrupted.map((f) => `The file ${f} was unreadable and was reset to defaults.`),
    };
  }

  @Get('prefs')
  getPrefs(): Promise<Prefs> {
    return this.prefs.get();
  }

  @Patch('prefs')
  @Mutation({ product: 'settings', verb: 'prefs.update', scope: 'local' })
  updatePrefs(@Body({ schema: UpdatePrefsSchema }) body: UpdatePrefs): Promise<Prefs> {
    return this.prefs.update(body);
  }

  @Get('recents/projects')
  recentProjects(@ProfileId() profileId: string | undefined): Promise<string[]> {
    return this.prefs.recentProjects(this.profiles.get(profileId).profile.id);
  }

  @Post('recents/projects')
  touchProject(
    @ProfileId() profileId: string | undefined,
    @Body({ schema: TouchProjectSchema }) body: z.infer<typeof TouchProjectSchema>,
  ): Promise<string[]> {
    return this.prefs.touchProject(this.profiles.get(profileId).profile.id, body.projectId);
  }

  @Get('audit')
  auditLog(@Query({ schema: AuditQuerySchema }) q: AuditQuery): Promise<AuditEntry[]> {
    return this.audit.query(q);
  }

  @Get('operations')
  listOperations(@ProfileId() profileId: string | undefined): OperationSummary[] {
    return this.operations.list(this.profiles.get(profileId).profile.id);
  }

  @Get('operations/:id')
  getOperation(@Param('id', { schema: z.string().uuid() }) id: string): OperationSummary {
    const op = this.operations.get(id);
    if (!op) throw ProblemException.of('NOT_FOUND', 'This operation is not known to Nephoscope.');
    return op;
  }

  @Post('operations/:id/cancel')
  @HttpCode(200)
  @Mutation({ product: 'nephoscope', verb: 'operation.cancel', scope: 'local' })
  cancelOperation(@Param('id', { schema: z.string().uuid() }) id: string): OperationSummary {
    const op = this.operations.get(id);
    if (!op) throw ProblemException.of('NOT_FOUND', 'This operation is not known to Nephoscope.');
    if (!this.operations.cancel(id))
      throw ProblemException.of('FAILED_PRECONDITION', 'This operation cannot be cancelled from Nephoscope.');
    return op;
  }

  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Ready when configuration is valid; reports degraded storage instead of failing (SPEC-0001 CA-67). */
  @Get('ready')
  ready(): { status: 'ready'; dataDirWritable: boolean; environmentProfile: boolean } {
    return {
      status: 'ready',
      dataDirWritable: this.store.isWritable,
      environmentProfile: !this.profiles.environmentMissing,
    };
  }
}
