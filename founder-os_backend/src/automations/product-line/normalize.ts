// normalize.ts — pure, framework-free spec/unit normalizers for intake.
//
// Vendor quotes write the same fact many ways (4" / 4in / 4 inch / 4 INCH).
// These canonicalize the *value text* so checklist matching + rate dedupe see
// one form. Mapping values to the RIGHT spec key (width vs thickness) stays
// the model's job — it has the checklist questions; this only cleans text.
// Shared by Worker + Express (no prisma, no KV, no fetch).

/** 4" → 4 inch · 4in → 4 inch · 6′ → 6 feet. Leaves other text untouched. */
export function normalizeInches(s: unknown): string {
  let t = String(s ?? '').trim();
  if (!t) return '';
  // 4" / 4″ / 4'' (trailing quote marks, possibly spaced)
  t = t.replace(/(\d+(?:\.\d+)?)\s*["″'']\s*$/g, '$1 inch');
  // 4in / 4 in / 4IN (bare unit suffix at end)
  t = t.replace(/(\d+(?:\.\d+)?)\s*in\b\.?$/i, '$1 inch');
  // 6' / 6′ → 6 feet
  t = t.replace(/(\d+(?:\.\d+)?)\s*['′]\s*$/g, '$1 feet');
  return t.replace(/\s+/g, ' ').trim();
}

/** Canonical unit words: mtr/meter/metre → meter; nos/pc → pcs; kg/kgs → kg. */
const UNIT_MAP: Record<string, string> = {
  mtr: 'meter', mtrs: 'meter', meter: 'meter', meters: 'meter', metre: 'meter', metres: 'meter',
  nos: 'pcs', no: 'pcs', 'nos.': 'pcs', pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs',
  kg: 'kg', kgs: 'kg', kilogram: 'kg',
  ft: 'feet', feet: 'feet', foot: 'feet',
  mm: 'mm', cm: 'cm', inch: 'inch', inches: 'inch',
  sqft: 'sqft', 'sq.ft': 'sqft', sqm: 'sqm',
  roll: 'roll', rolls: 'roll', coil: 'coil', coils: 'coil', box: 'box', set: 'set', pair: 'pair',
};

export function normalizeUnit(s: unknown): string | undefined {
  const t = String(s ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!t) return undefined;
  if (UNIT_MAP[t]) return UNIT_MAP[t];
  const raw = String(s ?? '').trim().slice(0, 120);
  return raw || undefined;
}

/** Full spec-value cleanup: inch marks + squeeze whitespace. Keeps brand
 *  names, grades, free text verbatim (only the dimension/unit tail changes). */
export function normalizeSpecValue(s: unknown, max = 500): string {
  return normalizeInches(s).slice(0, max);
}

/** "Nylon 4"" → { cleaned, dimHint }: pulls a bare trailing dimension out so
 *  callers can suggest it for width/length keys. Returns null when no
 *  dimension-looking tail exists. Pure hint — the model still picks the key. */
export function dimHint(s: unknown): { cleaned: string; dim: string } | null {
  const t = String(s ?? '').trim();
  const m = t.match(/(\d+(?:\.\d+)?\s*(?:"|″|in\b\.?|inch|inches|mm|cm|feet|ft|meter|mtr))\s*$/i);
  if (!m) return null;
  return { cleaned: t.slice(0, m.index).trim(), dim: normalizeInches(m[1]) };
}
