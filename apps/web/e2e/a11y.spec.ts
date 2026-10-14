import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockApi } from './mock-api';
import { PAGES } from './pages';

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => {
        sessionStorage.setItem('nephoscope.profile', 'env');
        localStorage.setItem('nephoscope.theme', t);
      }, theme);
    });

    for (const [name, url, heading] of PAGES) {
      test(`${name} has no axe violations`, async ({ page }) => {
        await mockApi(page);
        await page.goto(url);
        await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(heading);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        // Charts and editors settle after the first paint.
        await page.waitForLoadState('networkidle');
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        const summary = result.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')}: ${n.failureSummary?.split('\n').slice(1).join(' ')}`),
        }));
        expect(summary).toEqual([]);
      });
    }
  });
}
