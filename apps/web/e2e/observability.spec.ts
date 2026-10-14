import { expect, test } from '@playwright/test';
import { PROJECT } from './fixtures';
import { traces } from './fixtures-observability';
import { mockApi } from './mock-api';

const shot = (name: string) => ({ path: `e2e/.shots/${name}.png`, fullPage: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('nephoscope.profile', 'env'));
});

test('Logs Explorer: query editor, facets, histogram and trace links (SPEC-0005 D-04)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/logging`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Logging');
  await expect(page.getByText('Based on the 30 entries loaded')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Facets' }).getByText('cloud_run_revision')).toBeVisible();
  await page.screenshot(shot('logging-explorer'));
  expect(unmatched).toEqual([]);
});

test('Log Router shows the writer identity and its role (CA-06)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/logging?tab=router`);
  await expect(page.getByRole('table', { name: 'Sinks' }).getByText('errors-to-pubsub')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Sinks' }).getByText('Built in')).toBeVisible();
  await page.screenshot(shot('logging-router'));
});

test('Log storage and log-based metrics', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/logging?tab=storage`);
  await page.getByRole('table', { name: 'Log buckets' }).getByText('audit-long').click();
  await expect(page.getByText('365 days')).toBeVisible();
  await page.screenshot(shot('logging-storage'));
  await page.goto(`/p/${PROJECT}/logging?tab=metrics`);
  await expect(page.getByText('checkout_errors')).toBeVisible();
});

test('Metrics Explorer builds PromQL from the picker and charts it (D-08, T-11)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/monitoring`);
  await page.getByRole('option', { name: /Request Count/ }).click();
  await expect(page.locator('.nb-uplot canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'response_code_class' }).click();
  await page.screenshot(shot('monitoring-explorer'));
  await page.getByRole('radio', { name: 'Table' }).click();
  await expect(page.getByRole('table', { name: 'Series' }).getByText('2xx')).toBeVisible();
});

test('A dashboard renders charts, scorecards and text as text; other widgets as JSON (D-09, T-12)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/monitoring/dashboards/ops-1`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('API operations');
  await expect(page.getByText('Restart <b>api</b> only after paging.', { exact: false })).toBeVisible();
  await expect(page.getByText('"pieChart"')).toBeVisible();
  await page.screenshot(shot('monitoring-dashboard'));
});

test('Alerting, uptime checks and channels', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/monitoring/alerts/1001`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('API p99 latency above 800 ms');
  await expect(page.getByText('On-call email')).toBeVisible();
  await page.screenshot(shot('monitoring-policy'));
  await page.goto(`/p/${PROJECT}/monitoring?tab=uptime`);
  await expect(page.getByText('93.0% passed')).toBeVisible();
  await page.screenshot(shot('monitoring-uptime'));
  await page.goto(`/p/${PROJECT}/monitoring?tab=channels`);
  await expect(page.getByText('Unverified')).toBeVisible();
});

test('Error Reporting lists groups and shows a group with its stack trace (D-11)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/errorreporting`);
  await expect(page.getByRole('table', { name: 'Error groups' }).getByText(/TypeError/)).toBeVisible();
  await page.screenshot(shot('errors-list'));
  await page.goto(`/p/${PROJECT}/errorreporting/CNjx6cK6kMuQ`);
  await expect(page.getByText('at checkout (/app/src/checkout.js:42:17)', { exact: false })).toBeVisible();
  await page.screenshot(shot('errors-group'));
});

test('Trace lists traces with a latency histogram and opens the waterfall (D-12, T-15)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/trace`);
  await expect(page.getByRole('table', { name: 'Traces' }).getByText('/v1/checkout').first()).toBeVisible();
  await page.screenshot(shot('trace-list'));
  await page.goto(`/p/${PROJECT}/trace/${traces[0]?.traceId}`);
  await expect(page.getByRole('list', { name: 'Spans' }).getByText('payments.charge')).toBeVisible();
  await page.getByRole('button', { name: /payments\.charge/ }).click();
  await expect(page.getByText('acme', { exact: true })).toBeVisible();
  await page.screenshot(shot('trace-waterfall'));
});

test('Resource kit: a product page and an item with child collections (SPEC-0001 D-16)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/spanner`);
  await expect(page.getByRole('table', { name: 'Instances' }).getByRole('link', { name: 'Orders' })).toBeVisible();
  await page.screenshot(shot('kit-spanner'));
  await page.goto(`/p/${PROJECT}/r/spanner/instances/instances/orders?tab=c-databases`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Orders');
  await expect(page.getByRole('table', { name: 'Databases' }).getByText('main')).toBeVisible();
  await page.screenshot(shot('kit-spanner-instance'));
  expect(unmatched).toEqual([]);
});
