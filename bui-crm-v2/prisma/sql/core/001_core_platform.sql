-- ═════════════════════════════════════════════════════════════════════════════
-- prisma/sql/core/001_core_platform.sql  ·  🔒 LOCKED (same rules as core.prisma)
-- Run after the Prisma DDL. Idempotent: safe to re-run after every core
-- migration (it re-attaches triggers to any new core tables).
--
-- What it guarantees, at the database level (no code path can skip it):
--   A. Every INSERT/UPDATE/DELETE on core and automation tables is written to
--      core."RowChangeLog" with the acting employee/service account.
--   B. Logs, events and ledgers are append-only.
--   C. Issued invoices/notes are frozen; business documents are never deleted.
--   D. Journals balance; nothing posts into a closed period.
--   E. Gapless GST-compliant document numbers.
--   F. Integrity rules Prisma cannot express (CHECKs, partial uniques).
--   G. Read models for derived quantities (stock, order progress, dues).
--
-- ⚠ Prisma does not model CHECKs, triggers, views or partial indexes. Future
--   `prisma migrate diff` output may propose dropping the uq_* / ix_* indexes
--   created here — remove those lines from generated migrations.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- A. ACTOR CONTEXT + ROW-CHANGE AUDIT
-- ─────────────────────────────────────────────────────────────────────────────
-- The core service layer starts every write transaction with:
--   SELECT core.set_actor('EMPLOYEE', '<employee uuid>', '<request id>');
-- (transaction-scoped; Prisma: run inside the same $transaction).

CREATE OR REPLACE FUNCTION core.set_actor(p_type text, p_id text, p_request text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.actor_type', coalesce(p_type, ''), true),
         set_config('app.actor_id',   coalesce(p_id, ''),   true),
         set_config('app.request_id', coalesce(p_request, ''), true);
$$;

CREATE OR REPLACE FUNCTION core.log_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = core, pg_temp AS $$
DECLARE
  v_old jsonb; v_new jsonb; v_changed text[]; v_id text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k ORDER BY k) INTO v_changed
    FROM jsonb_object_keys(v_new) k
    WHERE v_new -> k IS DISTINCT FROM v_old -> k AND k <> 'updatedAt';
    IF v_changed IS NULL THEN RETURN NEW; END IF;          -- no-op update
  ELSE
    SELECT array_agg(k ORDER BY k) INTO v_changed FROM jsonb_object_keys(coalesce(v_new, v_old)) k;
  END IF;

  v_id := coalesce(v_new, v_old) ->> 'id';
  IF v_id IS NULL THEN                                     -- composite keys
    v_id := coalesce(v_new, v_old)::text;
  END IF;

  INSERT INTO core."RowChangeLog"
    ("schemaName", "tableName", "rowId", operation, "changedFields", "oldData", "newData",
     "actorType", "actorId", "requestId", "dbUser", "txId")
  VALUES
    (TG_TABLE_SCHEMA, TG_TABLE_NAME, v_id, TG_OP::core."RowOperation", coalesce(v_changed, '{}'),
     v_old, v_new,
     nullif(current_setting('app.actor_type', true), ''),
     nullif(current_setting('app.actor_id', true), ''),
     nullif(current_setting('app.request_id', true), ''),
     session_user, txid_current());

  RETURN coalesce(NEW, OLD);
END $$;

