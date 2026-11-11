# BUI CRM: core data layer + automation layer

Two layers in one PostgreSQL database:

| | Core (`core` schema) | Automation (`automation` schema) |
|---|---|---|
| File | `prisma/schema/core.prisma` | `prisma/schema/automation.prisma` |
| Who edits | Humans only, via reviewed PR | AI agents and humans |
| Holds | Master data, enquiry → estimate → order → stock → dispatch → invoice → payment, GST, ledger, permissions, actions + escalation, approvals, notifications, audit | Dashboards, reports, saved views, automation rules, AI agent runs and insights, custom fields, feature flags |
| Protected by | `core.lock` checksum + CODEOWNERS + agent deny rules + DB triggers | Audited automatically; may only reference core by id |

`prisma/schema/legacy.prisma` holds your current 105 tables (`public` schema), unchanged, so the running app keeps working while modules move into core. It is frozen: models are only ever deleted from it.

## Layout

```
prisma/
  schema/core.prisma            🔒 core data layer (also holds datasource + generator)
  schema/automation.prisma      ✏️ AI-editable
  schema/legacy.prisma          🔒 frozen, shrinks as modules migrate
  sql/core/001_core_platform.sql  🔒 audit triggers, immutability, numbering, ledger checks, views
  sql/core/002_seed_platform.sql  🔒 roles, permissions, stage gates, approvals, escalations
  sql/automation/               ✏️ automation SQL (read-only on core)
  core.lock                     🔒 checksums of every locked file
scripts/schema-guard.mjs        🔒 the lock enforcer (pre-commit + CI)
AGENTS.md, CLAUDE.md            🔒 agent instructions
opencode.json, .claude/settings.json  🔒 agent edit-deny rules
.github/CODEOWNERS, .github/workflows/schema-guard.yml, .githooks/pre-commit  🔒
tests/scenario.sql              end-to-end checks of the core guarantees
```

## One-time setup

1. Prisma 6.7+ with the schema folder: add `"prisma": { "schema": "prisma/schema" }` to `package.json` (or pass `--schema prisma/schema`).
2. Replace `@your-github-username` in `.github/CODEOWNERS`. In GitHub branch protection for `main`: require the `schema-guard` check and **Require review from Code Owners**.
3. `git config core.hooksPath .githooks`
4. Sign the lock yourself (never an agent): `node scripts/schema-guard.mjs --sign`, then commit `prisma/core.lock`.

## Creating the database objects

1. Generate DDL against the live database:
   `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema --script > prisma/migrations/<ts>_core_init/migration.sql`
   Check it contains **no** `DROP` statements on `"public"` tables. If it does, `legacy.prisma` differs from the live tables. Fix that first.
2. Apply it, then run as a superuser: `001_core_platform.sql`, then `002_seed_platform.sql`.
3. Optional check on a scratch copy: `psql -f tests/scenario.sql` (every line should read PASS).
4. Re-run `001_core_platform.sql` after every core migration. It is idempotent and attaches audit triggers to new tables.

## Runtime contract (for the core service layer)

- Every write transaction starts with `SELECT core.set_actor('<EMPLOYEE|SERVICE_ACCOUNT|SYSTEM>', '<id>', '<request id>')`. The row trigger stamps that actor on every change in `core."RowChangeLog"`.
- Every read served to the dashboard writes one `core."AccessLog"` row: the record viewed, or the ids returned on a list or search page, plus any sensitive fields shown.
- Permission checks happen in the service, not the UI. A user's rules = roles of their current positions + directly granted roles (`PermissionRule`, scoped via `EntityAccessConfig`).
- Order stage changes go through one function. It checks the `TRANSITION` permission and every `StageGateRule` for the target stage, inserts `SalesOrderStageEvent`, emits a `DomainEvent`, and opens the next department's `BusinessAction`.
- Document numbers come only from `core.next_document_number(...)` inside the creating transaction.
- The escalation sweeper runs every few minutes and logs to `SystemJobRun`. It selects open actions with `nextEscalationAt <= now()`, applies the next `EscalationStep`, notifies, and schedules the following step.

## Moving off legacy tables and Zoho

1. **Masters:** legal entities, employees, customers, suppliers, products, opening stock. Record every imported row in `ExternalReference` (`LEGACY_BUI` / `ZOHO_BOOKS`).
2. **Sales:** new enquiries and estimates in core. Import open Zoho estimates with their lines through the Zoho API, and keep closed ones as reference history.
3. **Orders and dispatch:** new sales orders in core; finish in-flight Zoho orders in Zoho.
4. **Finance cut-over at a month start** (ideally 1 April):
   - Open invoices come in as opening receivables.
   - The trial balance comes in as an opening journal.
   - E-invoicing and e-way bills go live through a GSP (`IntegrationCommand`).
   - Run Zoho in parallel for one month, then switch it to read-only.
5. **Retire legacy models** from `legacy.prisma` as each screen moves to core.

Have your CA confirm the following before step 4: the chart of accounts, GST rates per HSN, e-invoice applicability for each GSTIN, and the posting rules.
