# Core change proposal: designation assignment write + position-derived access — 2026-11-12

## Model / field
`CoreEmpPosition` (+ `CoreEmpDept`, `CoreEmpRegion`) write path; effective-scope
resolution (position roles ∪ direct grants) in backend scoping + frontend
`canView` mirror. Reads already live (`GET /api/auth/core-assignments`).

## Why (business reason)
Founder decision 2026-11-12: HR assigns one department → designation per login;
dashboards auto-enable from the designation instead of root hand-granting every
scope/role. Helpers (`hlp_*`) cannot cover this — it is the access surface.

## Proposed shape
- `PUT /api/auth/core-assignments/:userId` (HR-only gate: root / user-admin /
  human-resources holders; same `canManage` split as the read side — HR assigns,
  only managers+root touch roles/scopes directly).
  Body: `{ positionId, departmentId?, reason? }`.
- Service (in `src/modules/core/`, human-written): close any open primary
  `core_emp_position`/`core_emp_dept` rows for the employee (`validTo=now`,
  `reason`), insert the new primary rows, resolve `employeeId` via
  `core_user_link` (email-exact link must already exist — HR links the login
  first; never name-guess), stamp `reason` + actor.
- One primary designation enforced: a second primary write retires the first
  (history preserved via `validTo`, never deleted — triggers already forbid
  `DELETE` on these tables).
- Access union (separate step, same sign-off): effective scopes = position-role
  scopes (`core_position_role` → `core_role`) ∪ direct user scopes/roles.
  Served access unchanged at flip (union only adds); replace-manual needs a
  login-by-login audit + founder sign-off.

## Migration
No migration: tables + seeds exist (0126). Backfill already converged via
`mirrorRosterRow` dual-write (33 primary positions live).

## Audit / permission impact
Every assignment writes `core_audit_event` (actor = HR editor, reason required
— empty reason rejected). Sensitive: none beyond existing roster PII. Scope:
HR assigns designations; HR cannot grant scopes/roles directly (unchanged).

## Reviewer decision
<!-- APPROVED / REJECTED + signature + date. On approval, human edits core + re-signs lock. -->
PENDING.
