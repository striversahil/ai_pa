// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.


// ── Scale path: per-product accessors (no full-table load) ──────────────
// getProductLineData() above caps rates at 2000 and loads every table — it
// breaches KV/CPU limits past ~10K. Hot paths (sales chat, intake,
// knowledge copilot) MUST use these targeted, per-product cached queries
// instead. The monolith stays ONLY for the dashboard payload until it is
// paginated (do NOT raise the cap again — paginate instead).

export interface ProductIndexRow {
  id: string;
  category: string;
  name: string;
  aliases: string[];
  active: boolean;
}

export interface VendorIndexRow {
  id: string;
  name: string;
  vendorType: string;
  location: string | null;
  active: boolean;
}
