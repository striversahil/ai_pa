-- Per-customer CRM situation + remarks for the Customer Ageing tab.
-- Stored on the contact master so re-imports never overwrite it.
ALTER TABLE PaymentCustomer ADD COLUMN situation TEXT DEFAULT '';
ALTER TABLE PaymentCustomer ADD COLUMN situationRemarks TEXT DEFAULT '';
ALTER TABLE PaymentCustomer ADD COLUMN situationUpdatedAt TEXT;
ALTER TABLE PaymentCustomer ADD COLUMN situationUpdatedBy TEXT DEFAULT '';
