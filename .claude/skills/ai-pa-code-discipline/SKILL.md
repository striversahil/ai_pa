---
name: ai-pa-code-discipline
description: Rules and workflow for any AI agent that writes, edits, refactors or cleans up code in the striversahil/ai_pa repository (frontend components, backend APIs, the /automations registry and /session workspace features). Use this skill whenever the task touches ai_pa code, adds or changes a page, component, hook, API route, service or schema, touches the /session page or /api/session endpoints, or involves removing duplicate code, ad-hoc rewrites or mess. Use it even for small edits, because the main failure in this repo is agents adding new code instead of reusing existing code.
---

# ai_pa Code Discipline

This skill exists to stop three recurring problems: **duplicate code**, **messy ad-hoc rewrites**, and **blurred boundaries** between features. It also governs how `/session` (viewer workspaces) and `/automations` (registry/admin) stay separate siblings on shared code.

> **Precedence.** `AGENTS.md` (root) is authoritative — especially its "Automation vs Session boundary" and "Coding practices" sections, which are the short form of this skill. `architecture.md` §16–§18 describes the machinery (catalog, guards, duplication baseline + ranked debt). This skill is the long form: workflow, audit procedure, decision table. Never trust a path in this file over what is actually in the repo — re-check with `rg`/`ls` and fix this file if it drifted.
>
> **Existing tooling — use it, don't rebuild it:** `docs/REUSABLE_COMPONENTS.md` (search here first), `scripts/dup-audit.mjs` + `scripts/guards/rewrite-ratchet.test.mjs` (ratchet), `scripts/refactor/split-module.mjs` (extract + re-export splitter), `docs/rewrite-log.md` (log of cleanup commits + known pre-existing failures), `founder-os_backend/scripts/{workspace-parity,route-parity,session-e2e}.mjs` (before/after data parity), `scripts/e2e/` (UI).

---

## 0. Prime directives

1. **Search before you write.** Before creating any component, hook, function, type, schema, route or util, search the repo for an existing one that does the same job. Extend it if it is close. Only create new code when nothing fits, and say so in your summary.
2. **One concept, one home.** Every piece of logic, UI, type or constant lives in exactly one place. If you need it in two features, it moves to shared code. It is never copied. (Backend↔frontend mirrors required by AGENTS.md — `queues.ts` ↔ `src/<domain>/queue.ts` etc. — are the one sanctioned exception; they carry a comment naming their mirror and a guard test.)
3. **Refactor in place, in small steps.** No "rewrite the file from scratch". Extract + re-export (AGENTS.md), keep behavior identical, verify, continue. `scripts/guards/rewrite-ratchet.test.mjs` enforces this. A rewrite is allowed only if the owner explicitly asks, and then it still ships as reviewable steps.
4. **Leave the code smaller or equal.** Every task that adds code must also remove the code it makes obsolete (old copies, dead imports, unused props, commented-out blocks, unused files).
5. **Don't touch what you weren't asked to touch.** Unrelated cleanups go in a separate, clearly labelled change.
6. **Behavior-preserving first, feature second.** Refactors and features never share a step.
7. **Never edit the locked ERP core** (`prisma/core/`, `src/modules/core/`, `src/worker/routes/work.ts`, migration `0125`, `scripts/core-guard.mjs`). Propose changes in `docs/core-change-requests/`.

---

## 1. Phase 0: Audit (on first non-trivial change in a session, then refresh when stale)

Record results in the existing root **`architecture.md`** §18.4 (one home — do NOT create a second `docs/ARCHITECTURE.md`). Start from the baseline and ranked debt already there; refresh the numbers rather than re-deriving everything. Fix drift you find as you go.

Collect:

