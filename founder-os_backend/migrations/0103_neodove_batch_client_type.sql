-- 0103_neodove_batch_client_type.sql — filter campaign pushes by client type.
--
-- One client type per push ('' = all types). Stored on the batch so history
-- distinguishes same-state/different-type pushes and the "already pushed"
-- warning stays per state+type.

ALTER TABLE NeoDovePushBatch ADD COLUMN clientType TEXT NOT NULL DEFAULT '';
