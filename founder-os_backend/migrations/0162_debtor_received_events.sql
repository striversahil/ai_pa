-- 0162_debtor_received_events.sql — dated history for sheet "Amount Received".
--
-- The ageing sheet reports one cumulative "Amount Received" per invoice, with
-- no date. `DebtorInvoice.baseReceived` is overwritten on every re-paste, so a
-- historical view could only guess when that money arrived (it counted from
-- the LATEST import, which moved forward on every paste).
--
-- This append-only ledger records the delta on every import, so an "as of"
-- view can sum what the sheet knew at that date:
--   receivedAt(invoice, D) = max( Σ events(day ≤ D), Σ receipts(collectionDate ≤ D) )
--
-- Backfill seeds one row per existing invoice from the import that last wrote
-- it (`lastImportAt`, else `createdAt`), which is when that figure became
-- known. Rows whose stored timestamps are not ISO days are skipped on read;
-- those fall back to the `lastImportAt` cutoff rule in as-of.ts.
CREATE TABLE IF NOT EXISTS "DebtorInvoiceReceivedEvent" (
  "id"          TEXT    PRIMARY KEY,
  "invoiceId"   TEXT    NOT NULL,
  "day"         TEXT    NOT NULL,
  "amountDelta" REAL    NOT NULL DEFAULT 0,
  "source"      TEXT    NOT NULL DEFAULT 'import',
  "importedBy"  TEXT    NOT NULL DEFAULT '',
  "createdAt"   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_debtor_received_event_invoice
  ON "DebtorInvoiceReceivedEvent"("invoiceId", "day");

INSERT INTO "DebtorInvoiceReceivedEvent" ("id", "invoiceId", "day", "amountDelta", "source", "importedBy")
SELECT lower(hex(randomblob(16))),
       "id",
       COALESCE(NULLIF(substr("lastImportAt", 1, 10), ''), substr(CAST("createdAt" AS TEXT), 1, 10), ''),
       "baseReceived",
       'backfill',
       COALESCE("importedBy", '')
  FROM "DebtorInvoice"
 WHERE "baseReceived" > 0
   AND COALESCE(NULLIF(substr("lastImportAt", 1, 10), ''), substr(CAST("createdAt" AS TEXT), 1, 10), '')
       GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