- **Route inventory**: Worker routes = `founder-os_backend/src/worker/routes/*.ts` (registered from `src/worker.ts`). Express `src/routes/` is FROZEN — inventory it only to delete/delegate, never to extend. Frontend views = hash routes in `founder-os_frontend/src/app/page.tsx` + `src/views/*` + workspace registry `src/workspaces/registry.tsx`.
- **Component inventory**: `founder-os_frontend/src/components/` with importers (`rg "from .*<name>"`).
- **API-call inventory**: every frontend backend call. Flag inline `fetch(` inside `components/` (≈64 files at time of writing) — those are migration candidates to a domain `api.ts`/hook.
- **Duplication report**: `npx jscpd --min-lines 6 --min-tokens 50 founder-os_frontend/src founder-os_backend/src scripts` plus `rg` for repeated fetch calls, zod shapes, prompt strings, error handling, `inr`/date formatters (canonical: `src/lib/format.ts`, guarded by `format-canonical.test.mjs`).
- **Ad-hoc smells**: files over ~400 lines (AGENTS.md split threshold), components with inline fetch + state + markup, route handlers with domain logic, `utils`/`helpers`/`misc` dumping grounds, `v2`/`new`/`old`/`copy`/`final` names (e.g. stray `schema (1).prisma`), commented-out code, hard-coded URLs/model names/magic strings, two ways of doing one thing.

Output a short ranked list: *what is duplicated, where, and the proposed single home.* Show the owner before large moves if anything is ambiguous.

### Repo Facts (verified 2026-11-12)

| Item | Value |
|---|---|
| Frontend framework / router | Next.js 16 static export (App Router shell `src/app/page.tsx`, hash routing via `useHashRoute`); build MUST be webpack (`npm run build`) |
| Backend framework / language | TypeScript. Live: Hono on Cloudflare Worker + D1 (`src/worker.ts` → `src/worker/`). Frozen alt: Express (`src/server.ts`, `src/routes/`) |
| Frontend shared components dir | `founder-os_frontend/src/components/` |
| Frontend domain dirs | `src/<domain>/` (`enquiry/` is the reference: `queue.ts`, `normalize.ts`, `pricing.ts`), data hooks in `src/hooks/` |
| HTTP client | `src/api/client.ts` (+ `src/hooks/useApi.ts`); live data via `src/hooks/useLiveData.ts` (`useLiveDashboard`, `useOptimisticMutation`) |
| /automations page entry | `src/views/automations/AutomationsView.tsx` (registry/admin: enable, pause, config) |
| /session page entry | `src/views/session/SessionView.tsx` ("Workspace"; dashboards at `/session/<slug>`) — renders via shared `src/workspaces/` (`WorkspaceFrame`, `useWorkspaces`, `registry.tsx`, `api.ts#workspaceDataUrl`, `useWorkspaceHost`). One catalog: backend `modules/workspaces/catalog.ts` ↔ FE `src/workspaces/aliases.ts` |
| Backend /automations routes | `src/worker/routes/automations.ts` (+ `modules/automation/registry-worker.ts`) |
| Backend /session routes | `src/worker/routes/session.ts` (read-only) → `modules/workspaces/{catalog,scoping,service,resolvers}.ts`, `worker/viewer.ts`, `worker/workspace-data.ts` |
| Backend module pattern | `src/modules/<domain>/` types · parse · queues · scopes · redaction · update · routes · store (reference `modules/enquiries/`) |
| Checks (no test suite) | `node --test "scripts/guards/*.test.mjs"` (CI: `.github/workflows/guards.yml`) · `cd founder-os_backend && node scripts/build-worker.mjs && node scripts/smoke-worker.mjs` · `npx tsc --noEmit` (known pre-existing errors: `durable/*.ts`, `zoho-sent-analyzer/service.ts`) · frontend `npx tsc --noEmit` + `npm run build` + `npm run lint` · `node founder-os_backend/scripts/core-guard.mjs` |
| Deploy | Per AGENTS.md: deploy every change, backend first. Never `source .env`. |

---

## 2. Target architecture (as it applies to THIS repo)

### 2.1 Backend: sibling features on shared modules

