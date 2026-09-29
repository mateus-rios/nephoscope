import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

/**
 * Pub/Sub end to end against the emulator (SPEC-0006 T-01 to T-04), through the UI. Usage:
 *   NEPHOSCOPE_URL=http://127.0.0.1:8082 node scripts/pubsub-smoke.mjs
 * Screenshots go to e2e/.shots (git-ignored), or to OUT when set.
 * Nephoscope must run with PUBSUB_EMULATOR_HOST set.
 */
const OUT = process.env.OUT ?? 'e2e/.shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.NEPHOSCOPE_URL ?? 'http://127.0.0.1:8082';
const PROJECT = `smoke-${Date.now()}`;
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
await page.addInitScript(() => {
  try {
    sessionStorage.setItem('nephoscope.profile', 'env');
  } catch {}
});
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
let failed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log('ok  ', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, e.message.split('\n')[0]);
    await shot(`fail-${name.replaceAll(' ', '-')}`);
  }
};
const api = (path, body) =>
  fetch(`${BASE}/api/projects/${PROJECT}/pubsub/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-nephoscope-client': '1', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

await step('create topic', async () => {
  await page.goto(`${BASE}/p/${PROJECT}/pubsub`);
  await page.getByRole('button', { name: 'Create topic' }).first().click();
  await page.getByLabel('Topic id').fill('orders');
  await page.getByRole('dialog').getByRole('button', { name: 'Create topic' }).click();
  await page.getByRole('heading', { name: 'orders', level: 1 }).waitFor();
});
await step('create subscription', async () => {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Create subscription' }).click();
  await page.getByLabel('Subscription id').fill('orders-pull');
  await page.getByRole('dialog').getByRole('button', { name: 'Create subscription' }).click();
  await page.getByRole('heading', { name: 'orders-pull', level: 1 }).waitFor();
  await shot('pubsub-01-subscription');
});
await step('publish from the dialog', async () => {
  await page.goto(`${BASE}/p/${PROJECT}/pubsub/topics/orders`);
  await page.getByRole('button', { name: 'Publish message' }).click();
  await page.getByLabel('Text payload').fill('<script>alert(1)</script> order 1');
  await page.getByRole('button', { name: 'Add attribute' }).click();
  await page.getByLabel('Attribute 1').fill('source');
  await page.getByLabel('Value 1').fill('smoke');
  await page.getByRole('dialog').getByRole('button', { name: 'Publish message' }).click();
  await page.getByText('Published 1 message').waitFor();
});
await step('peek shows the message as text and gives it back', async () => {
  await page.goto(`${BASE}/p/${PROJECT}/pubsub/subscriptions/orders-pull?tab=messages`);
  await page.getByRole('button', { name: 'I understand' }).click();
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Peek messages' }).click();
    if (
      await page
        .getByText('<script>alert(1)</script> order 1')
        .first()
        .isVisible({ timeout: 6000 })
        .catch(() => false)
    )
      break;
  }
  await page.getByText('<script>alert(1)</script> order 1').first().waitFor();
  await page.getByRole('button', { name: 'Show message' }).first().click();
  await page.getByText('smoke').first().waitFor();
  await shot('pubsub-02-peek');
});
await step('pull and acknowledge needs the typed count', async () => {
  await page.getByRole('button', { name: 'Pull and acknowledge' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('10');
  await dialog.getByRole('button', { name: 'Acknowledge up to 10 messages' }).click();
  await page.getByText(/Acknowledged \d message/).waitFor();
});
await step('watch a topic live', async () => {
  await page.goto(`${BASE}/p/${PROJECT}/pubsub/topics/orders?tab=watch`);
  await page.getByRole('button', { name: 'Start watching' }).click();
  await page.getByText(/Watching through nephoscope-watch-/).waitFor();
  await api('topics/orders/publish', { messages: [{ data: Buffer.from('live one').toString('base64'), attributes: { k: 'v' } }] });
  await page.getByText('live one').first().waitFor({ timeout: 10_000 });
  await shot('pubsub-03-watch');
  await page.getByRole('button', { name: 'Stop watching' }).click();
});
await step('the watch subscription is gone after stopping', async () => {
  for (let i = 0; i < 20; i++) {
    const subs = await (await api('topics/orders/subscriptions')).json();
    if (subs.length === 1) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('nephoscope-watch subscription still exists');
});
await step('snapshot, acknowledge, seek back (T-08)', async () => {
  await api('topics/orders/publish', { messages: [{ data: Buffer.from('replay me').toString('base64'), attributes: {} }] });
  await page.goto(`${BASE}/p/${PROJECT}/pubsub/subscriptions/orders-pull?tab=seek`);
  await page.getByLabel('New snapshot id').fill('before-ack');
  await page.getByRole('button', { name: 'Take snapshot' }).click();
  await page.getByText('Snapshot before-ack created').waitFor();
  let acked = 0;
  for (let i = 0; i < 5 && acked === 0; i++)
    acked = (await (await api('subscriptions/orders-pull/pull-ack', { max: 10, confirm: '10' })).json()).length;
  if (acked === 0) throw new Error('nothing to acknowledge');
  await page.getByRole('button', { name: 'Seek to it' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('orders-pull');
  await dialog.getByRole('button', { name: 'Seek' }).click();
  await page.getByText('Seek done').waitFor();
  let back = [];
  for (let i = 0; i < 5 && back.length === 0; i++) back = await (await api('subscriptions/orders-pull/peek', { max: 10 })).json();
  if (!back.some((m) => m.text === 'replay me')) throw new Error('the message did not come back');
});
await step('create a schema and validate a message', async () => {
  await page.goto(`${BASE}/p/${PROJECT}/pubsub?tab=schemas`);
  await page.getByRole('button', { name: 'Create schema' }).first().click();
  await page.getByLabel('Schema id').fill('order-schema');
  await page.getByRole('button', { name: 'Validate definition' }).click();
  await page.getByText('Valid', { exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Create schema' }).click();
  await page.getByRole('heading', { name: 'order-schema', level: 1 }).waitFor();
  await page.getByRole('tab', { name: 'Validate a message' }).click();
  await page.getByRole('button', { name: 'Validate message' }).click();
  await page.getByText('Valid', { exact: true }).waitFor();
  await page.getByLabel('Message as JSON').fill('{"id": 5}');
  await page.getByRole('button', { name: 'Validate message' }).click();
  await page.getByText('Valid', { exact: true }).waitFor({ state: 'hidden' });
  await shot('pubsub-04-schema');
});
for (const theme of ['light', 'dark']) {
  for (const [name, url] of [
    ['list', `/p/${PROJECT}/pubsub`],
    ['topic', `/p/${PROJECT}/pubsub/topics/orders`],
    ['subscription', `/p/${PROJECT}/pubsub/subscriptions/orders-pull?tab=messages`],
  ]) {
    await step(`axe ${theme} ${name}`, async () => {
      await page.addInitScript((t) => {
        try {
          localStorage.setItem('nephoscope.theme', t);
        } catch {}
      }, theme);
      await page.goto(BASE + url);
      await page.getByRole('heading', { level: 1 }).first().waitFor();
      await page.waitForTimeout(600);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const summary = (v) =>
        `${v.id}: ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(' | ')}`;
      if (r.violations.length) throw new Error(r.violations.map(summary).join('; '));
    });
  }
}
// Failed requests are expected with an emulators-only profile (project lookups need a key).
const real = errors.filter((e) => !e.includes('Failed to load resource'));
console.log(real.length ? `ERRORS:\n${real.join('\n')}` : 'no page errors');
if (real.length || failed) process.exitCode = 1;
await browser.close();
