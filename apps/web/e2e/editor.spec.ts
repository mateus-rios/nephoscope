import { expect, test } from '@playwright/test';
import { PROJECT } from './fixtures';
import { mockApi } from './mock-api';

/**
 * Regression test for the Monaco and monaco-yaml pairing: monaco-yaml 5 needs the worker API of
 * Monaco 0.52, and a mismatch fails quietly (validation, completion and hover just stop).
 */
test('validates workflow source against the schema in the YAML worker (SPEC-0003 CA-20)', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || /Could not create web worker|Missing requestHandler/.test(m.text()))
      problems.push(`${m.type()}: ${m.text().slice(0, 200)}`);
  });
  await page.addInitScript(() => sessionStorage.setItem('nephoscope.profile', 'env'));
  await mockApi(page);
  await page.goto(`/p/${PROJECT}/workflows/us-central1/order-flow`);
  const editor = page.getByRole('group', { name: 'Source of order-flow' });
  await expect(editor.locator('.view-lines')).toContainText('main:', { timeout: 30_000 });
  await editor.locator('.view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n    - bad:\n        colll: sys.log\n');
  // The schema rejects the unknown key "colll".
  await expect(editor.locator('.squiggly-error, .squiggly-warning').first()).toBeVisible({ timeout: 15_000 });
  expect(problems).toEqual([]);
});
