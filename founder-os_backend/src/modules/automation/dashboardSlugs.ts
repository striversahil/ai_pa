/**
 * Slugs that have a dashboard renderer in the frontend (Automations.tsx
 * `renderDashboard`). This list is the single source of truth for the
 * "View Dashboard" button and is intentionally STATIC — it must NOT depend on
 * engine boot state, otherwise the button flickers on cold-start isolates
 * where `AutomationEngine.all()` has not registered modules yet.
 *
 * Keep in sync with the explicit mappings in
 * founder-os_frontend/src/components/Automations.tsx `renderDashboard`.
 */
export const DASHBOARD_SLUGS = new Set<string>([
  // explicitly-rendered dashboards
  'enterprise-operations-analytics',
  'zoho-sent-analyzer',
  'dpp-prices-dashboard',
  'wa-engine-monitor',
  'whatsapp-marketing',
  'neodove-telecaller-report',
  'telecalling',
  'whatsapp-autopilot',
  // generic sheet-analysis renderer (SheetAnalysisDashboard fallback)
  'telecalling-agent-analysis',
]);
