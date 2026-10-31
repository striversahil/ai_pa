// service.ts — read/write lifecycles for the Reporting Sheet.
//
// Reads serve one KV-cached payload per period (all departments); the route
// filters it to the viewer's departments so a head's response contains only
// their own data. Writes are narrow (one section save), always audited, and
// invalidate the period cache. Heads may save the current + previous ISO week;
// root/MIS may save any week.
import { cached, cacheDel } from '../../shared/cache';
import type { MeResponse } from '../auth/types';
import {
  DEPARTMENTS, SECTION_DEFS, sectionDef,
  type ReportDepartment, ReportOrigin, ReportSection,
  type ReportDepartmentView, type ReportEntryView, type ReportPeriodItem,
  type ReportingPayload,
} from './types';
import { canEditDepartment, isReportingManager, viewableDepartments } from './access';
import {
  currentWeekKey, previousWeekKey, recentWeeks, weekLabel, weekRange,
} from './period';
import {
  cleanRegionOrders, cleanTelecallerRows, insertReportAudit, listFilledPeriods,
  listPeriodEntries, upsertEntry,
} from './store';

export class ReportingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const cacheKey = (period: string) => `reporting:week:${period}`;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function invalidateReportingCache(period: string): Promise<void> {
  await cacheDel(cacheKey(period));
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

interface FullEntry {
  dept: string;
  section: string;
  payload: Record<string, unknown>;
  telecallerRows: ReturnType<typeof cleanTelecallerRows>;
  regionOrders: ReturnType<typeof cleanRegionOrders>;
  origin: string;
  submittedByName: string;
  submittedAt: string;
}

async function loadFullPeriod(period: string): Promise<FullEntry[]> {
  const rows = await listPeriodEntries(period);
  return rows.map((r) => ({
    dept: r.department,
    section: r.section,
    payload: parsePayload(r.payloadJson),
    telecallerRows: cleanTelecallerRows(r.telecallerRowsJson),
    regionOrders: cleanRegionOrders(r.regionOrdersJson),
    origin: r.origin,
    submittedByName: r.submittedByName,
    submittedAt: r.updatedAt,
  }));
}

/** Full (unfiltered) period payload — cached; the route narrows by viewer. */
async function computePeriod(period: string): Promise<{ entries: FullEntry[]; filled: string[] }> {
  const [entries, filled] = await Promise.all([loadFullPeriod(period), listFilledPeriods()]);
  return { entries, filled };
}

function periodsList(now = new Date()): ReportPeriodItem[] {
  const cur = currentWeekKey(now);
  return recentWeeks(12, now).map((key) => {
    const { from, to } = weekRange(key);
    return { key, label: weekLabel(key), from, to, current: key === cur };
  });
}

export async function getReportingPayload(me: MeResponse | null, period: string): Promise<ReportingPayload> {
  const key = /^(\d{4})-W(\d{2})$/.test(period) ? period : currentWeekKey();
  const { entries, filled } = await cached(`reporting:week:${key}`, CACHE_TTL_MS, () => computePeriod(key));
  const viewable = viewableDepartments(me);
  const now = new Date();
  const editablePeriod = key === currentWeekKey(now) || key === previousWeekKey(now);
  const isManager = isReportingManager(me);
  void filled;

  const departments: ReportDepartmentView[] = DEPARTMENTS.filter((d) => viewable.includes(d.dept)).map((d) => {
    const defs = SECTION_DEFS[d.dept] ?? [];
    const sections = defs.map((def) => {
      const hit = entries.find((e) => e.dept === d.dept && e.section === def.section);
      return {
        section: def.section,
        title: def.title,
        blurb: def.blurb,
        autofill: def.autofill,
        entry: hit
          ? {
              payload: hit.payload,
              telecallerRows: hit.telecallerRows,
              regionOrders: hit.regionOrders,
              origin: (['manual', 'autofill', 'adjusted'] as ReportOrigin[]).includes(hit.origin as ReportOrigin)
                ? (hit.origin as ReportOrigin)
                : ('manual' as ReportOrigin),
              submittedByName: hit.submittedByName,
              submittedAt: hit.submittedAt,
            }
          : null,
      };
    });
    return {
      dept: d.dept,
      title: d.title,
      canEdit: canEditDepartment(me, d.dept) && (editablePeriod || isManager),
      sections,
      submittedCount: sections.filter((s) => s.entry).length,
      sectionCount: sections.length,
    };
  });

  return {
    period: key,
    periods: periodsList(now),
    editable: editablePeriod || isManager,
    departments,
  };
}

/** Periods with at least one entry (for the picker's data dots). */
export async function getFilledPeriods(): Promise<string[]> {
  return listFilledPeriods();
}

const MAX_TEXT = 2000;

function sanitizePayload(
  dept: ReportDepartment, section: ReportSection, raw: unknown,
): Record<string, unknown> {
  const def = sectionDef(dept, section);
  if (!def) throw new ReportingError('unknown section', 400);
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    const v = src[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'number' || f.type === 'money') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new ReportingError(`"${f.label}" must be a number ≥ 0`, 400);
      out[f.key] = f.type === 'money' ? Math.round(n * 100) / 100 : Math.floor(n);
    } else {
      out[f.key] = String(v).slice(0, MAX_TEXT);
    }
  }
  return out;
}

