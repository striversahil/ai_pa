-- 0178_drop_telecaller_archive.sql
--
-- 0177 re-pointed every roster id in history at the employee id and left
-- "TelecallerArchive" behind for one release as a rollback seat. The live
-- "Telecaller" name is the read-only VIEW over HumanResourcesMember, so the
-- archived table (and its idx_telecaller_region[2] indexes) can go.
--
-- Run only after the 0177 backend deploy is verified.

DROP TABLE IF EXISTS "TelecallerArchive";
