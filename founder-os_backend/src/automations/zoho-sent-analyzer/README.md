# Zoho Sent Analyzer

Incremental Zoho Books estimate sync + comment analysis + AI classification.
Runs every 15 minutes. The full analyzer lives **in this folder**
(`service.ts` = `SalesCopilotService`); the heavy LLM work runs in GitHub
Actions (`scripts/zoho-sent-runner.js`). The frontend Zoho Estimates board
is this automation's dashboard.

Files:

- `service.ts` — `SalesCopilotService` (~900 lines): Zoho fetch, comment
  sync, deterministic classification, closed-status sync, brief/EOD context,
  sales-orders-today read. Implements `AnalysisEngine`.
- `index.ts` — `handler()` → `runSync()`; `data()` → KPI summary for
  `GET /api/automations/zoho-sent-analyzer/data`.
- `rule.json` — handler, `schedule: */15 * * * *`, scope `zoho`.

## Two runtimes, one pipeline (read this first)

| Path | Where | Does what |
|---|---|---|
| In-worker (`service.ts runSync`) | Worker `/api/trigger` or local node-cron | Zoho fetch → fingerprint fast-path → metadata sync → closed-status sync → comment diff → **deterministic** classify only; non-matching estimates marked `__PENDING_AI__` (no LLM on the worker) |
| GH runner (`scripts/zoho-sent-runner.js`, `cron-every-15min.yml` → `workflow_dispatch`) | GitHub Actions, unlimited CPU | Same fetch + fingerprint (via `/api/runner/zoho/fingerprint`) → metadata upsert (`/api/estimates/bulk-upsert`) → closed sync → comment refresh → deterministic classify → **Groq LLM fallback** (`openai/gpt-oss-120b`, HIGH reasoning, `GROQ_API_KEYS` rotation — omniroute avoided, ~12h outages) → lead-details extraction → watermark advance |

Both compute the **same fingerprint** and share the KV key
`zoho:analyzer:state_fingerprint` (24h TTL), so they stay in sync.
`ZOHO_FORCE=1` / `force` dispatch bypasses the gate and reclassifies all
active estimates.

## Flow inside `runSync` / runner

1. **Auth**: parse Zoho creds from `ZOHO_CURL_CONTENT` secret (cookie-based
   curl export, primary) → `ZOHO_BOOKS_SENT_URL` + `ZOHO_BOOKS_AUTH_TOKEN`
   OAuth fallback → local `zoho_sent/sent_estimates.txt` (dev). Same parser
   (`parseCurlContent`: URL + `-H` headers + `organization_id`). Runner
   reads only the `zoho_sent/sent_estimates.txt` file.
2. **Fetch estimates** (network): active `sent` list from Zoho Books.
3. **Fetch comments** for every active estimate (network, concurrency 6,
   before ANY DB read): `estimates/:id/comments?organization_id=`.
4. **Fingerprint fast-path**: `estimate_id|status|total|last_modified_time|
   maxRealSalesCommentId` per estimate (sorted, joined). Comments don't bump
   `last_modified_time` in Zoho, so max comment id is included. Match with
   cached fingerprint → return `{skipped:true}` with **zero DB reads**.
   Requires all comment fetches to succeed; `force` skips the gate.
5. **Metadata sync** (always, before AI): single `findMany` of existing rows
   reused for change detection; field-wise compare
   (number/customer/total/date/status) → `upsert` only changed rows.
6. **Closed-status sync**: local `sent` rows missing from Zoho's active list
   are re-fetched individually (`estimates/:id`); status updated on change;
   their comments re-synced + classified (same deterministic/pending path,
   `movingSlow='No'` for closed).
7. **Comment diff**: `comment.groupBy(estimateId, max commentId)` vs Zoho's
   max **real-sales** comment id → `hasNew` per estimate.
8. **Change detection** per estimate: `force || statusChanged ||
   neverAnalyzed || modifiedSinceLastSync (last_modified_time >
   lastSyncTime) || hasNewComments`. Else skipped (keeps old `lastSyncTime`
   so downtime catch-up works on the next tick).
9. **processEstimate** (parallel pool, concurrency 6, one retry after 5 min):
   upsert all comments (HTML cleaned: `<br>`/`</p>` → newline, tags
   stripped), collect real-sales timeline (latest-first by sequential
   comment id, last 15 kept). No-comment → default classification
   (`meaningfulUpdate=false, intentScore=2, movingSlow=Yes if >3 days old`,
   `reasoning='No sales agent comment found.'`). Else badges from the
   **latest comment only** (deterministic; summary/intent from the journey).
   `lastSyncTime` advances **only on success** — failures retry next tick.
10. **Watermark**: `Setting sales_copilot:last_complete_sync_at` advances
    only when `neededCount > 0 && failedCount === 0`. Dashboard "Last
    synced" = last fully-completed pass, not any tick. Fingerprint cached
    only when `failedCount === 0`.
11. Overlap guard: `isSyncRunning` — concurrent (manual force + cron) runs
    throw instead of double-spending AI credits.

## Classification (deterministic-first, LLM fallback)

Order per estimate: deterministic rules → LLM → pending marker.

- **Deterministic** (`modules/ai/deterministicClassifier.ts`, ported into
  the runner): 100% repeatable regexes over the latest comment —
  order-confirmed / firm-commit / future-follow-up-date (with
  passed-due-date check) → `meaningful_update=true`; system-auto /
  not-answering / rejection / internal-handoff / vague-revert-without-date /
  bare-action / quotation-only-or-spec-block / purchased-elsewhere →
  `meaningful_update=false` with typed flags (`not_answering`,
  `under_discussion`, `confirm` + `confirm_date`; `confirm='Yes'` only when
  the confirm date is within 2 days). `movingSlow` is age-based (>3 days
  since estimate date), not LLM. Deterministic hit writes
  `summary='Deterministic classification.'`, `intent_score` 4 (meaningful)
  or 2 (not). No LLM call.
- **LLM fallback (runner only)**: Groq `groqJson` with agent roster
  (today's live NeoDove report → yesterday's snapshot → 
...[truncated 4471 chars]