export interface Actor {
  id: string;
  name: string;
}

const VALID_ORIGINS: ReportOrigin[] = ['manual', 'autofill', 'adjusted'];

export async function saveReportSection(args: {
  me: MeResponse | null;
  actor: Actor;
  period: string;
  dept: ReportDepartment;
  section: ReportSection;
  payload: unknown;
  telecallerRows: unknown;
  regionOrders: unknown;
  origin: unknown;
}): Promise<ReportEntryView> {
  const { me, actor, period, dept, section } = args;
  if (!DEPARTMENTS.some((d) => d.dept === dept)) throw new ReportingError('unknown department', 400);
  const def = sectionDef(dept, section);
  if (!def) throw new ReportingError('unknown section', 400);
  if (!/^(\d{4})-W(\d{2})$/.test(period)) throw new ReportingError('bad period (expected YYYY-WNN)', 400);
  if (!canEditDepartment(me, dept)) {
    throw new ReportingError('only this department head (or root / MIS) can enter this data', 403);
  }
  const now = new Date();
  const inWindow = period === currentWeekKey(now) || period === previousWeekKey(now);
  if (!inWindow && !isReportingManager(me)) {
    throw new ReportingError('this week is locked — only root / MIS can edit it now', 403);
  }

  const clean = sanitizePayload(dept, section, args.payload);
  const rows = def.rows === 'telecaller' && Array.isArray(args.telecallerRows)
    ? cleanTelecallerRows(JSON.stringify(args.telecallerRows))
    : [];
  const orders = def.rows === 'telecaller' && Array.isArray(args.regionOrders)
    ? cleanRegionOrders(JSON.stringify(args.regionOrders))
    : [];
  const origin: ReportOrigin = VALID_ORIGINS.includes(args.origin as ReportOrigin)
    ? (args.origin as ReportOrigin)
    : 'manual';

  await upsertEntry({
    period, department: dept, section, payloadJson: JSON.stringify(clean),
    telecallerRows: rows, regionOrders: orders, origin,
    actorId: actor.id, actorName: actor.name,
  });
  await insertReportAudit({
    actorId: actor.id, actorName: actor.name, action: 'section-save',
    entityId: `${period}/${dept}/${section}`,
    detail: { origin, fields: Object.keys(clean), rows: rows.length, orders: orders.length },
  });
  await invalidateReportingCache(period);

  return {
    payload: clean,
    telecallerRows: rows,
    regionOrders: orders,
    origin,
    submittedByName: actor.name,
    submittedAt: new Date().toISOString(),
  };
}
