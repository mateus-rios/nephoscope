import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoggerService } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { isApiPath } from '../security/security.middleware.js';

/** apps/web/dist, relative to apps/api/dist/core/web. */
export function defaultWebDist(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../../web/dist');
}

/**
 * Serves the built SPA from the same origin as the API (SPEC-0001 D-01): hashed assets cached
 * forever, index.html never cached, history fallback for client routes.
 */
export function mountWebApp(app: NestExpressApplication, dir: string, logger: LoggerService): boolean {
  const indexFile = join(dir, 'index.html');
  if (!existsSync(indexFile)) {
    logger.log({ msg: 'Web app not found; serving the API only', dir });
    return false;
  }
  app.useStaticAssets(dir, {
    index: false,
    redirect: false,
    setHeaders(res, path) {
      res.setHeader('Cache-Control', path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (isApiPath(req.path)) return next();
    // Paths that look like files are real 404s, not client routes.
    if (/\.[a-z0-9]{1,8}$/i.test(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });
  logger.log({ msg: 'Serving web app', dir });
  return true;
}
