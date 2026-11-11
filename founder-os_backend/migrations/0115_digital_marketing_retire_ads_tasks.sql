-- Retire Meta/WhatsApp/Email recurring tasks (moved to manual ADS registry, migration 0113).
UPDATE "DigitalMarketingTaskTemplate" SET "active" = 0 WHERE "id" IN ('dmm-06', 'dmm-08', 'dmm-09');
-- Auto-complete any ad runs whose end date already passed.
UPDATE "DigitalMarketingAd" SET "status" = 'completed', "updatedAt" = datetime('now')
WHERE substr("endDate", 1, 10) < date('now', 'localtime') AND "status" != 'completed';
