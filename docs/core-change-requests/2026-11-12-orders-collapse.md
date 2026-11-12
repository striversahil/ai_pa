# Core change proposal: orders/floor collapse — 2026-11-12

## Model / field
`core_sales_order`, `core_so_line`, `core_stage_event`, `core_dispatch_proof`, `core_attachment` — collapse the 5 legacy floor tables (`CrmSalesOrder`, `CrmSoItem`, `CrmScheduleEvent`, `CrmDispatchProof`, `SoAttachment`) by rename, same pattern as 0136 (customer) + 0137 (ledger).

## Why (business reason)
Parity is now proven on live D1 after 0138 backfill: orders 144=144 (0 missing, 0 header diffs), lines 429=429 (0 missing, 0 field diffs), stage events 562=562, proofs 12=12, attachments 18=18. The dual-write (`mirrorOrders` on every sync tick + floor mutation) keeps them converged. One table per entity removes the fork permanently.

## Proposed shape
Same as today, plus unification columns `actorId/actorReason` on `core_sales_order` (+ `tombstonedAt` only if floor deletes ever tombstone — today deleted_source rows stay out of scope, no tombstone convention). No new columns otherwise.

## Migration
NOT a clean rename — schemas differ, human must decide each:
1. `CrmSalesOrder` has `customerId`, `soDelayReason`, `billingAddressEditedAt/By`, `shippingAddressEditedAt/By` — core lacks them. Drop (lossy) or carry into core?
2. `core_sales_order` has `masterCustomerId` — legacy lacks it. Backfill rule on rename (UNIQUE exact match or '') is already what 0130/0138 used.
3. `SoAttachment.kvKey` vs `core_attachment.storageKey` — rename column in the same migration (`RENAME COLUMN`) + bridge VIEW maps the old name.
4. `CrmSoItem` ↔ `core_so_line`, `CrmScheduleEvent` ↔ `core_stage_event`, `CrmDispatchProof` ↔ `core_dispatch_proof` — column sets match; pure renames.
5. `VIEW` + `INSTEAD OF` bridges on all 5 old names (same as 0136/0137), then repoint floor reads + `TABLE_MAP` entries + lead-import/gen scripts, retire `mirrorOrders`/`shadowCompareFloor` calls (locked `src/modules/core/orders.ts` stays defined-but-uncalled until re-sign).

## Audit / permission impact
Order writes stamp `actorId` (sync actor / floor editor) + `actorReason` (sync-tick / floor-mutation kind). Floor permissions unchanged (agents promise-only, dispatch/MIS/root full). No sensitive-field change.

## Reviewer decision
<!-- APPROVED / REJECTED + signature + date. On approval, human edits core + re-signs lock. -->
PENDING — hot table (Zoho sync writes every few minutes). Recommend: approve only after one quiet `floor-shadow` week post-0138 + explicit column decisions on (1)–(3) above.
