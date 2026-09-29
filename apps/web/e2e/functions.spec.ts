import { expect, test } from '@playwright/test';
import { PROJECT } from './fixtures';
import { mockApi } from './mock-api';

const shot = (name: string) => ({ path: `e2e/.shots/${name}.png` });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('nephoscope.profile', 'env'));
});

test('lists functions of every generation once (D-07, T-18)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/functions`);
  const table = page.getByRole('table', { name: 'Functions' });
  await expect(table.getByRole('link', { name: 'hello' })).toBeVisible();
  await expect(table.getByText('1st gen')).toBeVisible();
  await expect(table.getByText('Cloud Run', { exact: true })).toBeVisible();
  await expect(table.getByText(/storage\.object\.finalize \(uploads\)/)).toBeVisible();
  await expect(table.getByRole('link', { name: 'resize-image' })).toHaveAttribute(
    'href',
    `/p/${PROJECT}/run/services/us-east1/resize-image`,
  );
  await page.screenshot(shot('functions-list'));
  expect(unmatched).toEqual([]);
});

test('edits gen2 source and lists the changes before redeploying (D-09, CA-17)', async ({ page }) => {
  let redeployBody: unknown = null;
  await mockApi(page, [
    [
      'POST',
      /\/functions\/locations\/us-central1\/functions\/hello\/source$/,
      (_url, route) => {
        redeployBody = route.request().postDataJSON();
        return {
          operation: {
            id: 'op1',
            profileId: 'env',
            projectId: PROJECT,
            product: 'functions',
            kind: 'functions.function.redeploy',
            family: 'longrunning',
            resource: { name: 'x', displayName: 'Redeploy hello', href: null },
            status: 'running',
            progress: null,
            message: null,
            startedAt: new Date().toISOString(),
            finishedAt: null,
            error: null,
            googleName: 'op',
          },
        };
      },
    ],
  ]);
  await page.goto(`/p/${PROJECT}/functions/us-central1/hello?tab=source`);
  await expect(page.getByRole('navigation', { name: 'Source files' }).getByText('index.js')).toBeVisible();
  const lines = page.getByRole('group', { name: 'Source of index.js' }).locator('.view-lines');
  await expect(lines).toBeVisible();
  await lines.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('// edited\n');
  // Every keystroke lands: the editor never reapplies its own changes (fixed dropped characters).
  await expect(page.getByRole('group', { name: 'Source of index.js' }).locator('.view-lines')).toContainText('// edited');
  await expect(page.getByRole('navigation', { name: 'Source files' }).getByRole('img', { name: 'Changed' })).toBeVisible();
  await page.getByRole('button', { name: 'Redeploy source' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('changed index.js')).toBeVisible();
  await page.screenshot(shot('functions-source-redeploy'));
  await dialog.getByRole('button', { name: 'Redeploy source' }).click();
  await expect.poll(() => (redeployBody as { changed?: { path: string }[] } | null)?.changed?.[0]?.path).toBe('index.js');
});
