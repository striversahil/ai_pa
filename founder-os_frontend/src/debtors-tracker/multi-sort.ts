"use client";

/** Shared cumulative (multi-column) sort for Debtors Tracker tables.
 *
 * Rules (per founder):
 * - Every header click accumulates — no Shift key.
 * - Sort state is in-memory only (useState), never persisted.
 * - Click cycle per column: default-dir → flipped → removed.
 *   When the stack empties it falls back to the table's default sort.
 * - First click from a pristine default REPLACES the default, so a clean
 *   single-column sort is reachable; later clicks stack on top of it.
 */

export type SortDir = "asc" | "desc";

export interface SortSpec {
  key: string;
  dir: SortDir;
}

export function defaultDirFor(key: string, textFirst: ReadonlySet<string>): SortDir {
  return textFirst.has(key) ? "asc" : "desc";
}

export function isDefaultSort(specs: SortSpec[], defaults: SortSpec[]): boolean {
  if (specs.length !== defaults.length) return false;
  return specs.every((s, i) => s.key === defaults[i]?.key && s.dir === defaults[i]?.dir);
}

/**
 * Next sort stack after clicking `key`.
 * - Unknown column: append with its default direction (or replace a pristine default).
 * - Known column, still on its default direction: flip it in place.
 * - Known column, already flipped: remove it; empty stack → defaults.
 */
export function nextSortSpecs(
  specs: SortSpec[],
  key: string,
  defaults: SortSpec[],
  textFirst: ReadonlySet<string>,
): SortSpec[] {
  const idx = specs.findIndex((s) => s.key === key);
  if (idx === -1) {
    const fresh: SortSpec = { key, dir: defaultDirFor(key, textFirst) };
    // First click from the pristine default replaces it instead of stacking,
    // otherwise a lone single-column sort would be unreachable.
    if (isDefaultSort(specs, defaults)) return [fresh];
    return [...specs, fresh];
  }
  const current = specs[idx]!;
  const firstDir = defaultDirFor(key, textFirst);
  if (current.dir === firstDir) {
    const flipped: SortSpec = { key, dir: firstDir === "asc" ? "desc" : "asc" };
    return specs.map((s, i) => (i === idx ? flipped : s));
  }
  const rest = specs.filter((_, i) => i !== idx);
  return rest.length > 0 ? rest : [...defaults];
}

/** Human-readable stack for the Reset chip row, e.g. "Customer ↑ > Amount ↓". */
export function describeSortSpecs(specs: SortSpec[], labelOf: (key: string) => string): string {
  return specs.map((s) => `${labelOf(s.key)} ${s.dir === "asc" ? "↑" : "↓"}`).join("  ›  ");
}
