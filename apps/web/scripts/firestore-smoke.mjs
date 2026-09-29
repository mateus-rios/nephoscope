import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

/**
 * Firestore end to end against the emulator (SPEC-0004 §9): a Nephoscope started with
 * FIRESTORE_EMULATOR_HOST and data seeded by the API. Usage:
 *   NEPHOSCOPE_URL=http://127.0.0.1:8082 node scripts/firestore-smoke.mjs
 * Screenshots go to e2e/.shots (git-ignored), or to OUT when set.
 */
const OUT = process.env.OUT ?? 'e2e/.shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.NEPHOSCOPE_URL ?? 'http://127.0.0.1:8082';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('dialog', (d) => {
  errors.push(`DIALOG: ${d.message()}`);
  d.dismiss();
});
await page.addInitScript(() => {
  try {
    sessionStorage.setItem('nephoscope.profile', 'env');
  } catch {}
});
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const step = async (name, fn) => {
  try {
    await fn();
    console.log('ok  ', name);
  } catch (e) {
    console.log('FAIL', name, e.message.split('\n')[0]);
    await shot(`fail-${name}`);
  }
};

await step('databases', async () => {
  await page.goto(`${BASE}/p/demo-project/firestore`);
  await page.getByRole('table', { name: 'Databases' }).getByText('(default)').waitFor();
  await shot('01-databases');
});
await step('panels', async () => {
  await page.goto(`${BASE}/p/demo-project/firestore/(default)?path=users/ana`);
  await page.getByRole('button', { name: 'Collapse address' }).waitFor();
  await shot('02-panels-doc');
});
await step('missing doc', async () => {
  await page.goto(`${BASE}/p/demo-project/firestore/(default)?path=orphans`);
  await page.getByText('No document').first().waitFor();
});
await step('xss text + reference', async () => {
  await page.goto(`${BASE}/p/demo-project/firestore/(default)?path=users/ana/orders/o1`);
  await page.getByText('<img src=x onerror=alert(1)>').waitFor();
  await page.getByRole('main').getByRole('button', { name: 'users/ana', exact: true }).last().click();
  await page.getByRole('button', { name: 'Collapse address' }).waitFor();
});
await step('edit with diff', async () => {
  await page.goto(`${BASE}/p/demo-project/firestore/(default)?path=users/bruno`);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog').locator('.view-lines').first();
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.type(`,\n"visits${Date.now()}": {"$increment": 1}`);
  await page.getByRole('button', { name: 'Review changes' }).click();
  await page.getByText('1 change').waitFor();
  await page.getByRole('dialog').locator('.monaco-diff-editor').waitFor();
  await page.waitForTimeout(500);
  await shot('03-review');
  await page.getByRole('button', { name: 'Save document' }).click();
  await page.getByText('Saved bruno').waitFor();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page
    .getByText(/^visits\d+/)
    .first()
    .waitFor();
});
await step('table view', async () => {
  await page.goto(`${BASE}/p/demo-project/firestore/(default)?path=users&view=table`);
  await page.getByRole('table', { name: 'Documents in users' }).getByText('carla').first().waitFor();
  await shot('04-table');
});
await step('query', async () => {
  await page.goto(`${BASE}/p/demo-project/firestore/(default)?tab=query`);
  await page.getByLabel('Collection path').fill('users');
  await page.getByRole('button', { name: 'Condition' }).first().click();
  await page.getByLabel('Field').first().fill('age');
  await page.getByLabel('Value').first().fill('25');
  await page.getByRole('button', { name: 'Run query' }).click();
  await page.getByRole('table', { name: 'Query results' }).getByText('users/bruno').waitFor();
  await shot('05-query');
  await page.getByRole('button', { name: 'Run aggregation' }).click();
  await page.getByText('count()').waitFor();
});
await step('live', async () => {
  await page.getByRole('button', { name: 'Live' }).click();
  await page.getByText(/Live: the first snapshot/).waitFor();
  await fetch(`${BASE}/api/projects/demo-project/firestore/databases/%28default%29/document?path=users/bruno`, {
    method: 'PUT',
    headers: { 'x-nephoscope-client': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { mood: { t: 'string', v: 'live!' } }, mask: ['mood'], updateTime: null }),
  });
  await page.getByText('live!').waitFor();
  await shot('06-live');
  await page.getByRole('button', { name: 'Stop live' }).click();
});
await step('datastore-like admin in emulator', async () => {
  await page.goto(`${BASE}/p/demo-project/firestore/(default)?tab=indexes`);
  await page.getByText('Indexes is not available in the emulator').waitFor();
});
// Accessibility of the Firestore screens (SPEC-0002 G5), in both themes.
for (const theme of ['light', 'dark']) {
  for (const [name, url] of [
    ['databases', '/p/demo-project/firestore'],
    ['panels', '/p/demo-project/firestore/(default)?path=users/ana'],
    ['table', '/p/demo-project/firestore/(default)?path=users&view=table'],
    ['query', '/p/demo-project/firestore/(default)?tab=query'],
  ]) {
    await step(`axe ${theme} ${name}`, async () => {
      await page.addInitScript((t) => {
        try {
          localStorage.setItem('nephoscope.theme', t);
        } catch {}
      }, theme);
      await page.goto(BASE + url);
      await page.getByRole('heading', { level: 1 }).first().waitFor();
      await page.waitForTimeout(800);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const summary = (v) =>
        `${v.id}: ${v.nodes
          .slice(0, 3)
          .map((n) => `${n.target.join(' ')} ${(n.failureSummary ?? '').split('\n').slice(1).join(' ')}`)
          .join(' | ')}`;
      if (r.violations.length) throw new Error(r.violations.map(summary).join('; '));
    });
  }
}
// Failed requests are expected with an emulators-only profile (project lookups need a key).
const real = errors.filter((e) => !e.includes('Failed to load resource'));
console.log(real.length ? `ERRORS:\n${real.join('\n')}` : 'no page errors');
if (real.length) process.exitCode = 1;
await browser.close();
