-- 0177_sales_staff_is_the_hr_register.sql
--
-- The sales roster stops being a second master. A person is telecaller / field
-- staff / team lead by their chart seat and their sales profile now lives on
-- HumanResourcesMember (salesType/salesRegions/salesTeamLeadId/...). Every
-- roster id in history is re-pointed at the employee id, then the Telecaller
-- table is retired (archived for one release) and replaced by a read-only
-- VIEW with the old column names so the leaderboard, drills, risk, dialer,
-- field visits and notification SQL keep reading the same shape.
--
-- Region count is free: regions are a JSON array, 0..N, validated against the
-- active catalog + the chart seat's allotment in modules/org/regions.ts. The
-- TL1/TL2 tier lives on HumanResourcesRegion only (it drives the reseller
-- target ledger), never on a person.
--
-- core_credit is rebuilt CONSTRAINT-ONLY (same rows, same columns) to drop its
-- Telecaller foreign key; the data is untouched and the core lock files are
-- not edited. See docs/core-change-requests if this needs to be revisited.

ALTER TABLE "HumanResourcesMember" ADD COLUMN "salesType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HumanResourcesMember" ADD COLUMN "salesRegions" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "HumanResourcesMember" ADD COLUMN "salesTeamLeadId" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "salesAssignFollowUps" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "salesOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "salesAbsentSince" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "neodoveUserId" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "neodoveUserName" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "whatsapp" TEXT;

