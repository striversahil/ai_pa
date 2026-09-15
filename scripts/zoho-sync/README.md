# zoho-sync — Zoho Books estimate sync pipeline (GH Actions side)

`scripts/zoho-sent-runner.js` is a thin orchestrator (~190 lines) over these
modules. It runs the full sync on the 5-min workflow
(`cron-every-5min.yml`, gated by `run_zoho` in quiet hours);
`SO_ONLY=1` remains available for manual lightweight sales-orders ticks.
Heavy work stays here (unlimited CPU); D1 reads/writes go through the
Worker's `/api/runner/*` endpoints.

## Fetch scope (read this first)

The list query is derived from the saved curl export
(`zoho_sent/sent_estimates.txt`) in `fetch.js:buildEstimatesUrl`:

* `filter_by=Status.All` — **every** status, not just Sent. Drafts persist as
  metadata for visibility but never enter AI/comment processing.
* 2 pages × 200 rows, `sort_column=last_modified_time` desc — any status move
  bumps the row into the window, so transitions are always visible.
* `last_modified_time` is a change signal only, never a fetch cursor.

## Modules

| File | Owns | Never touches |
|---|---|---|
| `fetch.js` | Zoho reads: All-status 2-page list, comment batches, vanished-row detail check, NeoDove roster, sales-orders snapshot | D1, AI |
| `diff.js` | Pure change detection (no I/O — unit-testable): fingerprint build/parse, metadata diff (status excluded), `detectTransitions`, comment newcomer sets, `selectWorkItems` with the `PROCESSABLE` gate (`sent/accepted/declined/confirmed`) | network, DB, AI |
| `persist.js` | Worker writes: `getDbState`, `postMetadataUpserts`, `postStatusUpdates`, `postComments` (HTML-cleaned, batched), `postClassification`, `postLeadDetails`, watermark, fingerprint, sales-orders tile | Zoho, AI |
| `analyze.js` | The only AI spender: badge + journey classification, pooled with retry (`AI_CONCURRENCY=2`, 2s pacing), lead-details capture loop | Zoho reads, D1 (writes via `persist.js`) |
| `comments.js` | Shared pure helpers: HTML cleaning, system-comment detection, IST timestamp ordering (Zoho ids are NOT chronological), sales-comment extraction | everything else |

## Flow (orchestrator order matters)

1. Sales-orders-today snapshot (independent of estimates, every tick).
2. All-status fetch (2 pages) → DB state → fingerprint fast-path (zero DB
   writes when unchanged; `needsBackfill` keeps uncaptured rows looping).
3. Comments for sent + DB-was-sent rows only (close-out coverage for
   sent→draft/void moves; brand-new drafts get metadata only).
4. **Status transitions first** → `/api/runner/zoho/status`, which credits
   accepted/confirmed closes into the telecalling ledger (idempotent —
   replays are safe) and broadcasts `estimates` + `telecalling` live events.
5. Metadata convergence → `/api/estimates/bulk-upsert`. Status rides along
   only on brand-new rows; flips always go through step 4 first, so no win
   is ever applied silently.
6. Vanished-row fallback: DB-`sent` rows on neither page get one detail
   check (deleted in Zoho → last-known status kept).
7. AI classification + lead-details (sent + just-transitioned; close-out
   rows get `movingSlow='No'`).
8. Watermark (`sales_copilot:last_complete_sync_at`) + fingerprint stored
   only on a failure-free pass with work done. Dashboard "Last synced" =
   last fully-completed pass, not any tick.

## Rules for editors

* New Zoho reads → `fetch.js`. New comparisons → `diff.js` (keep it pure —
  add a `node -e` assertion when you change it). New worker writes →
  `persist.js`. New AI spend → `analyze.js`, gated by `PROCESSABLE`.
* `node --check` every file before commit. No test suite — verification is
  `node --check` + targeted `node -e` asserts + worker smoke + live curl.
* `ZOHO_FORCE=1` reprocesses every eligible row (manual full pass).
