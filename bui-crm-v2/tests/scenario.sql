\set ON_ERROR_STOP 1
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_like text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%' || p_like || '%' THEN RETURN 'PASS  blocked: ' || left(SQLERRM, 90); END IF;
    RETURN 'FAIL  wrong error: ' || SQLERRM; END;
  RETURN 'FAIL  was allowed: ' || left(p_sql, 80);
END $$;

-- ── Setup: legal entity, FY, open period, series, people ──
BEGIN;
SELECT core.set_actor('EMPLOYEE', NULL, 'test-setup');
INSERT INTO core."LegalEntity"(id, code, "legalName", gstin, "stateCode", "addressLine1", city, pincode, "updatedAt")
VALUES ('00000000-0000-0000-0000-0000000000e1', 'BUI', 'BUI Industries Pvt Ltd', '23ABCDE1234F1Z5', '23', 'Plot 1', 'Indore', '452001', now());
INSERT INTO core."FiscalYear"(id, "legalEntityId", code, "startDate", "endDate")
VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-27', '2026-04-01', '2027-03-31');
INSERT INTO core."AccountingPeriod"(id, "legalEntityId", "fiscalYearId", "startDate", "endDate", status)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', d::date, (d + interval '1 month - 1 day')::date,
       CASE WHEN d < '2026-11-01' THEN 'CLOSED'::core."PeriodStatus" ELSE 'OPEN' END
