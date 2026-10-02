import { ColabJobSpecSchema, SaveColabScheduleSchema, UpdateColabTemplateSchema } from '@nephoscope/contracts';
import { describe, expect, it } from 'vitest';
import { colabHref, parseGsUri, readPages } from './colab.service.js';
import { mapExecution, mapSchedule, mapTemplate, sameResource, schedulePatch, templatePatch, toJob } from './colab-mapping.js';
import { emptyNotebook, renderNotebook, TEXT_CAP, validateNotebook } from './notebook-render.js';

const REPO = 'projects/demo/locations/us-central1/repositories/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab';
const TEMPLATE = 'projects/demo/locations/us-central1/notebookRuntimeTemplates/4242';

const spec = ColabJobSpecSchema.parse({
  displayName: 'Nightly report',
  source: { kind: 'notebook', repository: REPO },
  template: TEMPLATE,
  outputUri: 'gs://demo-results/colab/',
  identity: { kind: 'serviceAccount', email: 'runner@demo.iam.gserviceaccount.com' },
});

describe('colab mapping', () => {
  it('builds the execution job of a notebook run (D-08)', () => {
    expect(toJob(spec)).toEqual({
      displayName: 'Nightly report',
      dataformRepositorySource: { dataformRepositoryResourceName: REPO },
      notebookRuntimeTemplateResourceName: TEMPLATE,
      gcsOutputUri: 'gs://demo-results/colab',
      serviceAccount: 'runner@demo.iam.gserviceaccount.com',
      executionTimeout: '86400s',
    });
  });

  it('maps an execution as Google returns it, with the project as a number', () => {
    const e = mapExecution({
      name: 'projects/123456/locations/us-central1/notebookExecutionJobs/987',
      displayName: 'Nightly report',
      jobState: 'JOB_STATE_FAILED',
      status: { code: 9, message: 'Kernel died' },
      dataformRepositorySource: {
        dataformRepositoryResourceName: 'projects/123456/locations/us-central1/repositories/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab',
      },
      notebookRuntimeTemplateResourceName: 'projects/123456/locations/us-central1/notebookRuntimeTemplates/4242',
      gcsOutputUri: 'gs://demo-results/colab',
      executionUser: 'ana@example.com',
      executionTimeout: '3600s',
      scheduleResourceName: 'projects/123456/locations/us-central1/schedules/55',
      createTime: '2026-10-01T03:00:00.123Z',
    });
    expect(e).toMatchObject({
      id: '987',
      location: 'us-central1',
      state: 'failed',
      status: { code: 9, message: 'Kernel died' },
      identity: { kind: 'user', email: 'ana@example.com' },
      timeoutSeconds: 3600,
      createTime: '2026-10-01T03:00:00.123Z',
    });
    expect(e.source.kind === 'notebook' && sameResource(e.source.repository, REPO)).toBe(true);
    expect(sameResource(e.schedule, 'projects/demo/locations/us-central1/schedules/55')).toBe(true);
    expect(sameResource(e.schedule, 'projects/demo/locations/us-east1/schedules/55')).toBe(false);
  });

  it('sends only the template fields that changed (D-07)', () => {
    const current = mapTemplate({
      name: TEMPLATE,
      displayName: 'GPU',
      notebookRuntimeType: 'USER_DEFINED',
      machineSpec: { machineType: 'g2-standard-4', acceleratorType: 'NVIDIA_L4', acceleratorCount: 1 },
      idleShutdownConfig: { idleTimeout: '10800s' },
      softwareConfig: { env: [{ name: 'MODE', value: 'prod' }] },
    });
    expect(current.idleShutdown).toEqual({ disabled: false, timeoutMinutes: 180 });
    const same = UpdateColabTemplateSchema.parse({ displayName: 'GPU', env: { MODE: 'prod' } });
    expect(templatePatch(current, same).mask).toEqual([]);
    const changed = UpdateColabTemplateSchema.parse({ displayName: 'GPU large', env: { MODE: 'dev' } });
    expect(templatePatch(current, changed).mask).toEqual(['display_name', 'software_config.env']);
  });

  it('sends only the schedule fields that changed (D-08)', () => {
    const current = mapSchedule({
      name: 'projects/123456/locations/us-central1/schedules/55',
      displayName: 'Nightly',
      cron: 'TZ=America/Sao_Paulo 0 3 * * *',
      state: 'ACTIVE',
      maxConcurrentRunCount: '1',
      allowQueueing: false,
      createNotebookExecutionJobRequest: {
        parent: 'projects/123456/locations/us-central1',
        notebookExecutionJob: { ...toJob(spec), notebookRuntimeTemplateResourceName: TEMPLATE.replace('demo', '123456') },
      },
    });
    const body = SaveColabScheduleSchema.parse({ displayName: 'Nightly', cron: 'TZ=America/Sao_Paulo 0 3 * * *', job: spec });
    const parent = 'projects/demo/locations/us-central1';
    expect(schedulePatch(current, parent, body).mask).toEqual([]);
    expect(schedulePatch(current, parent, { ...body, cron: 'TZ=America/Sao_Paulo 0 4 * * *' }).mask).toEqual(['cron']);
    const other = { ...body, job: { ...spec, outputUri: 'gs://other' } };
    expect(schedulePatch(current, parent, other).mask).toEqual(['create_notebook_execution_job_request']);
  });

  it('links resources to their pages with the project id the user opened', () => {
    expect(colabHref('demo', 'projects/123456/locations/us-central1/notebookRuntimes/rt-1')).toBe(
      '/p/demo/colab/runtimes/us-central1/rt-1',
    );
    expect(colabHref('demo', REPO)).toBe(`/p/demo/colab/notebooks/us-central1/${REPO.split('/').pop()}`);
    expect(colabHref('demo', 'projects/demo/locations/us-central1')).toBeNull();
  });

  it('parses Cloud Storage URIs', () => {
    expect(parseGsUri('gs://bucket')).toEqual({ bucket: 'bucket', path: '' });
    expect(parseGsUri('gs://bucket/a/b/')).toEqual({ bucket: 'bucket', path: 'a/b' });
    expect(parseGsUri('https://example.com')).toBeNull();
  });

  it('reads pages up to the cap', async () => {
    let calls = 0;
    const items = await readPages(async (token) => {
      calls++;
      const n = Number(token ?? 0);
      return { items: [n, n + 1], next: String(n + 2) };
    }, 5);
    expect(items).toEqual([0, 1, 2, 3, 4, 5]);
    expect(calls).toBe(3);
  });
});

