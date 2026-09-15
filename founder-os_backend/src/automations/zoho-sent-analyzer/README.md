# Zoho Sent Analyzer

Incremental Zoho Books estimate sync + comment analysis + AI classification.
The full analyzer lives **in this folder** (`service.ts` =
`SalesCopilotService`); the heavy LLM work runs in GitHub Actions
(`scripts/zoho-sent-runner.js`, thin orchestrator over
`scripts/zoho-sync/*` — see that folder's README). The frontend Zoho
Estimates board is this automation's dashboard.

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
| GH runner (`scripts/zoho-sent-runner.js` + `scripts/zoho-sync/*`, 15-min full sync / 5-min sales-orders tick → `workflow_dispatch`) | GitHub Actions, unlimited CPU | All-status 2-page fetch (`Status.All`, newest-modified first) → fingerprint (via `/api/runner/zoho/fingerprint`) → status transitions (`/api/runner/zoho/status`, credits closes) → metadata upsert (`/api/estimates/bulk-upsert`, status excluded) → gated comment refresh → **Groq LLM** (`openai/gpt-oss-120b`, HIGH reasoning, `GROQ_API_KEYS` rotation — omniroute avoided, ~12h outages) → lead-details extraction → watermark advance. Module map: `fetch.js` (Zoho reads) / `diff.js` (pure change detection) / `persist.js` (worker writes) / `analyze.js` (only AI spender) / `comments.js` (shared pure helpers). Full contract in `scripts/zoho-sync/README.md` |

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
2. **Fetch estimates** (network): all-status list (`Status.All`, 2 pages ×
   200, newest-`last_modified_time` first — any status move lands in-window).
   Drafts persist as metadata for visibility but never enter AI/comment work.
3. **Fetch comments** for sent + ex-sent rows only (close-out coverage;
   brand-new drafts get metadata only). Concurrency 6, before ANY DB read:
   `estimates/:id/comments?organization_id=`.
4. **Fingerprint fast-path**: deterministic JSON `{v:2, byEst:{estimateId:
   {m, ids}}}` (sorted keys → plain `===` compare), where `m` =
   `status|total|last_modified_time` and `ids` = the FULL sorted real-sales
   comment id list. Comments don't bump `last_modified_time` in Zoho, so the
   id list is included — full lists, not max id, because Zoho ids aren't
   chronological and max proved blind to low-id newcomers. Match with
   cached fingerprint → return `{skipped:true}` with **zero DB reads**.
   Requires all comment fetches to succeed; `force` skips the gate.
   Legacy plain-string values auto-migrate (one transitional full pass).
5. **Metadata sync** (always, before AI): single `findMany` of existing rows
   reused for change detection; field-wise compare
   (number/customer/total/date) → `upsert` only changed rows. Status is
   EXCLUDED — every flip flows through step 6 so wins are ledger-credited,
   never applied silently.
6. **Status transitions** (replaces the old per-estimate closed-status
   detail loop): any move in any direction comes straight from the
   All-status listing → `/api/runner/zoho/status` (accepted/confirmed
   credit the telecalling close ledger, idempotent). DB-`sent` rows missing
   from both pages get one detail check (deleted in Zoho → last-known
   status kept).
7. **Comment diff**: `comment.groupBy(estimateId, max commentId)` vs Zoho's
   max **real-sales** comment id → `hasNew` per estimate.
8. **Change detection** per estimate: `force || statusChanged ||
   neverAnalyzed || modifiedSinceLastSync (last_modified_time >
   lastSyncTime) || hasNewComments`. Else skipped (keeps old `lastSyncTime`
   so downtime catch-up works on the next tick).
9. **processEstimate** (runner pool: 2 workers + 2s pacing per estimate —
   Groq quotas saturate above that — one retry round after 5s):
   upsert all comments (HTML cleaned: `<br>`/`</p>` → newline, tags
   stripped), collect real-sales timeline (latest-first by comment
   **timestamp** — `date_formatted` parsed as IST, `date` fallback, id
   order tiebreak only; Zoho ids are NOT chronological, e.g. EST-023377
   id-sorted the wrong "latest". Last 15 kept). No-comment → default classification
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

## Classification (worker: deterministic-first; runner: LLM-only)

Order per estimate depends on the path. In-worker (`service.ts`):
deterministic rules → `__PENDING_AI__` marker (no LLM on the worker).
GH runner (`analyze.js`): Groq LLM directly for every work item — the old
ported deterministic block was dead code (never called) and has been
removed; do not re-add it here.

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