/**
 * Slugs that have a dashboard renderer in the frontend (Automations.tsx
 * `renderDashboard`). This list is AUTO-GENERATED at build time from the
 * automation directories (any automation whose index.ts exports a `data`
 * provider) — see scripts/gen-automation-registry.mjs. It is intentionally
 * STATIC (a generated Set, not boot-state-dependent) so the "View Dashboard"
 * button never flickers on cold-start isolates where the AutomationEngine has
 * not registered modules yet.
 *
 * Adding a new automation directory with a `data` provider automatically
 * grants it a dashboard on the next build — no manual edits here.
 */
import { AUTOMATION_DASHBOARDS } from './registry.generated';

export const DASHBOARD_SLUGS = new Set<string>(AUTOMATION_DASHBOARDS);