FROM generate_series('2026-04-01'::date, '2027-03-01', interval '1 month') d;
INSERT INTO core."DocumentSeries"(id, "legalEntityId", "documentType", "fiscalYearId", prefix, padding, "updatedAt") VALUES
 (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', 'TAX_INVOICE', '00000000-0000-0000-0000-0000000000f1', 'BUI/2627/', 5, now()),
 (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', 'SALES_ORDER', '00000000-0000-0000-0000-0000000000f1', 'SO/2627/', 5, now());
INSERT INTO core."Employee"(id, "fullName", "workEmail", "updatedAt") VALUES
 ('00000000-0000-0000-0000-00000000a001', 'Asha (sales)', 'asha@bui.in', now()),
 ('00000000-0000-0000-0000-00000000a002', 'Meena (accounts)', 'meena@bui.in', now()),
 ('00000000-0000-0000-0000-00000000a003', 'Ravi (TL)', 'ravi@bui.in', now());
INSERT INTO core."EmployeeReportingLine"(id, "employeeId", "managerId") VALUES (gen_random_uuid(), '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a003');
INSERT INTO core."Warehouse"(id, code, name, "legalEntityId", "stateCode") VALUES ('00000000-0000-0000-0000-0000000000a1', 'MAIN', 'Main store', '00000000-0000-0000-0000-0000000000e1', '23');
INSERT INTO core."Product"(id, sku, name, "baseUomId", "taxRateId", "hsnCode", "updatedAt")
SELECT '00000000-0000-0000-0000-0000000000b1', 'ROL-0001', 'Roller 9 inch', u.id, t.id, '84378020', now()
FROM core."UnitOfMeasure" u, core."TaxRate" t WHERE u.code = 'NOS' AND t.code = 'GST18';
INSERT INTO core."Customer"(id, "legalName", "displayName", "normalizedName", gstin, status, "updatedAt")
VALUES ('00000000-0000-0000-0000-0000000000c1', 'Shree Ram Mills', 'Shree Ram Mills', 'shree ram mills', '27ABCDE1234F1Z5', 'ACTIVE', now());
COMMIT;

\echo '── 1. Sales registers an UNQUALIFIED enquiry (no customer yet), then qualifies it'
BEGIN;
SELECT core.set_actor('EMPLOYEE', '00000000-0000-0000-0000-00000000a001', 'req-enq-1');
INSERT INTO core."SalesEnquiry"(id, "enquiryNo", "legalEntityId", "leadSourceId", "prospectCompany", "prospectPhoneE164", title, "ownerId", "updatedAt")
SELECT '00000000-0000-0000-0000-0000000000d1', 'ENQ-0001', '00000000-0000-0000-0000-0000000000e1', id, 'Shree Ram Mills', '+919800000001', 'Need 10 rollers', '00000000-0000-0000-0000-00000000a001', now()
FROM core."LeadSource" WHERE code = 'INCOMING_CALL';
UPDATE core."SalesEnquiry" SET status = 'QUALIFIED', "customerId" = '00000000-0000-0000-0000-0000000000c1', "qualifiedAt" = now(),
       "qualifiedById" = '00000000-0000-0000-0000-00000000a001' WHERE id = '00000000-0000-0000-0000-0000000000d1';
COMMIT;
SELECT 'PASS  enquiry history rows: ' || count(*) || ', fields changed on qualify: ' ||
       (SELECT array_to_string("changedFields", ',') FROM core."RowChangeLog" WHERE "tableName"='SalesEnquiry' AND operation='UPDATE')
       || ', actor=' || max("actorId") FROM core."RowChangeLog" WHERE "tableName" = 'SalesEnquiry';
SELECT pg_temp.expect_error($$UPDATE core."SalesEnquiry" SET status='LOST' WHERE id='00000000-0000-0000-0000-0000000000d1'$$, 'ck_enquiry_lost_reason');

\echo '── 2. Sales order with gapless number; stock reservation guarded'
BEGIN;
SELECT core.set_actor('EMPLOYEE', '00000000-0000-0000-0000-00000000a001', 'req-so-1');
INSERT INTO core."SalesOrder"(id, "soNo", "legalEntityId", "customerId", "orderDate", "placeOfSupply", "ownerId", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000501', core.next_document_number('00000000-0000-0000-0000-0000000000e1', 'SALES_ORDER', '2026-11-11'),
        '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '2026-11-11', '27', '00000000-0000-0000-0000-00000000a001', now());
INSERT INTO core."SalesOrderLine"(id, "salesOrderId", "lineNo", "productId", description, quantity, "uomId", "unitPrice", "taxableValue", "gstRate", "igstAmount", "lineTotal")
SELECT '00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000501', 1, '00000000-0000-0000-0000-0000000000b1', 'Roller 9 inch', 10, u.id, 1000, 10000, 18, 1800, 11800
FROM core."UnitOfMeasure" u WHERE u.code = 'NOS';
COMMIT;
SELECT 'PASS  SO number issued: ' || "soNo" FROM core."SalesOrder" WHERE id = '00000000-0000-0000-0000-000000000501';
INSERT INTO core."StockLedgerEntry"(id, "productId", "warehouseId", "movementType", quantity, "postingDate", "sourceDocType", "sourceDocId", "sourceLineId")
VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'OPENING', 6, '2026-11-11', 'Opening', gen_random_uuid(), gen_random_uuid());
SELECT pg_temp.expect_error($$INSERT INTO core."InventoryReservation"(id,"salesOrderLineId","productId","warehouseId",quantity) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000511','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1',10)$$, 'only 6');
INSERT INTO core."InventoryReservation"(id,"salesOrderLineId","productId","warehouseId",quantity) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000511','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1',6);
SELECT 'PASS  stock view: on_hand=' || on_hand || ' reserved=' || reserved || ' available=' || available FROM core.v_stock_available;
SELECT pg_temp.expect_error($$INSERT INTO core."StockLedgerEntry"(id,"productId","warehouseId","movementType",quantity,"postingDate","sourceDocType","sourceDocId") VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','ADJUSTMENT_IN',1,'2026-08-10','Adj',gen_random_uuid())$$, 'CLOSED');
SELECT pg_temp.expect_error($$UPDATE core."StockLedgerEntry" SET quantity = 100$$, 'append-only');

\echo '── 3. Stage moves are append-only history; orders cannot be deleted'
INSERT INTO core."SalesOrderStageEvent"(id, "salesOrderId", "fromStage", "toStage", "actorType", "actorEmployeeId")
VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000501', 'DRAFT', 'CONFIRMED', 'EMPLOYEE', '00000000-0000-0000-0000-00000000a001');
SELECT pg_temp.expect_error($$DELETE FROM core."SalesOrderStageEvent"$$, 'append-only');
SELECT pg_temp.expect_error($$DELETE FROM core."SalesOrder"$$, 'never deleted');
SELECT pg_temp.expect_error($$UPDATE core."SalesOrder" SET stage='ON_HOLD'$$, 'ck_so_hold_reason');

\echo '── 4. Invoice: issued → frozen; unbalanced journal rejected'
BEGIN;
SELECT core.set_actor('EMPLOYEE', '00000000-0000-0000-0000-00000000a002', 'req-inv-1');
INSERT INTO core."Invoice"(id, "invoiceNo", "legalEntityId", "customerId", "salesOrderId", "invoiceDate", "placeOfSupply", "sellerSnapshot", "buyerSnapshot", subtotal, "taxableTotal", "igstTotal", "grandTotal", "updatedAt")
VALUES ('00000000-0000-0000-0000-0000000001a1', core.next_document_number('00000000-0000-0000-0000-0000000000e1', 'TAX_INVOICE', '2026-11-11'),
        '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000501', '2026-11-11', '27', '{}', '{}', 6000, 6000, 1080, 7080, now());
INSERT INTO core."InvoiceLine"(id, "invoiceId", "lineNo", "salesOrderLineId", "productId", description, "hsnCode", quantity, "uomId", "unitPrice", "taxableValue", "gstRate", "igstAmount", "lineTotal")
SELECT gen_random_uuid(), '00000000-0000-0000-0000-0000000001a1', 1, '00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-0000000000b1', 'Roller 9 inch', '84378020', 6, u.id, 1000, 6000, 18, 1080, 7080
FROM core."UnitOfMeasure" u WHERE u.code = 'NOS';
UPDATE core."Invoice" SET status = 'ISSUED', "issuedAt" = now() WHERE id = '00000000-0000-0000-0000-0000000001a1';
COMMIT;
SELECT 'PASS  invoice issued: ' || "invoiceNo" FROM core."Invoice";
SELECT pg_temp.expect_error($$UPDATE core."Invoice" SET "grandTotal" = 1 WHERE id='00000000-0000-0000-0000-0000000001a1'$$, 'only e-invoice fields');
SELECT pg_temp.expect_error($$UPDATE core."InvoiceLine" SET quantity = 1$$, 'cannot change');
UPDATE core."Invoice" SET irn = 'IRN123', "eInvoiceStatus" = 'GENERATED' WHERE id = '00000000-0000-0000-0000-0000000001a1';
SELECT 'PASS  e-invoice IRN added after issue';
SELECT pg_temp.expect_error($$DELETE FROM core."Invoice"$$, 'cannot be deleted');
INSERT INTO core."LedgerAccount"(id, "legalEntityId", code, name, type, "systemKey") VALUES
 ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-0000000000e1', '1100', 'Debtors', 'ASSET', 'AR'),
 ('00000000-0000-0000-0000-0000000001b2', '00000000-0000-0000-0000-0000000000e1', '4000', 'Sales', 'INCOME', 'SALES'),
 ('00000000-0000-0000-0000-0000000001b3', '00000000-0000-0000-0000-0000000000e1', '2201', 'Output IGST', 'LIABILITY', 'OUTPUT_IGST');
SELECT pg_temp.expect_error($$
  INSERT INTO core."JournalEntry"(id,"entryNo","legalEntityId","entryDate","idempotencyKey",narration) VALUES ('00000000-0000-0000-0000-0000000001c1','J1','00000000-0000-0000-0000-0000000000e1','2026-11-11','Invoice:x:issue','Sale');
  INSERT INTO core."JournalLine"(id,"entryId","accountId",debit) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000001c1','00000000-0000-0000-0000-0000000001b1',7080);
  INSERT INTO core."JournalLine"(id,"entryId","accountId",credit) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000001c1','00000000-0000-0000-0000-0000000001b2',6000);
  SET CONSTRAINTS ALL IMMEDIATE;$$, 'unbalanced');
BEGIN;
INSERT INTO core."JournalEntry"(id,"entryNo","legalEntityId","entryDate","idempotencyKey",narration,"sourceDocType","sourceDocId") VALUES ('00000000-0000-0000-0000-0000000001c2','J2','00000000-0000-0000-0000-0000000000e1','2026-11-11','Invoice:1a1:issue','Sale','Invoice','00000000-0000-0000-0000-0000000001a1');
INSERT INTO core."JournalLine"(id,"entryId","accountId",debit,"customerId") VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000001c2','00000000-0000-0000-0000-0000000001b1',7080,'00000000-0000-0000-0000-0000000000c1');
INSERT INTO core."JournalLine"(id,"entryId","accountId",credit) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000001c2','00000000-0000-0000-0000-0000000001b2',6000);
INSERT INTO core."JournalLine"(id,"entryId","accountId",credit) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000001c2','00000000-0000-0000-0000-0000000001b3',1080);
COMMIT;
SELECT 'PASS  balanced journal posted';
SELECT pg_temp.expect_error($$INSERT INTO core."JournalEntry"(id,"entryNo","legalEntityId","entryDate","idempotencyKey",narration) VALUES (gen_random_uuid(),'J3','00000000-0000-0000-0000-0000000000e1','2026-11-12','Invoice:1a1:issue','dup')$$, 'idempotencyKey');

\echo '── 5. Receivables: partial payment → outstanding'
INSERT INTO core."PaymentReceipt"(id, "receiptNo", "legalEntityId", "customerId", "receivedOn", mode, amount, status, "updatedAt")
VALUES ('00000000-0000-0000-0000-0000000001d1', 'RCPT-1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '2026-11-11', 'UPI', 5000, 'VERIFIED', now());
INSERT INTO core."PaymentAllocation"(id, "receiptId", "invoiceId", amount) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000001a1', 5000);
SELECT 'PASS  outstanding=' || outstanding || ' of ' || "grandTotal" FROM core.v_invoice_outstanding;
SELECT pg_temp.expect_error($$INSERT INTO core."PaymentAllocation"(id,"receiptId",amount) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000001d1',10)$$, 'ck_alloc_one_target');

\echo '── 6. Escalation: overdue action is picked up by the sweeper query'
INSERT INTO core."BusinessAction"(id, category, title, "departmentId", "assigneeId", "dueAt", "escalationPolicyId", "nextEscalationAt", "entityType", "entityId", "updatedAt")
SELECT '00000000-0000-0000-0000-0000000001e1', 'verify_order', 'Verify SO', d.id, '00000000-0000-0000-0000-00000000a002', now() - interval '3 hours', p.id, now() - interval '1 hour', 'SalesOrder', '00000000-0000-0000-0000-000000000501', now()
FROM core."Department" d, core."EscalationPolicy" p WHERE d.code = 'ACCOUNTS' AND p.key = 'verify_order';
SELECT 'PASS  sweeper finds: ' || a.title || ' → next step L' || s.level || ' ' || s.target || ' after ' || s."afterMinutes" || 'min'
FROM core."BusinessAction" a JOIN core."EscalationStep" s ON s."policyId" = a."escalationPolicyId" AND s.level = a."escalationLevel" + 2
WHERE a.status IN ('OPEN','IN_PROGRESS','WAITING') AND a."nextEscalationAt" <= now();
SELECT pg_temp.expect_error($$UPDATE core."BusinessAction" SET status='DONE'$$, 'ck_action_done');

\echo '── 7. Access log + audit protections'
INSERT INTO core."AccessLog"("actorType","actorId","accessType","entityType","entityId","sensitiveFields","screen")
VALUES ('EMPLOYEE','00000000-0000-0000-0000-00000000a001','VIEW','SalesOrder','00000000-0000-0000-0000-000000000501','{unitCost}','/sales/orders/x');
SELECT pg_temp.expect_error($$DELETE FROM core."AccessLog"$$, 'append-only');
SELECT pg_temp.expect_error($$UPDATE core."RowChangeLog" SET "actorId" = 'x'$$, 'append-only');

\echo '── 8. A table an AI agent adds to "automation" is audited automatically'
CREATE TABLE automation."AgentScratch"(id uuid PRIMARY KEY, note text);
INSERT INTO automation."AgentScratch" VALUES (gen_random_uuid(), 'hello');
SELECT CASE WHEN count(*) = 1 THEN 'PASS  new automation table audited' ELSE 'FAIL  not audited' END
FROM core."RowChangeLog" WHERE "schemaName" = 'automation' AND "tableName" = 'AgentScratch';

\echo '── Accountability summary'
SELECT "tableName", operation, count(*), count(DISTINCT "actorId") AS actors
FROM core."RowChangeLog" WHERE "requestId" LIKE 'req-%' GROUP BY 1, 2 ORDER BY 1, 2;
