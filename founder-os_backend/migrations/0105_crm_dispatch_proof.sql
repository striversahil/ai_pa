-- 0105_crm_dispatch_proof.sql — fresh-proof gate for every dispatch.
--
-- Each Mark dispatched (full or partial) must carry a fresh triple:
--   1 × invoice PDF (SoAttachment kind='invoice')
--   1 × before-packing photo (kind='packing_before')
--   1 × after-packing photo (kind='packing_after')
-- One row here is written per dispatch action AFTER the items move. The three
-- UNIQUE columns make a single file unusable twice — a repeat partial must
-- upload a fresh set. No backfill: already-dispatched rows are unaffected.

CREATE TABLE IF NOT EXISTS CrmDispatchProof (
  id        TEXT PRIMARY KEY,
  soId      TEXT NOT NULL DEFAULT '',
  soNumber  TEXT NOT NULL DEFAULT '',
  invoiceId TEXT NOT NULL DEFAULT '',
  beforeId  TEXT NOT NULL DEFAULT '',
  afterId   TEXT NOT NULL DEFAULT '',
  actor     TEXT NOT NULL DEFAULT '',
  day       TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  UNIQUE (invoiceId),
  UNIQUE (beforeId),
  UNIQUE (afterId)
);

CREATE INDEX IF NOT EXISTS idx_crm_dispatch_proof_so ON CrmDispatchProof(soId);
CREATE INDEX IF NOT EXISTS idx_crm_dispatch_proof_so_number ON CrmDispatchProof(soNumber);
