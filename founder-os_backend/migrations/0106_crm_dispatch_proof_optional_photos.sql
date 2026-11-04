-- 0106_crm_dispatch_proof_optional_photos.sql — packing photos become optional.
--
-- The proof gate keeps ONE required file (the invoice PDF); before/after
-- packing photos attach when the floor has them. SQLite UNIQUE columns accept
-- multiple NULLs, so a missing photo stores NULL and never collides, while a
-- provided photo still burns once via its UNIQUE column. Rebuild is used
-- because SQLite cannot ALTER a column to nullable or drop an inline UNIQUE.
-- Existing rows (if any) survive via NULLIF('' → NULL) copy.

CREATE TABLE IF NOT EXISTS CrmDispatchProof_new (
  id        TEXT PRIMARY KEY,
  soId      TEXT NOT NULL DEFAULT '',
  soNumber  TEXT NOT NULL DEFAULT '',
  invoiceId TEXT NOT NULL DEFAULT '',
  beforeId  TEXT,
  afterId   TEXT,
  actor     TEXT NOT NULL DEFAULT '',
  day       TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  UNIQUE (invoiceId),
  UNIQUE (beforeId),
  UNIQUE (afterId)
);

INSERT OR IGNORE INTO CrmDispatchProof_new (id, soId, soNumber, invoiceId, beforeId, afterId, actor, day, createdAt)
  SELECT id, soId, soNumber, invoiceId, NULLIF(beforeId, ''), NULLIF(afterId, ''), actor, day, createdAt FROM CrmDispatchProof;

DROP TABLE CrmDispatchProof;

ALTER TABLE CrmDispatchProof_new RENAME TO CrmDispatchProof;

CREATE INDEX IF NOT EXISTS idx_crm_dispatch_proof_so ON CrmDispatchProof(soId);
CREATE INDEX IF NOT EXISTS idx_crm_dispatch_proof_so_number ON CrmDispatchProof(soNumber);
