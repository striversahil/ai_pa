-- Add sales agent attribution to estimate classifications.
-- Populated by zoho-sent-runner via LLM matching against the NeoDove agent roster.
ALTER TABLE Classification ADD COLUMN salesAgent TEXT NOT NULL DEFAULT 'Unassigned';
