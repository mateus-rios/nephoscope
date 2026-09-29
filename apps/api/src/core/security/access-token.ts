import { randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_COOKIE = 'nephoscope_token';

/** Access token for non-loopback hosts or NEPHOSCOPE_REQUIRE_TOKEN (SPEC-0001 CA-71). */
export class AccessToken {
  readonly value: string;

  constructor(configured: string | null) {
    this.value = configured ?? randomBytes(32).toString('base64url');
  }

  matches(candidate: string | undefined | null): boolean {
    if (!candidate) return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.value);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1];
}
