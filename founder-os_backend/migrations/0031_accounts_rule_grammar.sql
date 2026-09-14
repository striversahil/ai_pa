-- Accounts automation: rich schedule grammar columns (see
-- founder-os_backend/data/accounts_follow_up.json legend). ruleType/ruleJson
-- drive the engine; legacy dueDay/dueMonth still serve simple MIS tasks.
ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "ruleType" TEXT;
ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "ruleJson" TEXT;
ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "rawText" TEXT;
