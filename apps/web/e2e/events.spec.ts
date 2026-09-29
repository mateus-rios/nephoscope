import { expect, test } from '@playwright/test';
import { PROJECT } from './fixtures';
import { mockApi } from './mock-api';

const shot = (name: string) => ({ path: `e2e/.shots/${name}.png` });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('nephoscope.profile', 'env'));
});

test('lists Scheduler jobs with their last result and next run (CA-24)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/scheduler`);
  const table = page.getByRole('table', { name: 'Scheduler jobs' });
  await expect(table.getByRole('link', { name: 'nightly-etl-schedule' })).toBeVisible();
  await expect(table.getByText('Paused').first()).toBeVisible();
  await page.screenshot(shot('scheduler-list'));
  expect(unmatched).toEqual([]);
});

test('previews "0 */2 * * 1-5" in America/Sao_Paulo while typing (D-12, T-15)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/scheduler`);
  await page.getByRole('button', { name: 'Create job' }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Cron expression').fill('0 */2 * * 1-5');
  await sheet.getByLabel('Time zone').fill('America/Sao_Paulo');
  await expect(sheet.getByText('On the hour, every 2 hours, Monday through Friday')).toBeVisible();
  await expect(sheet.getByRole('table', { name: 'Next runs' }).locator('tbody tr')).toHaveCount(5);
  await page.screenshot(shot('scheduler-create'));
});

test('schedules a Cloud Run job with the right API call prefilled (CA-13)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/run/jobs/us-central1/nightly-etl`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Schedule this job' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByLabel('URL')).toHaveValue(
    `https://run.googleapis.com/v2/projects/${PROJECT}/locations/us-central1/jobs/nightly-etl:run`,
  );
  await expect(sheet.getByLabel('Service account')).toHaveValue(`etl@${PROJECT}.iam.gserviceaccount.com`);
});

test('shows a service triggers tab with its Scheduler and Eventarc triggers (CA-02)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/run/services/us-central1/api?tab=triggers`);
  await expect(page.getByText('api-on-upload')).toBeVisible();
  await expect(page.getByText('google.cloud.storage.object.v1.finalized')).toBeVisible();
});

test('shows a queue with its tasks and settings (D-13)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/tasks/us-central1/emails`);
  await expect(page.getByRole('table', { name: 'Tasks' }).getByText('8423150172395621')).toBeVisible();
  await expect(page.getByText('Code 14')).toBeVisible();
  await page.screenshot(shot('tasks-queue'));
  expect(unmatched).toEqual([]);
});

test('creates an Eventarc trigger from the provider catalog (D-14, CA-28)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/eventarc`);
  await expect(page.getByRole('table', { name: 'Triggers' }).getByText('Cloud Run api /events (us-central1)')).toBeVisible();
  await page.getByRole('button', { name: 'Create trigger' }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'Cloud Storage' }).click();
  await sheet.getByRole('combobox', { name: 'Event type' }).click();
  await page.getByRole('option', { name: 'The object is created or overwritten' }).click();
  await expect(sheet.getByLabel('bucket')).toBeVisible();
  await page.screenshot(shot('eventarc-create'));
});
