import { vi } from 'vitest';
import type { ProfileHandle } from '../core/credentials/profiles.service.js';

export interface FakeCall {
  url: string;
  method: string;
  data?: unknown;
}

/**
 * A profile handle whose authorized REST requests answer from `responses`, matched by URL path
 * suffix; anything else fails as a Google 404. Tests only.
 */
export function fakeHandle(responses: Record<string, unknown>): { h: ProfileHandle; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const request = vi.fn(async (o: FakeCall) => {
    calls.push(o);
    const path = o.url.replace(/\?.*$/, '');
    const hit = Object.entries(responses).find(([k]) => path.endsWith(k));
    if (!hit) throw Object.assign(new Error('not found'), { response: { status: 404, data: { error: { code: 404, message: 'nope' } } } });
    return { data: typeof hit[1] === 'function' ? (hit[1] as (c: FakeCall) => unknown)(o) : hit[1] };
  });
  const h = { profile: { id: 'p1', principal: 'tester@demo.iam.gserviceaccount.com' }, auth: { request } } as unknown as ProfileHandle;
  return { h, calls };
}
