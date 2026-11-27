# Core change proposal: batched receivable mirror — 2026-11-27

## Model / behaviour
`mirrorReceivables(invoiceIds?)` (`modules/core/finance.ts`) keeps `core_receipt` in step with the
open debtor invoices. Nothing about the DATA changes — only how the statements are issued.

## Why (business reason)
The mirror currently issues **two D1 queries per open invoice**: `resolveMasterId()` (one
`SELECT … FROM "MasterCustomer" WHERE displayName = ? OR companyName = ? LIMIT 2`) plus an
`UPDATE "core_receipt"` per row. On the live book (582 open invoices) that is 1,168 queries on
**every** debtors import, collections import, invoice delete and reset — and it grows with the book
forever. It was the largest single contributor to the 503s on big pastes (2026-11-27): a 582-row
re-paste ran for ~2 minutes and was killed by the platform with a partially applied sheet. The
import path now defers the mirror to `waitUntil`, which stops the 503 but does not stop the cost:
a paste still spends ~1,200 queries on a background task whose failure is silently swallowed, so
`core_receipt` can go stale without anyone noticing.

## Proposed shape
1. One `UPDATE` that resolves the master link in SQL, replacing the per-invoice `resolveMasterId`
   round trip — the same "exactly one match, else ''" rule as `resolveMasterId` (ambiguous names
   must stay unlinked, never guessed):
   ```sql
   UPDATE "core_receipt" SET "masterCustomerId" = COALESCE((
     SELECT CASE WHEN COUNT(*) = 1 THEN MAX("id") ELSE '' END
     FROM "MasterCustomer" WHERE "displayName" = ? OR "companyName" = ?
   ), ''), ... WHERE "id" = ?
   ```
   bound per row inside the existing `INSERT OR IGNORE … SELECT` + `UPDATE` pair, or (preferred)
2. a single `UPDATE "core_receipt" … FROM (SELECT … FROM "DebtorInvoice" …)` that joins
   `MasterCustomer` once, so the whole sweep is **2 statements** regardless of book size.
Option 2 changes the ambiguous-name handling into a `HAVING COUNT(*) = 1` join — reviewer should
pick one; both keep `core_receipt` byte-identical today (the mirror is convergent, not incremental).

## Migration / audit / permission impact
No migration (no schema change). No new audit rows (`mirrorReceivables` writes no audit entry).
Same caller, same scope gates, same `try/catch` non-fatal contract.

## Reviewer decision
PENDING — requires the core owner (human). Until it lands, the import route keeps the existing
mirror behind `waitUntil` on the last slice only.
