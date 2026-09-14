// compile-kyp.mjs — DEPRECATED: derived kyp_taxonomy.json / kyp_slots.json are
// no longer used. The intake runner grounds directly on
// data/know_your_product_v2.json in two stages (slim category routing, then
// per-category detail), so there is nothing to compile.
// This script now just validates the v2 file and reports prompt sizes.
// Usage: node scripts/compile-kyp.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'data', 'know_your_product_v2.json');

const raw = JSON.parse(readFileSync(src, 'utf8'));
const cats = raw.categories ?? [];
let total = 0;
for (const c of cats) {
  total += (c.items ?? []).length;
  const full = JSON.stringify(c).length;
  console.log(`${c.category}: ${(c.items ?? []).length} items (~${Math.round(full / 4)} stage-B tokens)`);
}
const slim = cats.map((c) => `${c.category}: ${(c.items ?? []).map((i) => i.item_name).join(', ')}`).join('\n');
console.log(`categories: ${cats.length}, items: ${total}`);
console.log(`stage-A router list: ${slim.length} chars (~${Math.round(slim.length / 4)} tokens)`);
console.log('v2 OK — no derived files needed.');
