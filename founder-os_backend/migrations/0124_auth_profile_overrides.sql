-- Users portal identity overrides (2026-11-11): per-login display name +
-- position override. Both nullable; null = Google name / auto-resolved
-- position. Display/grouping only — access still flows via roles.
ALTER TABLE auth_user ADD COLUMN displayName TEXT;
ALTER TABLE auth_user ADD COLUMN positionOverride TEXT;
