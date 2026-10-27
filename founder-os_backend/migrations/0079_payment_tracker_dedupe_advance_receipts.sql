-- Merge advance placeholders into the real-invoice receipt they duplicate.
--
-- The collections sheet originally books some receipts against "Advance" and
-- later re-pastes the same money against the real invoice no. The exact dedupe
-- key includes the invoice no, so both rows survive. Soft-delete the placeholder
-- only when exactly one active real-invoice row has the same customer, date,
-- amount and mode, and the two rows do not carry different receipt numbers.
-- Two real invoices paid the same day (and genuine part-payments) are untouched.
UPDATE PaymentCollection
SET deleted = 1
WHERE deleted = 0
  AND resolvedInvoiceId IS NULL
  AND (lower(trim(invoiceNo)) = 'advance' OR matchStatus = 'advance')
  AND (
    SELECT COUNT(*)
    FROM PaymentCollection r
    WHERE r.deleted = 0
      AND r.id <> PaymentCollection.id
      AND lower(trim(r.customerName)) = lower(trim(PaymentCollection.customerName))
      AND r.collectionDate IS PaymentCollection.collectionDate
      AND abs(r.amount - PaymentCollection.amount) <= 0.005
      AND lower(trim(r.mode)) = lower(trim(PaymentCollection.mode))
      AND trim(r.invoiceNo) <> ''
      AND lower(trim(r.invoiceNo)) <> 'advance'
      AND r.matchStatus <> 'advance'
      AND NOT (
        trim(PaymentCollection.receiptNo) <> ''
        AND trim(r.receiptNo) <> ''
        AND lower(trim(PaymentCollection.receiptNo)) <> lower(trim(r.receiptNo))
      )
  ) = 1;
