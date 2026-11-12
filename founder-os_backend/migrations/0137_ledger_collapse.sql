-- 0137_ledger_collapse.sql — TelecallerScoreEvent BECOMES core_credit (founder decision 2026-11-12).
--
-- Same collapse pattern as 0136: the mirror-then-flip plan is abandoned for
-- the close-credit ledger. Parity verified 2026-11-12 on live D1:
-- TelecallerScoreEvent 1573 rows = core_credit 1573 rows, same ids, all
-- business fields identical (the single diff was 0.5s of mirror-write
-- timestamp skew on createdAt of one row — the renamed table keeps the
-- authoritative legacy timestamps).
--
--   1. DROP the verified 1:1 mirror (its indexes die with it; the renamed
--      table keeps TelecallerScoreEvent's own indexes).
--   2. RENAME the legacy table into core_* (metadata-only, instant).
--   3. ADD unification columns: actorId/actorReason (who/what — close system
--      stamps the credited telecaller + kind; remarks stamp the manager).
--   4. VIEW + INSTEAD OF bridge on the old name until the follow-up drops it.
-- The designed history reset (bulk DELETE of close rows + epoch stamp) is
-- unaffected — it deletes by id set, tombstones don't apply to the ledger.

DROP TABLE core_credit;

ALTER TABLE TelecallerScoreEvent RENAME TO core_credit;

ALTER TABLE core_credit ADD COLUMN actorId TEXT;
ALTER TABLE core_credit ADD COLUMN actorReason TEXT;

CREATE VIEW TelecallerScoreEvent AS SELECT * FROM core_credit;

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
