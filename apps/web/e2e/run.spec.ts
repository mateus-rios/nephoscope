import { expect, test } from '@playwright/test';
import { PROJECT } from './fixtures';
import { mockApi } from './mock-api';

const shot = (name: string) => ({ path: `e2e/.shots/${name}.png`, fullPage: false });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('nephoscope.profile', 'env');
  });
});

test('lists services of every region with status, traffic and access (CA-01)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/run`);
  const table = page.getByRole('table', { name: 'Cloud Run services' });
  await expect(table.getByRole('link', { name: 'api', exact: true })).toBeVisible();
  await expect(table.getByText('europe-west1')).toBeVisible();
  await expect(table.getByText('2 revisions')).toBeVisible();
  await expect(table.getByText('function')).toBeVisible();
  await expect(table.getByText('Public').first()).toBeVisible();
  await expect(page.getByText(/Partial results: one location did not answer \(asia-south2\)/)).toBeVisible();
  await page.screenshot(shot('run-services'));
  expect(unmatched).toEqual([]);
});

test('filters services by location through the URL (CA-61)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/run?location=europe-west1`);
  const table = page.getByRole('table', { name: 'Cloud Run services' });
  await expect(table.getByRole('link', { name: 'web', exact: true })).toBeVisible();
  await expect(table.getByRole('link', { name: 'api', exact: true })).toHaveCount(0);
});

test('shows a service with traffic, revisions and the deploy form (CA-02, CA-03)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/run/services/us-central1/api`);
  await expect(page.getByRole('heading', { name: 'api', level: 1 })).toBeVisible();
  await expect(page.getByText('Latest (api-00012-xyz)')).toBeVisible();
  await page.screenshot(shot('run-service-overview'));

  await page.getByRole('tab', { name: /Revisions/ }).click();
  await expect(page.getByRole('table', { name: 'Revisions' }).getByText('api-00011-abc')).toBeVisible();
  await expect(page).toHaveURL(/tab=revisions/);
  await page.screenshot(shot('run-service-revisions'));

  await page.getByRole('button', { name: 'Deploy revision' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByLabel('Image')).toHaveValue('us-docker.pkg.dev/demo-project/app/api:1.4.2');
  await sheet.getByLabel('Image').fill('us-docker.pkg.dev/demo-project/app/api:1.5.0');
  await expect(
    sheet.getByText('Image: us-docker.pkg.dev/demo-project/app/api:1.4.2 to us-docker.pkg.dev/demo-project/app/api:1.5.0'),
  ).toBeVisible();
  await expect(sheet.getByText(/gcloud run deploy api/)).toBeVisible();
  await page.screenshot(shot('run-deploy-sheet'));
  expect(unmatched).toEqual([]);
});

test('edits traffic and requires 100% (CA-04)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/run/services/us-central1/api`);
  await page.getByRole('button', { name: 'Edit traffic' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Percent 1').fill('50');
  await expect(dialog.getByText('Total 60%')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save traffic split' })).toBeDisabled();
  await dialog.getByLabel('Percent 2').fill('50');
  await expect(
    dialog.getByText(/The latest revision \(now api-00012-xyz\) will get 50%, revision api-00011-abc will get 50%/),
  ).toBeVisible();
  await page.screenshot(shot('run-traffic'));
});

test('shows metrics and logs tabs (SPEC-0005 D-01, D-07)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/run/services/us-central1/api?tab=metrics`);
  await expect(page.getByText('Requests per second')).toBeVisible();
  await expect(page.getByText(/Startup latency is hidden/)).toBeVisible();
  await page.screenshot(shot('run-metrics'));
  await page.getByRole('tab', { name: 'Logs' }).click();
  await expect(page.getByText('Database connection refused')).toBeVisible();
  await page.getByRole('button', { name: /Database connection refused/ }).click();
  await expect(page.getByRole('region', { name: 'Log entry' })).toBeVisible();
  await page.screenshot(shot('run-logs'));
});

test('lists jobs and shows a running execution (CA-09, CA-11)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/run?tab=jobs`);
  await expect(page.getByRole('table', { name: 'Cloud Run jobs' }).getByRole('link', { name: 'nightly-etl' })).toBeVisible();
  await page.screenshot(shot('run-jobs'));
  await page.goto(`/p/${PROJECT}/run/jobs/us-central1/nightly-etl/executions/nightly-etl-9zzq1`);
  await expect(page.getByRole('heading', { name: 'nightly-etl-9zzq1' })).toBeVisible();
  await expect(page.getByText('1 succeeded, 0 failed, 2 running of 3')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel execution' })).toBeVisible();
  await page.screenshot(shot('run-execution'));
  expect(unmatched).toEqual([]);
});
