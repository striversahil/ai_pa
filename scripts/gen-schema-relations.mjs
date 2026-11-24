#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/gen-schema-relations.mjs
//
// Compiles the relationship graph the notification AI needs, from the two
// places this repo already declares it:
//
//   1. prisma/schema.prisma + prisma/core/*.prisma
//        `@relation(fields: [xId], references: [id])` → DECLARED intent
//        (`@@map("core_x")` is honoured so the table name is the D1 name)
//   2. src/shared/d1-prisma.ts#RELATIONS
//        `Model: { field: { model, fk, one } }` → the joins our code ACTUALLY
//        performs at runtime (the strongest signal: it is executable truth)
//
// Output: founder-os_backend/src/modules/notifications/relations.ts (static,
// Worker-safe — the Worker cannot read .prisma files at runtime).
//
// The live `PRAGMA foreign_key_list` edges and the curated application joins
// (email bridges, which have no FK) are merged at runtime in schema.ts.
//
// Usage
//   node scripts/gen-schema-relations.mjs           # write the file
//   node scripts/gen-schema-relations.mjs --check    # exit 1 if it drifted
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BE = path.join(ROOT, 'founder-os_backend');
const OUT = path.join(BE, 'src/modules/notifications/relations.ts');
const CORE_DIR = path.join(BE, 'prisma/core');
const PRISMA_FILES = [
  path.join(BE, 'prisma/schema.prisma'),
  ...(fs.existsSync(CORE_DIR)
    ? fs.readdirSync(CORE_DIR).filter((f) => f.endsWith('.prisma')).sort().map((f) => path.join(CORE_DIR, f))
    : []),
];
const SHIM = path.join(BE, 'src/shared/d1-prisma.ts');

const rel = (from, field, model, ref, kind) => ({ from, field, model, ref, kind });

/** Prisma `model X { … @relation(fields: [a], references: [b]) }` → edges. */
function parsePrisma(text) {
  const out = [];
  let model = null;
  let table = null;
  for (const line of text.split('\n')) {
    const start = line.match(/^model\s+(\w+)\s*\{/);
    if (start) {
      model = start[1];
      table = start[1];
      continue;
    }
    if (!model) continue;
    if (/^\}/.test(line)) {
      model = null;
      table = null;
      continue;
    }
    const mapped = line.match(/@@map\(\s*"([^"]+)"\s*\)/);
    if (mapped) {
      table = mapped[1];
      continue;
    }
    const field = line.match(/^\s+(\w+)\s+([A-Za-z_]\w*)(?:\[\])?\??\s+.*@relation\((.*)\)\s*$/);
    if (!field) continue;
    const args = field[3];
    const fields = args.match(/fields:\s*\[([^\]]*)\]/);
    if (!fields) continue; // the back-reference side declares no columns
    const refs = args.match(/references:\s*\[([^\]]*)\]/);
    const from = fields[1].split(',').map((s) => s.trim()).filter(Boolean);
    const to = (refs ? refs[1] : 'id').split(',').map((s) => s.trim()).filter(Boolean);
    from.forEach((f, i) => out.push(rel(table, f, field[2], to[i] ?? 'id', 'declared')));
  }
  return out;
}

