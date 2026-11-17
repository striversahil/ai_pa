// Extracted verbatim from store.ts by scripts/refactor/split-module.mjs.
// store.ts re-exports everything public here, so existing imports keep working.


export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Normalize a role→position mapping: trimmed chart title or null. */
export function cleanPosition(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, 120) : null;
}
