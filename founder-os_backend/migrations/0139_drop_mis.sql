-- 0139_drop_mis.sql — Retire the MIS role/scope (founder decision 2026-11-12).
--
-- The MIS name is deleted from the system without a doubt. Every MIS-gated
-- endpoint becomes root-only in code (requireAdminScope); no department scope
-- inherits MIS powers. The one MIS login (mis.themilling@gmail.com) keeps
-- exactly `zoho` + `user-admin` as DIRECT user grants — everything else it
-- held came from the deleted role.
--
-- Row order respects FKs (auth_role_scope/auth_user_role reference both
-- sides; both role and scope rows go last). The `samarth` role also held the
-- `mis` scope — that grant dies here too.
INSERT OR IGNORE INTO auth_user_scope (userId, scopeKey)
  SELECT id, 'zoho' FROM auth_user WHERE email = 'mis.themilling@gmail.com';
INSERT OR IGNORE INTO auth_user_scope (userId, scopeKey)
  SELECT id, 'user-admin' FROM auth_user WHERE email = 'mis.themilling@gmail.com';
DELETE FROM auth_role_scope WHERE scopeKey = 'mis';
DELETE FROM auth_user_role WHERE roleKey = 'mis';
DELETE FROM auth_role WHERE key = 'mis';
DELETE FROM auth_scope WHERE key = 'mis';
