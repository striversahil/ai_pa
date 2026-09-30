// contract.js — the identities both Zoho sync pipelines share.
//
// Every endpoint path, KV key, Setting key, and status set in this file is
// referenced by name from the GH runners (scripts/zoho-sent-runner.js,
// scripts/crm-runner.js, scripts/zoho-sync/*) AND the Worker routes that serve
// them (src/worker/routes/runner.ts, src/worker/routes/estimates.ts).
// Change a string here and both sides move together — that is the whole point.
// Worker TS adoption is Phase 3; until then this file is runner-side truth and
// the Worker routes are documented to mirror it (NOT the reverse).

'use strict';

const API = Object.freeze({
  estimatesBulkUpsert: '/api/estimates/bulk-upsert',
  zohoState: '/api/runner/zoho/state',
  zohoFingerprint: '/api/runner/zoho/fingerprint',
  zohoStatus: '/api/runner/zoho/status',
  zohoComments: '/api/runner/zoho/comments',
  zohoClassification: '/api/runner/zoho/classification',
  leadDetails: '/api/runner/estimates/lead-details',
  salesOrdersToday: '/api/runner/zoho/salesorders-today',
  crmSnapshot: '/api/runner/crm/snapshot',
  crmFingerprint: '/api/runner/crm/fingerprint',
  crmHeartbeat: '/api/runner/crm/heartbeat',
  crmItems: '/api/runner/crm/items',
  crmActions: '/api/runner/crm/actions',
  neodoveReportLive: '/api/automations/neodove-telecaller-report/data',
  neodoveReportLatest: '/api/neodove/report',
  linkedinToday: '/api/linkedin/today',
  linkedinPick: '/api/linkedin/pick',
  linkedinPosted: '/api/linkedin/posted',
  linkedinBatch: '/api/runner/linkedin/batch',
});

// KV keys as the Worker routes address them — the cache layer (src/shared/cache.ts)
// transparently prefixes every key with `kvx:`.
const KV = Object.freeze({
  ZOHO_FINGERPRINT: 'zoho:analyzer:state_fingerprint',
});

const SETTINGS = Object.freeze({
  LAST_COMPLETE_SYNC: 'sales_copilot:last_complete_sync_at',
  PRIMARY_ORG: 'zoho:primary_org',
});

// Zoho Books estimate statuses, lowercased before comparison everywhere.
const ZOHO_STATUSES = Object.freeze({
  // Only these ever enter the AI/comment pipeline (diff/selectWorkItems gate).
  PROCESSABLE: Object.freeze(['sent', 'accepted', 'declined', 'confirmed']),
  // Sales-orders-today tile exclusions (fetch/sales-orders + crm/pendingStep).
  SO_EXCLUDED: Object.freeze(['cancelled', 'void']),
});

// CRM pipeline identities (crm-runner stage machine). Tuning (caps, windows,
// budgets) stays with the runner — only the shared vocabulary lives here.
const CRM = Object.freeze({
  STAGES: Object.freeze(['confirm', 'invoice', 'ship', 'payment']),
  TERMINAL: 'complete',
});

module.exports = { API, KV, SETTINGS, ZOHO_STATUSES, CRM };
