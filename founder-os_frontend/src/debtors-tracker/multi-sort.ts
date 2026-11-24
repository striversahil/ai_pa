"use client";

/** Shared cumulative (multi-column) sort for Debtors Tracker tables.
 *
 * Rules (per founder):
 * - Every header click accumulates — no Shift key.
 * - Sort state is in-memory only (useState), never persisted.
 * - Click cycle per column: default-dir → flipped → removed.
 *   When the stack empties it falls back to the table's default sort.
 * - A click on a NEW column always APPENDS, so it lands as a sub-level under
 *   whatever is already sorting ("Date ↓ › Invoice No. ↑" in one click).
 *   The old rule replaced a pristine default, which hid stacking from the
 *   first click on a freshly loaded table.
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
 * - Unknown column: append with its default direction (a sub-level).
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
    // Always a SUB-LEVEL: stacking from the first click is what makes
    // "date, then invoice number" a single gesture.
    return [...specs, { key, dir: defaultDirFor(key, textFirst) }];
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

/**
 * Serial at the end of an invoice number: "BUI/26-27/751" → 751, "1836" →
 * 1836. `null` when the last `/` segment is not a plain number
 * ("BUI/TI0476/17-18").
 *
 * Founder rule (2026-11-26): the invoice number IS that trailing serial, so
 * the sort must not compare the prefix ("BUI/25-26/1200" vs "BUI/26-27/751").
 */
export function invoiceSerial(invoiceNo: unknown): number | null {
  const tail = String(invoiceNo ?? "").trim().split("/").at(-1)?.trim() ?? "";
  if (!/^-?\d+(\.\d+)?$/.test(tail)) return null;
  const n = Number(tail);
  return Number.isFinite(n) ? n : null;
}

/**
 * Invoice-number order — the ONE comparator for the invoice column (invoices
 * tab, collections tab, overdue export).
 *
 * Numeric serials sort first and ascending; anything without a serial falls
 * back to a numeric-aware string compare. The result is always finite: a
 * comparator that returns `NaN` reads as "equal" and silently disables the
 * sort — and every sub-level stacked under it.
 */
export function compareInvoiceNo(a: unknown, b: unknown): number {
  const na = invoiceSerial(a);
  const nb = invoiceSerial(b);
  const byString = () => String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
  if (na != null && nb != null) return na !== nb ? na - nb : byString();
  if (na != null) return -1;
  if (nb != null) return 1;
  return byString();
}
