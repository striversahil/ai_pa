# Core change request: drop `mis` from `resolveCaller` (MIS retirement)

Date: 2026-11-12
Status: PROPOSED (needs human re-sign — agents must not edit `src/modules/core/*`)

## What changed around it

Founder decision 2026-11-12: the MIS name is deleted from the system. The
`mis` auth scope and `mis` role are removed (migration `0139_drop_mis.sql`),
every `requireMisScope`/inline `scopes.includes('mis')` gate in
`src/worker/`, `src/modules/*` (non-core), `src/automations/*`, and the
frozen Express layer became root-only, and `mis.themilling@gmail.com` keeps
only `zoho` + `user-admin` as direct grants.

## Requested core edit (one line)

`src/modules/core/permissions.ts:46`, inside `resolveCaller`:

```ts
if (scopes.includes('sales-head') || scopes.includes('mis') || scopes.includes('user-admin')) {
```

→

```ts
if (scopes.includes('sales-head') || scopes.includes('user-admin')) {
```

No table, type, or migration change — the D1 rows are already gone via 0139,
so `scopes.includes('mis')` is dead-false in production either way. This edit
is cosmetic-completeness (zero remaining `mis` hits outside debtor-sheet CSV
data columns), not behavioral.

## Verification for the re-sign

- `node scripts/core-guard.mjs` green before and after (path-only change).
- `node --test scripts/guards/*.test.mjs` — the no-`mis` guard allowlists this
  single line until the edit lands.
- Backend `tsc` shows no new errors; `smoke-worker.mjs` 63 PASS.
