import { CLIENT_HEADER, CLIENT_HEADER_VALUE, PROBLEM_CONTENT_TYPE, type Problem } from '@nephoscope/contracts';
import type { NextFunction, Request, Response } from 'express';
import type { NephoscopeConfig } from '../config/config.js';
import { makeProblem } from '../problem/problem.js';
import { AccessToken, bearerToken, readCookie, TOKEN_COOKIE } from './access-token.js';
import { hostnameOf, isAllowedHost, isLoopbackHost, originAuthority } from './host.js';

function send(res: Response, problem: Problem) {
  res.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
}

const EXEMPT_API_PATHS = new Set(['/api/health', '/api/ready']);

/**
 * Object links (SPEC-0006 D-11) are opened by <img>, <video> and downloads, which cannot send the
 * client header; their unguessable, short-lived token stands in for it. Every other check applies.
 */
function isObjectLink(req: Request): boolean {
  return (req.method === 'GET' || req.method === 'HEAD') && /^\/api\/o\/[A-Za-z0-9_-]{43}$/.test(req.path);
}

export function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

/**
 * Localhost hardening (SPEC-0001 D-05, CA-12 to CA-16, CA-71). Runs before routing, for static
 * files and the API alike.
 */
export function createSecurityMiddleware(config: NephoscopeConfig, token: AccessToken) {
  return function security(req: Request, res: Response, next: NextFunction) {
    // CA-12: Host allowlist against DNS rebinding.
    const hostname = hostnameOf(req.headers.host);
    if (!isAllowedHost(hostname, config.allowedHosts)) {
      return send(
        res,
        makeProblem(
          'HOST_NOT_ALLOWED',
          `Host "${hostname ?? ''}" is not allowed. Add it to NEPHOSCOPE_ALLOWED_HOSTS to serve Nephoscope under that name.`,
        ),
      );
    }

    // CA-71: access token outside loopback, or always with NEPHOSCOPE_REQUIRE_TOKEN.
    const needsToken = config.requireToken || !isLoopbackHost(hostname);
    if (needsToken) {
      const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
      if (queryToken && token.matches(queryToken) && req.method === 'GET' && !isApiPath(req.path)) {
        // Opening the startup URL stores the token as a strict cookie, then drops it from the URL.
        res.cookie(TOKEN_COOKIE, token.value, { httpOnly: true, sameSite: 'strict', path: '/' });
        const url = new URL(req.originalUrl, 'http://placeholder');
        url.searchParams.delete('token');
        return res.redirect(303, `${url.pathname}${url.search}`);
      }
      const presented = readCookie(req.headers.cookie, TOKEN_COOKIE) ?? bearerToken(req.headers.authorization);
      if (!token.matches(presented) && !EXEMPT_API_PATHS.has(req.path)) {
        return send(
          res,
          makeProblem(
            'UNAUTHENTICATED',
            'This Nephoscope requires its access token. Open the URL printed in the server log when it started.',
          ),
        );
      }
    }

    if (!isApiPath(req.path)) return next();

    // CA-15: never answer preflights; no CORS headers are ever sent.
    if (req.method === 'OPTIONS') {
      return send(res, makeProblem('CROSS_SITE_REQUEST', 'Cross-origin requests are not accepted.'));
    }

    if (EXEMPT_API_PATHS.has(req.path)) return next();

    // CA-14: refuse cross-site requests.
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return send(res, makeProblem('CROSS_SITE_REQUEST', 'Requests from other sites are not accepted.'));
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const authority = originAuthority(origin);
      if (authority === null || authority !== String(req.headers.host ?? '').toLowerCase()) {
        return send(res, makeProblem('CROSS_SITE_REQUEST', 'The request origin does not match this server.'));
      }
    }

    // CA-13: required client header (forces a preflight for any cross-origin fetch).
    if (req.headers[CLIENT_HEADER] !== CLIENT_HEADER_VALUE && !isObjectLink(req)) {
      return send(
        res,
        makeProblem('CLIENT_HEADER_REQUIRED', `Every API request must carry the header ${CLIENT_HEADER}: ${CLIENT_HEADER_VALUE}.`),
      );
    }
    return next();
  };
}

/** Security headers on every response (SPEC-0001 CA-18). */
export function createHeadersMiddleware() {
  return function headers(req: Request, res: Response, next: NextFunction) {
    const host = String(req.headers.host ?? '').toLowerCase();
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        `connect-src 'self' ws://${host} wss://${host}`,
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.removeHeader('X-Powered-By');
    next();
  };
}