- **`/api/session/*` and `/api/automations/*` are siblings.** `routes/session.ts` is the viewer side (read-only, scoped to the viewer); `routes/automations.ts` is the registry/admin side. Neither route module imports the other. Shared logic lives in `src/modules/workspaces/`, `src/modules/automation/`, `src/worker/viewer.ts` / `workspace-data.ts`, or `src/shared/`.
- **Do NOT re-prefix existing domain endpoints** (`/api/enquiries`, `/api/crm`, `/api/telecalling`, …) under `/api/automation(s)` or `/api/session`. They are live, consumed by the frontend and runners. New endpoints go in the Worker route module for their domain, Worker-only.
- **Route handlers are thin orchestrators**: parse input → scope check → one store/service call → broadcast. No D1 queries, LLM calls or branching business rules inline. Target ≤ ~20 lines per handler.
- **One of each cross-cutting thing** — already exists, reuse it:
  - config/env: `bootstrapEnv` / `deps()` in `worker/context.ts`
  - DB: `deps().prisma` (the `prisma-d1.ts` shim) or `c.env.DB` for raw D1 paths
  - LLM: `getGateway(env)` in `src/shared/ai-gateway.ts` (runners: `scripts/ai-gateway.js` via `runner-lib.js`) — never a second client
  - cache: `cached()` / `cacheDel*` in `src/shared/cache.ts`
  - auth: `getViewer`, `requireSecret`, `requireMisScope`, `requireSalesManager` in context/viewer
  - live updates: `broadcastLive` / `notifyLive` (auto `data-changed` already covers new writes)
  If you find a second one, merge it.
- **Dependency direction:** `worker/routes → modules/<domain> → shared/`. Never the reverse, never sideways between route modules.
- **Shared modules stay dual-runtime/edge-safe** — no Node-only deps in `src/modules/*`, `src/shared/*`, `src/automations/*`.
- **Path changes:** if an existing path must move, keep the old one as a thin alias until the frontend is migrated, then delete it. Never leave both forever.

### 2.2 Frontend: views compose, domains own logic, components are shared

- **`src/components/` is shared UI.** New components there take **props and callbacks**; they do not call the backend or hardcode `/automations` / `/session`. Existing components with inline `fetch` are legacy — when you touch one, move its fetch into the domain's `api.ts`/hook as a separate behavior-preserving step.
- **Views compose.** `views/session/*` and `views/automations/*` stay thin and render through the shared `src/workspaces/` layer and existing dashboards. `/session` reuses the same dashboard components the registry links to, with server-side viewer scoping — never a forked copy.
- **One HTTP client** (`src/api/client.ts` / `useApi`) and **one live-data layer** (`useLiveData.ts`). No second fetch wrapper, state library or socket.
- **Never fork a component for `/session`.** If an existing component almost fits: add a prop or slot with defaults that keep the other caller identical; verify both views. If too tangled, first split container logic into a hook and markup into a presentational piece, as its own step.
- **No `SessionFoo` copy of `Foo`.** Names like `FooSession`, `FooV2`, `NewFoo` are a stop sign.
- **Types/predicates mirror backend** with the same names and a comment naming the mirror path; change both sides together.

---

## 3. Workflow for every task

1. **Restate** the task in one or two lines and name the layer(s) touched (component / view / domain module / Worker route / shared / runner).
2. **Search** for existing code (`rg`, file tree, import graph). List what you found and what you will reuse.
3. **Plan** the smallest change set. If it exceeds about 5 files or mixes refactor and feature, split it into steps.
4. **Implement** step by step. After each step run the checks in Repo Facts and confirm behavior is unchanged.
5. **Delete** what the change made obsolete. `rg` the symbol and path before deleting.
6. **Deploy** per AGENTS.md (backend first, then frontend).
7. **Report** in this format:
   - Reused: ...
   - Added (and why nothing existing fit): ...
   - Removed: ...
   - Moved to shared: ...
   - Verified by: ...
   - Not done / follow-ups: ...

---

## 4. Cleanup plan (each phase its own change; app stays working and deployed)

