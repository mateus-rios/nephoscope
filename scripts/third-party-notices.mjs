// Third-party notices (SPEC-0001 D-28): every production dependency with its license text and
// NOTICE, for the image and for the web app, whose minified bundle drops license headers.
// Usage: pnpm notices (or node scripts/third-party-notices.mjs)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputs = [join(root, 'THIRD_PARTY_NOTICES.txt'), join(root, 'apps/web/public/third-party-notices.txt')];
const RULE = '='.repeat(78);

/** License-like files at a package root: LICENSE, LICENCE, COPYING, NOTICE, ThirdPartyNotices. */
const LEGAL = /^(licen[cs]e|copying|notice|third[-_]?party[-_]?notices?)(\.(md|txt|markdown))?$/i;
const LICENSE_FILE = /^licen[cs]e(\.(md|txt))?$/i;

function pnpmLicenses() {
  const args = ['licenses', 'list', '--prod', '--json'];
  const opts = { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  // Started by pnpm, its own script runs under Node directly: no shell, which Windows would need for pnpm.cmd.
  const script = process.env.npm_execpath;
  if (script && /\.(c?js|mjs)$/.test(script)) return execFileSync(process.execPath, [script, ...args], opts);
  return execFileSync('pnpm', args, opts);
}

const entries = [];
for (const [license, packages] of Object.entries(JSON.parse(pnpmLicenses()))) {
  for (const pkg of packages) {
    if (pkg.name.startsWith('@nephoscope/')) continue;
    pkg.versions.forEach((version, i) => {
      entries.push({
        name: pkg.name,
        version,
        license,
        dir: pkg.paths?.[i] ?? pkg.paths?.[0],
        homepage: pkg.homepage ?? null,
        author: pkg.author ?? null,
      });
    });
  }
}
entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd();

/**
 * Standard texts for packages that ship no license file, taken from another package with the
 * same license in the tree, so nothing is retyped. Copyright lines name the package's author.
 */
const templates = { 'Apache-2.0': read(join(root, 'LICENSE')) };
for (const e of entries) {
  if (templates[e.license] || e.license.includes(' ') || !e.dir || !existsSync(e.dir)) continue;
  const file = readdirSync(e.dir).find((f) => LICENSE_FILE.test(f));
  if (!file) continue;
  const text = read(join(e.dir, file));
  if (/Permission (is hereby granted|to use, copy, modify)/.test(text)) templates[e.license] = text;
}

function standardText(license, author) {
  return license
    .split(/\s+(?:AND|OR)\s+/)
    .map((id) => id.replace(/[()]/g, ''))
    .map((id) => {
      const t = templates[id];
      if (!t) return `(No standard text available for ${id}.)`;
      if (id === 'Apache-2.0') return `--- Apache License 2.0 (standard text) ---\n${t}`;
      const copyright = `Copyright (c) ${author ?? 'the package authors'}`;
      // Only the notice lines ("Copyright (c) ..."), never the body's "the above copyright notice".
      return `--- ${id} License (standard text) ---\n${t.replace(/^\s*Copyright\b.*$/gm, copyright)}`;
    })
    .join('\n\n');
}

const seen = new Set();
const sections = [];
let filled = 0;
for (const e of entries) {
  const key = `${e.name}@${e.version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const files =
    e.dir && existsSync(e.dir)
      ? readdirSync(e.dir)
          .filter((f) => LEGAL.test(f))
          .sort()
      : [];
  let texts = files.map((f) => `--- ${f} ---\n${read(join(e.dir, f))}`).join('\n\n');
  if (!files.some((f) => LICENSE_FILE.test(f) || /^copying/i.test(f))) {
    filled++;
    texts = `(The package ships no license file; the standard text of its declared license follows.)\n\n${standardText(e.license, e.author)}${texts ? `\n\n${texts}` : ''}`;
  }
  const note =
    e.name === 'elkjs'
      ? '\nUsed under the Eclipse Public License 2.0 (EPL-2.0), one of its two licenses. Source: https://github.com/kieler/elkjs'
      : '';
  sections.push(`${key}\nLicense: ${e.license}${e.homepage ? `\nHomepage: ${e.homepage}` : ''}${note}\n\n${texts}`);
}

const header = `Nephoscope third-party notices

Nephoscope is licensed under the Apache License, Version 2.0 (see LICENSE and NOTICE).
It includes the following third-party software, each under its own license. The texts
below are copied from each package as published.

${sections.length} packages.
`;
const body = `${header}\n${RULE}\n\n${sections.join(`\n\n${RULE}\n\n`)}\n`;
for (const out of outputs) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body);
}
console.log(`Third-party notices: ${sections.length} packages (${filled} given the standard text of their license).`);
