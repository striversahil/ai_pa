# Rewrite log — /automations vs /session split + duplication cleanup

Rules and design: the `founder-os-codekeeper` skill (`references/automation-vs-session.md`,
`references/rewrite-plan.md`). One line per commit below. Metrics come from
`node scripts/dup-audit.mjs .`; the floor is `scripts/guards/rewrite-baseline.json`.

## Decisions (founder, 2026-11-12)

1. Telecalling + NeoDove report workspace data stay readable without login on the new
   `/api/session/workspaces/<slug>/data` path, same as the old `/api/automations/<slug>/data`.
   Encoded as `publicData: true` in `modules/workspaces/catalog.ts`; only those two.
2. Admins (`me.isAdmin`) land on `/automations` at `/`; everyone else lands on `/session`.
3. Nav label for `/session` is **Workspace**.

## Known pre-existing failures (do not "fix" inside unrelated work)

- `scripts/guards/d1-parity.test.mjs` › "no stale registry keys": `Core*`/`Hlp*` models live in
  `prisma/core/`, which the guard doesn't read. Fixing touches the locked core → proposal needed.
- `scripts/guards/gateway-pool.test.mjs` cancelled unless the worker bundle was built first.
- Backend `npx tsc --noEmit`: 48 errors at baseline (prisma client not generated in CI-less
  envs + `durable/*`, `zoho-sent-analyzer`, `field-staff.ts`). Gate = no NEW errors.

## Open gap found during the split (needs a founder decision, NOT changed)

`GET /api/automations/:slug/data` (and therefore `/api/session/workspaces/:slug/data`) has no
generic permission check: any signed-in user can read any provider's payload except
`debtors-tracker`, `master-data`, `reporting-sheet` (which have explicit scopers). The
Samarth/Sahil overview dashboards depend on this by reading other dashboards' data from the
browser (`hooks/useOverviewData.ts`). Tightening it needs a server-side overview aggregator
first. Tracked as a follow-up; behavior preserved byte-for-byte here.

## Commits

| # | Phase | Commit | Metrics moved |
|---|---|---|---|
