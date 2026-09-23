// orgs.js — multi-organization helpers for the Zoho Books sync.
//
// Credential contract (chosen by founder 2026-09-23): ONE curl-export file
// (zoho_sent/sent_estimates.txt) carries the shared login (cookies/headers)
// plus EVERY organization_id. All unique organization_id=<digits> occurrences
// in the file (list URL, Referer app/<org>, BuildCookie_<org>, ...) in file
// order form the org list; the FIRST is the primary org (BUI — all existing
// rows stay bare). When cookies are refreshed, paste the new export preserving
// the org order (BUI first) — the same headers are reused for every org.
//
// Identity rule: Zoho estimate/comment ids are only unique per org, so
// non-primary rows are namespaced at the Zoho boundary:
//   dbEstimateId = '<orgId>:<zohoEstimateId>'   (primary rows stay bare)
//   dbCommentId  = '<orgId>:<zohoCommentId>'
// Everything downstream (diff, persist, worker routes, telecalling engine,
// ledger, dashboards) keys on these DB ids and works unchanged; the
// `organizationId` column on Estimate carries the org for filtering/badges.

'use strict';

// All unique organization_id=<digits> in file order (URL, Referer, cookies).
function parseOrgIds(content) {
  const ids = [];
  const seen = new Set();
  for (const m of String(content || '').matchAll(/organization_id=([0-9]+)/g)) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  // Referer app/<org> + BuildCookie_<org> may name an org the URL doesn't —
  // accept those as well so a hand-noted org is never silently dropped.
  for (const m of String(content || '').matchAll(/(?:app\/|BuildCookie_|zalb_zid=)([0-9]{6,})/g)) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  return ids;
}

// DB identity for a Zoho estimate id from the given org.
function dbEstimateId(orgId, zohoId, primaryOrg) {
  const id = String(zohoId ?? '');
  if (!orgId || orgId === primaryOrg) return id;
  return `${orgId}:${id}`;
}

// DB identity for a Zoho comment id from the given org.
function dbCommentId(orgId, zohoCommentId, primaryOrg) {
  const id = String(zohoCommentId ?? '');
  if (!orgId || orgId === primaryOrg) return id;
  return `${orgId}:${id}`;
}

// Split a DB estimate id back into { orgId, zohoId }.
// bareIdOrg = org to assume for bare (primary) ids.
function splitDbEstimateId(dbId, bareIdOrg) {
  const s = String(dbId ?? '');
  const m = s.match(/^([0-9]+):(.+)$/);
  if (m) return { orgId: m[1], zohoId: m[2] };
  return { orgId: bareIdOrg || '', zohoId: s };
}

// Normalize one raw Zoho estimate row at the fetch boundary: tag _orgId +
// _zohoId, rewrite estimate_id to the DB identity for non-primary orgs.
function normalizeEstimateRow(est, orgId, primaryOrg) {
  if (!est || typeof est !== 'object') return est;
  est._orgId = orgId;
  est._zohoId = est.estimate_id;
  est.estimate_id = dbEstimateId(orgId, est.estimate_id, primaryOrg);
  return est;
}

// Normalize raw Zoho comment rows (prefix comment_id for non-primary orgs).
function normalizeCommentRows(comments, orgId, primaryOrg) {
  if (!Array.isArray(comments)) return comments;
  if (!orgId || orgId === primaryOrg) return comments;
  for (const c of comments) {
    if (c && typeof c === 'object' && c.comment_id != null) {
      c.comment_id = dbCommentId(orgId, c.comment_id, primaryOrg);
    }
  }
  return comments;
}

// Swap the organization_id in a saved list URL for a per-org fetch.
function urlForOrg(savedUrl, orgId) {
  const u = new URL(savedUrl);
  u.searchParams.set('organization_id', orgId);
  return u.toString();
}

module.exports = {
  parseOrgIds,
  dbEstimateId,
  dbCommentId,
  splitDbEstimateId,
  normalizeEstimateRow,
  normalizeCommentRows,
  urlForOrg,
};