describe('notebook rendering (D-06)', () => {
  const nb = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' }, language_info: { name: 'python' } },
    cells: [
      { cell_type: 'markdown', source: ['# Report\n', 'Numbers of the day'] },
      {
        cell_type: 'code',
        execution_count: 3,
        source: 'print(1)\ndf',
        outputs: [
          { output_type: 'stream', name: 'stdout', text: ['1\n'] },
          {
            output_type: 'execute_result',
            execution_count: 3,
            data: {
              'text/plain': ['   a\n', '0  1'],
              'text/html': '<table><script>alert(1)</script></table>',
              'image/png': 'iVBORw0KGgo=\n',
              'application/vnd.jupyter.widget-view+json': { model_id: 'x' },
            },
          },
          { output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: ['\u001b[0;31mValueError\u001b[0m: bad'] },
        ],
      },
      { cell_type: 'code', source: '<svg/>', outputs: [{ output_type: 'display_data', data: { 'image/svg+xml': '<svg onload="x()"/>' } }] },
    ],
  };

  it('normalizes cells and outputs, never passing HTML as markup', () => {
    const { notebook, error } = renderNotebook(JSON.stringify(nb));
    expect(error).toBeNull();
    expect(notebook).toMatchObject({ nbformat: '4.5', kernel: 'Python 3', language: 'python' });
    const [md, code, svg] = notebook?.cells ?? [];
    expect(md).toMatchObject({ type: 'markdown', source: '# Report\nNumbers of the day', outputs: [] });
    expect(code?.executionCount).toBe(3);
    expect(code?.outputs[0]).toEqual({ kind: 'stream', name: 'stdout', text: '1\n' });
    expect(code?.outputs[1]).toMatchObject({
      kind: 'result',
      text: '   a\n0  1',
      html: '<table><script>alert(1)</script></table>',
      image: { mime: 'image/png', data: 'iVBORw0KGgo=' },
      omitted: ['application/vnd.jupyter.widget-view+json'],
    });
    expect(code?.outputs[2]).toEqual({ kind: 'error', name: 'ValueError', value: 'bad', traceback: 'ValueError: bad' });
    const image = svg?.outputs[0];
    expect(image?.kind === 'result' && image.image?.mime).toBe('image/svg+xml');
    expect(image?.kind === 'result' && Buffer.from(image.image?.data ?? '', 'base64').toString()).toBe('<svg onload="x()"/>');
  });

  it('cuts very long text with a marker', () => {
    const long = { ...nb, cells: [{ cell_type: 'code', source: 'x'.repeat(TEXT_CAP + 10), outputs: [] }] };
    const source = renderNotebook(JSON.stringify(long)).notebook?.cells[0]?.source ?? '';
    expect(source.length).toBeLessThan(TEXT_CAP + 100);
    expect(source).toMatch(/\[10 more characters not shown\]$/);
  });

  it('explains what it cannot show', () => {
    expect(renderNotebook('{nope').error).toMatch(/not valid JSON/);
    expect(renderNotebook('{"worksheets": []}').error).toMatch(/nbformat 3/);
    expect(validateNotebook('[]')).toMatch(/not a Jupyter notebook/);
    expect(validateNotebook(emptyNotebook())).toBeNull();
  });
});
