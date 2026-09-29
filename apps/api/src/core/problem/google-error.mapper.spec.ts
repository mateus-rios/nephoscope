import { NotFoundException } from '@nestjs/common';
import { toProblem } from './google-error.mapper.js';
import { ProblemException } from './problem.js';

describe('toProblem', () => {
  it('maps a gRPC SERVICE_DISABLED error to API_DISABLED with service and consumer (SPEC-0001 CA-29)', () => {
    const err = Object.assign(new Error('7 PERMISSION_DENIED: Cloud Run Admin API has not been used in project 123'), {
      code: 7,
      details: 'Cloud Run Admin API has not been used in project 123 before or it is disabled.',
      statusDetails: [
        {
          reason: 'SERVICE_DISABLED',
          domain: 'googleapis.com',
          metadata: {
            consumer: 'projects/123',
            service: 'run.googleapis.com',
            serviceTitle: 'Cloud Run Admin API',
            activationUrl: 'https://console.developers.google.com/apis/api/run.googleapis.com/overview?project=123',
          },
        },
        { links: [{ description: 'Enable the API', url: 'https://console.developers.google.com/apis' }] },
      ],
    });
    const p = toProblem(err);
    expect(p.code).toBe('API_DISABLED');
    expect(p.status).toBe(403);
    expect(p.service).toBe('run.googleapis.com');
    expect(p.consumer).toBe('projects/123');
    expect(p.serviceTitle).toBe('Cloud Run Admin API');
    expect(p.activationUrl).toContain('run.googleapis.com');
    expect(p.help?.[0]?.url).toBe('https://console.developers.google.com/apis');
    expect(p.detail).toContain('has not been used');
  });

  it('reads SERVICE_DISABLED from a REST error body with @type details', () => {
    const err = Object.assign(new Error('Request failed'), {
      response: {
        status: 403,
        data: {
          error: {
            code: 403,
            status: 'PERMISSION_DENIED',
            message: 'Secret Manager API has not been used in project 42',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                reason: 'SERVICE_DISABLED',
                domain: 'googleapis.com',
                metadata: { consumer: 'projects/42', service: 'secretmanager.googleapis.com' },
              },
            ],
          },
        },
      },
    });
    const p = toProblem(err);
    expect(p.code).toBe('API_DISABLED');
    expect(p.service).toBe('secretmanager.googleapis.com');
    expect(p.activationUrl).toBeUndefined();
  });

  it('finds the missing permission in a permission error', () => {
    const p = toProblem(
      Object.assign(new Error('x'), {
        code: 7,
        details: "Permission 'run.services.list' denied on resource 'namespaces/acme' (or resource may not exist).",
      }),
    );
    expect(p.code).toBe('PERMISSION_DENIED');
    expect(p.permission).toBe('run.services.list');
  });

  it('prefers the permission named in ErrorInfo metadata', () => {
    const p = toProblem(
      Object.assign(new Error('x'), {
        code: 7,
        details: 'The caller does not have permission',
        statusDetails: [
          { reason: 'IAM_PERMISSION_DENIED', domain: 'iam.googleapis.com', metadata: { permission: 'storage.buckets.list' } },
        ],
      }),
    );
    expect(p.permission).toBe('storage.buckets.list');
    expect(p.reason).toBe('IAM_PERMISSION_DENIED');
  });

  it.each([
    [3, 'INVALID_ARGUMENT', 400],
    [5, 'NOT_FOUND', 404],
    [6, 'ALREADY_EXISTS', 409],
    [8, 'RESOURCE_EXHAUSTED', 429],
    [9, 'FAILED_PRECONDITION', 400],
    [10, 'CONFLICT', 409],
    [14, 'UNAVAILABLE', 503],
    [4, 'DEADLINE_EXCEEDED', 504],
    [16, 'UNAUTHENTICATED', 401],
  ])('maps gRPC code %i to %s / %i', (code, expected, status) => {
    const p = toProblem(Object.assign(new Error('boom'), { code, details: 'boom' }));
    expect(p.code).toBe(expected);
    expect(p.status).toBe(status);
    expect(p.grpcCode).toBe(code);
  });

  it('marks transient failures as retryable', () => {
    expect(toProblem(Object.assign(new Error('x'), { code: 14, details: 'x' })).retryable).toBe(true);
    expect(toProblem(Object.assign(new Error('x'), { code: 5, details: 'x' })).retryable).toBe(false);
  });

  it('passes problems through unchanged', () => {
    const e = ProblemException.of('READ_ONLY', 'nope');
    expect(toProblem(e)).toBe(e.problem);
  });

  it('maps Nest HTTP exceptions', () => {
    expect(toProblem(new NotFoundException('Cannot GET /x')).code).toBe('NOT_FOUND');
  });

  it('never leaks non-errors as anything but INTERNAL', () => {
    expect(toProblem('weird').code).toBe('INTERNAL');
  });
});
