-- 0162 — Management→Sales questions are private to those two desks.
--
-- Founder rule 2026-11-23: Procurement joins a sales conversation ONLY when
-- SALES raises a product query. A question Management asks Sales (e.g.
-- "does the client require rubber or rexene bag?") is Management ↔ Sales and
-- must never appear in the procurement inbox.
--
-- Before this fix the category picker was offered to the management desk too,
-- so such questions were stored with category='product_query' and reached
-- procurement. `canSee` and the SQL visibility now additionally require
-- `openedBy = 'sales'` for procurement, so these rows disappear from that desk
-- either way; this backfill makes the stored shape honest — NULL keeps the
-- pre-category behaviour (sales ↔ management only), and no message is touched.
UPDATE EnquiryThread
   SET category = NULL
 WHERE channel = 'sales'
   AND openedBy <> 'sales'
   AND category IS NOT NULL;
