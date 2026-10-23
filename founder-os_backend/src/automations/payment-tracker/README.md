# Payment Tracker

Pending-payments control desk shared by **sales (`payment-tracker` scope)** and
**accounts (`accounts` scope)**. Deterministic — no LLM.

## Access model (founder decision)

- **Reads + sales follow-up** (`GET data`, `PATCH invoice` follow-up fields):
  any user holding `payment-tracker` OR the legacy `accounts` scope.
- **Accounts-only writes** (imports, reset, deletes, customer contacts,
  reminder run): `accounts` scope (root/admin included).
- The **Accounts tab** (paste/reset) renders only for accounts users; sales see
  Summary / Customer Ageing / Invoices / Collections / Reminders.
- The automation is registered under its own `payment-tracker` scope and also
  grants access to `accounts` holders (`AUTOMATION_ACCESS_SCOPES`); `accounts`
  remains a frontend implied scope for the sidebar.

## What it does

- **Debtors ledger** (`DebtorInvoice`, one row per invoice): imported by
  pasting the Excel ageing sheet. The paste only needs the eight columns the
  founder supplies — `Customer Name | Invoice No. | Invoice Date | Credit
  Period (Days) | Due Date | Invoice Amount | Amount Received | Balance
  Receivable` (the parser also accepts the wider legacy sheet). Upsert/append
  by `(invoiceNo, customerName)` — partial pastes are fine; a re-paste of the
  refreshed sheet updates existing rows. The same invoice no. under a
  DIFFERENT customer is reported as an import conflict and never merged.
  Soft-deleted rows are restored on re-import.
- **Collections ledger** (`PaymentCollection`, one row per receipt): imported
  by pasting the receipts sheet (`Collection Date | Customer Name | Invoice
  No. | Amount Received | Mode of Receipt | ... | optional Receipt No. /
  Transaction ID`). Credit notes are amounts in parentheses/debit-note
  negatives, stored as negative amounts. Re-pastes are idempotent: receipt no.
  first, else invoice no + date + amount + mode. Multiple part-payments for one
  invoice are preserved.
- **Customer contact master** (`PaymentCustomer`): one row per normalized
  customer name with phone, email (store-only), region (R1–R4), WhatsApp
  opt-in and notes. Phone/email/region can be backfilled from the debtor
  sheet; manual edits always win. Region is mirrored onto every invoice for
  the customer. One contact per customer drives reminders.
- **Reminder log** (`PaymentReminder`): daily dry-run at 10:00 IST, one
  preview per customer per IST day. Live business-initiated WhatsApp requires
  WABA Cloud API credentials + an approved template + recorded opt-in; until
  then nothing is sent.
- **Customer ageing summary + top-level totals**: recomputed on every
  dashboard read against today's IST date (Not Due / 0–30 / 31–60 / 61–90 /
  91–180 / Above 180), so Ageing rolls automatically without re-import.
- **Derived ageing fields (never pasted)**: due date anchored on the pasted
  due date, else `invoiceDate + creditPeriodDays`, else `invoiceDate`. Helper
  fields computed on every read: `daysSinceInvoice`, `daysOverdue`, `dueMonth`,
  `invoiceWeekStart`, `dueWeekStart` (Mondays).

## Receiving math (drift-free rule)

- Base received per invoice (`baseReceived`), priority:
  1. numeric pasted "Amount Received" (> 0);
  2. otherwise `invoiceAmount − Balance Receivable` (clamped ≥ 0);
  3. otherwise the previously stored base (updates) / 0 (new invoice).
- `effectiveReceived = max(baseReceived, Σ ledger collections)`. The receipts
  sheet is cumulative history; taking the larger of sheet vs ledger is
  paste-order independent and never double-counts. New receipts register once
  the ledger exceeds the sheet figure. `collectedAtImport` is legacy only.
- Customer advances are receipt rows with invoice no **"Advance"**
  (`matchStatus: 'advance'`). Never invoice-matched, accumulate per customer,
  reduce Net Due. Net Due = Gross Due − Advance.

## Matching

Collections match by invoice no first (customer-qualified when that invoice no
is shared); otherwise the customer's oldest OPEN invoice (`matchStatus:
'customer'`); `Advance` stays out of matching (`matchStatus: 'advance'`);
otherwise `none` and visible for manual fix-up. Unmatched rows whose invoice no
later appears are re-booked automatically. Soft-deleted invoices unlink their
collections.

## Dashboard UX

Shared horizontal `TabBar`: **Summary · Customer Ageing · Invoices ·
Collections · Reminders · Accounts** (Accounts only for accounts users).
First-time accounts users land on Accounts; sales land on Summary. Ageing shows
contact + last follow-up; accounts can edit the contact master. Invoices open a
row editor (accounts: all fields; sales: last call date / call status / payment
status / remarks only). Collections are read-only for sales. Ageing rows open a
**Ledger** statement (all invoices + receipts + sheet-received adjustments,
CSV/print); Invoices and Collections use the Excel-dense table variant.

## Endpoints

Read (any tracker scope):
- `GET  /api/payment-tracker/data` — KV-cached payload (summary, customers,
  invoices, collections, reminders, meta).
- `GET  /api/payment-tracker/customers/:customerKey/ledger` — full customer
  statement, reconciled to the dashboards.
- `GET  /api/automations/payment-tracker/data` — generic dashboard route.

Accounts-only:
- `POST /api/payment-tracker/preview` `{ text, kind }`
- `POST /api/payment-tracker/import/debtors` `{ text }`
- `POST /api/payment-tracker/import/collections` `{ text }`
- `PUT  /api/payment-tracker/customers/contact`
- `POST /api/payment-tracker/reminders/run`
- `DELETE /api/payment-tracker/data` (wipes ledgers + reminder log; contacts
  survive)
- `DELETE /api/payment-tracker/invoices/:id` / `collections/:id` (soft delete)

Either tracker scope:
- `PATCH /api/payment-tracker/invoices/:id` — accounts: all editable fields;
  sales: `lastCallDate`, `callStatus`, `paymentStatus`, `remarks`.

## Cadence

Native Worker cron `* * * * *` gates the daily dry-run at **10:00 IST**
(04:30 UTC) from `scheduledTime`; no GitHub workflow. The run is idempotent per
customer/day. GH runner/weekly jobs are not involved.

## Files

- `types.ts` — shapes + identity helpers
- `customer-ledger.ts` — complete customer statement builder
- `parse.ts` — pure TSV paste parsers (Excel clipboard)
- `shared.ts` — date/money/bucket helpers
- `ledger.ts` — live invoice ledger + per-customer ageing
- `imports.ts` — paste imports, matching, conflicts, corrections
- `customers.ts` — contact master
- `reminders.ts` — daily dry-run queue
- `payload.ts` — KV-cached dashboard payload
- `service.ts` — compatibility re-exports
- `index.ts` / `rule.json` — automation registration (manual trigger)

MIGRATIONS: `0069` base tracker · `0070` customer contacts · `0075`
customer region · `0076` client contact/region seed.
MIRROR: `founder-os_frontend/src/payment-tracker/{types,parse,api}.ts`
(regenerate the parse mirror whenever backend `parse.ts` changes),
`components/PaymentTrackerDashboard.tsx` and `components/payment-tracker/*`.
