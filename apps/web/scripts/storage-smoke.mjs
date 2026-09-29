import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

/**
 * Cloud Storage end to end against fake-gcs-server (SPEC-0006 T-11 and T-13 in part), through the
 * UI. Usage:
 *   NEPHOSCOPE_URL=http://127.0.0.1:8082 node scripts/storage-smoke.mjs
 * Screenshots go to e2e/.shots (git-ignored), or to OUT when set.
 * Nephoscope must run with STORAGE_EMULATOR_HOST set.
 */
const OUT = process.env.OUT ?? 'e2e/.shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.NEPHOSCOPE_URL ?? 'http://127.0.0.1:8082';
const PROJECT = 'storage-smoke';
const BUCKET = `smoke-${Date.now()}`;
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
context.setDefaultTimeout(10_000);
const page = await context.newPage();
const errors = [];
let dialogs = 0;
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
// Stored HTML or SVG must never run: any alert() would show up here.
page.on('dialog', (d) => {
  dialogs++;
  void d.dismiss();
});
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
const api = (path) =>
  fetch(`${BASE}/api/projects/${PROJECT}/storage/${path}`, { headers: { 'x-nephoscope-client': '1' } }).then((r) => r.json());

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
);
const files = [
  { name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('hello from nephoscope') },
  { name: 'data.json', mimeType: 'application/json', buffer: Buffer.from('{"order": 7, "items": ["a", "b"]}') },
  { name: 'table.csv', mimeType: 'text/csv', buffer: Buffer.from('id,name\n1,"Ana, B."\n2,Caio\n') },
  {
    name: 'evil.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>'),
  },
  { name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<h1>hi</h1><script>alert(3)</script>') },
  { name: 'pixel.png', mimeType: 'image/png', buffer: PNG },
  { name: 'doc.pdf', mimeType: 'application/pdf', buffer: PDF },
];
const openObject = async (name) => {
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByRole('row').filter({ hasText: name }).first().getByText(name, { exact: true }).click();
  await page.getByRole('dialog').getByRole('heading', { name, exact: true }).waitFor();
};

