import 'reflect-metadata';
import { Logger, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { ConfigError, clearEmptyEmulatorVariables, loadConfig, type NephoscopeConfig } from './core/config/config.js';
import { LiveGateway } from './core/live/live.gateway.js';
import { JsonLogger } from './core/logging/json-logger.js';
import { ProblemFilter } from './core/problem/problem.filter.js';
import { ProblemException } from './core/problem/problem.js';
import { AccessToken } from './core/security/access-token.js';
import { createHeadersMiddleware, createSecurityMiddleware } from './core/security/security.middleware.js';
import { defaultWebDist, mountWebApp } from './core/web/web-app.js';

interface IssueLike {
  message: string;
  path?: ReadonlyArray<unknown>;
}

function issuePath(issue: IssueLike): string {
  return (issue.path ?? [])
    .map((p) => (typeof p === 'object' && p !== null && 'key' in p ? String((p as { key: unknown }).key) : String(p)))
    .join('.');
}

/** The object upload route (SPEC-0006 D-11). */
const UPLOAD_PATH = /^\/api\/projects\/[^/]+\/storage\/buckets\/[^/]+\/upload(\?|$)/;

export async function createApp(config: NephoscopeConfig, token: AccessToken, logger = new JsonLogger(config.logLevel)) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, token), {
    logger,
    bodyParser: false,
  });
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(createHeadersMiddleware());
  app.use(createSecurityMiddleware(config, token));
  // A Firestore document can be 1 MiB, larger as tagged wire values; imports send 500 at a time (SPEC-0004 D-16).
  // Uploads stream their body untouched, whatever its type (SPEC-0006 D-11): a JSON file is data, not a request.
  app.useBodyParser('json', {
    limit: '12mb',
    type: (req) => !UPLOAD_PATH.test(req.url ?? '') && /^application\/json\b/i.test(String(req.headers['content-type'] ?? '')),
  });
  mountWebApp(app, config.webDist ?? defaultWebDist(), logger);
  app.useGlobalFilters(new ProblemFilter());
  // Route schemas only attach metadata; this pipe performs the validation (SPEC-0001 D-02, CA-31).
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues: readonly IssueLike[]) =>
        ProblemException.of('INVALID_ARGUMENT', 'The request is not valid.', {
          errors: issues.map((i) => ({ path: issuePath(i), message: i.message })),
        }),
    }),
  );
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  let config: NephoscopeConfig;
  clearEmptyEmulatorVariables();
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(`${err instanceof ConfigError ? err.message : String(err)}\n`);
    process.exit(1);
  }
  const logger = new JsonLogger(config.logLevel);
  // Google libraries can reject in the background (a credential lookup with no key, for instance).
  // One such failure must not stop the console for every tab, so it is logged, not fatal.
  process.on('unhandledRejection', (reason) => {
    logger.error(
      { msg: 'Unhandled rejection', error: reason instanceof Error ? reason.message : String(reason) },
      reason instanceof Error ? reason.stack : undefined,
      'Process',
    );
  });
  const token = new AccessToken(config.accessToken);
  const app = await createApp(config, token, logger);
  await app.listen(config.port, config.host);
  // Uploads stream for as long as the file takes (SPEC-0006 D-11); idle sockets still time out.
  app.getHttpServer().requestTimeout = 0;
  app.get(LiveGateway).attach(app.getHttpServer());

  // CA-68: never take more than 10 seconds to stop.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => setTimeout(() => process.exit(1), 10_000).unref());
  }

  const log = new Logger('Nephoscope');
  const shownHost = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  log.log({ msg: `Nephoscope is listening on http://${shownHost}:${config.port}`, readOnly: config.readOnly });
  // CA-75: the port must only be published on the loopback interface.
  log.warn({
    msg: 'Nephoscope has no login. Publish its port on 127.0.0.1 only, for example docker run -p 127.0.0.1:8080:8080, as docker-compose.yml does.',
  });
  if (config.requireToken || config.allowedHosts.length > 0) {
    // CA-71: the one place the access token is written, once, at startup.
    log.warn({
      msg: `Access token required outside loopback. Open http://<host>:${config.port}/?token=${token.value} once to store it in your browser.`,
    });
  }
}

if (process.env.NEPHOSCOPE_NO_BOOTSTRAP !== '1') {
  await bootstrap();
}
