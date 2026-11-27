-- 0180_integration_hub.sql — ONE ingestion pipeline for every external service.
--
-- A connector is a TYPE (built-in in code, or user-authored here), a source is
-- a live CONNECTION (one form, one portal account, one page). Events are the
-- normalized activity rows every screen reads; deliveries are the raw audit
-- trail (replay re-normalizes them after a mapping change).
--
-- Raw-SQL tables: modules/integrations/store.ts owns them, so there is no
-- Prisma model and no d1-prisma shim registration (see the guard allowlist).

CREATE TABLE IF NOT EXISTS "IntegrationConnector" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT NOT NULL DEFAULT '🔌',
  "color" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL DEFAULT 'custom',
  "authKind" TEXT NOT NULL DEFAULT 'webhook',
  "mapping" TEXT NOT NULL DEFAULT '{}',
  "sample" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdByName" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationConnector_key" ON "IntegrationConnector"("key");

CREATE TABLE IF NOT EXISTS "IntegrationSource" (
  "id" TEXT PRIMARY KEY,
  "connectorKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "tokenHash" TEXT NOT NULL DEFAULT '',
  "config" TEXT NOT NULL DEFAULT '{}',
  "mapping" TEXT NOT NULL DEFAULT '',
  "eventCount" INTEGER NOT NULL DEFAULT 0,
  "lastEventAt" TEXT NOT NULL DEFAULT '',
  "lastError" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdByName" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "IntegrationSource_connector" ON "IntegrationSource"("connectorKey", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "IntegrationEvent" (
  "id" TEXT PRIMARY KEY,
  "sourceId" TEXT NOT NULL,
  "connectorKey" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'raw',
  "occurredAt" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "summary" TEXT NOT NULL DEFAULT '',
  "company" TEXT NOT NULL DEFAULT '',
  "contactName" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "city" TEXT NOT NULL DEFAULT '',
  "amount" REAL,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "raw" TEXT NOT NULL DEFAULT '',
  "linkedType" TEXT NOT NULL DEFAULT '',
  "linkedId" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'accepted',
  "error" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationEvent_dedupe" ON "IntegrationEvent"("sourceId", "externalId");
CREATE INDEX IF NOT EXISTS "IntegrationEvent_feed" ON "IntegrationEvent"("occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "IntegrationEvent_kind" ON "IntegrationEvent"("kind", "occurredAt" DESC);

CREATE TABLE IF NOT EXISTS "IntegrationDelivery" (
  "id" TEXT PRIMARY KEY,
  "sourceId" TEXT NOT NULL,
  "receivedAt" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "httpStatus" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT NOT NULL DEFAULT '',
  "bodyPreview" TEXT NOT NULL DEFAULT '',
  "bytes" INTEGER NOT NULL DEFAULT 0,
  "eventId" TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "IntegrationDelivery_source" ON "IntegrationDelivery"("sourceId", "receivedAt" DESC);
