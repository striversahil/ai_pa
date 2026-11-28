// credentials.js — where the Zoho sync gets its session.
//
// PRIMARY: GET /api/runner/integrations/resolve?provider=zoho reads the
// hlp_integration_instance row (mig 0183) and returns a FRESH access token,
// so rotating a client id/refresh token is a Settings edit, not a file edit.
// FALLBACK: the saved curl export (sync-core/zoho-auth) — kept as the
// emergency path for a DB that has no Zoho instance yet.

const { workerRequest } = require('../runner-lib');

function asList(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

/**
 * @returns {Promise<null | { source: string, orgId: string, orgIds: string[],
 *   headers: Record<string,string>, apiBase: string, url: string }>}
 *   null = no DB instance / worker unreachable → caller falls back.
 */
async function resolveZohoRuntime() {
  if (!process.env.WORKER_URL || !process.env.SHARED_SECRET) return null;
  const data = await workerRequest('/api/runner/integrations/resolve?provider=zoho', { timeoutMs: 15000 });
  if (!data?.accessToken) return null;
  const cfg = data.config || {};
  const apiDomain = String(cfg.apiDomain || 'https://www.zohoapis.in').replace(/\/+$/, '');
  const orgIds = asList(cfg.organizations);
  if (!orgIds.length && cfg.organizationId) orgIds.push(String(cfg.organizationId));
  if (!orgIds.length && data.organizationId) orgIds.push(String(data.organizationId));
  if (!orgIds.length) return null;
  return {
    source: 'worker',
    orgId: orgIds[0],
    orgIds,
    headers: { Authorization: `Zoho-oauthtoken ${data.accessToken}` },
    apiBase: `${apiDomain}/books/v3`,
    url: `${apiDomain}/books/v3/estimates?organization_id=${orgIds[0]}&per_page=200&page=1`,
  };
}

module.exports = { resolveZohoRuntime };
