// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.


export const DATA_KEY = 'product-line:data:v1';

export const DATA_TTL_MS = 10 * 60 * 1000;

export function parseAliases(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s)).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.map((s) => String(s)).filter(Boolean);
    } catch { /* fall through */ }
  }
  return [];
}

export function parseAttrValues(raw: unknown): Record<string, string> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[String(k)] = String(v ?? '');
    return out;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) return parseAttrValues(v);
    } catch { /* fall through */ }
  }
  return {};
}

export function parseCondition(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object') return v;
    } catch { /* fall through */ }
  }
  return null;
}

export function parseMissingSpecs(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.map(String).filter(Boolean);
    } catch { /* fall through */ }
  }
  return null;
}

export const INDEX_KEY = 'product-line:index:v1';

export const INDEX_TTL_MS = 10 * 60 * 1000;

export const RATES_TTL_MS = 10 * 60 * 1000;

export const VENDORS_KEY = 'product-line:vendors:v1';

export const VENDORS_TTL_MS = 10 * 60 * 1000;

export const DETAIL_TTL_MS = 10 * 60 * 1000;