- **Phase 0 — Audit.** As in §1; update `architecture.md`; produce the duplication report.
- **Phase 1 — Safety net.** Extend `scripts/guards/` (zero-dep `node --test`) rather than adding a test framework: route-shape smoke in `smoke-worker.mjs`, mirror/parity guards for anything duplicated across backend↔frontend.
- **Phase 2 — Consolidate cross-cutting code.** Route remaining direct `fetch` in components through domain `api.ts`/hooks on `api/client.ts`; collapse duplicate formatters/error shapes into the existing canonical modules.
- **Phase 3 — Backend thinning.** Move inline logic out of fat Worker route handlers into `modules/<domain>/` (extract + re-export). Keep retiring Express mirrors (delegate to shared cores, then delete).
- **Phase 4 — Frontend separation.** Pull inline fetch/state out of `components/` into `src/<domain>/` + `hooks/`; make components props-driven.
- **Phase 5 — /session.** Already exists (backend `routes/session.ts` + `modules/workspaces/`, frontend `views/session` + `src/workspaces/`). Extend it only by composing shared workspace components and server-side scoping (`modules/workspaces/scoping.ts`, never `if (slug === …)` in a route); new viewer endpoints go under `/api/session/*`, read-only. `GET /api/automations/:slug/data` is a deprecated alias — retire it once nothing calls it.
- **Phase 6 — Lock-in.** Add the guardrails in §6 to `scripts/guards/` + `guards.yml`; record duplication numbers in `architecture.md`.

---

## 5. Anti-patterns (stop and rethink if you catch yourself doing these)

- Copy-pasting a file and renaming it "for session".
- A boolean prop that flips half the component into a different component — prefer composition/slots or split.
- An API call, `useEffect` fetch or business rule inside a new shared component.
- A route handler longer than about 20 lines.
- A `utils` function used once, or a `utils` file mixing unrelated topics.
- `routes/session.ts` importing `routes/automations.ts` (or the reverse); `views/session` importing `views/automations` (or the reverse).
- A second HTTP client, LLM client, cache helper, error format, logger or config loader.
- Adding a new Express endpoint (Express is frozen).
- Rewriting a whole file to change a few lines.
- Leaving old and new implementations side by side "just in case".
- Hard-coded URLs, model names, prompt text or magic numbers repeated across files.
- Silencing lint or type errors instead of fixing them.

---

## 6. Guardrails (add to `scripts/guards/`, keep green in CI)

- **Import boundaries:** guard that `views/session` ↛ `views/automations` (and reverse), `components/` ↛ `views/`, `worker/routes/session.ts` ↛ `worker/routes/automations.ts`.
- **Duplication budget:** `jscpd` with a threshold baseline; fail on increase.
- **Size limits:** warn above ~400 lines per file (AGENTS.md split rule) and ~50 lines per function/component.
- **No-rewrite ratchet:** keep `rewrite-ratchet.test.mjs` green.
- **One concern per commit**, with the report format from §3 in the message/PR body.

---

## 7. Quick decision table

| Situation | Do this |
|---|---|
| Need a UI piece for `/session` | Search `components/` + `src/workspaces/`; reuse or generalize via props/slots; never copy |
| Existing component fetches data itself | Move fetch to the domain `api.ts`/hook; pass data as props (separate step) |
| Both features need the same backend logic | Move it to `modules/<domain>/` or `src/shared/`; both import it |
| Two similar endpoints in different features | Keep both routes; share the service function underneath |
| Logic needed by both Worker and runner | Shared TS module + JS port with a parity guard (like `gateway-js-parity`) |
| Found duplicate code unrelated to the task | Note it in follow-ups; fix in a separate change |
| Unsure whether code is dead | `rg` for references, check git history; if still unsure, ask the owner |
| Task seems to require a rewrite | Propose a stepwise plan first; do not rewrite silently |
| Change touches ERP core | Stop; write `docs/core-change-requests/` proposal |
