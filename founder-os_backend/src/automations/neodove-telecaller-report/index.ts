/**
 * NeoDove Telecaller Report (live).
 *
 * Raw per-user-day rows are pushed into D1 (Settings key
 * `neodove_user_report:<YYYY-MM-DD>`) by the native in-worker refresh
 * (src/automations/neodove-refresh.ts — every 5 minutes for TODAY; the GH
 * Actions runner scripts/neodove-report-runner.js is kept as fallback) and
 * once daily for YESTERDAY's final snapshot.
 *
 * This automation is the read side only:
 *   - handler(): no-op (nothing to execute server-side)
 *   - data():    GET /api/automations/neodove-telecaller-report/data
 *                ?date=YYYY-MM-DD | ?from=YYYY-MM-DD&to=YYYY-MM-DD
 *                (default: latest stored day)
 *                → per-agent aggregates summed across every stored day in the
 *                  range + individual KRA/KPI vs per-day benchmarks.
 *
 * Individual KRA/KPI (benchmarks judged on today's live numbers):
 *   - ≥ 120 connected calls / agent / day
 *   - ≥ 10 leads generated / agent / day (true "leads generated" count from
 *     the get-leads API, see neodove-refresh / neodove-report-runner; older
 *     snapshots fall back to leadsInProgress + leadsConverted). NOTE: this is
 *     the STANDALONE NeoDove dashboard's numerator — the Telecalling boards
 *     source leadsGenerated from Enquiry rows (getEnquiryLeadCounts), so the
 *     two dashboards can legitimately differ.
 *   - Zoho sent-estimates pipeline attributed per agent via an optional
 *     name mapping (Setting key `kra:zoho_name_map`, JSON:
 *     { "Zoho Commenter": "NeoDove UserName", ... }).
 */


// Pieces split into ./index-parts/ (importable on their own); re-exported for compat.
export { CONNECTED_CALLS_PER_DAY, LEADS_PER_AGENT_PER_DAY, computeAgentKra, handler } from "./index-parts/pure";
export type { NeodoveAgentRow, AgentKra } from "./index-parts/types";
export { invalidateNeodoveCache, getNeodoveAgentMap, getAllNeodoveAgents, getNeodoveRangeMap, getLatestNeodoveDay, data } from "./index-parts/io";


