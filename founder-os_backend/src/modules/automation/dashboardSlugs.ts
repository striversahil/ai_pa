import { dashboardSlugSet } from '../workspaces/catalog';

/**
 * Slugs that have a dashboard renderer in the frontend. Static (must NOT depend
 * on engine boot state, or the "View Dashboard" button flickers on cold
 * isolates).
 *
 * Derived from the workspace catalog (modules/workspaces/catalog.ts) — add new
 * dashboards THERE. Kept as a named export for existing importers
 * (worker/context.ts, modules/automation/routes.ts).
 */
export const DASHBOARD_SLUGS: Set<string> = dashboardSlugSet();
