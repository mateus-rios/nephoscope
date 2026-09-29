import { type InvokeRequest, type InvokeResponse, MAX_INVOKE_RESPONSE_BYTES } from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';
import type { ProfileHandle } from '../credentials/profiles.service.js';
import { ProblemException } from '../problem/problem.js';

const TIMEOUT_MS = 60_000;

/** Why an ID token could not be made, and what to use instead (SPEC-0003 D-08, R-02). */
export function idTokenNote(credentialType: string, err: unknown): string {
  if (credentialType === 'authorized_user') {
    return 'This profile uses gcloud user credentials, which cannot create ID tokens for a service URL, so the request was sent without one. Use a service account key profile, or run the equivalent curl command with gcloud auth print-identity-token.';
  }
  if (credentialType === 'external_account') {
    return 'Workload identity federation credentials cannot create ID tokens directly, so the request was sent without one. Use a service account key or an impersonation profile.';
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `No ID token could be created (${detail}), so the request was sent without one.`;
}

/**
 * Sends a test request to a resource's own URL (SPEC-0003 D-08). `baseUrl` always comes from the
 * resource as Google reports it, never from the browser, so Nephoscope cannot be used as a proxy.
 */
@Injectable()
export class InvokeService {
  async invoke(h: ProfileHandle, baseUrl: string, req: InvokeRequest): Promise<InvokeResponse> {
    const base = new URL(baseUrl);
    if (base.protocol !== 'https:') throw ProblemException.of('FAILED_PRECONDITION', 'Only HTTPS URLs can be tested.');
    const target = new URL(req.path, base);
    if (target.origin !== base.origin) throw ProblemException.of('INVALID_ARGUMENT', 'The path must stay on the resource URL.');

    const headers = new Headers();
    for (const { name, value } of req.headers) headers.append(name, value);
    let authNote: string | null = null;
    if (req.authenticate) {
      try {
        const client = await h.auth.getIdTokenClient(base.origin);
        const authHeaders = new Headers((await client.getRequestHeaders(target.toString())) as ConstructorParameters<typeof Headers>[0]);
        const authorization = authHeaders.get('authorization');
        if (authorization) headers.set('authorization', authorization);
      } catch (err) {
        authNote = idTokenNote(h.profile.type, err);
      }
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== '';
    const started = performance.now();
    let res: Response;
    try {
      res = await fetch(target, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw ProblemException.of(
        timedOut ? 'DEADLINE_EXCEEDED' : 'UNAVAILABLE',
        timedOut
          ? 'The resource did not answer within 60 seconds.'
          : `The request failed: ${err instanceof Error ? err.message : String(err)}`,
        {
          retryable: true,
        },
      );
    }
    const headersMs = performance.now() - started;

    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let truncated = false;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const room = MAX_INVOKE_RESPONSE_BYTES - bytes;
        if (value.byteLength > room) {
          chunks.push(value.subarray(0, room));
          bytes += room;
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
        bytes += value.byteLength;
      }
    }
    const body = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
    return {
      url: target.toString(),
      status: res.status,
      statusText: res.statusText,
      headers: [...res.headers.entries()],
      body,
      truncated,
      bodyBytes: bytes,
      contentType: res.headers.get('content-type'),
      timings: { totalMs: Math.round(performance.now() - started), headersMs: Math.round(headersMs) },
      authNote,
    };
  }
}
