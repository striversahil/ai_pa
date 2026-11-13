# Rewrite log — /automations vs /session split + duplication cleanup

Rules and design: AGENTS.md ("Automation vs Session boundary", "Coding practices"), architecture.md
§16/§18, and the skill `.claude/skills/ai-pa-code-discipline/` (replaces the off-repo
`founder-os-codekeeper` skill). One line per commit below. Metrics come from
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
| 10 | P6 | Frontend: 30 oversized UI files split by `scripts/refactor/split-module.mjs` into per-component files (e.g. `components/sales-controller-panel/RosterSection.tsx`), originals re-export; browser sweep of all 21 workspaces + tabs, 0 page errors | FE files >400: 35→24 |
| 11 | P6 | Backend: 27 oversized services/modules split into `<name>-parts/{types,pure,io}.ts` — `pure.ts` never does I/O (reusable without a DB), `io.ts` = DB/cache/network; originals re-export. Excluded: routes, locked core, D1 shim, Express, context/cron, redirect twins, zoho-sent-analyzer (__dirname), and 3 files whose split changed TS inference (chat-tools-pricing, estimate-link, digital-marketing/service). `scripts/route-parity.mjs`: 125 GET routes × anon/root, 250/250 identical vs pre-split (2 differ only in a minified stack-frame name) | BE files >400: 45→35 |
| 12 | P6 | `src/lib/format.ts`: one home for money/date formatters, one named export per distinct behavior (inr, inrWhole, inrRounded, inrRoundedOrZero, inrShort, fmtDay, fmtDayMonth, fmtDayYear, fmtShortDate); 16 local copies now re-export it; guard `format-canonical.test.mjs` runs frozen legacy copies vs canonical on 30 edge inputs (8/8 identical). Remaining copies have genuinely different output. | inr 14→7, date 12→4 |
| 13 | P6 | Fix: split classifier now treats async/await/.then as I/O; 9 services re-split from source so every `pure.ts` is provably free of async I/O (audit: 0 hits across 27 pure.ts). `components/ui` now exports Modal, ConfirmDialog, Popover. `docs/REUSABLE_COMPONENTS.md` lists all 192 importable files. NOTE: backend `io.ts` halves remain large (up to ~1.8k lines) — splitting I/O by business concern needs design, not a mechanical tool. | — |
| 14 | P6 | `DebtorsTrackerDashboard` modal stack (import / invoice / contact / situation / ledger) extracted to `components/debtors-tracker/DashboardModals.tsx` — fixes the ratchet regression `7d89669` introduced (394→411 lines, CI red on main). Parent keeps state + mutation wiring; the extracted file is props-only. | FE files >400: 25→24 (floor) |
| 15 | — | MIS role retired system-wide (`4a8adde`, migration 0139): scope + role + `requireMisScope` deleted, ex-MIS endpoints root-only (`requireAdminScope`), `mis.themilling@gmail.com` keeps zoho + user-admin direct. Guard `no-mis-role.test.mjs` (allowlist: debtor CSV data + 2 locked-core lines pending human re-sign). | — |
| 16 | — | HR Organization tab (`components/human-resources/OrganizationTab.tsx` + `OrgNodeCard`/`OrgPositionPicker`/`OrgLoginMapRow`) built on one chart module `hr/organization.ts` (verbatim `organization.json` mirror, `count` dropped from the read model, seats from the HR master). Employee form's free-text Designation/Department replaced by the chart picker; the unmapped-logins queue left the HR Employees tab and the Sales Controller (its one home is now the tree node) — `RegisterMappingSection` + `RosterMappingSection` deleted, Map/Link row extracted, not forked. Guard `org-chart-parity.test.mjs` (10 cases). | FE raw fetch 168→167 |
| 17 | — | Org chart is one graph + one person save: React Flow node graph (`src/org/`: canvas ~40-line layered layout + node + inspector rail + person drawer) mounted in HR (all depts) and Sales Controller (`department="Sales"`); `PUT /api/org/people/:id` (`modules/org/`: access pure · read · write · types, io re-export) owns position/region(s)/tlLevel/WhatsApp/office phone/NeoDove/access/active via existing services (tlPairError, normalizeAgentPhone, updateEmployee, setUserScopes, mirrorRosterRow — never rewritten); `canManagePerson` = root/admin all, HR all, sales-head → Sales, dept scopes → own dept. Retired: Controller roster editor, `/api/telecallers` POST/PUT/DELETE + `/from-directory` + `/link`, `OrgNodeCard`/`OrgLoginMapRow`, `src/telecalling/api.ts`; GET roster stays (Export + field-staff picker). Guards: new `org-access.test.mjs` (10 cases), `no-mis-role` allowlist extended for the chart-title mirror. Ratchet held (be files >400: 36, fe local_date_formatter: 4). | net ~flat (shed ~5 concepts, added graph + 2 endpoints) |
