-- 0108_crm_dispatch_proof_extra_docs.sql — three more optional dispatch proofs.
--
-- The dispatch floor now also attaches (all optional, all burn-once):
--   transportId   → kind='transport_receipt'  (transporter's receipt / bilty)
--   courierId     → kind='courier_receipt'    (courier slip / AWB)
--   packingListId → kind='packing_list'       (the packing list for the box)
--
-- The invoice stays the only REQUIRED file. SQLite UNIQUE columns accept
-- multiple NULLs, so an unused slot stores NULL and never collides, while a
-- provided file still burns once via its UNIQUE column (same semantics as the
-- before/after photos added in 0106). Rebuild is used because SQLite cannot
-- add an inline UNIQUE constraint via ALTER TABLE.

CREATE TABLE IF NOT EXISTS CrmDispatchProof_new (
  id            TEXT PRIMARY KEY,
  soId          TEXT NOT NULL DEFAULT '',
  soNumber      TEXT NOT NULL DEFAULT '',
  invoiceId     TEXT NOT NULL DEFAULT '',
  beforeId      TEXT,
  afterId       TEXT,
  items         TEXT NOT NULL DEFAULT '[]',
  transportId   TEXT,
  courierId     TEXT,
  packingListId TEXT,
  actor         TEXT NOT NULL DEFAULT '',
  day           TEXT NOT NULL DEFAULT '',
  createdAt     TEXT NOT NULL,
  UNIQUE (invoiceId),
  UNIQUE (beforeId),
  UNIQUE (afterId),
  UNIQUE (transportId),
  UNIQUE (courierId),
  UNIQUE (packingListId)
);

-- `items` (migration 0107) is carried across too, so a from-scratch replay
-- keeps the batch snapshots.
INSERT OR IGNORE INTO CrmDispatchProof_new
  (id, soId, soNumber, invoiceId, beforeId, afterId, items, actor, day, createdAt)
  SELECT id, soId, soNumber, invoiceId, NULLIF(beforeId, ''), NULLIF(afterId, ''), COALESCE(items, '[]'), actor, day, createdAt
  FROM CrmDispatchProof;

DROP TABLE CrmDispatchProof;

ALTER TABLE CrmDispatchProof_new RENAME TO CrmDispatchProof;

CREATE INDEX IF NOT EXISTS idx_crm_dispatch_proof_so ON CrmDispatchProof(soId);
CREATE INDEX IF NOT EXISTS idx_crm_dispatch_proof_so_number ON CrmDispatchProof(soNumber);
