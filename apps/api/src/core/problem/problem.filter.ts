import { PROBLEM_CONTENT_TYPE } from '@nephoscope/contracts';
import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { toProblem } from './google-error.mapper.js';

/** Every failure becomes `application/problem+json` (SPEC-0001 D-08). */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Problem');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    const problem = toProblem(exception);
    if (problem.status >= 500) {
      this.logger.error(exception instanceof Error ? exception : { msg: problem.detail });
    }
    if (res.headersSent) return;
    res.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
  }
}
