// reporting-sheet — Weekly management review automation.
//
// No schedule: the payload is a KV-cached read of the ReportEntry table and
// the dashboard refreshes on the typed `reporting` live event after every
// save. The automation exists so the sheet is a first-class dashboard
// (sidebar, Automations registry, "View data").
// Reads are viewer-filtered: the worker automations-route guard attaches the
// session's MeResponse as query.reportingMe, and data() scopes the payload to
// the departments that viewer may open.
import type { AutomationContext } from '../../modules/automation/types';
import { getReportingPayload } from '../../modules/reporting/service';
import { currentWeekKey } from '../../modules/reporting/period';

export async function handler(_ctx: AutomationContext): Promise<void> {
  // Warm the current week for the fastest first paint.
  await getReportingPayload(null, currentWeekKey());
}

/** Dashboard data provider — GET /api/automations/reporting-sheet/data */
export async function data(ctx?: AutomationContext): Promise<unknown> {
  const subject = (ctx?.subject ?? {}) as Record<string, any>;
  const me = (subject.reportingMe ?? null) as any;
  const period = typeof subject.period === 'string' && subject.period ? subject.period : currentWeekKey();
  return getReportingPayload(me, period);
}