-- roster row -> employee. Email is the join key (loginEmail first, then the
-- employee email so the Rajiv Kapoor survivor row still matches), and the
-- no-email field-staff rows are pinned explicitly (they are the same person:
-- the R1 field-staff slot became Omkar Singh's employee record).
CREATE TABLE "_sales_staff_map" AS
SELECT t.id AS rosterId,
  (SELECT m.id FROM "HumanResourcesMember" m
    WHERE coalesce(m.deleted, 0) = 0 AND m.department = 'Sales'
      AND t.email IS NOT NULL AND trim(t.email) <> ''
      AND (lower(t.email) = lower(coalesce(nullif(m.loginEmail, ''), m.email))
           OR lower(t.email) = lower(coalesce(m.email, '')))
    ORDER BY (lower(t.email) = lower(coalesce(nullif(m.loginEmail, ''), m.email))) DESC,
             m.createdAt ASC, m.id ASC
    LIMIT 1) AS memberId
FROM Telecaller t WHERE coalesce(t.deleted, 0) = 0;

UPDATE "_sales_staff_map" SET memberId = '5eb8fb8e-00b3-4a4b-a188-9e536ece6b29'
 WHERE rosterId IN ('5939905c-8111-4e73-875e-8f9fdd519c33', '0f44911b-ab02-44b7-8ef0-141e8f80617d');

-- Sales profile: only chart sales seats keep a profile. A Sales Head can own
-- history (Muskan) without becoming field staff.
UPDATE "HumanResourcesMember" SET
  salesType = (SELECT t.type FROM "_sales_staff_map" mp JOIN Telecaller t ON t.id = mp.rosterId
               WHERE mp.memberId = "HumanResourcesMember".id LIMIT 1),
  salesRegions = coalesce((SELECT CASE
      WHEN coalesce(t.region, '') <> '' AND coalesce(t.region2, '') <> '' THEN json_array(t.region, t.region2)
      WHEN coalesce(t.region, '') <> '' THEN json_array(t.region)
      WHEN coalesce(t.region2, '') <> '' THEN json_array(t.region2) ELSE '[]' END
    FROM "_sales_staff_map" mp JOIN Telecaller t ON t.id = mp.rosterId
    WHERE mp.memberId = "HumanResourcesMember".id LIMIT 1), '[]'),
  salesOrder = coalesce((SELECT t."order" FROM "_sales_staff_map" mp JOIN Telecaller t ON t.id = mp.rosterId
               WHERE mp.memberId = "HumanResourcesMember".id LIMIT 1), 0),
  salesAssignFollowUps = coalesce((SELECT t.assignEstimateFollowUps FROM "_sales_staff_map" mp JOIN Telecaller t ON t.id = mp.rosterId
               WHERE mp.memberId = "HumanResourcesMember".id LIMIT 1), 1),
  salesAbsentSince = (SELECT t.absentSince FROM "_sales_staff_map" mp JOIN Telecaller t ON t.id = mp.rosterId
               WHERE mp.memberId = "HumanResourcesMember".id LIMIT 1),
  neodoveUserId = (SELECT t.neodoveUserId FROM "_sales_staff_map" mp JOIN Telecaller t ON t.id = mp.rosterId
               WHERE mp.memberId = "HumanResourcesMember".id LIMIT 1),
  neodoveUserName = (SELECT t.neodoveUserName FROM "_sales_staff_map" mp JOIN Telecaller t ON t.id = mp.rosterId
               WHERE mp.memberId = "HumanResourcesMember".id LIMIT 1),
  whatsapp = (SELECT t.whatsapp FROM "_sales_staff_map" mp JOIN Telecaller t ON t.id = mp.rosterId
               WHERE mp.memberId = "HumanResourcesMember".id LIMIT 1)
WHERE id IN (
  SELECT mp.memberId FROM "_sales_staff_map" mp
  JOIN "HumanResourcesMember" m2 ON m2.id = mp.memberId
  WHERE mp.memberId IS NOT NULL AND m2.designation IN ('Team Lead', 'Telecaller', 'Field Staff')
);

-- Reporting line: none of the old "TL1/TL2" tokens existed as a person, so the
-- first pass links each staff member to the team lead who controls one of
-- their regions (R1/R3 -> Rajiv). The head can re-link anyone afterwards.
UPDATE "HumanResourcesMember" SET salesTeamLeadId = (
  SELECT tl.id FROM "HumanResourcesMember" tl
  WHERE tl.salesType = 'team_lead' AND coalesce(tl.deleted, 0) = 0
    AND tl.id <> "HumanResourcesMember".id
    AND EXISTS (SELECT 1 FROM json_each(tl.salesRegions) je
                WHERE je.value IN (SELECT value FROM json_each("HumanResourcesMember".salesRegions)))
  ORDER BY tl.createdAt ASC, tl.id ASC LIMIT 1)
WHERE salesType IN ('telecaller', 'field_staff') AND json_array_length(salesRegions) > 0;

-- ── FK rebuild: assignment + credit may now point at an employee ─────────
CREATE TABLE "EstimateAssignment__new" (
  id                TEXT PRIMARY KEY,
  estimateId        TEXT NOT NULL,
  telecallerId      TEXT NOT NULL,
  assignedAt        TEXT NOT NULL,
  day               TEXT NOT NULL,
  reassignedFromId  TEXT,
  status            TEXT NOT NULL DEFAULT 'assigned',
  snatchReason      TEXT,
  tempForTelecallerId TEXT,
  FOREIGN KEY (estimateId) REFERENCES Estimate(estimateId) ON DELETE CASCADE
);
INSERT INTO "EstimateAssignment__new" (id, estimateId, telecallerId, assignedAt, day, reassignedFromId, status, snatchReason, tempForTelecallerId)
  SELECT id, estimateId, telecallerId, assignedAt, day, reassignedFromId, status, snatchReason, tempForTelecallerId FROM "EstimateAssignment";
DROP TABLE "EstimateAssignment";
ALTER TABLE "EstimateAssignment__new" RENAME TO "EstimateAssignment";
CREATE INDEX idx_estassign_telecaller ON "EstimateAssignment"(telecallerId);
CREATE INDEX idx_estassign_estimate ON "EstimateAssignment"(estimateId);
CREATE INDEX idx_estassign_day ON "EstimateAssignment"(day);
CREATE INDEX idx_ea_temp_for ON "EstimateAssignment"(tempForTelecallerId);

-- The legacy `TelecallerScoreEvent` bridge (mig 0137) is a VIEW + 3 INSTEAD OF
-- triggers over `core_credit`; SQLite refuses to drop a table a view reads. Drop
-- the bridge, rebuild the table constraint-only, then recreate it VERBATIM.
DROP VIEW "TelecallerScoreEvent";

CREATE TABLE "core_credit__new" (
  id           TEXT PRIMARY KEY,
  telecallerId TEXT NOT NULL,
  estimateId   TEXT NOT NULL,
  delta        INTEGER NOT NULL,
  day          TEXT NOT NULL,
  reason       TEXT,
  createdAt    TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT '',
  actorId      TEXT,
  actorReason  TEXT
);
INSERT INTO "core_credit__new" (id, telecallerId, estimateId, delta, day, reason, createdAt, kind, actorId, actorReason)
  SELECT id, telecallerId, estimateId, delta, day, reason, createdAt, kind, actorId, actorReason FROM "core_credit";
DROP TABLE "core_credit";
ALTER TABLE "core_credit__new" RENAME TO "core_credit";
CREATE INDEX idx_scoreevent_telecaller ON "core_credit"(telecallerId);
CREATE INDEX idx_scoreevent_day ON "core_credit"(day);
CREATE INDEX idx_scoreevent_estimate ON "core_credit"(estimateId);

CREATE VIEW "TelecallerScoreEvent" AS SELECT * FROM core_credit;
CREATE TRIGGER trg_TelecallerScoreEvent_insert INSTEAD OF INSERT ON TelecallerScoreEvent
BEGIN
  INSERT INTO core_credit (
    id, telecallerId, estimateId, kind, delta, day, reason, createdAt, actorId, actorReason
  ) VALUES (
    NEW.id, NEW.telecallerId, NEW.estimateId, NEW.kind, NEW.delta, NEW.day,
    NEW.reason, NEW.createdAt, NEW.actorId, NEW.actorReason
  );
END;
CREATE TRIGGER trg_TelecallerScoreEvent_update INSTEAD OF UPDATE ON TelecallerScoreEvent
BEGIN
  UPDATE core_credit SET
    telecallerId = NEW.telecallerId, estimateId = NEW.estimateId, kind = NEW.kind,
    delta = NEW.delta, day = NEW.day, reason = NEW.reason, createdAt = NEW.createdAt,
    actorId = NEW.actorId, actorReason = NEW.actorReason
  WHERE id = OLD.id;
END;
CREATE TRIGGER trg_TelecallerScoreEvent_delete INSTEAD OF DELETE ON TelecallerScoreEvent
BEGIN
  DELETE FROM core_credit WHERE id = OLD.id;
END;

-- ── history: old roster ids become employee ids ───────────────────────────
UPDATE "Estimate" SET createdBy = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "Estimate".createdBy)
 WHERE createdBy IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "Estimate" SET assignedTelecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "Estimate".assignedTelecallerId)
 WHERE assignedTelecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "Estimate" SET lockedTelecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "Estimate".lockedTelecallerId)
 WHERE lockedTelecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "EstimateAssignment" SET telecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "EstimateAssignment".telecallerId)
 WHERE telecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "EstimateAssignment" SET tempForTelecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "EstimateAssignment".tempForTelecallerId)
 WHERE tempForTelecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "core_credit" SET telecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "core_credit".telecallerId)
 WHERE telecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "ScoreEvent" SET telecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "ScoreEvent".telecallerId)
 WHERE telecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "ManualCallLog" SET telecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "ManualCallLog".telecallerId)
 WHERE telecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "DeviceRegistration" SET telecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "DeviceRegistration".telecallerId)
 WHERE telecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "DevicePairCode" SET telecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "DevicePairCode".telecallerId)
 WHERE telecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "DevicePairRequest" SET telecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "DevicePairRequest".telecallerId)
 WHERE telecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "DeviceCall" SET telecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "DeviceCall".telecallerId)
 WHERE telecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "FieldVisit" SET telecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "FieldVisit".telecallerId)
 WHERE telecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "DialerQueue" SET telecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "DialerQueue".telecallerId)
 WHERE telecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);
