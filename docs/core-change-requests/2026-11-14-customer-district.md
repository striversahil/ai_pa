# Core change proposal: customer district — 2026-11-14

## Model / field
`core_customer.district TEXT NOT NULL DEFAULT ''` + index `core_customer_district_idx`.

## Why (business reason)
Founder decision 2026-11-14: Customer Master must filter district-wise (state → district drill-down) and NeoDove campaign pushes must target districts. The founder-supplied `client_district_wise.json` (5,106 customers, ~4,310 placed in an Indian district) is the same book with a district per row, keyed by the same `id`. Helpers (`hlp_*`) cannot cover this — district is a first-class book attribute read on every master payload, every campaign selection, and the leaderboard region heals; a side table would fork every read.

## Proposed shape
- One nullable-by-default text column (`''` = unplaced: state-known-no-district 540, outside-India 67, unassigned 189).
- Manager-only edit (same as state/subArea/region); imports never write it (upsert column list untouched — a flat Zoho re-import cannot wipe it).
- NeoDove: district threads through selection as `region + state + district`; `NeoDovePushBatch.district` records it; `detail1` folds to `"State · District"` (no new NeoDove field).

## Migration
- `0144_customer_district.sql`: ADD COLUMN + index + backfill `UPDATE … WHERE id = ?` rows generated from the JSON (generator: `founder-os_backend/scripts/gen-district-migration.mjs`, re-runnable).
- `0145_neodove_batch_district.sql`: `NeoDovePushBatch ADD COLUMN district`.

## Audit / permission impact
No new PII (district is coarser than the stored city/pincode). Reads inherit the existing master/campaign gates; writes inherit the manager-only geography rule. No actor-stamp change (column covered by the existing customer-edit audit detail).

## Reviewer decision
APPROVED — founder (verbal, 2026-11-14 session: district filter + district push). Implemented by agent per plan; core-guard stays green (no locked paths touched).
