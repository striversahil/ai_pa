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
| 1 | P1 | `worker/http.ts` (readBody, authErrorResponse) + `worker/viewer.ts` (memoised getViewer); auth gate/chatMe/enquiryMe use it; resolveSelfTelecaller → `modules/telecalling/self-roster.ts` | getme 56→52 |
| 2 | P1 | WhatsApp Marketing endpoints → `worker/routes/whatsapp-marketing.ts` (verbatim; re-export kept) | non-registry routes in automations.ts 8→0 |
| 3 | P2 | `modules/workspaces/catalog.ts` = single dashboard/alias list; DASHBOARD_SLUGS + public AUTH_EXEMPT paths derived from it; guard `workspace-catalog.test.mjs`; parity harness `scripts/workspace-parity.mjs` (60/60 vs main) | be alias literals 6→5 |
| 4 | P2 | Per-slug viewer scoping → `modules/workspaces/scoping.ts` (+ `resolvers.ts`, `service.ts`, `worker/workspace-data.ts`); old data route is a deprecated alias of the shared handler; guard `workspace-scoping.test.mjs` (16 cases); parity 60/60 vs main | slug branches in routes 8→0, getMe 52→45, AuthError catches 8→5 |
| 5 | P2 | `worker/routes/session.ts`: GET /api/session, /api/session/workspaces, /api/session/workspaces/:slug/data; `session` added to BOOT_PATH_RE; public telecalling/NeoDove paths exempt via catalog; `scripts/session-e2e.mjs` (19 checks, seeded viewers); new path == main old path on 60/60 parity cases | — |
| 6 | P6 | Session lookup sweep: 43 copies in 20 route files → `getViewerMe(c)` (identical expression; `work.ts` locked, untouched; `crm-attachments.ts` passes the raw cookie to getMe — likely bug, left for founder) | getMe 45→2 |
| 7 | P3 | Frontend `src/workspaces/` (api, aliases mirror, registry, host, frame, pins, useWorkspaces); 25 dashboard fetches → `workspaceDataUrl()` on /api/session | FE hardcoded data URLs 26→0, raw fetch 192→168 |
| 8 | P4–5 ⚑ | `/session` Workspace page (`views/session/SessionView.tsx`) + `/automations` slimmed to the registry console (`views/automations/AutomationsView.tsx`); dashboards live at `/session/<slug>` for everyone; legacy `/automations/<slug>` + alias slugs redirect (replace); admins land on /automations, others on /session; sidebar reads /api/session/workspaces; overview 'Open' links fixed (were inert hash links); browser e2e `scripts/e2e/` 19/19 | FE alias literals 10→1, automations nav 3→0 |
| 9 | P6 | Body-parse sweep: 195 copies of `c.req.json().catch(() => ({}))` → `readBody(c)` (worker/http.ts); 4 with different fallbacks left as-is; `work.ts` locked | json body catch 199→4 |