/** `const RELATIONS = { Model: { field: { model: 'X', fk: 'fk' } } }` → edges. */
function parseShim(text) {
  const anchor = text.indexOf('const RELATIONS');
  if (anchor < 0) return [];
  // Start at the ASSIGNMENT: the type annotation right after the name contains
  // braces too (`Record<string, { model: string; … }>`), and entering there
  // made the brace scan terminate inside the type.
  const open = text.indexOf('= {', anchor);
  if (open < 0) return [];
  let depth = 0;
  let end = text.length;
  for (let i = open + 2; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const out = [];
  let model = null;
  for (const line of text.slice(open + 2, end).split('\n')) {
    const block = line.match(/^\s{2}(\w+):\s*\{(.*)$/);
    if (block && !block[2].includes('}')) {
      model = block[1];
      continue;
    }
    const entry = line.match(/^\s{4}(\w+):\s*\{\s*model:\s*'(\w+)',\s*fk:\s*'(\w+)'/);
    if (entry && model) out.push(rel(model, entry[3], entry[2], 'id', 'orm'));
    if (/^\s{2}\},?\s*$/.test(line)) model = null;
  }
  return out;
}

function build() {
  const sources = [
    ...PRISMA_FILES.map((f) => ({ file: f, text: fs.readFileSync(f, 'utf8'), edges: [] })),
    { file: SHIM, text: fs.readFileSync(SHIM, 'utf8'), edges: [] },
  ];
  for (const src of sources) {
    src.edges = src.file === SHIM ? parseShim(src.text) : parsePrisma(src.text);
  }
  const merged = new Map();
  const rank = { orm: 2, declared: 1 };
  for (const src of sources) {
    for (const e of src.edges) {
      if (!e.from || !e.field || !e.model) continue;
      if (e.from === e.model) continue; // self-relations say nothing about joins
      const key = `${e.from}.${e.field}->${e.model}.${e.ref}`;
      const prev = merged.get(key);
      if (!prev || (rank[e.kind] ?? 0) > (rank[prev.kind] ?? 0)) merged.set(key, e);
    }
  }
  const edges = [...merged.values()].sort((a, b) => a.from.localeCompare(b.from) || a.field.localeCompare(b.field));
  const hash = crypto
    .createHash('sha1')
    .update(sources.map((s) => path.relative(ROOT, s.file) + '\n' + s.text).join('\n'))
    .digest('hex')
    .slice(0, 12);
  return { edges, hash, sourceCount: sources.length };
}

function render({ edges, hash, sourceCount }) {
  const by = new Map();
  for (const e of edges) {
    const list = by.get(e.from) ?? [];
    list.push(e);
    by.set(e.from, list);
  }
  const rows = edges
    .map((e) => `  { from: ${JSON.stringify(e.from)}, field: ${JSON.stringify(e.field)}, model: ${JSON.stringify(e.model)}, ref: ${JSON.stringify(e.ref)}, kind: ${JSON.stringify(e.kind)} },`)
    .join('\n');
  return `// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/relations.ts — GENERATED. Do not edit by hand.
//
// Regenerate with: node scripts/gen-schema-relations.mjs
// Verify (CI guard): node scripts/gen-schema-relations.mjs --check
//
// Compiled from ${sourceCount} sources:
//   • prisma/schema.prisma + prisma/core/*.prisma  → kind "declared" (@relation)
//   • src/shared/d1-prisma.ts#RELATIONS            → kind "orm"      (runtime joins)
//
// These are the table → table edges the notification AI is allowed to JOIN on.
// Live SQLite foreign keys ("fk") and the curated no-FK application joins
// ("app") are merged at runtime in ./schema.ts.
//
// source-hash: ${hash}
// ─────────────────────────────────────────────────────────────────────────────

export type RelationKind = 'orm' | 'declared';

export interface TableRelation {
  /** Table the edge starts at. */
  from: string;
  /** Column on \`from\` that holds the key. */
  field: string;
  /** Table the edge points at. */
  model: string;
  /** Column on \`model\` (almost always \`id\`). */
  ref: string;
  kind: RelationKind;
}

export const RELATIONS_SOURCE_HASH = ${JSON.stringify(hash)};

export const TABLE_RELATIONS: readonly TableRelation[] = [
${rows}
];

/** Edges grouped by their source table (built once — read by schema.ts). */
export const RELATIONS_BY_TABLE: Record<string, TableRelation[]> = (() => {
  const out: Record<string, TableRelation[]> = {};
  for (const e of TABLE_RELATIONS) (out[e.from] ??= []).push(e);
  return out;
})();
`;
}

const { edges, hash, sourceCount } = build();
const text = render({ edges, hash, sourceCount });
const check = process.argv.includes('--check');

if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error(
      'gen-schema-relations: relations.ts is stale.\n' +
        `  expected source-hash ${hash}\n` +
        '  run: node scripts/gen-schema-relations.mjs',
    );
    process.exit(1);
  }
  console.log(`gen-schema-relations: up to date (${edges.length} edges, hash ${hash})`);
} else {
  fs.writeFileSync(OUT, text, 'utf8');
  console.log(`gen-schema-relations: wrote ${path.relative(ROOT, OUT)} — ${edges.length} edges, hash ${hash}`);
}
