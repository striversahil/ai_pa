// zoho-auth.js — Zoho Books credential parsing (ONE copy).
//
// Moved verbatim from scripts/zoho-sync/fetch.js (the superset parser: it
// handles single- AND double-quoted curl exports, plus the legacy single-org
// fallback). scripts/crm-runner.js carried an older single-quote-only copy —
// it now uses this. Behavior on the real export file is identical: the extra
// branches only trigger on inputs the old copy rejected outright.
//
// Auth contract (founder decision 2026-09-23): ONE curl-export file carries the
// shared login (cookies/headers) plus EVERY organization_id; the FIRST org is
// primary (BUI). See zoho-orgs.js for the identity rules.

'use strict';

const fs = require('fs');
const path = require('path');
const { parseOrgIds } = require('./zoho-orgs');

function parseCurlFile() {
  // __dirname = founder-os_backend/src/shared/sync-core → up three to the
  // backend root, then down into zoho_sent. Robust to the caller's cwd.
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'zoho_sent', 'sent_estimates.txt'),
    path.join(process.cwd(), 'founder-os_backend', 'zoho_sent', 'sent_estimates.txt'),
    '/app/zoho_sent/sent_estimates.txt',
  ];
  const curlFile = candidates.find((p) => fs.existsSync(p));
  if (!curlFile) throw new Error(`Zoho credentials file not found (tried: ${candidates.join(', ')})`);

  const content = fs.readFileSync(curlFile, 'utf-8');
  const urlMatch = content.match(/curl\s+'([^']+)'/) || content.match(/curl\s+"([^"]+)"/) || content.match(/curl\s+([^\s\\]+)/);
  if (!urlMatch) throw new Error('Could not extract URL from sent_estimates.txt');
  const url = urlMatch[1];

  const headers = {};
  const headerMatches = content.matchAll(/-H\s+'([^:]+):\s*(.*?)'(?=\s|\\|$)/g);
  for (const m of headerMatches) headers[m[1].trim()] = m[2].trim().replace(/\\$/, '').trim();
  if (Object.keys(headers).length === 0) {
    const double = content.matchAll(/-H\s+"([^:]+):\s*(.*?)"(?=\s|\\|$)/g);
    for (const m of double) headers[m[1].trim()] = m[2].trim().replace(/\\$/, '').trim();
  }

  let orgIds = parseOrgIds(content);
  // Fallback: single org from the list URL (legacy exports).
  if (!orgIds.length) {
    const orgMatch = url.match(/organization_id=([0-9]+)/);
    if (orgMatch) orgIds = [orgMatch[1]];
  }
  const orgId = orgIds[0] || '';

  if (headers['Accept-Encoding']) headers['Accept-Encoding'] = 'gzip, deflate';
  if (orgIds.length > 1) console.log(`zoho-sync/fetch: multi-org mode — ${orgIds.join(', ')} (primary ${orgId})`);
  return { url, headers, orgId, orgIds };
}

let cached = null;
function zohoContext() {
  if (!cached) cached = parseCurlFile();
  return cached;
}

module.exports = { parseCurlFile, zohoContext };
