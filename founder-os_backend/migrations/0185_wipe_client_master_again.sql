-- 0185_wipe_client_master_again.sql
--
-- The client master book is wiped a second time on the founder's request
-- (2026-11-28): "i want this to happen seamlessly ... you can delete all the
-- data i'll reupload all of it once again". He re-uploads the Zoho export
-- right after, and a fresh book is an exact mirror of that file (an upsert
-- would keep rows he has since deleted in Zoho).
--
-- REVERSIBLE: the table is copied verbatim BEFORE the delete, so the rows are
-- one statement away from coming back (identical column order, both sides
-- `SELECT *`):
--   DELETE FROM core_customer;
--   INSERT INTO core_customer SELECT * FROM _backup_core_customer_20261128;
-- The older book stays in _backup_core_customer_20261127 (14,838 rows, the
-- pre-0182 master) — nothing overwrites it. Drop either backup table only
-- after a re-import has been verified.
--
-- The code keeps its tombstone rule (store.ts never row-deletes the book);
-- this is a deliberate one-off data operation by the owner, not a new delete
-- path. No table declares a foreign key on core_customer, so nothing
-- cascades — estimates keep their rows and their customerId, which the
-- re-import re-points to the same ids.

CREATE TABLE IF NOT EXISTS _backup_core_customer_20261128 AS SELECT * FROM core_customer;

INSERT OR REPLACE INTO MasterDataAudit (id, actorId, actorName, action, entityId, detail, createdAt)
SELECT 'wipe-20261128', 'root', 'Founder', 'wipe', '',
       '{"reason":"founder wipe, clean re-upload follows","backup":"_backup_core_customer_20261128","rows":' || COUNT(*) || '}',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM core_customer;

DELETE FROM core_customer;
