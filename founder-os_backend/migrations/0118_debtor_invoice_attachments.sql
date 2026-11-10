-- 0118_debtor_invoice_attachments.sql — per-invoice PDF attachments.
--
-- One row per attached PDF (bulk-zip import or manual upload). Bytes live in
-- Workers KV (CHAT_FILES, like SoAttachment); this table is the durable
-- metadata, keyed by invoice row id so a re-paste never wipes it.

CREATE TABLE IF NOT EXISTS "DebtorInvoiceAttachment" (
  "id" TEXT PRIMARY KEY,
  "invoiceId" TEXT NOT NULL,
  "invoiceNo" TEXT DEFAULT '',
  "fileName" TEXT DEFAULT '',
  "mime" TEXT DEFAULT 'application/pdf',
  "size" INTEGER DEFAULT 0,
  "kvKey" TEXT UNIQUE,
  "source" TEXT DEFAULT 'manual',
  "uploadedBy" TEXT DEFAULT '',
  "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "DebtorInvoiceAttachment_invoiceId_idx" ON "DebtorInvoiceAttachment" ("invoiceId");
CREATE INDEX IF NOT EXISTS "DebtorInvoiceAttachment_invoiceNo_idx" ON "DebtorInvoiceAttachment" ("invoiceNo");
