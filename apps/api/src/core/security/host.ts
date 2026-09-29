import { LOOPBACK_HOSTS } from '../config/config.js';

/** Host name of a `Host` or `Origin` value, lowercase, without port. Handles IPv6 literals. */
export function hostnameOf(hostHeader: string | undefined | null): string | null {
  if (!hostHeader) return null;
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 0 ? value.slice(0, end + 1) : null;
  }
  const colon = value.indexOf(':');
  return colon >= 0 ? value.slice(0, colon) : value;
}

export function isLoopbackHost(hostname: string | null): boolean {
  return hostname !== null && (LOOPBACK_HOSTS as readonly string[]).includes(hostname);
}

export function isAllowedHost(hostname: string | null, allowed: readonly string[]): boolean {
  if (!hostname) return false;
  return isLoopbackHost(hostname) || allowed.includes(hostname);
}

/** `host:port` of an Origin header value, or null when it is not a valid http(s) origin. */
export function originAuthority(origin: string | undefined): string | null {
  if (!origin || origin === 'null') return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}
