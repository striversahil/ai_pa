-- 0099_crm_payment_terms_editable_addresses.sql
-- CRM floor: payment terms (Zoho-owned, display-only) + human-editable addresses.
--
-- paymentTerms   extracted from Zoho's free-text `terms` block (the structured
--                payment_terms fields are 0/"Due on Receipt" on every SO — no
--                signal). Overwritten by every detail tick (source-owned).
-- *EditedAt/By  set by PUT /api/crm/orders/:id/addresses. While set, the sync
--                leaves that address alone (local edit wins permanently).

ALTER TABLE "CrmSalesOrder" ADD COLUMN "paymentTerms" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CrmSalesOrder" ADD COLUMN "billingAddressEditedAt" TIMESTAMP;
ALTER TABLE "CrmSalesOrder" ADD COLUMN "billingAddressEditedBy" TEXT;
ALTER TABLE "CrmSalesOrder" ADD COLUMN "shippingAddressEditedAt" TIMESTAMP;
ALTER TABLE "CrmSalesOrder" ADD COLUMN "shippingAddressEditedBy" TEXT;
