import { expect, test } from '@playwright/test';
import { PROJECT } from './fixtures';
import { EXECUTION_ID } from './fixtures-workflows';
import { mockApi } from './mock-api';

const shot = (name: string) => ({ path: `e2e/.shots/${name}.png` });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('nephoscope.profile', 'env'));
});

test('shows the source with its step graph and selects lines from a node (D-10, CA-19, T-12)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/workflows/us-central1/order-flow`);
  // Monaco and the layout engine load on demand; allow for a cold start.
  await expect(page.getByRole('group', { name: 'Source of order-flow' }).locator('.view-lines')).toContainText('main:', {
    timeout: 30_000,
  });
  const graph = page.getByRole('group', { name: 'Workflow step graph' });
  await expect(graph.getByRole('button', { name: /Step validate, switch/ })).toBeVisible();
  await expect(graph.getByRole('button', { name: /Step notify, sys\.log/ })).toBeVisible();
  await page.screenshot(shot('workflow-source'));
  // A container's body is covered by its own steps; its label is the handle.
  await graph.getByRole('button', { name: /Step price, item in/ }).click({ position: { x: 24, y: 14 } });
  await expect(page.getByRole('group', { name: 'Source of order-flow' }).locator('.selected-text').first()).toBeVisible();
  expect(unmatched).toEqual([]);
});

test('shows a failed execution with its steps and path (D-11, CA-22)', async ({ page }) => {
  const unmatched = await mockApi(page);
  await page.goto(`/p/${PROJECT}/workflows/us-central1/order-flow/executions/${EXECUTION_ID}`);
  await expect(page.getByText('HTTP 502 from payments').first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Step entries' }).getByText('notify')).toBeVisible();
  await page.screenshot(shot('workflow-execution'));
  await page.getByRole('tab', { name: 'Graph' }).click();
  await expect(page.getByRole('button', { name: /Step charge, try with retry, failed/ })).toBeVisible();
  await page.screenshot(shot('workflow-execution-graph'));
  expect(unmatched).toEqual([]);
});

test('offers recent arguments and the equivalent command (CA-21)', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/workflows/us-central1/order-flow`);
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('group', { name: 'Execution argument' }).locator('.view-lines')).toContainText('"order"');
  await expect(sheet.getByText(/gcloud workflows run order-flow/)).toBeVisible();
  await page.screenshot(shot('workflow-execute'));
});
