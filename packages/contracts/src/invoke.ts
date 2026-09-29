import { z } from 'zod';

/**
 * Test requests to a resource's own URL (SPEC-0003 D-08). The server picks the URL from the
 * resource; the request only carries the path, so Nephoscope is never an open proxy (SPEC-0001 D-05).
 */

export const invokeMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** Headers the server sets itself or that would let a request escape its target. */
export const FORBIDDEN_INVOKE_HEADERS = [
  'authorization',
  'host',
  'cookie',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'te',
  'trailer',
  'keep-alive',
] as const;

export const MAX_INVOKE_BODY_BYTES = 1024 * 1024;
export const MAX_INVOKE_RESPONSE_BYTES = 5 * 1024 * 1024;

export const InvokeRequestSchema = z.object({
  method: z.enum(invokeMethods),
  path: z
    .string()
    .max(2048)
    .regex(/^\/(?!\/)[^\s#]*$/, 'A path starting with a single /'),
  headers: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, 'Invalid header name')
          .refine((n) => !(FORBIDDEN_INVOKE_HEADERS as readonly string[]).includes(n.toLowerCase()), 'Nephoscope sets this header itself'),
        value: z.string().max(8192),
      }),
    )
    .max(50)
    .default([]),
  body: z.string().max(MAX_INVOKE_BODY_BYTES).default(''),
  /** A traffic tag whose URL receives the request instead of the main one. */
  tag: z.string().max(63).nullable().default(null),
  /** Send an ID token for the URL made with the active profile. */
  authenticate: z.boolean().default(true),
});
export type InvokeRequest = z.infer<typeof InvokeRequestSchema>;

export interface InvokeResponse {
  url: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  /** True when the body was cut at 5 MiB. */
  truncated: boolean;
  bodyBytes: number;
  contentType: string | null;
  timings: { totalMs: number; headersMs: number };
  /** Why no ID token was sent, when authenticate was requested but not possible (SPEC-0003 R-02). */
  authNote: string | null;
}
