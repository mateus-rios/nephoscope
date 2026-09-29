import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PROJECT } from './fixtures';
import { EXECUTION_ID } from './fixtures-workflows';
import { mockApi } from './mock-api';

/** Every M1 screen, in both themes, against WCAG 2.2 AA (SPEC-0002 G1, SPEC-0001 NFR accessibility). */
const PAGES: [string, string, string][] = [
  ['run services', `/p/${PROJECT}/run`, 'Cloud Run'],
  ['run jobs', `/p/${PROJECT}/run?tab=jobs`, 'Cloud Run'],
  ['run service', `/p/${PROJECT}/run/services/us-central1/api`, 'api'],
  ['run service revisions', `/p/${PROJECT}/run/services/us-central1/api?tab=revisions`, 'api'],
  ['run service triggers', `/p/${PROJECT}/run/services/us-central1/api?tab=triggers`, 'api'],
  ['run job', `/p/${PROJECT}/run/jobs/us-central1/nightly-etl`, 'nightly-etl'],
  ['run execution', `/p/${PROJECT}/run/jobs/us-central1/nightly-etl/executions/nightly-etl-9zzq1`, 'nightly-etl-9zzq1'],
  ['functions', `/p/${PROJECT}/functions`, 'Cloud Run functions'],
  ['function', `/p/${PROJECT}/functions/us-central1/hello`, 'hello'],
  ['workflows', `/p/${PROJECT}/workflows`, 'Workflows'],
  ['workflow', `/p/${PROJECT}/workflows/us-central1/order-flow`, 'order-flow'],
  ['workflow execution', `/p/${PROJECT}/workflows/us-central1/order-flow/executions/${EXECUTION_ID}`, EXECUTION_ID],
  ['scheduler', `/p/${PROJECT}/scheduler`, 'Cloud Scheduler'],
  ['tasks', `/p/${PROJECT}/tasks`, 'Cloud Tasks'],
  ['queue', `/p/${PROJECT}/tasks/us-central1/emails`, 'emails'],
  ['eventarc', `/p/${PROJECT}/eventarc`, 'Eventarc'],
];

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
