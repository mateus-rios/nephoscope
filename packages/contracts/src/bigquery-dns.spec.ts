import { describe, expect, it } from 'vitest';
import { type BqField, bqErrorPosition, bqLabelChanges, bqRow, bqTimestamp, formatBqBytes } from './bigquery.js';
import { describeDnsChange, qualifyDnsName, RrsetSchema } from './dns.js';

const f = (name: string, type: string, mode: BqField['mode'] = 'NULLABLE', fields: BqField[] = []): BqField => ({
  name,
  type,
  mode,
  description: null,
  policyTags: [],
  fields,
});

describe('BigQuery values keep their types (SPEC-0008 D-03, T-03)', () => {
  it('keeps 64-bit integers, NUMERIC and BYTES exact', () => {
    const schema = [f('big', 'INT64'), f('n', 'NUMERIC'), f('b', 'BYTES'), f('x', 'FLOAT64'), f('none', 'STRING')];
    const row = { f: [{ v: '9007199254740993' }, { v: '1.1' }, { v: 'YWJj' }, { v: 'NaN' }, { v: null }] };
    expect(bqRow(schema, row)).toEqual(['9007199254740993', '1.1', 'YWJj', 'NaN', null]);
  });

  it('turns microsecond timestamps into ISO strings without losing microseconds', () => {
    expect(bqTimestamp('1700000000123456')).toBe('2023-11-14T22:13:20.123456Z');
    expect(bqTimestamp('0')).toBe('1970-01-01T00:00:00.000000Z');
    expect(bqTimestamp('-1500')).toBe('1969-12-31T23:59:59.998500Z');
    expect(bqRow([f('t', 'TIMESTAMP')], { f: [{ v: '1700000000000001' }] })).toEqual(['2023-11-14T22:13:20.000001Z']);
  });

  it('expands STRUCT, ARRAY and JSON', () => {
    const schema = [
      f('tags', 'STRING', 'REPEATED'),
      f('who', 'STRUCT', 'NULLABLE', [f('name', 'STRING'), f('age', 'INT64')]),
      f('events', 'STRUCT', 'REPEATED', [f('at', 'DATE')]),
      f('doc', 'JSON'),
    ];
    const row = {
      f: [
        { v: [{ v: 'a' }, { v: 'b' }] },
        { v: { f: [{ v: 'Ana' }, { v: '41' }] } },
        { v: [{ v: { f: [{ v: '2026-10-14' }] } }] },
        { v: '{"k":[1,2]}' },
      ],
    };
    expect(bqRow(schema, row)).toEqual([['a', 'b'], { name: 'Ana', age: '41' }, [{ at: '2026-10-14' }], { k: [1, 2] }]);
  });

  it('removes labels by sending them as null', () => {
    expect(bqLabelChanges({ env: 'prod', old: 'x' }, { env: 'dev', team: 'data' })).toEqual({ env: 'dev', team: 'data', old: null });
  });

  it('formats bytes for the Run button and finds error positions', () => {
    expect(formatBqBytes('1320702443')).toBe('1.23 GiB');
    expect(formatBqBytes(512)).toBe('512 B');
    expect(bqErrorPosition('Unrecognized name: x at [3:14]')).toEqual({ line: 3, column: 14 });
    expect(bqErrorPosition('Access Denied')).toEqual({ line: null, column: null });
  });
});

describe('Cloud DNS change sets (SPEC-0008 D-10, T-12)', () => {
  const a = (name: string, data: string, ttl = 300) => ({ name, type: 'A' as const, ttl, rrdatas: [data] });

  it('pairs a deletion and an addition of the same record set into a change', () => {
    const lines = describeDnsChange({
      additions: [a('www.example.com.', '5.6.7.8', 60), { name: 'example.com.', type: 'TXT', ttl: 300, rrdatas: ['"v=spf1 -all"'] }],
      deletions: [a('www.example.com.', '1.2.3.4'), a('old.example.com.', '9.9.9.9')],
    });
    expect(lines.map((l) => [l.kind, l.name, l.type])).toEqual([
      ['add', 'example.com.', 'TXT'],
      ['remove', 'old.example.com.', 'A'],
      ['change', 'www.example.com.', 'A'],
    ]);
    expect(lines[2]).toMatchObject({ before: { ttl: 300, rrdatas: ['1.2.3.4'] }, after: { ttl: 60, rrdatas: ['5.6.7.8'] } });
  });

  it('qualifies names typed relative to the zone', () => {
    expect(qualifyDnsName('www', 'example.com.')).toBe('www.example.com.');
    expect(qualifyDnsName('@', 'example.com.')).toBe('example.com.');
    expect(qualifyDnsName('', 'example.com.')).toBe('example.com.');
    expect(qualifyDnsName('other.org.', 'example.com.')).toBe('other.org.');
  });

  it('accepts only the editable record types and fully qualified names', () => {
    expect(RrsetSchema.safeParse(a('www.example.com.', '1.2.3.4')).success).toBe(true);
    expect(RrsetSchema.safeParse({ ...a('www.example.com.', '1.2.3.4'), type: 'SOA' }).success).toBe(false);
    expect(RrsetSchema.safeParse(a('www.example.com', '1.2.3.4')).success).toBe(false);
    expect(RrsetSchema.safeParse({ ...a('_sip._tcp.example.com.', '10 5 5060 sip.example.com.'), type: 'SRV' }).success).toBe(true);
  });
});
