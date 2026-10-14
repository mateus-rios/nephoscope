import { describe, expect, it } from 'vitest';
import { fakeHandle } from '../../testing/fake-handle.js';
import { checkChange, DnsService, mapRecordSet, routingPolicyText } from './dns.module.js';

const ops = { recordInstant: () => ({}) } as never;

describe('Cloud DNS (SPEC-0008 D-10)', () => {
  it('keeps every record of a change inside the zone', () => {
    const rr = (name: string) => ({ name, type: 'TXT' as const, ttl: 300, rrdatas: ['"x"'] });
    expect(() => checkChange('example.com.', { additions: [rr('example.com.'), rr('www.example.com.')], deletions: [] })).not.toThrow();
    expect(() => checkChange('example.com.', { additions: [rr('example.org.')], deletions: [] })).toThrow();
    // A suffix that is not a label boundary is outside the zone.
    expect(() => checkChange('example.com.', { additions: [], deletions: [rr('badexample.com.')] })).toThrow();
  });

  it('shows routing policies as text', () => {
    expect(
      routingPolicyText({
        wrr: {
          items: [
            { weight: 0.8, rrdatas: ['1.1.1.1'] },
            { weight: 0.2, rrdatas: ['2.2.2.2'] },
          ],
        },
      }),
    ).toBe('Weighted: 0.8 → 1.1.1.1; 0.2 → 2.2.2.2');
    expect(mapRecordSet({ name: 'a.example.com.', type: 'A', ttl: 300, rrdatas: ['1.2.3.4'] })).toEqual({
      name: 'a.example.com.',
      type: 'A',
      ttl: 300,
      rrdatas: ['1.2.3.4'],
      routingPolicy: null,
    });
  });

  it('applies a change set in one call, after checking it against the zone', async () => {
    const { h, calls } = fakeHandle({
      'managedZones/web': { name: 'web', dnsName: 'example.com.' },
      'managedZones/web/changes': { id: '7', status: 'pending', additions: [], deletions: [] },
    });
    const dns = new DnsService(ops);
    const change = await dns.applyChange(h, 'demo', 'web', {
      additions: [{ name: 'www.example.com.', type: 'A', ttl: 300, rrdatas: ['5.6.7.8'] }],
      deletions: [{ name: 'www.example.com.', type: 'A', ttl: 300, rrdatas: ['1.2.3.4'] }],
    });
    expect(change).toMatchObject({ id: '7', status: 'pending' });
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('https://dns.googleapis.com/dns/v1/projects/demo/managedZones/web/changes');
    expect(post?.data).toMatchObject({ additions: [{ rrdatas: ['5.6.7.8'] }], deletions: [{ rrdatas: ['1.2.3.4'] }] });
  });
});
