# Payment Tracker

Pending-payments control desk for the accounts team. Deterministic — no LLM.

## What it does

- **Debtors ledger** (`DebtorInvoice`, one row per invoice): imported by
  pasting the Excel ageing sheet (`S.No | Customer Name | Invoice No. | ... |
  Ledger Link`) into the dashboard textarea. Upsert/append by
  `(invoiceNo, customerName)` — partial pastes are fine; a re-paste of the
  refreshed sheet updates the existing rows.
- **Collections ledger** (`PaymentCollection`, one row per receipt): imported
  by pasting the receipts sheet (`Collection Date | Customer Name | Invoice
  No. | Amount Received | Mode of Receipt | ...`). Credit notes are amounts
  in parentheses/debit-note negatives, stored as negative amounts. Exact
  re-pastes are deduped silently.
- **Customer ageing summary + top-level totals**: recomputed on every
  dashboard read against today's IST date (Not Due / 0–30 / 31–60 / 61–90 /
  91–180 / Above 180), so the Ageing rolls automatically without re-import.

## Receiving math (drift-free rule)

- effectiveReceived = `baseReceived` + (Σ collections ledgered to the invoice
  − `collectedAtImport` snapshot taken at that debtor import).
- Snapshot rule: a paste carrying a NUMERIC "Amount Received" (> 0) is
  authoritative — it already includes ledgered money, so `collectedAtImport`
  = current ledger total → delta 0 → no double-count.
- A paste with a blank/—/0 "Amount Received" sets base 0 and snapshot 0 —
  the pasted sheet is stale about receipts, so ledger money flows through
  the delta → no under-count.
- Ledger money beyond the invoice amount shows a NEGATIVE invoice balance →
  counted as **Advance received** at customer level; Net Due = Gross Due −
  Advance.

## Matching

Collections match to invoices: by invoice no first; when the number doesn't
exist, the customer's oldest OPEN invoice (due date asc) absorbs it
(`matchStatus: 'customer'`); otherwise the row stays `none` and is visible in
the Collections tab for manual follow-up. Unmatched rows whose invoice no
later appears in a debtor import are re-booked automatically.

## Endpoints (all `accounts`-scope gated; SEE worker/routes/payment-tracker.ts)

- `POST /api/payment-tracker/import/debtors` `{ text }` — paste → parse → upsert
- `POST /api/payment-tracker/import/collections` `{ text }` — paste → parse → append
- `GET  /api/payment-tracker/data` — KV-cached full payload (summary,
  customers, invoices, collections)
- `GET  /api/automations/payment-tracker/data` — dashboard convenience route

## Files

- `types.ts` — shapes + bucket helpers
- `parse.ts` — pure TSV paste parsers (Excel clipboard; header-detection)
- `service.ts` — imports, ledger math, ageing aggregation, KV cache
- `index.ts` / `rule.json` — automation registration (manual trigger)

MIGRATION: `migrations/0069_payment_tracker.sql`
MIRROR: `founder-os_frontend/src/payment-tracker/parse.ts` (frontend paste
preview) and `founder-os_frontend/src/components/PaymentTrackerDashboard.tsx`.
