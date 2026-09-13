// compile-kyp.mjs — Phase 0: KYP dedup + compile taxonomy/slot schema.
// Reads data/know_your_product.json, emits data/kyp_taxonomy.json (slim, prompt-safe)
// + data/kyp_slots.json (full per-item slot detail for Stage B + KV).
// Usage: node scripts/compile-kyp.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'data', 'know_your_product.json');
const outTax = join(root, 'data', 'kyp_taxonomy.json');
const outSlots = join(root, 'data', 'kyp_slots.json');

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const uniq = (arr) => [...new Set((arr ?? []).map((s) => String(s).trim()).filter(Boolean))];

// Canonical merges: [matchNormVariants] -> canonical item_name + extra aliases
const MERGES = [
  { canon: 'Fiber Rod / Nylon Rod', category: 'Plansifter Accessories', match: ['fiberrod', 'fiber rod nylon rod'], aliases: ['fiberrod', 'plansifter fiber', 'nylon rod'] },
  { canon: 'Plansifter Frame', category: 'Plansifter Accessories', match: ['plansifter wooden frame', 'plansifter frame'], aliases: ['plansifter wooden frame'] },
  { canon: 'Wire Rope', category: 'Plansifter Accessories', match: ['plansifter wire rope', 'wire rope'], aliases: ['plansifter wire rope'] },
  { canon: 'Chilled Cast Iron Rolls', category: 'Roller Mill Accessories', match: ['chilled cast iron rolls'], aliases: [] },
];

// Header/generic rows that are not purchasable items — excluded from taxonomy.
const DROP_NORM = new Set([
  'sieve pan cleaners',
  'jointing accessories',
  'perforated sheets',
  'ask knob type metal or plastic',
]);

// Generic headers kept out of extraction but recorded.
const HEADER_NORM = new Set([
  'bearing', 'coupling', 'chain sprocket', 'pulleys',
  'elevator buckets', 'conveyor belts',
]);

// Keyword -> slot key heuristic over required_attributes + notes text.
const SLOT_RULES = [
  [/grade/, 'grade'], [/micron|mesh opening|opening/, 'opening'], [/mesh count|holes per inch/, 'mesh_count'],
  [/width/, 'width'], [/length/, 'length'], [/height/, 'height'], [/thickness|gauge/, 'thickness'],
  [/diameter|dia|bore/, 'diameter'], [/teeth/, 'teeth'], [/profile|section/, 'profile'],
  [/ply/, 'ply'], [/material|ms\b|ss\b|stainless|mild steel|pvc|nylon|pu\b|rubber|cotton/, 'material'],
  [/make|brand|manufacturer|machine/, 'machine_make'], [/quantity|qty|pieces|meters|boxes|bales|pairs/, 'quantity'],
  [/color|colour/, 'colour'], [/pressure|compressor/, 'air_pressure'], [/volt|rpm|hp|kw/, 'motor_spec'],
];

function deriveSlots(questions, notes) {
  const text = [...(questions ?? []), ...(notes ?? [])].join(' | ').toLowerCase();
  const slots = [];
  for (const [re, key] of SLOT_RULES) {
    if (re.test(text) && !slots.includes(key)) slots.push(key);
  }
  return slots;
}

const raw = JSON.parse(readFileSync(src, 'utf8'));
const byKey = new Map(); // `${category}||${canonNorm}` -> merged entry
const dropped = [];
const headers = [];

for (const cat of raw.categories ?? []) {
  for (const it of [...(cat.items ?? []), ...(cat.listed_only_no_notes ?? [])]) {
    const name = String(it.item_name ?? '').trim();
    const n = norm(name);
    if (!n) continue;
    if (DROP_NORM.has(n)) { dropped.push({ category: cat.category, item_name: name, reason: 'non-item row' }); continue; }
    if (HEADER_NORM.has(n)) { headers.push({ category: cat.category, item_name: name }); continue; }
    const merge = MERGES.find((m) => m.match.includes(n));
    const canon = merge?.canon ?? name;
    const key = `${(merge?.category ?? cat.category)}||${norm(canon)}`;
    const prev = byKey.get(key);
    const questions = uniq(it.required_attributes);
    const notes = uniq(it.notes);
    const aliases = uniq([...(it.aliases ?? []), ...(merge?.aliases ?? [])]);
    if (!prev) {
      byKey.set(key, {
        category: merge?.category ?? cat.category, item_name: canon, aliases,
        questions, notes,
        confidences: [Number(it.match_confidence ?? 0)],
        sources: [cat.category],
      });
    } else {
      prev.aliases = uniq([...prev.aliases, ...aliases]);
      prev.questions = uniq([...prev.questions, ...questions]);
      prev.notes = uniq([...prev.notes, ...notes]);
      prev.confidences.push(Number(it.match_confidence ?? 0));
      if (!prev.sources.includes(cat.category)) prev.sources.push(cat.category);
    }
  }
}

const items = [...byKey.values()].map((e) => {
  const slots = deriveSlots(e.questions, e.notes);
  return {
    ...e,
    confidence: Math.max(...e.confidences),
    slots,
    no_slots: slots.filter((s) => s !== 'quantity').length === 0,
  };
});
items.sort((a, b) => a.category.localeCompare(b.category) || a.item_name.localeCompare(b.item_name));

const taxonomy = {
  version: 1,
  generated_at: new Date().toISOString(),
  categories: [...new Set(items.map((i) => i.category))].sort(),
  items: items.map((i) => ({ category: i.category, item_name: i.item_name, aliases: i.aliases })),
};

const slotsDoc = {
  version: 1,
  generated_at: taxonomy.generated_at,
  merges: MERGES.map((m) => ({ canon: m.canon, match: m.match })),
  dropped, headers,
  items: Object.fromEntries(items.map((i) => [`${i.category}||${i.item_name}`, {
    category: i.category, item_name: i.item_name, aliases: i.aliases,
    questions: i.questions, notes: i.notes, slots: i.slots,
    no_slots: i.no_slots, confidence: i.confidence, sources: i.sources,
  }])),
};

writeFileSync(outTax, JSON.stringify(taxonomy, null, 2));
writeFileSync(outSlots, JSON.stringify(slotsDoc, null, 2));

const chars = readFileSync(outTax, 'utf8').length;
console.log(`categories: ${taxonomy.categories.length}`);
console.log(`taxonomy items: ${taxonomy.items.length} (${chars} chars, ~${Math.round(chars / 4)} tokens)`);
console.log(`dropped: ${dropped.length}, headers: ${headers.length}`);
console.log(`no_slots items: ${items.filter((i) => i.no_slots).map((i) => i.item_name).join('; ')}`);
console.log(`wrote ${outTax}`);
console.log(`wrote ${outSlots}`);