-- Tables that are themselves logs (or too hot to double-log) are skipped.
CREATE OR REPLACE FUNCTION core.attach_audit_trigger(p_schema text, p_table text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_schema = 'core' AND p_table IN ('RowChangeLog', 'AccessLog', 'AuditEvent', 'AuthEvent', 'DomainEvent') THEN
    RETURN;
  END IF;
  EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row ON %I.%I', p_schema, p_table);
  EXECUTE format('CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I.%I
                  FOR EACH ROW EXECUTE FUNCTION core.log_row_change()', p_schema, p_table);
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_schema, table_name FROM information_schema.tables
           WHERE table_schema IN ('core', 'automation') AND table_type = 'BASE TABLE'
  LOOP
    PERFORM core.attach_audit_trigger(r.table_schema, r.table_name);
  END LOOP;
END $$;

-- New tables created later in "automation" (by agent-built migrations) get
-- the audit trigger automatically. Requires a superuser to install.
CREATE OR REPLACE FUNCTION core.on_create_table_attach_audit() RETURNS event_trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM pg_event_trigger_ddl_commands()
           WHERE command_tag = 'CREATE TABLE' AND schema_name IN ('core', 'automation')
  LOOP
    PERFORM core.attach_audit_trigger(r.schema_name, (SELECT relname::text FROM pg_class WHERE oid = r.objid));
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    DROP EVENT TRIGGER IF EXISTS evt_attach_audit;
    CREATE EVENT TRIGGER evt_attach_audit ON ddl_command_end
      WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION core.on_create_table_attach_audit();
  ELSE
    RAISE NOTICE 'Not superuser: event trigger skipped — re-run this file after each automation migration instead.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. APPEND-ONLY TABLES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'core.% is append-only (% blocked)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['RowChangeLog', 'AccessLog', 'AuditEvent', 'AuthEvent', 'DomainEvent',
                           'BusinessActionEvent', 'ApprovalEvent', 'SalesOrderStageEvent',
                           'DispatchEvent', 'StockLedgerEntry', 'JournalLine']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_append_only ON core.%I', t);
    EXECUTE format('CREATE TRIGGER trg_append_only BEFORE UPDATE OR DELETE ON core.%I
                    FOR EACH ROW EXECUTE FUNCTION core.forbid_mutation()', t);
  END LOOP;
END $$;

-- Journal entries: only POSTED → REVERSED is allowed, nothing else.
CREATE OR REPLACE FUNCTION core.guard_journal_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'journal entries cannot be deleted; post a reversal'; END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status')
     OR NOT (OLD.status = 'POSTED' AND NEW.status = 'REVERSED') THEN
    RAISE EXCEPTION 'journal entry % is immutable (only POSTED → REVERSED allowed)', OLD."entryNo";
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_journal ON core."JournalEntry";
CREATE TRIGGER trg_guard_journal BEFORE UPDATE OR DELETE ON core."JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION core.guard_journal_entry();

-- ─────────────────────────────────────────────────────────────────────────────
-- C. ISSUED DOCUMENTS ARE FROZEN; BUSINESS RECORDS ARE NEVER DELETED
-- ─────────────────────────────────────────────────────────────────────────────
-- After ISSUE, an invoice / credit-debit note may only gain e-invoice details
-- or be cancelled. Lines of an issued document cannot change at all.
CREATE OR REPLACE FUNCTION core.guard_issued_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := ARRAY['status', 'cancelledAt', 'cancelReason', 'eInvoiceStatus', 'irn', 'ackNo',
                          'ackDate', 'signedQrCode', 'eInvoiceError', 'updatedAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION '% % is issued and cannot be deleted', TG_TABLE_NAME, OLD.id; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION '% % is cancelled and frozen', TG_TABLE_NAME, OLD.id;
  END IF;
  IF OLD.status = 'ISSUED' THEN
    IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
      RAISE EXCEPTION '% % is issued: only e-invoice fields or cancellation may change', TG_TABLE_NAME, OLD.id;
    END IF;
    IF NEW.status NOT IN ('ISSUED', 'CANCELLED') THEN
      RAISE EXCEPTION 'issued document cannot return to %', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION core.guard_issued_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_row jsonb;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME = 'InvoiceLine' THEN
    SELECT status INTO v_status FROM core."Invoice" WHERE id = (v_row ->> 'invoiceId')::uuid;
  ELSE
    SELECT status INTO v_status FROM core."AdjustmentNote" WHERE id = (v_row ->> 'noteId')::uuid;
  END IF;
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'lines of an issued/cancelled document cannot change';
  END IF;
  -- an UPDATE must not move a line to a different (issued) document either
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) ->> 'invoiceId' IS DISTINCT FROM v_row ->> 'invoiceId' THEN
    RAISE EXCEPTION 'lines cannot be moved between documents';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_guard_issued ON core."Invoice";
CREATE TRIGGER trg_guard_issued BEFORE UPDATE OR DELETE ON core."Invoice"
  FOR EACH ROW EXECUTE FUNCTION core.guard_issued_document();
DROP TRIGGER IF EXISTS trg_guard_issued ON core."AdjustmentNote";
CREATE TRIGGER trg_guard_issued BEFORE UPDATE OR DELETE ON core."AdjustmentNote"
  FOR EACH ROW EXECUTE FUNCTION core.guard_issued_document();
DROP TRIGGER IF EXISTS trg_guard_lines ON core."InvoiceLine";
CREATE TRIGGER trg_guard_lines BEFORE INSERT OR UPDATE OR DELETE ON core."InvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION core.guard_issued_lines();
DROP TRIGGER IF EXISTS trg_guard_lines ON core."AdjustmentNoteLine";
CREATE TRIGGER trg_guard_lines BEFORE INSERT OR UPDATE OR DELETE ON core."AdjustmentNoteLine"
  FOR EACH ROW EXECUTE FUNCTION core.guard_issued_lines();

-- Master data and business documents are deactivated / cancelled, never deleted.
CREATE OR REPLACE FUNCTION core.forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'core.% rows are never deleted — deactivate or cancel instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['LegalEntity', 'Employee', 'Customer', 'Supplier', 'Product', 'Warehouse',
                           'SalesEnquiry', 'SalesEstimate', 'SalesOrder', 'Dispatch', 'PaymentReceipt',
                           'PaymentAllocation', 'PurchaseOrder', 'GoodsReceipt', 'SupplierBill',
                           'SupplierPayment', 'BusinessAction', 'ApprovalRequest', 'LedgerAccount',
                           'DocumentSeries', 'UserAccount']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_no_delete ON core.%I', t);
    EXECUTE format('CREATE TRIGGER trg_no_delete BEFORE DELETE ON core.%I
                    FOR EACH ROW EXECUTE FUNCTION core.forbid_delete()', t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. LEDGER INTEGRITY
-- ─────────────────────────────────────────────────────────────────────────────
-- Σ debit = Σ credit per entry, checked at COMMIT (lines are inserted one by one).
CREATE OR REPLACE FUNCTION core.check_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_dr numeric; v_cr numeric; v_n int;
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)
    INTO v_dr, v_cr, v_n FROM core."JournalLine" WHERE "entryId" = NEW."entryId";
  IF v_n < 2 OR v_dr <> v_cr THEN
    RAISE EXCEPTION 'journal entry % unbalanced: debit % ≠ credit % (% lines)', NEW."entryId", v_dr, v_cr, v_n;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_journal_balanced ON core."JournalLine";
CREATE CONSTRAINT TRIGGER trg_journal_balanced AFTER INSERT ON core."JournalLine"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.check_journal_balanced();

-- Lines may only post to postable accounts of the same legal entity.
CREATE OR REPLACE FUNCTION core.check_journal_line_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM core."LedgerAccount" a JOIN core."JournalEntry" e ON e.id = NEW."entryId"
                 WHERE a.id = NEW."accountId" AND a."isPostable" AND a.active
                   AND a."legalEntityId" = e."legalEntityId") THEN
    RAISE EXCEPTION 'account % is not postable for this legal entity', NEW."accountId";
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_journal_line_account ON core."JournalLine";
CREATE TRIGGER trg_journal_line_account BEFORE INSERT ON core."JournalLine"
  FOR EACH ROW EXECUTE FUNCTION core.check_journal_line_account();

-- Nothing posts into a CLOSED or LOCKED period (journals and stock).
CREATE OR REPLACE FUNCTION core.check_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_date date; v_entity uuid; v_status text;
BEGIN
  IF TG_TABLE_NAME = 'JournalEntry' THEN
    v_date := NEW."entryDate"; v_entity := NEW."legalEntityId";
  ELSE
    v_date := NEW."postingDate";
    SELECT "legalEntityId" INTO v_entity FROM core."Warehouse" WHERE id = NEW."warehouseId";
  END IF;
  SELECT status INTO v_status FROM core."AccountingPeriod"
   WHERE "legalEntityId" = v_entity AND v_date BETWEEN "startDate" AND "endDate";
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'no accounting period defined for % on %', v_entity, v_date;
  ELSIF v_status <> 'OPEN' THEN
    RAISE EXCEPTION 'period containing % is %', v_date, v_status;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_period_open ON core."JournalEntry";
CREATE TRIGGER trg_period_open BEFORE INSERT ON core."JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION core.check_period_open();
DROP TRIGGER IF EXISTS trg_period_open ON core."StockLedgerEntry";
CREATE TRIGGER trg_period_open BEFORE INSERT ON core."StockLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION core.check_period_open();

-- ─────────────────────────────────────────────────────────────────────────────
-- E. DOCUMENT NUMBERING (gapless, per legal entity / type / fiscal year)
-- ─────────────────────────────────────────────────────────────────────────────
-- Call inside the transaction that creates the document. The row lock makes
-- concurrent callers queue; a rollback releases the number (no gaps).
CREATE OR REPLACE FUNCTION core.next_document_number(p_legal_entity uuid, p_type text, p_date date)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE s record; v_no text;
BEGIN
  SELECT ds.* INTO s
  FROM core."DocumentSeries" ds JOIN core."FiscalYear" fy ON fy.id = ds."fiscalYearId"
  WHERE ds."legalEntityId" = p_legal_entity AND ds."documentType"::text = p_type
    AND p_date BETWEEN fy."startDate" AND fy."endDate" AND ds.active
  FOR UPDATE OF ds;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active % series for legal entity % on %', p_type, p_legal_entity, p_date;
  END IF;
  v_no := s.prefix || lpad(s."nextNumber"::text, s.padding, '0');
  IF p_type IN ('TAX_INVOICE', 'BILL_OF_SUPPLY', 'CREDIT_NOTE', 'DEBIT_NOTE') AND length(v_no) > 16 THEN
    RAISE EXCEPTION 'GST document number % exceeds 16 characters', v_no;
  END IF;
  UPDATE core."DocumentSeries" SET "nextNumber" = "nextNumber" + 1, "updatedAt" = now() WHERE id = s.id;
  RETURN v_no;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F. CHECK CONSTRAINTS & PARTIAL UNIQUE INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.add_check(p_table text, p_name text, p_expr text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = p_name) THEN
    EXECUTE format('ALTER TABLE core.%I ADD CONSTRAINT %I CHECK (%s)', p_table, p_name, p_expr);
  END IF;
END $$;

SELECT core.add_check('EmployeeReportingLine', 'ck_not_own_manager', '"employeeId" <> "managerId"');
SELECT core.add_check('Customer', 'ck_customer_merge', '("status" = ''MERGED'') = ("mergedIntoId" IS NOT NULL) AND ("mergedIntoId" IS NULL OR "mergedIntoId" <> id)');
SELECT core.add_check('Customer', 'ck_customer_gstin', '"gstin" IS NULL OR "gstin" ~ ''^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$''');
SELECT core.add_check('Supplier', 'ck_supplier_gstin', '"gstin" IS NULL OR "gstin" ~ ''^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$''');
SELECT core.add_check('LegalEntity', 'ck_entity_gstin', '"gstin" IS NULL OR "gstin" ~ ''^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$''');
SELECT core.add_check('CustomerAssignment', 'ck_assignment_target', 'num_nonnulls("employeeId", "teamId", "regionId") >= 1');
SELECT core.add_check('SalesEnquiry', 'ck_enquiry_has_party', '"customerId" IS NOT NULL OR "prospectCompany" IS NOT NULL OR "prospectPhoneE164" IS NOT NULL');
SELECT core.add_check('SalesEnquiry', 'ck_enquiry_disqualify_reason', '"status" <> ''DISQUALIFIED'' OR "disqualifyReason" IS NOT NULL');
SELECT core.add_check('SalesEnquiry', 'ck_enquiry_lost_reason', '"status" <> ''LOST'' OR "lostReason" IS NOT NULL');
SELECT core.add_check('EnquiryLine', 'ck_enquiry_qty', 'quantity > 0');
SELECT core.add_check('SalesEstimateLine', 'ck_est_line', 'quantity > 0 AND "unitPrice" >= 0 AND "gstRate" >= 0');
SELECT core.add_check('SalesOrderLine', 'ck_so_line', 'quantity > 0 AND "unitPrice" >= 0 AND "cancelledQty" >= 0 AND "cancelledQty" <= quantity');
SELECT core.add_check('SalesOrder', 'ck_so_hold_reason', '"stage" <> ''ON_HOLD'' OR "holdReason" IS NOT NULL');
SELECT core.add_check('SalesOrder', 'ck_so_cancel_reason', '"stage" <> ''CANCELLED'' OR "cancelReason" IS NOT NULL');
SELECT core.add_check('InvoiceLine', 'ck_inv_line', 'quantity > 0 AND "taxableValue" >= 0 AND length("hsnCode") BETWEEN 4 AND 8');
SELECT core.add_check('Invoice', 'ck_inv_cancel_reason', '"status" <> ''CANCELLED'' OR "cancelReason" IS NOT NULL');
SELECT core.add_check('Invoice', 'ck_inv_no_length', 'length("invoiceNo") <= 16');
SELECT core.add_check('AdjustmentNote', 'ck_note_no_length', 'length("noteNo") <= 16');
SELECT core.add_check('DispatchLine', 'ck_dispatch_qty', 'quantity > 0');
SELECT core.add_check('InventoryReservation', 'ck_reservation_qty', 'quantity > 0');
SELECT core.add_check('StockLedgerEntry', 'ck_stock_qty_nonzero', 'quantity <> 0');
SELECT core.add_check('StockLedgerEntry', 'ck_stock_sign', $$
  (quantity > 0 AND "movementType" IN ('OPENING','PURCHASE_RECEIPT','SALES_RETURN','TRANSFER_IN','ADJUSTMENT_IN'))
  OR (quantity < 0 AND "movementType" IN ('SALES_DISPATCH','PURCHASE_RETURN','TRANSFER_OUT','ADJUSTMENT_OUT'))
  OR "reversalOfId" IS NOT NULL$$);
SELECT core.add_check('PaymentReceipt', 'ck_receipt_amount', 'amount > 0 AND "tdsDeducted" >= 0');
SELECT core.add_check('PaymentAllocation', 'ck_alloc_one_target', 'num_nonnulls("invoiceId", "salesOrderId") = 1 AND amount > 0');
SELECT core.add_check('SupplierPaymentAllocation', 'ck_supplier_alloc', 'amount > 0');
SELECT core.add_check('JournalLine', 'ck_journal_line', 'debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0)');
SELECT core.add_check('BusinessAction', 'ck_action_done', '"status" <> ''DONE'' OR "completedAt" IS NOT NULL');
SELECT core.add_check('BusinessAction', 'ck_action_target', 'num_nonnulls("assigneeId", "assignedPositionId", "assignedTeamId") >= 1');
SELECT core.add_check('BusinessAction', 'ck_action_entity', '("entityType" IS NULL) = ("entityId" IS NULL)');
SELECT core.add_check('EscalationStep', 'ck_escalation_target', $$
  ("target" <> 'POSITION' OR "targetPositionId" IS NOT NULL) AND ("target" <> 'EMPLOYEE' OR "targetEmployeeId" IS NOT NULL) AND "afterMinutes" >= 0$$);
SELECT core.add_check('ApprovalPolicyStage', 'ck_approver_target', $$
  ("approverType" <> 'POSITION' OR "positionId" IS NOT NULL) AND ("approverType" <> 'ROLE' OR "roleId" IS NOT NULL)
  AND ("approverType" <> 'EMPLOYEE' OR "employeeId" IS NOT NULL)$$);
SELECT core.add_check('ApprovalRequest', 'ck_approval_stage', '"currentStage" BETWEEN 1 AND "totalStages"');
SELECT core.add_check('TaxRate', 'ck_tax_rate', '"gstRate" >= 0 AND "gstRate" <= 100 AND "cessRate" >= 0');
SELECT core.add_check('DocumentSeries', 'ck_series', '"nextNumber" >= 1 AND padding BETWEEN 1 AND 10');
SELECT core.add_check('NotificationPreference', 'ck_quiet_hours', '("quietFromMin" IS NULL) = ("quietToMin" IS NULL) AND coalesce("quietFromMin", 0) BETWEEN 0 AND 1439 AND coalesce("quietToMin", 0) BETWEEN 0 AND 1439');

CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_primary_department ON core."EmployeeDepartmentAssignment" ("employeeId") WHERE "validTo" IS NULL AND "isPrimary";
CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_primary_position   ON core."EmployeePositionAssignment" ("employeeId") WHERE "validTo" IS NULL AND "isPrimary";
CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_primary_region     ON core."EmployeeRegionAssignment" ("employeeId") WHERE "validTo" IS NULL AND responsibility = 'PRIMARY';
CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_region_open        ON core."EmployeeRegionAssignment" ("employeeId", "regionId") WHERE "validTo" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_member_open       ON core."TeamMembership" ("teamId", "employeeId") WHERE "validTo" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_direct_manager_open    ON core."EmployeeReportingLine" ("employeeId") WHERE "validTo" IS NULL AND type = 'DIRECT';
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_role_open     ON core."EmployeeRole" ("employeeId", "roleId") WHERE "validTo" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_owner_open    ON core."CustomerAssignment" ("customerId", role) WHERE "validTo" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_primary_contact ON core."CustomerContact" ("customerId") WHERE "isPrimary" AND active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_default_billing ON core."CustomerAddress" ("customerId") WHERE "isDefaultBilling" AND active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_default_shipping ON core."CustomerAddress" ("customerId") WHERE "isDefaultShipping" AND active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_estimate_holder_open   ON core."SalesEstimateAssignment" ("estimateId") WHERE "validTo" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_selected_rate_quote    ON core."EnquiryRateQuote" ("enquiryLineId") WHERE "isSelected";
CREATE UNIQUE INDEX IF NOT EXISTS uq_default_price_list     ON core."PriceList" ((true)) WHERE "isDefault" AND active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_alloc_active_invoice   ON core."PaymentAllocation" ("receiptId", "invoiceId") WHERE "reversedAt" IS NULL AND "invoiceId" IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS ix_customer_name_trgm ON core."Customer" USING gin ("normalizedName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_access_log_time_brin ON core."AccessLog" USING brin ("occurredAt");
CREATE INDEX IF NOT EXISTS ix_row_change_time_brin ON core."RowChangeLog" USING brin ("occurredAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- G. READ MODELS (derived — never stored as editable columns)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW core.v_stock_on_hand AS
SELECT "productId", "warehouseId", sum(quantity) AS on_hand
FROM core."StockLedgerEntry" GROUP BY "productId", "warehouseId";

CREATE OR REPLACE VIEW core.v_stock_available AS
SELECT coalesce(s."productId", r."productId") AS "productId",
       coalesce(s."warehouseId", r."warehouseId") AS "warehouseId",
       coalesce(s.on_hand, 0) AS on_hand,
       coalesce(r.reserved, 0) AS reserved,
       coalesce(s.on_hand, 0) - coalesce(r.reserved, 0) AS available
FROM core.v_stock_on_hand s
FULL JOIN (SELECT "productId", "warehouseId", sum(quantity) AS reserved
           FROM core."InventoryReservation" WHERE status = 'ACTIVE'
           GROUP BY "productId", "warehouseId") r
  ON r."productId" = s."productId" AND r."warehouseId" = s."warehouseId";

CREATE OR REPLACE VIEW core.v_sales_order_line_progress AS
SELECT l.id AS "salesOrderLineId", l."salesOrderId", l.quantity, l."cancelledQty",
       coalesce((SELECT sum(r.quantity) FROM core."InventoryReservation" r
                 WHERE r."salesOrderLineId" = l.id AND r.status = 'ACTIVE'), 0) AS reserved_qty,
       coalesce((SELECT sum(d.quantity) FROM core."DispatchLine" d JOIN core."Dispatch" h ON h.id = d."dispatchId"
                 WHERE d."salesOrderLineId" = l.id AND h.status IN ('DISPATCHED', 'DELIVERED')), 0) AS dispatched_qty,
       coalesce((SELECT sum(i.quantity) FROM core."InvoiceLine" i JOIN core."Invoice" v ON v.id = i."invoiceId"
                 WHERE i."salesOrderLineId" = l.id AND v.status = 'ISSUED'), 0) AS invoiced_qty
FROM core."SalesOrderLine" l;

CREATE OR REPLACE VIEW core.v_invoice_outstanding AS
SELECT v.id AS "invoiceId", v."legalEntityId", v."customerId", v."regionId", v."invoiceNo",
       v."invoiceDate", v."dueDate", v."grandTotal",
       coalesce(a.paid, 0) AS paid,
       coalesce(n.credited, 0) AS credited,
       v."grandTotal" - coalesce(a.paid, 0) - coalesce(n.credited, 0) AS outstanding,
       GREATEST(0, current_date - v."dueDate") AS days_overdue
FROM core."Invoice" v
LEFT JOIN (SELECT "invoiceId", sum(amount + "tdsAmount") AS paid FROM core."PaymentAllocation"
           WHERE "reversedAt" IS NULL AND "invoiceId" IS NOT NULL GROUP BY "invoiceId") a ON a."invoiceId" = v.id
LEFT JOIN (SELECT "invoiceId", sum(CASE WHEN "noteType" = 'CREDIT' THEN "grandTotal" ELSE -"grandTotal" END) AS credited
           FROM core."AdjustmentNote" WHERE status = 'ISSUED' GROUP BY "invoiceId") n ON n."invoiceId" = v.id
WHERE v.status = 'ISSUED';

-- Over-reservation guard: a reservation may not exceed available stock.
CREATE OR REPLACE FUNCTION core.check_reservation_available() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_avail numeric;
BEGIN
  IF NEW.status <> 'ACTIVE' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."productId"::text || NEW."warehouseId"::text, 0));
  SELECT coalesce(sum(quantity), 0) INTO v_avail FROM core."StockLedgerEntry"
   WHERE "productId" = NEW."productId" AND "warehouseId" = NEW."warehouseId";
  SELECT v_avail - coalesce(sum(quantity), 0) INTO v_avail FROM core."InventoryReservation"
   WHERE "productId" = NEW."productId" AND "warehouseId" = NEW."warehouseId" AND status = 'ACTIVE'
     AND id <> NEW.id;
  IF NEW.quantity > v_avail THEN
    RAISE EXCEPTION 'cannot reserve %: only % available', NEW.quantity, v_avail;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_reservation_available ON core."InventoryReservation";
CREATE TRIGGER trg_reservation_available BEFORE INSERT OR UPDATE OF quantity, status ON core."InventoryReservation"
  FOR EACH ROW EXECUTE FUNCTION core.check_reservation_available();
