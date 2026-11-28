-- 0183_integrations_and_ingestion.sql — ONE outbound gateway + ONE inbound staging table.
--
-- hlp_integration_instance: a provider ACCOUNT (zoho org, waba number, portal seller)
--   addressed by (provider, instanceKey). Secrets are AES-GCM ciphertext only;
--   nothing decryptable is ever stored here.
-- hlp_ingested_data: every inbound payload arrives HERE first (webhook or poller),
--   is normalized by a pure mapper, then routed to its domain store. `realtime`
--   rows are processed in waitUntil on the request; `batch` rows wait for a runner.
--
-- Raw-SQL tables: modules/integrations/gateway/store.ts + modules/ingestion/store.ts
-- own them (Prisma models exist for d1-parity/documentation, the stores use SQL).

CREATE TABLE IF NOT EXISTS "hlp_integration_instance" (
  "id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "instanceKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "isDefault" INTEGER NOT NULL DEFAULT 0,
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "deliveryMode" TEXT NOT NULL DEFAULT 'batch',
  "baseUrl" TEXT NOT NULL DEFAULT '',
  "encryptedSecrets" TEXT NOT NULL DEFAULT '',
  "configJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "hlp_integration_instance_key"
  ON "hlp_integration_instance"("provider", "instanceKey");
CREATE INDEX IF NOT EXISTS "hlp_integration_instance_default"
  ON "hlp_integration_instance"("provider", "isDefault", "enabled");

CREATE TABLE IF NOT EXISTS "hlp_ingested_data" (
  "id" TEXT PRIMARY KEY,
  "source" TEXT NOT NULL,
  "instanceKey" TEXT NOT NULL DEFAULT 'default',
  "eventType" TEXT NOT NULL DEFAULT '',
  "externalEventId" TEXT,
  "deliveryMode" TEXT NOT NULL DEFAULT 'batch',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "rawPayload" TEXT NOT NULL,
  "headersJson" TEXT NOT NULL DEFAULT '{}',
  "normalizedJson" TEXT NOT NULL DEFAULT '',
  "coreRefId" TEXT NOT NULL DEFAULT '',
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "errorLog" TEXT NOT NULL DEFAULT '',
  "receivedAt" TEXT NOT NULL,
  "processedAt" TEXT
);
-- Provider retries are no-ops: same (source, external id) is the same event.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_hlp_ingested_dedup"
  ON "hlp_ingested_data"("source", "externalEventId") WHERE "externalEventId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_hlp_ingested_queue"
  ON "hlp_ingested_data"("status", "deliveryMode", "receivedAt");
CREATE INDEX IF NOT EXISTS "idx_hlp_ingested_source_status"
  ON "hlp_ingested_data"("source", "status", "receivedAt");
