# Accounts

Recurring accounts/compliance taskbar — the accounts-team equivalent of the
telecalling roster + MIS controller.

Files:

- `index.ts` — `handler()` rolls today's task instances forward + flags
  overdue; `data` serves `GET /api/automations/accounts/data`.
- `service.ts` — everything: roster, templates, log instances, dashboard agg.
- `rule.json` — handler, daily `30 3 * * *` (03:30 IST rollover), scope `accounts`.

## Concepts

- **Accountant** — roster row (`name, role senior|junior, order, deleted`).
  MIS maps who is senior vs junior from the Controller tab
  (`/api/accounts/roster`, MIS-only writes).
- **AccountsTaskTemplate** — recurring definition (`title, frequency
  daily|weekly|monthly|quarterly|yearly, ownerRole senior|junior|either,
  dueDay, dueMonth, active`). MIS-owned (`/api/accounts/templates`).
- **AccountsTaskLog** — one instance per `(templateId, dueDate)`. Accountants
  log `done|skipped` + free-text `remark` from the taskbar; anything still
  `pending` past its due date reads `overdue` (derived at serve time, and
  materialised by the daily handler).

Due-date grammar (`ruleType` + `ruleJson`, source of truth
`data/accounts_follow_up.json`): `not_applicable` (daily → every working day
Mon–Sat), `fixed_day` {day, month|null}, `day_range` {start_day, end_day,
month|null} (due every day inside the window), `multiple_days` {days,
month|null}, `weekday` {weekday, occurrence every|first|last|…},
`week_of_month` {week_number, month} (due every day of that week slice),
`month_day_range` {start{day,month}, end{day,month}} (due every day in range,
year-wrap aware), `multi_occurrence` {occurrences[]} (any match wins).
`variable_per_item` / `to_be_decided` never auto-instantiate — they render in
the dashboard's "No fixed date" reference section. Templates without
`ruleJson` (simple MIS-created rows) fall back to frequency + dueDay/dueMonth.

Seeds: `node scripts/gen-accounts-seed.mjs` regenerates `seed-tasks.ts`
(fresh-DB fallback) + `migrations/0032*` from the JSON. Live seed = the
migration; `ensureSeedTemplates()` only fires on empty tables.

## Endpoints (worker `routes/accounts.ts`, mirrored in Express)

- `GET /api/automations/accounts/data?date=YYYY-MM-DD` — taskbar payload.
- `GET /api/accounts/roster` (MIS) · `POST/PUT/DELETE /api/accounts/roster`
- `GET /api/accounts/templates` (MIS) · `POST/PUT/DELETE /api/accounts/templates`
- `PATCH /api/accounts/logs/:id` — log status + remark (accounts scope).
- `POST /api/trigger/accounts` — daily rollover (secret-gated, like telecalling).
