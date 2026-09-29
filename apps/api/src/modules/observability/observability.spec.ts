import { describe, expect, it } from 'vitest';
import { mapRestEntry, protoEntryToRest, structToJson, summarize } from './log-mapping.js';
import { buildFilter } from './logs.service.js';
import { alignmentSeconds, quoteFilterValue, unitScale } from './metric-presets.js';

describe('buildFilter', () => {
  it('parenthesizes the base filter and the extra LQL', () => {
    const f = buildFilter({
      filter: 'resource.type="cloud_run_revision" OR x',
      extra: 'severity=ERROR OR y',
      minSeverity: 'WARNING',
      since: '2026-09-28T10:00:00Z',
      until: '2026-09-28T11:00:00Z',
    });
    expect(f).toBe(
      '(resource.type="cloud_run_revision" OR x) AND (severity=ERROR OR y) AND severity>=WARNING AND timestamp>="2026-09-28T10:00:00Z" AND timestamp<="2026-09-28T11:00:00Z"',
    );
  });

  it('skips empty extras and the DEFAULT severity', () => {
    expect(buildFilter({ filter: 'a', extra: '  ', minSeverity: 'DEFAULT', since: '2026-01-01T00:00:00Z' })).toBe(
      '(a) AND timestamp>="2026-01-01T00:00:00Z"',
    );
  });
});

describe('log entry mapping', () => {
  it('summarizes HTTP requests as method, status, latency and URL', () => {
    const e = mapRestEntry({
      insertId: 'abc',
      timestamp: '2026-09-28T10:00:00.123Z',
      severity: 'INFO',
      logName: 'projects/p/logs/run.googleapis.com%2Frequests',
      resource: { type: 'cloud_run_revision', labels: { service_name: 'api' } },
      httpRequest: { requestMethod: 'GET', requestUrl: 'https://api.run.app/x', status: 200, latency: '0.0421s' },
    });
    expect(e.summary).toBe('GET 200 42 ms https://api.run.app/x');
    expect(e.http?.latencyMs).toBe(42.1);
    expect(e.id).toBe('abc@2026-09-28T10:00:00.123Z');
    expect(e.resource.labels.service_name).toBe('api');
  });

  it('uses the text payload, then jsonPayload.message', () => {
    expect(summarize({ textPayload: 'hello\n  world' }, null)).toBe('hello world');
    expect(summarize({ jsonPayload: { message: 'started', port: 8080 } }, null)).toBe('started');
    expect(summarize({ jsonPayload: { a: 1 } }, null)).toBe('{"a":1}');
    expect(summarize({ protoPayload: { methodName: 'SetIamPolicy', resourceName: 'projects/p' } }, null)).toBe('SetIamPolicy projects/p');
  });

  it('maps numeric severities', () => {
    expect(mapRestEntry({ severity: 500 }).severity).toBe('ERROR');
    expect(mapRestEntry({ severity: 'nope' }).severity).toBe('DEFAULT');
  });

  it('decodes protobuf Structs', () => {
    expect(
      structToJson({
        fields: {
          a: { stringValue: 'x' },
          b: { numberValue: 2 },
          c: { listValue: { values: [{ boolValue: true }, { nullValue: 0 }] } },
          d: { structValue: { fields: { e: { stringValue: 'f' } } } },
        },
      }),
    ).toEqual({ a: 'x', b: 2, c: [true, null], d: { e: 'f' } });
  });

  it('converts streamed entries to the REST shape', () => {
    const rest = protoEntryToRest({
      insertId: 'i',
      timestamp: { seconds: '1790000000', nanos: 500000000 },
      jsonPayload: { fields: { message: { stringValue: 'hi' } } },
      httpRequest: { latency: { seconds: '1', nanos: 250000000 } },
      protoPayload: { type_url: 'type.googleapis.com/google.cloud.audit.AuditLog', value: 'AAA' },
    });
    expect(rest.timestamp).toBe('2026-09-21T14:13:20.5Z');
    expect(rest.jsonPayload).toEqual({ message: 'hi' });
    expect((rest.httpRequest as { latency: string }).latency).toBe('1.25s');
    expect((rest.protoPayload as { '@type': string })['@type']).toBe('type.googleapis.com/google.cloud.audit.AuditLog');
  });
});

describe('metric presets', () => {
  it('keeps each series near 300 points', () => {
    const hour = 3_600_000;
    expect(alignmentSeconds(0, hour)).toBe(60);
    expect(alignmentSeconds(0, 24 * hour)).toBe(300);
    expect(alignmentSeconds(0, 7 * 24 * hour)).toBe(3600);
    expect(alignmentSeconds(0, 30 * 24 * hour)).toBe(21_600);
    expect(alignmentSeconds(0, 400 * 24 * hour)).toBe(86_400);
  });

  it('scales series units to the chart unit', () => {
    expect(unitScale('ns', 'ms')).toBe(1e-6);
    expect(unitScale('s', 'ms')).toBe(1000);
    expect(unitScale('ms', 'ms')).toBe(1);
    expect(unitScale('%', 'ratio')).toBe(0.01);
  });

  it('quotes filter values', () => {
    expect(quoteFilterValue('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});
