# Instructions for AI coding agents (OpenCode, Claude Code, Codex, Cursor …)

This repository has a **locked core** and an **editable automation layer**.

## You MAY change
- `prisma/schema/automation.prisma` — dashboards, reports, saved views, automation rules, AI agent definitions/runs, insights, custom fields, feature flags, and new tables for new dashboard/automation features.
- `prisma/sql/automation/` — SQL for automation-schema objects (views over core, indexes on automation tables).
- Application code for dashboards and automations.

## You MUST NOT change (CI will reject the change)
- `prisma/schema/core.prisma` — the core data layer.
- `prisma/schema/legacy.prisma` — frozen pre-core tables.
- `prisma/sql/core/**`, `prisma/core.lock`, `scripts/schema-guard.mjs`
- `AGENTS.md`, `CLAUDE.md`, `opencode.json`, `.claude/**`, `.github/**`, `.githooks/**`
- Never run `node scripts/schema-guard.mjs --sign`, never commit with `--no-verify`, never work around these rules with shell commands (`sed`, `cp`, `mv`, `chmod`, `git checkout --`) on locked files.

If a task truly needs a core change, **stop and write a proposal** in `docs/core-change-requests/<date>-<topic>.md` describing the model/field, why, and the migration. A human reviews and applies it.

## Rules inside automation.prisma
1. Every `model` and `enum` uses `@@schema("automation")`.
2. No relation fields to core models. Reference core records by id only:
   `customerId String @db.Uuid // → core.Customer` — no `@relation`.
3. Never make automation the source of truth for business facts (amounts, stages, stock, prices). Derived/cached tables must be rebuildable from core and named as such (`…Snapshot`, `…Cache`).
4. Change core data only by calling the core service layer (it enforces permissions, writes the audit trail and emits `DomainEvent`s). Never `INSERT/UPDATE/DELETE` core tables directly, in code or SQL.
5. React to core changes by consuming `core.DomainEvent` via `EventConsumerCursor`, not by polling business tables.
6. Need an extra field on a core record? Use `CustomFieldDefinition` / `CustomFieldValue`.
7. New dashboards declare `requiredScreenKey`; access is granted by core `PermissionRule`s (`entityType = "screen:<key>"`), which you cannot grant yourself.

## Before finishing any task
Run `node scripts/schema-guard.mjs` and `npx prisma validate --schema prisma/schema`. Both must pass.
