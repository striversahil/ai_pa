#!/usr/bin/env node
// gen-district-migration.mjs — build migrations/0144_customer_district.sql from
// client_district_wise.json (the founder's district-segregated master book).
//
// The JSON is the same customer book with a `district` per row, keyed by the
// same `id` as core_customer — so the backfill is a 1:1 UPDATE per placed row.
// Rows without a usable district (state-known-no-district, outside-India,
// unassigned) keep the column default ''.
//
//   node scripts/gen-district-migration.mjs              # write the migration
//
// Re-runnable: re-running regenerates the same file from the current JSON.
// Only plain `district` is backfilled — districtSource/confidence stay out of
// the product (founder decision 2026-11-14).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..');
const DATA = join(ROOT, 'client_district_wise.json');
const OUT = join(ROOT, 'founder-os_backend', 'migrations', '0144_customer_district.sql');

const esc = (v) => String(v ?? '').replace(/'/g, "''");

const json = JSON.parse(readFileSync(DATA, 'utf8'));
const rows = [];
const seen = new Set();
const push = (id, district) => {
  const key = String(id ?? '').trim();
  const d = String(district ?? '').trim();
  if (!key || !d || seen.has(key)) return;
  seen.add(key);
  rows.push([key, d]);
};

for (const s of json?.india?.states ?? []) {
  for (const dst of s?.districts ?? []) {
    for (const c of dst?.customers ?? []) push(c?.id, c?.district);
  }
}
for (const ctry of json?.outsideIndia?.countries ?? []) {
  for (const dst of ctry?.districts ?? []) {
    for (const c of dst?.customers ?? []) push(c?.id, c?.district);
  }
}

const lines = [
  '-- 0144_customer_district.sql — district-wise customer book (founder decision 2026-11-14).',
  '--',
  '-- client_district_wise.json is the same master book with a district per row',
  '-- (India Post PIN directory mapping, renamed districts current). The backfill',
  '-- is a 1:1 UPDATE per placed row on the shared id; rows without a usable',
  '-- district (state-known-no-district, outside-India, unassigned) keep \'\'.',
  '-- Imports never write this column (upsert list untouched) — a flat Zoho',
  '-- re-import cannot wipe it. Manager-only edit, like state/subArea.',
  '',
  "ALTER TABLE core_customer ADD COLUMN district TEXT NOT NULL DEFAULT '';",
  'CREATE INDEX IF NOT EXISTS core_customer_district_idx ON core_customer (district);',
  '',
  `-- Backfill: ${rows.length} placed rows.`,
];
for (const [id, d] of rows) {
  lines.push(`UPDATE core_customer SET district = '${esc(d)}' WHERE id = '${esc(id)}';`);
}
lines.push('');
writeFileSync(OUT, lines.join('\n'));
console.log(`wrote ${OUT} (${rows.length} backfill rows)`);
