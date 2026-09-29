import { PROFILE_HEADER } from '@nephoscope/contracts';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Reads the active profile id of the tab (SPEC-0001 CA-07). */
export function profileIdFrom(req: Request): string | undefined {
  const value = req.headers[PROFILE_HEADER];
  const id = Array.isArray(value) ? value[0] : value;
  return id && id.length <= 64 ? id : undefined;
}

export const ProfileId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined =>
  profileIdFrom(ctx.switchToHttp().getRequest<Request>()),
);