await step('create bucket', async () => {
  await page.goto(`${BASE}/p/${PROJECT}/storage`);
  // A cold server can answer before the page hydrates; retry until the sheet opens.
  await page.getByRole('heading', { name: 'Cloud Storage', level: 1 }).waitFor();
  for (let i = 0; i < 5 && !(await page.getByRole('dialog').isVisible()); i++) {
    await page.getByRole('button', { name: 'Create bucket' }).first().click();
    await page
      .getByRole('dialog')
      .waitFor({ timeout: 2000 })
      .catch(() => {});
  }
  await page.getByRole('dialog').getByRole('textbox', { name: /^Name/ }).fill(BUCKET);
  await page.getByRole('dialog').getByRole('button', { name: 'Create bucket' }).click();
  await page.getByRole('heading', { name: BUCKET, level: 1 }).waitFor();
  await page.getByText('This bucket is empty').waitFor();
});
await step('upload seven files with progress (T-11)', async () => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Upload files' }).click()]);
  await chooser.setFiles(files);
  await page.getByText('7 of 7 uploaded').waitFor({ timeout: 20_000 });
  await page.getByRole('row').filter({ hasText: 'pixel.png' }).waitFor();
  await shot('storage-01-uploaded');
});
await step('overwriting asks first', async () => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Upload files' }).click()]);
  await chooser.setFiles([{ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('hello again') }]);
  await page.getByText('1 object already exists.').waitFor();
  await page.getByRole('button', { name: 'Overwrite 1 object' }).click();
  await page.getByText('8 of 8 uploaded').waitFor();
});
await step('text preview', async () => {
  await openObject('hello.txt');
  await page.getByRole('dialog').getByText('hello again').waitFor();
  await shot('storage-02-text');
});
await step('SVG and HTML only as source (T-13, CA-73)', async () => {
  await openObject('evil.svg');
  await page.getByRole('dialog').getByText('<script>alert(2)</script>', { exact: false }).waitFor();
  await page.getByRole('dialog').getByText('shown as source, never rendered').waitFor();
  await openObject('page.html');
  await page.getByRole('dialog').getByText('<script>alert(3)</script>', { exact: false }).waitFor();
  if (dialogs) throw new Error(`${dialogs} script dialogs ran`);
});
await step('image preview', async () => {
  await openObject('pixel.png');
  const img = page.getByRole('dialog').getByRole('img', { name: /Preview of pixel.png/ });
  await img.waitFor();
  await page.waitForFunction(() => {
    const i = document.querySelector('img[alt="Preview of pixel.png"]');
    return i instanceof HTMLImageElement && i.complete && i.naturalWidth === 1;
  });
});
await step('CSV as a table', async () => {
  await openObject('table.csv');
  await page.getByRole('dialog').getByRole('columnheader', { name: 'name' }).waitFor();
  await page.getByRole('dialog').getByRole('cell', { name: 'Ana, B.' }).waitFor();
});
await step('JSON formatted', async () => {
  await openObject('data.json');
  await page.getByRole('dialog').getByText('order', { exact: false }).first().waitFor();
});
await step('PDF in a frame', async () => {
  await openObject('doc.pdf');
  await page.getByRole('dialog').locator('iframe[title="Preview of doc.pdf"]').waitFor();
  await shot('storage-03-pdf');
});
await step('download streams an attachment', async () => {
  await openObject('hello.txt');
  const download = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Download' }).click();
  const d = await download;
  if (d.suggestedFilename() !== 'hello.txt') throw new Error(`Downloaded ${d.suggestedFilename()}`);
});
await step('edit metadata', async () => {
  await openObject('hello.txt');
  await page.getByRole('dialog').getByLabel('Cache control').fill('no-store');
  await page.getByRole('dialog').getByRole('button', { name: 'Save metadata' }).click();
  await page.getByText('Saved hello.txt').waitFor();
  const o = await api(`buckets/${BUCKET}/object?name=hello.txt`);
  if (o.cacheControl !== 'no-store') throw new Error(`cacheControl is ${o.cacheControl}`);
});
await step('rename', async () => {
  await openObject('hello.txt');
  await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Rename hello.txt' });
  await d.getByLabel('Object name').fill('greeting.txt');
  await d.getByRole('button', { name: 'Rename object' }).click();
  await page.getByText('Renamed to greeting.txt').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('row').filter({ hasText: 'greeting.txt' }).waitFor();
});
await step('create folder and browse into it', async () => {
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByRole('button', { name: 'Create folder' }).click();
  await page.getByLabel('Folder name').fill('docs');
  await page.getByRole('dialog').getByRole('button', { name: 'Create folder' }).click();
  await page.getByRole('row').filter({ hasText: 'docs/' }).getByText('docs/').click();
  await page.getByText('This folder is empty').waitFor();
  await page.getByRole('navigation', { name: 'Folder' }).getByRole('button', { name: BUCKET }).click();
});
await step('delete two objects with the typed count', async () => {
  for (const n of ['evil.svg', 'page.html']) await page.getByRole('row').filter({ hasText: n }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Delete 2 objects' }).click();
  await page.getByLabel('Type 2 to confirm').fill('2');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete 2 objects' }).click();
  await page.getByText('Deleted 2 objects').waitFor();
  await page.getByRole('row').filter({ hasText: 'evil.svg' }).waitFor({ state: 'detached' });
});
await step('lifecycle rule and CORS (T-16)', async () => {
  await page.goto(`${BASE}/p/${PROJECT}/storage/${BUCKET}?tab=configuration`);
  await page.getByLabel('Age (days)').fill('30');
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Delete when 30 days after creation' }).waitFor();
  await page.getByRole('group', { name: 'CORS rules as JSON' }).locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('x');
  await page.getByText('Not JSON').waitFor();
  await page.keyboard.press('Control+A');
  // Pasted, not typed: Monaco would close brackets and quotes itself.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await page.evaluate(() => navigator.clipboard.writeText('[{"origin": ["https://example.com"], "method": ["GET"]}]'));
  await page.keyboard.press('Control+V');
  await page.getByText('Not JSON').waitFor({ state: 'detached' });
  // fake-gcs-server accepts but does not keep lifecycle rules or CORS, so the request is checked.
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith(`/buckets/${BUCKET}`)),
    page.getByRole('button', { name: 'Save settings' }).click(),
  ]);
  await page.getByText(`Saved ${BUCKET}`).waitFor();
  const b = request.postDataJSON();
  if (b.lifecycle?.[0]?.condition?.age !== 30) throw new Error(`lifecycle ${JSON.stringify(b.lifecycle)}`);
  if (b.cors?.[0]?.origin?.[0] !== 'https://example.com') throw new Error(`cors ${JSON.stringify(b.cors)}`);
  await shot('storage-04-configuration');
});
for (const theme of ['light', 'dark']) {
  for (const [name, url, open] of [
    ['list', `/p/${PROJECT}/storage`],
    ['objects', `/p/${PROJECT}/storage/${BUCKET}`],
    ['object', `/p/${PROJECT}/storage/${BUCKET}`, 'table.csv'],
    ['configuration', `/p/${PROJECT}/storage/${BUCKET}?tab=configuration`],
  ]) {
    await step(`axe ${theme} ${name}`, async () => {
      await page.addInitScript((t) => {
        try {
          localStorage.setItem('nephoscope.theme', t);
        } catch {}
      }, theme);
      await page.goto(BASE + url);
      await page.getByRole('heading', { level: 1 }).first().waitFor();
      if (open) await openObject(open);
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
await step('delete the bucket with its objects (D-10)', async () => {
  await page.goto(`${BASE}/p/${PROJECT}/storage/${BUCKET}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete bucket' }).click();
  const n = (await api(`buckets/${BUCKET}/count`)).count;
  await page.getByLabel(`Type ${BUCKET} to confirm`).fill(BUCKET);
  await page.getByLabel(`Type ${n} to confirm the objects`).fill(String(n));
  await page.getByRole('button', { name: `Delete bucket and ${n} objects` }).click();
  await page.getByRole('heading', { name: 'Cloud Storage', level: 1 }).waitFor();
  for (let i = 0; i < 40; i++) {
    const { items } = await api('buckets');
    if (!items.some((b) => b.name === BUCKET)) return;
    await page.waitForTimeout(250);
  }
  throw new Error('The bucket still exists');
});
// Failed requests are expected with an emulators-only profile (project lookups need a key).
const real = errors.filter((e) => !e.includes('Failed to load resource'));
console.log(real.length ? `ERRORS:\n${real.join('\n')}` : 'no page errors');
if (real.length || failed || dialogs) process.exitCode = 1;
await browser.close();
