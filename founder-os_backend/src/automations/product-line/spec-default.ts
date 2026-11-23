// spec-default.ts — the default value a spec offers on a new quote.
//
// Pure on purpose (no D1 import) so the dashboard's selector, the seed generator
// and the guard all validate a default the same way. Stored as JSON text in
// `KypGuide.defaultValue` so `"pu"`, `1` and `true` stay distinguishable.
export function normalizeDefaultValue(
  raw: unknown,
  opts: { type?: string | null; enum?: string[] | null } = {},
): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const type = String(opts.type ?? 'string');
  if (type === 'boolean') {
    return JSON.stringify(raw === true || raw === 'true' || raw === 1 || raw === '1');
  }
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error('default must be a number');
    return JSON.stringify(type === 'integer' ? Math.round(n) : n);
  }
  const list = Array.isArray(raw)
    ? raw.map((v) => String(v).trim()).filter(Boolean)
    : [String(raw).trim()];
  if (!list.length) return null;
  const allowed = (opts.enum ?? []).filter(Boolean);
  if (allowed.length) {
    for (const v of list) {
      if (!allowed.includes(v)) {
        throw new Error('default "' + v + '" is not one of: ' + allowed.slice(0, 12).join(', '));
      }
    }
  }
  return JSON.stringify(type === 'array' ? list : list[0]);
}

/** Read a stored default back (`"GG"` → GG, `1` → 1, `true` → true). */
export function parseStoredDefault(raw: string | null | undefined): string | number | boolean | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  try {
    const v = JSON.parse(raw);
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    return undefined;
  } catch {
    return raw;
  }
}
