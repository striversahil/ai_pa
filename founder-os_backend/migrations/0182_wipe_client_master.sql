-- 0182_wipe_client_master.sql
--
-- The client master book is wiped on the founder's request (2026-11-27):
-- "delete all client master data, i'll add the client data again". The book is
-- re-imported afterwards from a fresh Zoho extract.
--
-- REVERSIBLE: the whole table is copied verbatim BEFORE the delete, so the
-- rows are one statement away from coming back (column order is identical,
-- both sides are `SELECT *`):
--   INSERT INTO core_customer SELECT * FROM _backup_core_customer_20261127;
-- Drop the backup table only after a re-import has been verified.
--
-- The code keeps its tombstone rule (collapse 0136 — store.ts never
-- row-deletes the book); this is a deliberate one-time data operation by the
-- owner, not a new delete path. No table declares a foreign key on
-- core_customer, so nothing cascades and no row elsewhere is touched.

CREATE TABLE IF NOT EXISTS _backup_core_customer_20261127 AS SELECT * FROM core_customer;

INSERT OR REPLACE INTO MasterDataAudit (id, actorId, actorName, action, entityId, detail, createdAt)
SELECT 'wipe-20261127', 'root', 'Founder', 'wipe', '',
       '{"reason":"founder wipe, re-import follows","backup":"_backup_core_customer_20261127","rows":' || COUNT(*) || '}',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM core_customer;

DELETE FROM core_customer;
