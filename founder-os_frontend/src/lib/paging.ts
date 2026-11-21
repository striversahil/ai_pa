// lib/paging.ts — the ONE frontend paging vocabulary.
// mirror: founder-os_backend/src/shared/paging.ts (response shape + page size).
// Founder standard (2026-11-21): page numbers, 50 rows, server search,
// COUNT totals, change banner instead of auto-reload.

export const PAGE_SIZE = 50;

/** Server page payload (`pageResult()` on the backend). */
export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Windowed page numbers: 1 2 … 5 6 7 … 19 20 (7 slots max). */
export function pageWindow(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set<number>([1, 2, current - 1, current, current + 1, total - 1, total]);
  const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] - nums[i - 1] > 1) out.push("…");
    out.push(nums[i]);
  }
  return out;
}

/** `base?page=&limit=&q=&…` — blank/undefined params are dropped. */
export function pagedUrl(base: string, params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${base}${base.includes("?") ? "&" : "?"}${qs}` : base;
}
