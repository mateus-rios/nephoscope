import type { AuditEntry } from '@nephoscope/contracts';
import { type CallHandler, type CanActivate, type ExecutionContext, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { catchError, type Observable, tap, throwError } from 'rxjs';
import { NEPHOSCOPE_CONFIG, type NephoscopeConfig } from '../config/config.js';
import { profileIdFrom } from '../context/profile-id.decorator.js';
import { ProfilesService } from '../credentials/profiles.service.js';
import { toProblem } from '../problem/google-error.mapper.js';
import { ProblemException } from '../problem/problem.js';
import { AuditService } from './audit.service.js';
import { fillResource, MUTATION_KEY, type MutationMeta } from './mutation.decorator.js';

function baseEntry(
  req: Request,
  meta: MutationMeta,
  profiles: ProfilesService,
): Omit<AuditEntry, 'outcome' | 'problemCode' | 'operationId'> {
  const profileId = profileIdFrom(req) ?? null;
  let principal: string | null = null;
  try {
    principal = profiles.get(profileId ?? undefined).profile.principal;
  } catch {
    principal = null;
  }
  const params = (req.params ?? {}) as Record<string, string>;
  return {
    ts: new Date().toISOString(),
    profileId,
    principal,
    projectId: params.projectId ?? null,
    method: req.method,
    route: req.route?.path ? String(req.route.path) : req.path,
    resource: fillResource(meta.resource, params),
    verb: `${meta.product}.${meta.verb}`,
  };
}

/** Rejects mutations in read-only mode (SPEC-0001 D-12, CA-48) and audits the rejection. */
@Injectable()
export class ReadOnlyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly profiles: ProfilesService,
    private readonly audit: AuditService,
    @Inject(NEPHOSCOPE_CONFIG) private readonly config: NephoscopeConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.get<MutationMeta | undefined>(MUTATION_KEY, ctx.getHandler());
    if (!meta || (meta.scope ?? 'gcp') !== 'gcp') return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    let reason: string | null = null;
    if (this.config.readOnly) {
      reason = 'This Nephoscope instance is read-only (NEPHOSCOPE_READ_ONLY).';
    } else {
      const handle = this.profiles.get(profileIdFrom(req));
      if (handle.profile.readOnly) reason = `The profile "${handle.profile.name}" is read-only.`;
    }
    if (!reason) return true;
    await this.audit.append({ ...baseEntry(req, meta, this.profiles), outcome: 'rejected', problemCode: 'READ_ONLY', operationId: null });
    throw ProblemException.of('READ_ONLY', reason);
  }
}

/** Appends one audit line per mutation attempt (SPEC-0001 CA-51). */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly profiles: ProfilesService,
    private readonly audit: AuditService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<MutationMeta | undefined>(MUTATION_KEY, ctx.getHandler());
    if (!meta || ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const base = baseEntry(req, meta, this.profiles);
    return next.handle().pipe(
      tap((result) => {
        const op = (result as { operation?: { id?: string } } | undefined)?.operation?.id ?? null;
        void this.audit.append({ ...base, outcome: 'ok', problemCode: null, operationId: op });
      }),
      catchError((err: unknown) => {
        const problem = toProblem(err);
        const rejected = problem.code === 'CONFIRMATION_REQUIRED' || problem.code === 'READ_ONLY';
        void this.audit.append({
          ...base,
          outcome: rejected ? 'rejected' : 'error',
          problemCode: problem.code,
          operationId: null,
        });
        return throwError(() => err);
      }),
    );
  }
}
