-- 0142_debtor_attachment_content_key.sql — record the invoice number read
-- from INSIDE the PDF (founder-audited invoice_link.json, 2026-11-14).
--
-- Zip filenames lie: 86 of 250 files carry a trailing number that differs
-- from the invoice number printed inside the PDF (e.g. filename
-- `Invoices FY 2024-25-919.pdf` contains `BUI/24-25/777`). Filename matching
-- alone mis-linked those. `contentKey` stores the ground truth (`FY/serial`,
-- e.g. `24-25/777`) per attached file so the correct mapping is durable and
-- future audits can verify links without re-reading every PDF.
ALTER TABLE "DebtorInvoiceAttachment" ADD COLUMN "contentKey" TEXT DEFAULT '';
