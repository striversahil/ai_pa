# Accounts

Recurring accounts/compliance taskbar for the accounts team. Deterministic, no
LLM. **One task = one thread** (founder design, 2026-11-25, migration 0166):
you no longer read a card per day — you read one row per task (× lane) and open
it to see the whole financial year of that task.

## The model

- **AccountsTaskTemplate** — the repeating definition (`title, shortTitle,
  frequency daily|weekly|monthly|quarterly|yearly, ownerRole
  senior|junior|either, ruleType/ruleJson, dueTime "HH:mm" IST, active`).
  Written only from the Controller tab (`/api/accounts/templates`, root).
- **AccountsTaskLog** — one row per `(templateId, dueDate, slot)`: the thread's
  ENTRY for that day, not a task. `slot` is `main`, or `senior`/`junior` when
  the template `isShared`. Fields: `status` (`pending|done|not_done|skipped`),
  `remark`, `timeTaken`, `doneBy`, `attachments`, and the thread columns
  `entryKind` (`instance` | `auto_miss`), `lateNote`, `lateNoteBy`,
  `lateNoteAt`.
- **Accountant** — roster (`name, role, order, deleted`), mirrors to the ERP
  roster via `mirrorRosterRow`.

### Founder rules encoded here (2026-11-25)

1. **Window = Indian financial year** (1 Apr → 31 Mar), `threadWindow()`.
2. **A day nobody logged is written programmatically** as `status='not_done',
   entryKind='auto_miss'`; the sentence "Task not done on 15 Nov 2026" is
   rendered from the date (`missLabel`), never stored.
3. **A missed day stays Not done forever.** "Resolve" only attaches a
   `lateNote` (audit trail: what was done late and when) — it never flips the
   day to Done. Marking Done is a separate, explicit action.
4. **A "Not done" recorded by a human with a remark is a valid negligence
   record** for that day (bucket `not_done`, never re-written by the engine).
5. **A window rule's span is its deadline** (`isMissable`): inside
   `day_range`/`week_of_month`/`month_day_range` the inner days are grace; only
   the last day can be missed.

Buckets (`service-parts/thread.ts#bucketOf`): `done` · `not_done` · `late`
(missed + lateNote, still not done) · `missed` (auto, no note → "unexplained")
· `pending` (due today or later). `unresolved = missed + not_done` drives the
red "unexplained days" counter.

## Files

- `index.ts` — `handler()` = `runThreadMaintenance()`; `data` serves the
  workspace payload (adds `threads`).
- `service.ts` — re-export surface (pure + io + thread).
- `service-parts/pure.ts` — schedule grammar, `isDueOn`, slots, dates, dues math.
- `service-parts/thread.ts` — pure thread rules: window, due dates, buckets,
  counts, `missLabel`, `longDate` (guard: `scripts/guards/accounts-thread.test.mjs`).
- `thread-io.ts` — D1 side: `ensureThreadInstances`, `materialiseMisses`,
  `runThreadMaintenance`, `getThread`, `getThreadSummaries`,
  `getThreadsForDashboard`, `getThreadsExport`.
- `service-parts/io.ts` — roster/templates/logging/dashboard/dues (largest file;
  thread code deliberately lives in `thread-io.ts`).
- `rule.json` — cron handler (`30 3 * * *`, historical) + scope `accounts`; the
  live rollover is the native 02:30 UTC block in `src/worker/cron.ts` (08:00 IST,
  no LLM, no GH dispatch, quiet hours don't apply).
- `cash.ts` / `seed-tasks.ts` — dispatch cash ledger, seed templates (generated
  by `node scripts/gen-accounts-seed.mjs`, never hand-edited).

Due-date grammar (`ruleType` + `ruleJson`): `not_applicable` (daily → Mon–Sat),
`fixed_day`, `day_range`, `multiple_days`, `weekday`, `week_of_month`,
`month_day_range`, `multi_occurrence`, plus `variable_per_item` /
`to_be_decided` which never auto-instantiate (they render under "No fixed date —
reference").

## Endpoints (worker `routes/accounts.ts` + `routes/accounts-files.ts`)

- `GET /api/automations/accounts/data?as=` — workspace payload (`threads`, today's
  `items`, dues, cash).
- `GET /api/accounts/tasks/:templateId/thread?slot&from&to` — one thread.
- `POST /api/accounts/threads/sync` — root: instantiate a year + record misses.
- `PATCH /api/accounts/logs/:id` — status / remark / time / `lateNote`
  (writing `lateNote` records the resolution, status untouched).
- `POST /api/accounts/logs/:id/files` · `DELETE /api/accounts/files/:id`.
- `GET /api/accounts/export?from&to&shape=thread|daily` — root (default thread:
  one row per task × lane with the window's entries inline).
- `GET /api/accounts/roster|templates` + writes — root.
- `POST /api/trigger/accounts` — manual/backfill rollover.
