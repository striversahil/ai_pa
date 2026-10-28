#!/usr/bin/env node
// theme-contrast.mjs — the gate the theme system never had.
//
// There is no test suite in this repo, so preset regressions used to be found
// by eye ("the light theme doesn't work"). This script parses the preset blocks
// in src/app/globals.css and asserts WCAG contrast for the ink/surface pairs
// every screen depends on — plus the light-mode accent remap, which is what
// used to make `text-emerald-400` invisible on white.
//
//   node scripts/theme-contrast.mjs
//
// Exit code 1 on any failure, so it can gate a build.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');

// ── tiny CSS reader ─────────────────────────────────────────────────────────
/** All `html[data-app-theme="x"], ...` blocks → [{ selectors, vars }]. */
function readBlocks(css) {
  const blocks = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selectors = m[1].trim();
    if (!selectors.includes('data-app-theme')) continue;
    const vars = {};
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const key = decl.slice(0, i).trim();
      const value = decl.slice(i + 1).trim();
      if (key.startsWith('--')) vars[key] = value;
    }
    blocks.push({ selectors, vars });
  }
  return blocks;
}

const ids = [...CSS.matchAll(/html\[data-app-theme="([a-z]+)"\]/g)].map((m) => m[1]);
const themes = [...new Set(ids)];

const blocks = readBlocks(CSS);
const shared = blocks.filter((b) => b.selectors.includes(','));
const perTheme = new Map();
for (const b of blocks) {
  const m = /html\[data-app-theme="([a-z]+)"\]/.exec(b.selectors);
  if (!m) continue;
  perTheme.set(m[1], { ...(perTheme.get(m[1]) ?? {}), ...b.vars });
}
const sharedVars = shared.reduce((acc, b) => ({ ...acc, ...b.vars }), {});

// Base values that presets inherit (theme + :root/.dark fallbacks).
function baseVars(css) {
  const out = {};
  for (const sel of [':root', '.dark']) {
    const re = new RegExp(`(?:^|\\n)${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g');
    let m;
    while ((m = re.exec(css))) {
      for (const decl of m[1].split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const key = decl.slice(0, i).trim();
        if (key.startsWith('--')) out[key] ??= decl.slice(i + 1).trim();
      }
    }
  }
  return out;
}
const base = baseVars(CSS);
const varsFor = (theme) => ({ ...base, ...sharedVars, ...(perTheme.get(theme) ?? {}) });

// ── colour + contrast ──────────────────────────────────────────────────────
function parseColor(value) {
  if (!value) return null;
  const v = value.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p));
    return [parts[0], parts[1], parts[2]];
  }
  return null; // color-mix(), var(), etc. — not a literal, skip
}

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg, bg) {
  const a = luminance(fg) + 0.05;
  const b = luminance(bg) + 0.05;
  return a > b ? a / b : b / a;
}

// ── checks ─────────────────────────────────────────────────────────────────
const INK = [
  ['--text-primary', 7.0],
  ['--text-secondary', 4.5],
  ['--text-tertiary', 3.0],
];
// The nav rail is inked with the same --text-* tokens, so it is checked too —
// a preset that pairs a dark rail with light-preset ink fails here.
const SURFACES = ['--bg-app', '--bg-card', '--bg-sidebar'];

// Accent steps the UI actually puts on a card as text/icon.
const LIGHT_ACCENT_TEXT = [
  'emerald', 'green', 'teal', 'cyan', 'sky', 'blue', 'violet', 'purple',
  'fuchsia', 'pink', 'rose', 'red', 'orange', 'amber', 'yellow', 'lime',
];

let failures = 0;
const rows = [];

for (const theme of themes) {
  const vars = varsFor(theme);
  const isLight = String(vars['--bg-app'] ?? '').match(/^#(f|e|d)/i);

  for (const [inkKey, min] of INK) {
    for (const surface of SURFACES) {
      const fg = parseColor(vars[inkKey]);
      const bg = parseColor(vars[surface]);
      if (!fg || !bg) continue;
      const ratio = contrast(fg, bg);
      const ok = ratio >= min;
      if (!ok) failures++;
      rows.push({ theme, pair: `${inkKey} on ${surface}`, ratio, min, ok });
    }
  }

  // Light presets remap the dark-tuned accent steps — verify they land.
  if (isLight) {
    for (const family of LIGHT_ACCENT_TEXT) {
      for (const step of [300, 400]) {
        const fg = parseColor(vars[`--color-${family}-${step}`]);
        const bg = parseColor(vars['--bg-card']);
        if (!fg || !bg) continue;
        const ratio = contrast(fg, bg);
        const ok = ratio >= 4.5;
        if (!ok) failures++;
        rows.push({ theme, pair: `text-${family}-${step} on card`, ratio, min: 4.5, ok });
      }
    }
  }
}

// ── report ─────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const fmt = (n) => n.toFixed(2);

if (process.argv.includes('--verbose')) {
  console.log(`${pad('theme', 10)}${pad('pair', 34)}${pad('ratio', 8)}min  ok`);
  for (const r of rows) {
    console.log(
      `${pad(r.theme, 10)}${pad(r.pair, 34)}${pad(fmt(r.ratio), 8)}${pad(r.min, 5)}${r.ok ? '✓' : '✗'}`,
    );
  }
  console.log('');
}

// Per-theme summary (min ratio per surface pair) so the table stays readable.
for (const theme of themes) {
  const mine = rows.filter((r) => r.theme === theme);
  const worst = mine.reduce((acc, r) => (r.ratio / r.min < acc.ratio / acc.min ? r : acc), mine[0]);
  console.log(
    `${pad(theme, 10)} ${String(mine.length).padStart(3)} checks · worst ${fmt(worst.ratio)}:1 (${worst.pair})`,
  );
}

if (failures) {
  console.error(`\n✗ ${failures} contrast check(s) failed.`);
  process.exit(1);
}
console.log(`\n✓ all ${rows.length} contrast checks passed across ${themes.length} presets.`);
