// workspace-catalog.test.mjs — the workspace catalog is the single source for
// dashboards + slug aliases (modules/workspaces/catalog.ts).
//
// 1. The derived DASHBOARD_SLUGS equals the hand-written set it replaced
//    (frozen below) — a refactor must not add/drop a "View Dashboard" button.
// 2. Public data paths are exactly the two founder-approved ones.
// 3. When the frontend mirror exists, its alias table equals the backend's.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const cat = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'workspaces', 'catalog.ts')));

// Verbatim copy of modules/automation/dashboardSlugs.ts before 2026-11-12,
// minus zoho-sent-analyzer (retired as a standalone dashboard 2026-11-14 —
// now the Analyzer tab inside Sales; see catalog.ts navAliases).
const LEGACY_DASHBOARD_SLUGS = [
  'dpp-prices-dashboard', 'wa-engine-monitor', 'whatsapp-marketing',
  'neodove-telecaller-report', 'sales', 'accounts', 'digital-marketing', 'human-resources',
  'debtors-tracker', 'payment-tracker', 'whatsapp-autopilot', 'enquiry-procurement',
  'enquiry-management', 'reporting-sheet', 'crm', 'product-line', 'stock',
  'samarth-overview', 'sahil-overview', 'linkedin', 'ai-usage', 'telecalling-agent-analysis',
];

describe('workspace catalog', () => {
  it('derives exactly the legacy DASHBOARD_SLUGS set', () => {
    assert.deepEqual([...cat.dashboardSlugSet()].sort(), [...LEGACY_DASHBOARD_SLUGS].sort());
  });

  it('only the two founder-approved workspaces are public', () => {
    assert.deepEqual(cat.publicDataPaths('/api/automations').sort(), [
      '/api/automations/neodove-telecaller-report/data',
      '/api/automations/telecalling/data',
    ]);
  });

  it('resolves legacy aliases', () => {
    assert.equal(cat.canonicalSlug('payment-tracker'), 'debtors-tracker');
    assert.equal(cat.canonicalSlug('telecalling'), 'telecalling'); // data stays on its provider
    assert.equal(cat.canonicalNavSlug('telecalling'), 'sales');
    assert.equal(cat.canonicalNavSlug('enquiry-tracker'), 'sales');
    assert.equal(cat.canonicalNavSlug('master-data'), 'sales');
    assert.equal(cat.canonicalNavSlug('zoho-sent-analyzer'), 'sales');
    assert.equal(cat.canonicalNavSlug('payment-tracker'), 'debtors-tracker');
    assert.equal(cat.canonicalNavSlug('stock'), 'stock');
  });

  it('every alias points at a real, non-headless workspace', () => {
    for (const [alias, { to }] of Object.entries(cat.aliasTable())) {
      assert.ok(cat.hasOwnDashboard(to), `${alias} → ${to} is not a dashboard workspace`);
    }
  });

  const feAliases = join(FRONTEND_SRC, 'workspaces', 'aliases.ts');
  it('frontend alias mirror matches the backend catalog', { skip: !existsSync(feAliases) }, async () => {
    const fe = await import(bundleToFile(feAliases, { alias: { '@': FRONTEND_SRC } }));
    assert.deepEqual(fe.ALIASES, cat.aliasTable());
  });
});