UPDATE "DialerBreak" SET telecallerId = (SELECT mp.memberId FROM "_sales_staff_map" mp WHERE mp.rosterId = "DialerBreak".telecallerId)
 WHERE telecallerId IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);

-- ── retire the table, keep the name as a read-only projection ─────────────
ALTER TABLE "Telecaller" RENAME TO "TelecallerArchive";

DELETE FROM "TelecallerArchive" WHERE id IN (SELECT rosterId FROM "_sales_staff_map" WHERE memberId IS NOT NULL);

CREATE VIEW "Telecaller" AS
SELECT
  m.id AS id,
  m.name AS name,
  m.email AS email,
  coalesce(m.salesAssignFollowUps, 1) AS assignEstimateFollowUps,
  coalesce(m.salesOrder, 0) AS "order",
  m.createdAt AS createdAt,
  m.neodoveUserId AS neodoveUserId,
  m.neodoveUserName AS neodoveUserName,
  coalesce(m.deleted, 0) AS deleted,
  m.phone AS phone,
  m.whatsapp AS whatsapp,
  m.salesAbsentSince AS absentSince,
  coalesce((SELECT r.tlLevel FROM "HumanResourcesRegion" r WHERE r.code = json_extract(m.salesRegions, '$[0]')), '') AS tlLevel,
  coalesce(json_extract(m.salesRegions, '$[0]'), '') AS region,
  m.salesType AS type,
  coalesce(json_extract(m.salesRegions, '$[1]'), '') AS region2,
  m.salesRegions AS regions,
  m.salesTeamLeadId AS teamLeadId,
  m.active AS active
FROM "HumanResourcesMember" m
WHERE m.salesType <> '' AND coalesce(m.deleted, 0) = 0;

DROP TABLE "_sales_staff_map";
