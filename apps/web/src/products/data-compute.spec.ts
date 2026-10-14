import { describeDnsChange } from '@nephoscope/contracts';
import { describe, expect, it } from 'vitest';
import { labelText, parseLabelText } from './bigquery/PropertiesDialog';
import { jsonFromRows, rowsFromJson } from './bigquery/SchemaEditor';
import { changeCommands } from './dns/DnsPages';
import { linkedDataset, starterSql } from './logging/LogsSql';

describe('SQL over logs (SPEC-0005 D-06)', () => {
  it('reads the linked dataset the Logging API names', () => {
    expect(linkedDataset('bigquery.googleapis.com/projects/demo/datasets/logs_sql')).toEqual({ project: 'demo', dataset: 'logs_sql' });
    expect(linkedDataset(null)).toBeNull();
    expect(linkedDataset('nonsense')).toBeNull();
  });

  it('starts from the last hour of the _AllLogs view', () => {
    const sql = starterSql('demo', 'logs_sql');
    expect(sql).toContain('FROM `demo.logs_sql._AllLogs`');
    expect(sql).toContain('INTERVAL 1 HOUR');
    expect(sql).toContain('LIMIT 100');
  });
});

describe('Cloud DNS equivalent commands (SPEC-0001 CA-65)', () => {
  it('names one gcloud command per change', () => {
    const lines = describeDnsChange({
      additions: [
        { name: 'www.example.com.', type: 'A', ttl: 60, rrdatas: ['5.6.7.8'] },
        { name: 'example.com.', type: 'TXT', ttl: 300, rrdatas: ['"it\'s"'] },
      ],
      deletions: [
        { name: 'www.example.com.', type: 'A', ttl: 300, rrdatas: ['1.2.3.4'] },
        { name: 'old.example.com.', type: 'CNAME', ttl: 300, rrdatas: ['x.example.com.'] },
      ],
    });
    expect(changeCommands('web', 'demo', lines).split('\n')).toEqual([
      `gcloud dns record-sets create example.com. --type=TXT --ttl=300 --rrdatas='"it'\\''s"' --zone=web --project=demo`,
      'gcloud dns record-sets delete old.example.com. --type=CNAME --zone=web --project=demo',
      "gcloud dns record-sets update www.example.com. --type=A --ttl=60 --rrdatas='5.6.7.8' --zone=web --project=demo",
    ]);
  });
});

describe('BigQuery properties and schemas (SPEC-0008 D-01)', () => {
  it('parses labels and points at the first bad one', () => {
    expect(parseLabelText('env=prod, team=data')).toEqual({ labels: { env: 'prod', team: 'data' } });
    expect(parseLabelText('')).toEqual({ labels: {} });
    expect(parseLabelText('env=prod, Bad=x')).toEqual({ error: expect.stringContaining('"Bad=x"') });
    expect(labelText({ a: '1', b: '' })).toBe('a=1, b=');
  });

  it('edits flat schemas as rows and leaves nested ones to the JSON view', () => {
    const json = jsonFromRows([
      { name: 'id', type: 'INT64', mode: 'REQUIRED' },
      { name: 'name', type: 'STRING', mode: 'NULLABLE' },
    ]);
    expect(JSON.parse(json)).toEqual([
      { name: 'id', type: 'INT64', mode: 'REQUIRED' },
      { name: 'name', type: 'STRING' },
    ]);
    expect(rowsFromJson(json)).toEqual([
      { name: 'id', type: 'INT64', mode: 'REQUIRED' },
      { name: 'name', type: 'STRING', mode: 'NULLABLE' },
    ]);
    expect(rowsFromJson('[{"name":"r","type":"RECORD","fields":[{"name":"x","type":"STRING"}]}]')).toBeNull();
    expect(rowsFromJson('not json')).toBeNull();
  });
});
