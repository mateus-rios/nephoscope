import { describe, expect, it } from 'vitest';
import { upgradePlan } from './functions.js';
import { costSql, describeEffective } from './platform.js';
import { discoveryJsonSchema, expandRawPath, queryStringOf, rawConfirmToken, rawCurl } from './rawapi.js';

describe('Raw API console (SPEC-0009 D-01)', () => {
  it('expands simple and reserved path parameters', () => {
    expect(expandRawPath('v1/projects/{projectsId}/services', { projectsId: 'demo project' })).toBe('v1/projects/demo%20project/services');
    expect(expandRawPath('v2/{+name}', { name: 'projects/demo/locations/us-central1/services/api' })).toBe(
      'v2/projects/demo/locations/us-central1/services/api',
    );
  });

  it('refuses values that could leave their place', () => {
    expect(() => expandRawPath('v2/{+name}', { name: 'projects/demo/../other' })).toThrow();
    expect(() => expandRawPath('v2/{+name}', { name: 'projects/demo?x=1' })).toThrow();
    expect(() => expandRawPath('v1/{name}', {})).toThrow(/required/);
  });

  it('asks for the last path segment before a DELETE', () => {
    expect(rawConfirmToken('v2/projects/demo/locations/us/services/api')).toBe('api');
    expect(rawConfirmToken('v1/projects/demo/secrets/db%20pass')).toBe('db pass');
  });

  it('turns discovery schemas into a JSON Schema without output-only fields', () => {
    const schemas = {
      Service: {
        id: 'Service',
        type: 'object',
        properties: {
          name: { type: 'string' },
          uid: { type: 'string', readOnly: true },
          template: { $ref: 'Template' },
          labels: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
      Template: {
        id: 'Template',
        type: 'object',
        properties: { maxInstanceRequestConcurrency: { type: 'integer', format: 'int32' }, revision: { type: 'string', format: 'int64' } },
      },
      Unused: { id: 'Unused', type: 'object' },
    };
    const js = discoveryJsonSchema(schemas, 'Service') as {
      $ref: string;
      definitions: Record<string, { properties?: Record<string, unknown> }>;
    };
    expect(js.$ref).toBe('#/definitions/Service');
    expect(Object.keys(js.definitions).sort()).toEqual(['Service', 'Template']);
    expect(js.definitions.Service?.properties).not.toHaveProperty('uid');
    expect(js.definitions.Service?.properties?.template).toEqual({ $ref: '#/definitions/Template' });
    expect(js.definitions.Template?.properties?.revision).toEqual({ type: ['string', 'integer'] });
  });

  it('builds the query string and a curl that takes the token from gcloud', () => {
    expect(queryStringOf({ pageSize: '10', filter: 'a b', fields: ['x', 'y'], empty: '' })).toBe(
      '?pageSize=10&filter=a%20b&fields=x&fields=y',
    );
    const curl = rawCurl('POST', 'https://run.googleapis.com/v2/x', { a: "it's" });
    expect(curl).toContain('$(gcloud auth print-access-token)');
    expect(curl).toContain(`-d '{"a":"it'\\''s"}'`);
  });
});

describe('Costs from the billing export (SPEC-0009 D-02)', () => {
  it('fills the table and project only when they are what they claim to be', () => {
    const sql = costSql('service', 'billing-admin.exports.gcp_billing_export_v1_0123', 'demo-project');
    expect(sql).toContain('FROM `billing-admin.exports.gcp_billing_export_v1_0123`');
    expect(sql).toContain("project.id = 'demo-project'");
    expect(costSql('day', 'b-proj.d.t', 'demo-project')).toContain('GROUP BY day, currency');
    expect(() => costSql('sku', 'x`; DROP TABLE y; --', 'demo-project')).toThrow();
    expect(() => costSql('sku', 'b-proj.d.t', "demo' OR '1'='1")).toThrow();
  });
});

describe('Effective organization policies (SPEC-0009 D-05)', () => {
  it('says what a policy does in a line', () => {
    expect(describeEffective('boolean', [])).toEqual({ text: 'Default', restricts: false });
    expect(describeEffective('boolean', [{ enforce: true }])).toEqual({ text: 'Enforced', restricts: true });
    expect(describeEffective('list', [{ values: { allowedValues: ['C0abc'] } }])).toEqual({ text: 'Allowed: C0abc', restricts: true });
    expect(describeEffective('list', [{ allowAll: true }])).toEqual({ text: 'Allow all', restricts: false });
    expect(describeEffective('boolean', [{ enforce: false, condition: { title: 'Dev only' } }])).toEqual({
      text: 'Not enforced (Dev only)',
      restricts: false,
    });
  });
});

describe('Gen1 upgrade sequence (SPEC-0003 D-18)', () => {
  it('offers only the steps the state allows, and says where traffic goes', () => {
    expect(upgradePlan('ELIGIBLE_FOR_2ND_GEN_UPGRADE').steps).toEqual(['setup']);
    expect(upgradePlan('SETUP_FUNCTION_UPGRADE_CONFIG_SUCCESSFUL').steps).toEqual(['redirect', 'abort']);
    const redirected = upgradePlan('REDIRECT_FUNCTION_UPGRADE_TRAFFIC_SUCCESSFUL');
    expect(redirected.steps).toEqual(['commit', 'rollback']);
    expect(redirected.traffic).toContain('2nd gen copy');
    expect(upgradePlan('UPGRADE_OPERATION_IN_PROGRESS')).toMatchObject({ steps: [], blocked: 'A step is in progress.' });
    expect(upgradePlan(null).blocked).toBe('Only 1st gen functions are upgraded.');
  });
});
