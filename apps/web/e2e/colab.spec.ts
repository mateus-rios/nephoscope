import { expect, test } from '@playwright/test';
import { PROJECT } from './fixtures';
import { EXECUTION_ID, NOTEBOOK_ID, RUNTIME_ID, SCHEDULE_ID, TEMPLATE_ID } from './fixtures-colab';
import { mockApi } from './mock-api';

const shot = (name: string) => ({ path: `e2e/.shots/${name}.png` });
const C = `/p/${PROJECT}/colab`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('nephoscope.profile', 'env'));
});

test('lists notebooks and shows one without ever rendering its HTML (SPEC-0010 D-06, CA-02)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(C);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Colab Enterprise');
  await expect(page.getByRole('link', { name: 'churn-model.ipynb' })).toBeVisible();
  await page.getByRole('link', { name: 'daily-sales.ipynb' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('daily-sales.ipynb');
  const cells = page.getByRole('region', { name: /^Cell \d+/ });
  await expect(cells).toHaveCount(4);
  await expect(page.getByText('Totals per region, refreshed every morning.')).toBeVisible();
  await expect(page.getByAltText('Output of cell 3')).toBeVisible();
  await expect(page.getByText("KeyError: 'missing'").first()).toBeVisible();
  await expect(page.getByText(/HTML output, not rendered/)).toBeVisible();
  // The HTML output carried a script: it must never reach the DOM as markup.
  expect(await page.evaluate(() => (window as unknown as { __colabXss?: number }).__colabXss)).toBeUndefined();
  await expect(page.locator('table td', { hasText: 'south' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show source' }).click();
  await expect(page.getByText(/<script>window.__colabXss = 1<\/script>/)).toBeVisible();
  await page.screenshot(shot('colab-notebook'));

  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('Filter by region')).toBeVisible();
  await page
    .getByRole('row', { name: /First version/ })
    .getByRole('button', { name: 'View' })
    .click();
  await expect(page).toHaveURL(/commit=beef00987654321fedcba0/);
  await expect(page.getByText('Showing version beef009, not the latest.')).toBeVisible();
  expect(unmatched).toEqual([]);
});

test('lists executions with the newest-page note and shows the executed notebook (D-03, D-10, CA-05)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`${C}?tab=executions`);
  await expect(page.getByText('Showing the newest 100 executions of us-central1.', { exact: false })).toBeVisible();
  const failedRow = page.getByRole('row', { name: /Failed/ });
  // The notebook is named by its display name although Google answered with the project number.
  await expect(failedRow.getByRole('link', { name: 'daily-sales.ipynb' })).toBeVisible();
  await page.screenshot(shot('colab-executions'));

  await page.goto(`${C}/executions/us-central1/${EXECUTION_ID}`);
  await expect(page.getByText("Cell 4 raised KeyError: 'missing'")).toBeVisible();
  await expect(page.getByRole('link', { name: 'gs://demo-results/colab' })).toBeVisible();
  await page.getByRole('tab', { name: 'Output' }).click();
  await expect(page.getByRole('region', { name: 'Executed notebook' })).toBeVisible();
  await expect(page.getByText('Totals per region, refreshed every morning.')).toBeVisible();
  await page.screenshot(shot('colab-execution-output'));
  expect(unmatched).toEqual([]);
});

test('shows a schedule and edits it with the REST request the API sends (D-08, D-11, CA-06)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`${C}/schedules/us-central1/${SCHEDULE_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Daily sales at 6');
  await expect(page.getByText('America/Sao_Paulo').first()).toBeVisible();
  await expect(page.getByText('212', { exact: true })).toBeVisible();
  // Names resolve although the stored request names the project by number.
  const run = page.getByRole('region', { name: 'Each run' });
  await expect(run.getByRole('link', { name: 'daily-sales.ipynb' })).toBeVisible();
  await expect(run.getByRole('link', { name: 'GPU L4' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('combobox', { name: /^Notebook/ })).toContainText('daily-sales.ipynb');
  await expect(sheet.getByRole('combobox', { name: /^Runtime template/ })).toContainText('GPU L4');
  await expect(sheet.getByText('Equivalent command')).toBeVisible();
  await expect(sheet.getByText(/createNotebookExecutionJobRequest/)).toBeVisible();
  await expect(sheet.getByText(/"cron": "TZ=America\/Sao_Paulo 0 6 \* \* 1-5"/)).toBeVisible();
  await page.screenshot(shot('colab-schedule-edit'));
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Runs' }).click();
  await expect(page.getByRole('row', { name: /Succeeded/ })).toBeVisible();
  expect(unmatched).toEqual([]);
});

test('shows runtimes and templates with their actions (D-07, D-09, CA-03, CA-04)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`${C}?tab=runtimes`);
  const row = page.getByRole('row', { name: /Ana GPU runtime/ });
  await expect(row.getByText('Running')).toBeVisible();
  await expect(row.getByRole('link', { name: 'GPU L4' })).toBeVisible();

  await page.goto(`${C}/runtimes/us-central1/${RUNTIME_ID}`);
  await expect(page.getByRole('button', { name: 'Upgrade' })).toBeVisible();
  await expect(page.getByText('This runtime belongs to ana@example.com', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'GPU L4' })).toBeVisible();
  await page.screenshot(shot('colab-runtime'));

  await page.goto(`${C}/templates/us-central1/${TEMPLATE_ID}`);
  await expect(page.getByText('pip install -q polars')).toBeVisible();
  await page.getByRole('button', { name: 'Create runtime' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByLabel('Runtime user')).toHaveValue('deployer@demo-project.iam.gserviceaccount.com');
  expect(unmatched).toEqual([]);
});

test('opens the run form from a notebook with its region fixed (D-08)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`${C}/notebooks/us-central1/${NOTEBOOK_ID}`);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByLabel('Region')).toHaveValue('us-central1');
  await expect(sheet.getByText('Pin this version (c0ffee1)')).toBeVisible();
  await expect(sheet.getByLabel('Service account email')).toHaveValue('deployer@demo-project.iam.gserviceaccount.com');
  await sheet.getByRole('button', { name: 'Run', exact: true }).click();
  // Nothing is sent while the template and output are missing.
  await expect(sheet.getByText('Pick a runtime template.')).toBeVisible();
  await expect(sheet.getByText('A Cloud Storage location such as gs://bucket/results.')).toBeVisible();
});
