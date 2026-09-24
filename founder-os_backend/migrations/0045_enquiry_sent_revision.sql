-- 0045: sent-revision marker — management can reopen a `sent` enquiry for
-- additional scope (revise flow). While set, the Zoho non-draft status does
-- NOT auto-promote/conclude the row, so new items loop through procurement
-- → management → sent again. Cleared on the next mark-as-sent.
ALTER TABLE Enquiry ADD COLUMN sentRevisionAt TEXT NOT NULL DEFAULT '';
