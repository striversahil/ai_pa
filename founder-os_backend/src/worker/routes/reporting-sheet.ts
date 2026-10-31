// ─────────────────────────────────────────────────────────────────────────────
// routes/reporting-sheet.ts — Reporting Sheet (weekly management review) API.
//
// Worker-only: Express is frozen (founder decision), so there is no mirror.
// The dashboard payload rides the automation data endpoint
// (`/api/automations/reporting-sheet/data`, viewer-filtered); this module owns
// saves, auto-fill suggestions and capabilities.
//
// Access:
//   read    → `reporting-sheet` (management viewers, read-only all), the
//             department scopes (`sales-head`, `crm`, `digital-marketing` —
//             own department), or root / MIS (everything)
//   enter   → the department's own scope, or root / MIS
//   window  → heads may save the current + previous ISO week only;
//             root / MIS may save any week
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import {
  authStore, getMe, readSessionCookie, notifyLive, LiveEvent, type Bindings,
} from '../context';
import { AuthError } from '../../modules/auth/types';
import {
  saveReportSection, getFilledPeriods, ReportingError, type Actor,
} from '../../modules/reporting/service';
import { buildAutofill } from '../../modules/reporting/autofill';
import {
  REPORTING_SCOPE, canEditDepartment, isReportingManager, viewableDepartments,
} from '../../modules/reporting/access';
import { DEPARTMENTS, type ReportDepartment, type ReportSection } from '../../modules/reporting/types';
import { currentWeekKey } from '../../modules/reporting/period';

async function meFor(c: any) {
  return getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
}

function actorOf(me: any): Actor {
  return { id: String(me?.user?.id ?? ''), name: String(me?.user?.name ?? me?.user?.email ?? '') };
}

function fail(c: any, e: unknown) {
  if (e instanceof ReportingError) return c.json({ error: e.message }, e.status as any);
  if (e instanceof AuthError) return c.json({ error: e.message }, ((e as any).status ?? 403) as any);
  throw e;
}

function validPeriod(raw: unknown): string {
  const p = String(raw ?? '');
  if (!/^(\d{4})-W(\d{2})$/.test(p)) throw new ReportingError('bad period (expected YYYY-WNN)', 400);
  return p;
}

export function registerReportingSheetRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Auto-fill suggestion (edit permission required) ───────────────────────
  app.get('/api/reporting/autofill', async (c) => {
    try {
      const me = await meFor(c);
      if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
      const dept = String(c.req.query('dept') ?? '') as ReportDepartment;
      const section = String(c.req.query('section') ?? '') as ReportSection;
      const period = validPeriod(c.req.query('period') ?? currentWeekKey());
      if (!DEPARTMENTS.some((d) => d.dept === dept)) throw new ReportingError('unknown department', 400);
      if (!canEditDepartment(me, dept)) {
        throw new ReportingError('only this department head (or root / MIS) can enter this data', 403);
      }
      return c.json(await buildAutofill(dept, section, period));
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Save one section ──────────────────────────────────────────────────────
  app.put('/api/reporting/week/:period/:dept/:section', async (c) => {
    try {
      const me = await meFor(c);
      if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
      const period = validPeriod(c.req.param('period'));
      const dept = c.req.param('dept') as ReportDepartment;
      const section = c.req.param('section') as ReportSection;
      const body = await c.req.json().catch(() => ({}));
      const entry = await saveReportSection({
        me, actor: actorOf(me), period, dept, section,
        payload: body?.payload,
        telecallerRows: body?.telecallerRows,
        regionOrders: body?.regionOrders,
        origin: body?.origin,
      });
      notifyLive(c, { type: LiveEvent.Reporting, period, dept, section });
      return c.json({ entry });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Periods with data (picker dots) ───────────────────────────────────────
  app.get('/api/reporting/filled', async (c) => {
    try {
      const me = await meFor(c);
      if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
      if (viewableDepartments(me).length === 0) {
        throw new AuthError('FORBIDDEN', `Requires '${REPORTING_SCOPE}' permission`, 403);
      }
      return c.json({ filled: await getFilledPeriods() });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ── Viewer capabilities (the UI hides what the server would reject) ───────
  app.get('/api/reporting/capabilities', async (c) => {
    try {
      const me = await meFor(c);
      if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
      const viewable = viewableDepartments(me);
      if (viewable.length === 0) {
        throw new AuthError('FORBIDDEN', `Requires '${REPORTING_SCOPE}' permission`, 403);
      }
      const canEdit: Record<string, boolean> = {};
      for (const d of DEPARTMENTS) canEdit[d.dept] = canEditDepartment(me, d.dept);
      return c.json({ departments: viewable, canEdit, isManager: isReportingManager(me) });
    } catch (e) {
      return fail(c, e);
    }
  });
}
