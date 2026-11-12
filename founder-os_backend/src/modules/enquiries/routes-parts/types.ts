// Extracted verbatim from routes.ts by scripts/refactor/split-module.mjs.
// routes.ts re-exports everything public here, so existing imports keep working.


export interface EnquiryResult {
  status: number;
  body: any;
  live?: { type: string; extra: Record<string, unknown> };
}

// ── Procurement view: AI-only redaction ─────────────────────────────────────
// Restricted viewers NEVER receive raw free text. The procurement rewrite
// (description + per-comment) is produced by the SAME background AI call that
// populates the structured fields (see extract.ts + runEnquiryExtraction) and
// cached per enquiry in KV, verified piece-by-piece against source hashes.
// There is deliberately NO deterministic fallback: a piece whose cache is
// missing/stale is withheld (redactedPending) while a background
// re-enrichment is kicked — the route handlers below do that via the
// returned flag. Stored rows stay intact for sales + AI.

export interface RedactOpts {
  redact?: boolean;
  /** 1-based page + page size for queue tables (10/50). Omit = full list. */
  page?: number;
  limit?: number;
  /** Opaque keyset cursor (presence, even "" for the first page, selects
   *  cursor mode over page/offset mode). Cap 100 — the queue dashboards take
   *  the newest 100 and Load-more the rest, so D1 bills a flat ~100 rows no
   *  matter how large the table grows. */
  cursor?: string;
  /** Server search across ALL rows (old + new): EST no., enquiry no.,
   *  client/contact, title, item names/qtys/specs, vendor names. ≥2 chars;
   *  shorter returns [] WITHOUT scanning (cost guard). Cap 50. Searches the
   *  write-maintained `searchText` identity mark — never the items blob or
   *  full description (same exclusion Zoho enforces in COQL criteria). */
  q?: string;
  /** False when no AI keys are configured — the redacted view then withholds
   *  free text with an explicit badge instead of failing silently. */
  aiConfigured?: boolean;
}

export interface ProcQueueOpts {
  queue: 'pending' | 'history';
  cursor?: string;
  limit?: number;
  aiConfigured?: boolean;
  // all=true returns the COMPLETE history set (same cached scan — KV reads,
  // zero D1). Compat only: dashboards page history by cursor (`limit` +
  // `cursor`) and keep pending complete.
  all?: boolean;
}
