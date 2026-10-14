import { expect, test } from '@playwright/test';
import { helloFunction, PROJECT, profiles } from './fixtures';
import { mockApi } from './mock-api';

const shot = (name: string) => ({ path: `e2e/.shots/${name}.png`, fullPage: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('nephoscope.profile', 'env'));
});

test('API console calls a method from its discovery form (SPEC-0009 T-01)', async ({ page }) => {
  const unmatched = await mockApi(page);
  const sent: unknown[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/rawapi/read')) sent.push(r.postDataJSON());
  });
  await page.goto(`/p/${PROJECT}/rawapi?api=serviceusage%3Av1&method=serviceusage.services.list`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('API console');
  await page.getByLabel('parent (path)').fill(`projects/${PROJECT}`);
  await page.getByLabel('filter', { exact: true }).fill('state:ENABLED');
  await expect(
    page.getByText(`'https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services?filter=state%3AENABLED'`),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Send GET' }).click();
  await expect(page.getByText('200 OK')).toBeVisible();
  expect(sent).toEqual([
    {
      api: 'serviceusage',
      version: 'v1',
      methodId: 'serviceusage.services.list',
      params: { parent: `projects/${PROJECT}`, filter: 'state:ENABLED' },
    },
  ]);
  await page.screenshot(shot('rawapi'));
  expect(unmatched).toEqual([]);
});

test('API console treats writes as mutations, refused for a read-only profile (SPEC-0009 T-04)', async ({ page }) => {
  await mockApi(page, [['GET', /^\/api\/profiles$/, () => profiles.map((p) => ({ ...p, readOnly: true }))]]);
  await page.goto(`/p/${PROJECT}/rawapi?api=serviceusage%3Av1&method=serviceusage.services.enable`);
  await expect(page.getByRole('button', { name: 'Send POST' })).toBeDisabled();
});

test('Quotas flag the ones over 80% (SPEC-0009 D-03, T-07)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/quotas`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Quotas');
  await expect(page.getByRole('row', { name: /CPUs/ })).toContainText('91.7%');
  await expect(page.getByRole('row', { name: /Read requests per minute/ })).toContainText('per minute');
  await page.screenshot(shot('quotas'));
  expect(unmatched).toEqual([]);
});

test('Organization policies put domain restricted sharing first (SPEC-0009 T-08)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/orgpolicy`);
  const rows = page.getByRole('table', { name: 'Organization policies' }).getByRole('row');
  await expect(rows.nth(1)).toContainText('Domain restricted sharing');
  await expect(rows.nth(1)).toContainText('Allowed: C0abc123');
  await page.screenshot(shot('orgpolicy'));
  expect(unmatched).toEqual([]);
});

test('Costs explain the billing export until one is set (SPEC-0009 D-02)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/billing?tab=costs`);
  await expect(page.getByText('Cloud Billing APIs do not report costs.')).toBeVisible();
  await page.goto(`/p/${PROJECT}/billing`);
  await expect(page.getByRole('row', { name: /Platform monthly/ })).toContainText('1500.00 USD');
  await page.screenshot(shot('billing'));
  expect(unmatched).toEqual([]);
});

test('A 1st gen function shows its upgrade sequence (SPEC-0003 D-18)', async ({ page }) => {
  const unmatched = await mockApi(page, [
    [
      'GET',
      new RegExp(`^/api/projects/${PROJECT}/functions/locations/us-central1/functions/hello$`),
      () => ({ ...helloFunction, generation: 'gen1', runService: null }),
    ],
  ]);
  await page.goto(`/p/${PROJECT}/functions/us-central1/hello?tab=upgrade`);
  await expect(page.getByText('A 2nd gen copy is ready to take it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send traffic to the copy' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Abort the upgrade' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Commit the upgrade' })).toHaveCount(0);
  await page.screenshot(shot('function-upgrade'));
  expect(unmatched).toEqual([]);
});
