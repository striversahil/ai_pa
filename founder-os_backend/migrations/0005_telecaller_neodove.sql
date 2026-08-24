-- 0005: link Telecaller roster entries to their NeoDove agent identity
-- so Lead Generation (calls connected / leads generated) can be merged with
-- Lead Conversion (estimate assignments) in the unified telecalling dashboard.
ALTER TABLE "Telecaller" ADD COLUMN "neodoveUserId" TEXT;
ALTER TABLE "Telecaller" ADD COLUMN "neodoveUserName" TEXT;
