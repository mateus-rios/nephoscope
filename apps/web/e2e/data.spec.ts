import { expect, test } from '@playwright/test';
import { PROJECT } from './fixtures';
import { JOB_ID, SQL_PATH, VM_PATH } from './fixtures-data';
import { mockApi } from './mock-api';

const shot = (name: string) => ({ path: `e2e/.shots/${name}.png`, fullPage: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('nephoscope.profile', 'env'));
});

test('BigQuery prices the query on Run and keeps 64-bit integers exact (SPEC-0008 D-02, D-03, T-03)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/bigquery?job=US%2F${JOB_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('BigQuery');
  await expect(page.getByRole('button', { name: 'Run · 1.23 GiB' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('table', { name: 'Query results' }).getByText('9007199254740993')).toBeVisible();
  await expect(page.getByText('2026-09-28T10:00:00.000123Z').first()).toBeVisible();
  await page.screenshot(shot('bigquery-editor'));
  expect(unmatched).toEqual([]);
});

test('A query over the ceiling asks to raise it for this run (SPEC-0008 T-02)', async ({ page }) => {
  await mockApi(page, [
    [
      'POST',
      new RegExp(`^/api/projects/${PROJECT}/bigquery/query/dryrun$`),
      () => ({ ok: true, totalBytesProcessed: String(25 * 1024 ** 3), statementType: 'SELECT', referencedTables: [], error: null }),
    ],
  ]);
  await page.goto(`/p/${PROJECT}/bigquery`);
  await page.getByRole('button', { name: 'Run · 25.00 GiB' }).click();
  const dialog = page.getByRole('dialog', { name: 'Raise the ceiling for this run?' });
  await expect(dialog).toContainText('more than your ceiling of 10.00 GiB');
  await expect(dialog.getByRole('button', { name: 'Run with a ceiling of 25.00 GiB' })).toBeVisible();
  await page.screenshot(shot('bigquery-ceiling'));
});

test('BigQuery table preview reads rows without a query (SPEC-0008 T-05)', async ({ page }) => {
  const unmatched = await mockApi(page);
  const queries: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/query/run')) queries.push(r.url());
  });
  await page.goto(`/p/${PROJECT}/bigquery/${PROJECT}/sales/orders?tab=preview`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('orders');
  await expect(page.getByText('nothing is billed')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Preview of orders' }).getByText('customer-1').first()).toBeVisible();
  await page.screenshot(shot('bigquery-table'));
  expect(queries).toEqual([]);
  expect(unmatched).toEqual([]);
});

test('Cloud DNS shows a change set before applying it (SPEC-0008 D-10, T-12)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/dns/example-com`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('example-com');
  await page.getByRole('button', { name: 'Add record set' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add record set' });
  await dialog.getByLabel('Name').fill('mail');
  await dialog.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: 'TXT' }).click();
  await dialog.getByLabel('Data').fill('"v=spf1 -all"');
  await dialog.getByRole('button', { name: 'Add to change set' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Change set: 1 change')).toBeVisible();
  await page.getByRole('button', { name: 'Review and apply' }).click();
  const review = page.getByRole('dialog', { name: 'Apply 1 change to example-com' });
  await expect(review).toContainText('gcloud dns record-sets create mail.example.com.');
  await expect(review).toContainText('--type=TXT');
  await page.screenshot(shot('dns-change-set'));
  expect(unmatched).toEqual([]);
});

test('Load balancing draws the chain to a serverless backend with its Armor policy (SPEC-0008 T-11)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/loadbalancing`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Load balancing');
  await expect(page.getByRole('link', { name: 'edge-waf' })).toHaveAttribute('href', `/p/${PROJECT}/armor/global/edge-waf`);
  await expect(page.getByRole('link', { name: /web-neg/ })).toHaveAttribute('href', `/p/${PROJECT}/run/services/us-central1/api`);
  await expect(page.getByText('leads to web-run for default').first()).toBeVisible();
  await page.screenshot(shot('loadbalancing'));
  expect(unmatched).toEqual([]);
});

test('Cloud SQL flags say which changes restart the instance (SPEC-0008 D-05)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/r/cloudsql/instances/${SQL_PATH}?tab=t-sqlflags`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('orders-db');
  const row = page.getByRole('row', { name: /max_connections/ });
  await expect(row).toContainText('Yes');
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit max_connections' })).toContainText('restarts the instance');
  await page.screenshot(shot('cloudsql-flags'));
  expect(unmatched).toEqual([]);
});

test('Compute instance offers lifecycle actions by state (SPEC-0008 D-07)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/r/compute/instances/${VM_PATH}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('web-1');
  await expect(page.getByRole('button', { name: 'Stop instance' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start instance' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Serial output' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Metrics' })).toBeVisible();
  await page.screenshot(shot('compute-instance'));
  expect(unmatched).toEqual([]);
});

test('Logs Explorer offers SQL through BigQuery when a dataset is linked (SPEC-0005 D-06)', async ({ page }) => {
  await mockApi(page, [
    [
      'GET',
      new RegExp(`^/api/projects/${PROJECT}/logging/buckets/[^/]+/[^/]+/links$`),
      () => [
        { name: 'links/logs_sql', datasetId: `bigquery.googleapis.com/projects/${PROJECT}/datasets/logs_sql`, lifecycleState: 'ACTIVE' },
      ],
    ],
  ]);
  await page.goto(`/p/${PROJECT}/logging?tab=sql`);
  await expect(page.getByText('BigQuery bills the bytes they process')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run · 1.23 GiB' })).toBeVisible({ timeout: 15_000 });
  await page.screenshot(shot('logging-sql'));
});
