#!/usr/bin/env node
/**
 * Deterministic design gates of SPEC-0002:
 *  - G6 / CA-03: no raw color literal in apps/web/src outside styles/tokens.css.
 *  - G4 / CA-34: no em dash in the web app's text.
 *  - T-09: AA contrast of every text and UI token pair, in both themes.
 * Exits with 1 when any check fails.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const webSrc = join(root, 'apps/web/src');
const tokensFile = join(webSrc, 'styles/tokens.css');
const failures = [];

// ---------------------------------------------------------------------------------------------
// G6 and G4: scan the sources.

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(tsx?|css|html)$/.test(entry.name)) yield path;
  }
}

const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(/;
const HEX = /(?<![\w&$-])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])/;
const EM_DASH = /—/;

const files = [...walk(webSrc), join(root, 'apps/web/index.html')];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const rel = relative(root, file).replaceAll('\\', '/');
  const isTokens = file === tokensFile;
  lines.forEach((line, i) => {
    if (!isTokens && (COLOR_FUNCTION.test(line) || HEX.test(line))) {
      failures.push(`G6 ${rel}:${i + 1} raw color literal: ${line.trim().slice(0, 120)}`);
    }
    if (EM_DASH.test(line)) failures.push(`G4 ${rel}:${i + 1} em dash: ${line.trim().slice(0, 120)}`);
  });
}

// ---------------------------------------------------------------------------------------------
// T-09: contrast of token pairs.

function themeBlock(css, selectorPattern) {
  const match = css.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Theme block ${selectorPattern} not found in tokens.css`);
  const tokens = {};
  for (const [, name, value] of match[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[name] = value.trim();
  return tokens;
}

/** oklch(L C H) to linear sRGB, clipped to the gamut. */
function oklchToLinearRgb(value) {
  const m = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+)?\)$/);
  if (!m) return null;
  const [l, c, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return rgb.map((v) => Math.min(1, Math.max(0, v)));
}

function luminance(value) {
  const rgb = oklchToLinearRgb(value);
  if (!rgb) throw new Error(`Unsupported color: ${value}`);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(fg, bg) {
  const [x, y] = [luminance(fg), luminance(bg)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT = 4.5;
const UI = 3;
const surfaces = ['film', 'sheet', 'panel', 'well'];
/** [foreground, backgrounds, minimum, what it is] */
const pairs = [
  ['ink', [...surfaces, 'hover', 'construct-tint'], TEXT, 'body text, selected rows'],
  ['ink-2', [...surfaces, 'hover', 'construct-tint'], TEXT, 'secondary text, the active index item'],
  ['ink-3', ['film', 'sheet', 'panel'], TEXT, 'meta text and help'],
  ['construct-ink', ['sheet', 'construct-tint'], TEXT, 'running state text'],
  ['redline-ink', ['sheet', 'panel', 'redline-tint'], TEXT, 'error text'],
  ['warn-ink', ['sheet', 'warn-tint'], TEXT, 'warning text'],
  ['ok-ink', ['sheet', 'ok-tint'], TEXT, 'success text'],
  ['commit-ink', ['commit', 'commit-hover', 'redline', 'redline-hover'], TEXT, 'commit and danger button labels'],
  ['ink-inverse', ['ink'], TEXT, 'inverse text (tooltips)'],
  ['rule-strong', ['sheet', 'film'], UI, 'control borders'],
  ['focus', ['sheet', 'film', 'panel'], UI, 'focus ring'],
  ['commit', ['sheet', 'film'], UI, 'commit control'],
  ['redline', ['sheet', 'film'], UI, 'error glyph, danger control'],
  ['warn', ['sheet'], UI, 'warning glyph'],
  ['ok', ['sheet'], UI, 'success glyph'],
  ['ink-3', ['sheet', 'hover'], UI, 'neutral glyphs'],
  ...['gray', 'blue', 'green', 'amber', 'red', 'violet'].map((t) => [`tag-${t}`, ['film'], UI, 'profile ribbon']),
];

const css = readFileSync(tokensFile, 'utf8');
const themes = {
  light: themeBlock(css, String.raw`:root,\s*\[data-theme=["']light["']\]`),
  dark: themeBlock(css, String.raw`\[data-theme=["']dark["']\]`),
};

const rows = [];
for (const [theme, tokens] of Object.entries(themes)) {
  for (const [fg, bgs, min, what] of pairs) {
    for (const bg of bgs) {
      if (!tokens[fg] || !tokens[bg]) {
        failures.push(`T-09 ${theme}: token --${tokens[fg] ? bg : fg} is missing`);
        continue;
      }
      const ratio = contrast(tokens[fg], tokens[bg]);
      const ok = ratio >= min;
      rows.push({ theme, pair: `${fg} on ${bg}`, ratio: ratio.toFixed(2), min, ok, what });
      if (!ok) failures.push(`T-09 ${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1 (${what})`);
    }
  }
}

if (process.argv.includes('--table')) {
  for (const r of rows)
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.theme.padEnd(5)} ${r.pair.padEnd(30)} ${r.ratio.padStart(5)}:1  min ${r.min}  ${r.what}`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  console.error(`\n${failures.length} design gate failure(s).`);
  process.exit(1);
}
console.log(`Design tokens: ${files.length} files free of raw colors and em dashes; ${rows.length} contrast pairs pass AA in both themes.`);
