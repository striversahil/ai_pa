-- 0136_customer_collapse.sql — MasterCustomer BECOMES core_customer (founder decision 2026-11-12).
--
-- The mirror-then-flip plan is abandoned: instead of moving reads to a parallel
-- core_customer copy, the legacy table IS the core table now. Parity verified
-- 2026-11-12 on live D1: MasterCustomer 5106 rows = core_customer 5106 rows,
-- 0 DELETED tombstones, identical ids (mirror reused legacy ids 1:1).
--
--   1. DROP the verified 1:1 mirror (its indexes die with it; the renamed
--      table keeps MasterCustomer's own indexes — same columns, stale names,
--      functionally identical).
--   2. RENAME the legacy table into core_* (metadata-only, instant).
--   3. ADD unification columns: actorId/actorReason (last-writer stamp, set by
--      the master-data write paths) + tombstonedAt (delete marker).
--   4. VIEW + INSTEAD OF bridge on the old name so any missed reader/writer
--      keeps working until the follow-up PR drops the bridge.
-- core_zoho_link rows are unaffected (entityIds are the same ids).

DROP TABLE core_customer;

ALTER TABLE MasterCustomer RENAME TO core_customer;

ALTER TABLE core_customer ADD COLUMN actorId TEXT;
ALTER TABLE core_customer ADD COLUMN actorReason TEXT;
ALTER TABLE core_customer ADD COLUMN tombstonedAt TEXT;

CREATE VIEW MasterCustomer AS SELECT * FROM core_customer;

CREATE TRIGGER trg_MasterCustomer_insert INSTEAD OF INSERT ON MasterCustomer
BEGIN
  INSERT INTO core_customer (
    id, zohoCustomerId, region, zone, subArea, state, pincode, displayName, companyName,
    customerType, customerTypeBase, customerTypeTag, status, contactPerson, designation,
    phonesJson, emailsJson, billingAddress, gstin, owner, pipelineStage, estimateCount,
    lastEstimateDate, salesOrderCount, lastSalesOrderDate, cityZoho, cityVerified,
    citySource, locationBasis, duplicateGroup, duplicateConfidence, suggestedAction,
    duplicateReview, reviewedBy, reviewedAt, notes, createdAt, updatedAt,
    actorId, actorReason, tombstonedAt
  ) VALUES (
    NEW.id, NEW.zohoCustomerId, NEW.region, NEW.zone, NEW.subArea, NEW.state, NEW.pincode,
    NEW.displayName, NEW.companyName, NEW.customerType, NEW.customerTypeBase,
    NEW.customerTypeTag, NEW.status, NEW.contactPerson, NEW.designation, NEW.phonesJson,
    NEW.emailsJson, NEW.billingAddress, NEW.gstin, NEW.owner, NEW.pipelineStage,
    NEW.estimateCount, NEW.lastEstimateDate, NEW.salesOrderCount, NEW.lastSalesOrderDate,
    NEW.cityZoho, NEW.cityVerified, NEW.citySource, NEW.locationBasis, NEW.duplicateGroup,
    NEW.duplicateConfidence, NEW.suggestedAction, NEW.duplicateReview, NEW.reviewedBy,
    NEW.reviewedAt, NEW.notes, NEW.createdAt, NEW.updatedAt,
    NEW.actorId, NEW.actorReason, NEW.tombstonedAt
  );
END;

CREATE TRIGGER trg_MasterCustomer_update INSTEAD OF UPDATE ON MasterCustomer
BEGIN
  UPDATE core_customer SET
    zohoCustomerId = NEW.zohoCustomerId, region = NEW.region, zone = NEW.zone,
    subArea = NEW.subArea, state = NEW.state, pincode = NEW.pincode,
    displayName = NEW.displayName, companyName = NEW.companyName,
    customerType = NEW.customerType, customerTypeBase = NEW.customerTypeBase,
    customerTypeTag = NEW.customerTypeTag, status = NEW.status,
    contactPerson = NEW.contactPerson, designation = NEW.designation,
    phonesJson = NEW.phonesJson, emailsJson = NEW.emailsJson,
    billingAddress = NEW.billingAddress, gstin = NEW.gstin, owner = NEW.owner,
    pipelineStage = NEW.pipelineStage, estimateCount = NEW.estimateCount,
    lastEstimateDate = NEW.lastEstimateDate, salesOrderCount = NEW.salesOrderCount,
    lastSalesOrderDate = NEW.lastSalesOrderDate, cityZoho = NEW.cityZoho,
    cityVerified = NEW.cityVerified, citySource = NEW.citySource,
    locationBasis = NEW.locationBasis, duplicateGroup = NEW.duplicateGroup,
    duplicateConfidence = NEW.duplicateConfidence, suggestedAction = NEW.suggestedAction,
    duplicateReview = NEW.duplicateReview, reviewedBy = NEW.reviewedBy,
    reviewedAt = NEW.reviewedAt, notes = NEW.notes, createdAt = NEW.createdAt,
    updatedAt = NEW.updatedAt, actorId = NEW.actorId, actorReason = NEW.actorReason,
    tombstonedAt = NEW.tombstonedAt
  WHERE id = OLD.id;
END;

CREATE TRIGGER trg_MasterCustomer_delete INSTEAD OF DELETE ON MasterCustomer
BEGIN
  DELETE FROM core_customer WHERE id = OLD.id;
END;
