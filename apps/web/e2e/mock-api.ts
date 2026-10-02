import type { Page, Route } from '@playwright/test';
import * as f from './fixtures';
import * as c from './fixtures-colab';
import * as e from './fixtures-events';
import * as w from './fixtures-workflows';

type Handler = (url: URL, route: Route) => unknown;

const P = `/api/projects/${f.PROJECT}`;
const R = `${P}/run`;
const FN = `${P}/functions/locations/us-central1/functions/hello`;
const WF = `${P}/workflows/locations/us-central1/workflows/order-flow`;
const CO = `${P}/colab`;
const NB = `${CO}/locations/us-central1/notebooks/${c.NOTEBOOK_ID}`;
const EX = `${CO}/locations/us-central1/executions/${c.EXECUTION_ID}`;

/** Method and path pattern to a fixture. Unknown API calls answer 404 so a test sees them. */
const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/instance$/, () => f.instance],
  ['GET', /^\/api\/profiles$/, () => f.profiles],
  ['GET', /^\/api\/prefs$/, () => ({ density: 'default', pageSize: 50, pinnedProducts: [], pinnedProjects: [] })],
  ['GET', /^\/api\/recents\/projects$/, () => [f.PROJECT]],
  ['GET', /^\/api\/operations$/, () => []],
  ['GET', /^\/api\/audit$/, () => []],
  ['GET', /^\/api\/projects$/, () => f.list([f.project])],
  ['GET', new RegExp(`^${P}$`), () => f.project],
  ['GET', new RegExp(`^${P}/capabilities$`), () => f.capabilities],
  ['GET', new RegExp(`^${R}/services$`), () => f.list(f.services, { unreachable: ['asia-south2'] })],
  ['GET', new RegExp(`^${R}/service-access$`), () => f.serviceAccess],
  ['GET', new RegExp(`^${R}/locations/us-central1/services/api$`), () => f.service],
  ['GET', new RegExp(`^${R}/locations/us-central1/services/api/revisions$`), () => f.list(f.revisions)],
  ['GET', new RegExp(`^${R}/locations/us-central1/services/api/access$`), () => f.serviceAccess[0]],
  [
    'GET',
    new RegExp(`^${R}/locations/us-central1/services/api/yaml$`),
    () => ({ apiVersion: 'serving.knative.dev/v1', kind: 'Service', metadata: { name: 'api' } }),
  ],
  ['GET', new RegExp(`^${R}/jobs$`), () => f.list(f.jobs)],
  ['GET', new RegExp(`^${R}/locations/us-central1/jobs/nightly-etl$`), () => f.job],
  ['GET', new RegExp(`^${R}/locations/us-central1/jobs/nightly-etl/executions$`), () => f.list(f.executions)],
  ['GET', new RegExp(`^${R}/locations/us-central1/jobs/nightly-etl/executions/nightly-etl-9zzq1$`), () => f.executions[0]],
  ['GET', new RegExp(`^${R}/locations/us-central1/jobs/nightly-etl/executions/nightly-etl-9zzq1/tasks$`), () => f.tasks],
  ['GET', new RegExp(`^${P}/functions$`), () => f.list(f.functionList)],
  ['GET', new RegExp(`^${FN}$`), () => f.helloFunction],
  ['GET', new RegExp(`^${FN}/source$`), () => f.helloSource],
  ['GET', new RegExp(`^${P}/workflows$`), () => f.list(w.workflowList)],
  ['GET', new RegExp(`^${WF}$`), () => w.workflow],
  ['GET', new RegExp(`^${WF}/executions$`), () => f.list([w.workflowExecution])],
  ['GET', new RegExp(`^${WF}/executions/[^/]+$`), () => w.workflowExecution],
  ['GET', new RegExp(`^${WF}/executions/[^/]+/steps$`), () => w.workflowSteps],
  ['GET', /^\/api\/history\/.+/, () => ['{"order":{"id":41}}']],
  ['GET', new RegExp(`^${P}/scheduler/jobs$`), () => f.list(e.schedulerJobs)],
  ['GET', new RegExp(`^${P}/scheduler/locations/us-central1/jobs/nightly-etl-schedule$`), () => e.schedulerJobs[0]],
  ['GET', new RegExp(`^${P}/tasks/queues$`), () => f.list(e.queues)],
  ['GET', new RegExp(`^${P}/tasks/locations/us-central1/queues/emails$`), () => e.queues[0]],
  ['GET', new RegExp(`^${P}/tasks/locations/us-central1/queues/emails/tasks$`), () => f.list(e.queueTasks)],
  ['GET', new RegExp(`^${P}/eventarc/triggers$`), () => f.list(e.triggers)],
  ['GET', new RegExp(`^${P}/eventarc/providers$`), () => e.providers],
  ['GET', new RegExp(`^${CO}/notebooks$`), () => f.list(c.notebooks)],
  ['GET', new RegExp(`^${NB}$`), () => c.notebookDetail],
  ['GET', new RegExp(`^${NB}/content$`), () => c.notebookDocument],
  ['GET', new RegExp(`^${NB}/history$`), () => f.list(c.commits)],
  ['GET', new RegExp(`^${NB}/executions$`), () => ({ ...c.executionList, truncated: [] })],
  ['GET', new RegExp(`^${NB}/schedules$`), () => f.list(c.schedules)],
  ['GET', new RegExp(`^${NB}/raw$`), () => ({ name: c.notebookDetail.name, labels: c.notebookDetail.labels })],
  ['GET', new RegExp(`^${CO}/executions$`), () => c.executionList],
  ['GET', new RegExp(`^${EX}$`), () => c.executions[0]],
  ['GET', new RegExp(`^${EX}/output$`), () => c.executionOutput],
  ['GET', new RegExp(`^${EX}/output/notebook$`), () => c.notebookDocument],
  ['GET', new RegExp(`^${CO}/schedules$`), () => f.list(c.schedules)],
  ['GET', new RegExp(`^${CO}/locations/us-central1/schedules/${c.SCHEDULE_ID}$`), () => c.schedules[0]],
  ['GET', new RegExp(`^${CO}/locations/us-central1/schedules/${c.SCHEDULE_ID}/runs$`), () => c.executionList],
  ['GET', new RegExp(`^${CO}/templates$`), () => f.list(c.templates)],
  ['GET', new RegExp(`^${CO}/locations/us-central1/templates/${c.TEMPLATE_ID}$`), () => c.templates[0]],
  ['GET', new RegExp(`^${CO}/runtimes$`), () => f.list(c.runtimes)],
  ['GET', new RegExp(`^${CO}/locations/us-central1/runtimes/${c.RUNTIME_ID}$`), () => c.runtimes[0]],
  ['GET', new RegExp(`^${P}/metrics$`), () => f.metrics],
  ['GET', new RegExp(`^${P}/logs$`), () => f.logs],
];

export async function mockApi(page: Page, overrides: [string, RegExp, Handler][] = []): Promise<string[]> {
  const unmatched: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    for (const [m, re, handler] of [...overrides, ...routes]) {
      if (m === method && re.test(url.pathname)) {
        const body = handler(url, route);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        return;
      }
    }
    unmatched.push(`${method} ${url.pathname}`);
    await route.fulfill({
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        detail: `No fixture for ${method} ${url.pathname}`,
        code: 'NOT_FOUND',
        retryable: false,
      }),
    });
  });
  // No live channel in these tests: the socket is refused quietly.
  await page.route('**/api/live', (route) => route.abort());
  return unmatched;
}
