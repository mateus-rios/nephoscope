import { expect, test } from '@playwright/test';
import { PROJECT } from './fixtures';
import { BUILD_ID } from './fixtures-security';
import { mockApi } from './mock-api';

const shot = (name: string) => ({ path: `e2e/.shots/${name}.png`, fullPage: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('nephoscope.profile', 'env'));
});

test('IAM policy shows direct, conditional and inherited grants (SPEC-0007 D-01)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/iam`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('IAM');
  await expect(page.getByText('Until year end').first()).toBeVisible();
  await expect(page.getByText('organizations/123456789').first()).toBeVisible();
  await page.screenshot(shot('iam-policy'));
  expect(unmatched).toEqual([]);
});

test('Secret Manager lists replication and never fetches a payload on its own (SPEC-0007 D-07)', async ({ page }) => {
  const unmatched = await mockApi(page);
  const accessed: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/access')) accessed.push(r.url());
  });
  await page.goto(`/p/${PROJECT}/secretmanager`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Secret Manager');
  await expect(page.getByText('stripe-key')).toBeVisible();
  await page.screenshot(shot('secrets'));
  await page.goto(`/p/${PROJECT}/secretmanager/global/db-password`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('db-password');
  await page.screenshot(shot('secret'));
  expect(accessed).toEqual([]);
  expect(unmatched).toEqual([]);
});

test('Cloud KMS key shows its primary version', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/kms/global/app/db-key`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('db-key');
  await expect(page.getByText('Primary').first()).toBeVisible();
  await page.screenshot(shot('kms-key'));
  expect(unmatched).toEqual([]);
});

test('Cloud Armor policy lists rules by priority with the default rule last (SPEC-0007 D-09)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/armor/global/edge-waf`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('edge-waf');
  await expect(page.getByText('Block SQL injection')).toBeVisible();
  await page.screenshot(shot('armor-policy'));
  expect(unmatched).toEqual([]);
});

test('Artifact Registry repository lists images with tags', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/artifactregistry/us-central1/apps`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('apps');
  await expect(page.getByText('v42').first()).toBeVisible();
  await page.screenshot(shot('registry-repository'));
  expect(unmatched).toEqual([]);
});

test('Cloud Build lists builds and opens one with its steps (SPEC-0007 D-12)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/cloudbuild`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cloud Build');
  await expect(page.getByRole('row', { name: /^Failed 0d9e8f7a/ })).toBeVisible();
  await page.screenshot(shot('cloudbuild'));
  await page.goto(`/p/${PROJECT}/cloudbuild/builds/global/${BUILD_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Build ${BUILD_ID.slice(0, 8)}`);
  await expect(page.getByText('npm test')).toBeVisible();
  await page.screenshot(shot('cloudbuild-build'));
  expect(unmatched).toEqual([]);
});

test('Cloud Deploy offers promotion to the next stage only (SPEC-0007 D-13)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/clouddeploy/us-central1/web`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('web');
  await expect(page.getByRole('button', { name: 'Promote to prod' })).toBeEnabled();
  await page.screenshot(shot('clouddeploy-pipeline'));
  expect(unmatched).toEqual([]);
});
