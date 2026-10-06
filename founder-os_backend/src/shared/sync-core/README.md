# sync-core — shared logic for the Zoho sync pipelines (GH runners)

One copy of everything the Zoho Books sync runners share. Consumed today by
`scripts/zoho-sent-runner.js` (+ `scripts/zoho-sync/*`) and
`scripts/crm-runner.js` (plain-node `require`); written as framework-free
plain JS + JSDoc so the Cloudflare Worker bundle and Express can adopt it too
(worker TS adoption is Phase 3 — until then the Worker routes mirror
`contract.js`, NOT the reverse).

| File | Owns | Moved from |
|---|---|---|
| `contract.js` | Every shared identity: worker endpoint paths, KV keys, Setting keys, Zoho status sets, CRM stage vocabulary | inline literals in `persist.js`, `crm-runner.js`, `fetch.js` |
| `zoho-auth.js` | Curl-export credential parsing + lazy context (multi-org, primary-first) | `zoho-sync/fetch.js` (superset — also replaced crm-runner's older copy) |
| `zoho-net.js` | Single-attempt fetch + the two retry policies (estimates / CRM-list) + `sleep` + 429 backoff | `zoho-sync/fetch.js`, `crm-runner.js` |
| `zoho-dates.js` | `istDateString` (IST day boundary both pipelines key on) | both runners |
| `zoho-comments.js` | HTML cleaning, system-comment filter, IST timestamp ordering, sales-comment extraction | `zoho-sync/comments.js` (shim deleted 2026-10-05) |
| `zoho-orgs.js` | Org parsing, `<org>:<id>` DB namespacing, URL swapping, CRM snapshot key scheme | `zoho-sync/orgs.js` (shim deleted 2026-10-05) + crm-runner's `orgScope` |
| `estimate-changes.js` | Fingerprint build/parse/capped-tick merge, metadata diff, transitions, newcomer detection, work-item selection | `zoho-sync/diff.js` (shim) |

## Rules for editors

- New Zoho reads → runner files. New comparisons/filters/identity logic → here
  (keep it pure: no I/O, no env, no `process` — unit-testable).
- New worker endpoint / KV key / Setting key / status → `contract.js` FIRST,
  then use the constant on both sides. Never reintroduce a string literal a
  constant already covers.
- The two HTTP retry policies differ on purpose (estimates absorbs connection
  drops; CRM fails fast to its preservative heartbeat). Don't unify them
  without owning both failure paths.
- `crmOrgScope` (always-prefixed snapshot keys) and `dbEstimateId`
  (bare-for-primary DB ids) differ on purpose — see the header in
  `zoho-orgs.js`. Don't unify without migrating stored snapshots/DB rows.
- Fingerprint invariant (2026-09-28 + 2026-09-30 incidents): the stored value
  may only ever contain comment ids already persisted in D1. `merge-` logic in
  `estimate-changes.js` is the only capped-tick writer; keep it that way.
- Verify with `node --check` + a `node -e` assertion for pure-logic changes.
  There is no test suite yet (Phase 2) — the assertions are the suite's seed.
