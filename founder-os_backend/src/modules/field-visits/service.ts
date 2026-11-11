// service.ts — Field Staff dashboard data (D1 rows, KV-cached like telecalling).
// Mill "new?" suggestion reuses the Customer Master exact+fuzzy matcher
// (telecalling/client-segments classifyClients); the manual toggle writes
// isNewManual and always wins via effectiveIsNew.

import { cached, cacheDelPrefix } from '../../shared/cache';
import { effectiveIsNew } from './types';
import {
  listExpenses,
  listFieldStaff,
  listFollowups,
  listMills,
  listVisits,
} from './store';

export function invalidateFieldStaffCache(): Promise<void> | void {
  return cacheDelPrefix('field-staff:') as any;
}

function istDay(offset = 0): string {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000 + offset * 86400 * 1000);
  return ist.toISOString().slice(0, 10);
}

export async function suggestMillMatch(millName: string): Promise<{
  isNewSuggested: boolean; matchMasterId: string; matchMasterName: string;
}> {
  const name = String(millName ?? '').trim();
  if (!name) return { isNewSuggested: true, matchMasterId: '', matchMasterName: '' };
  try {
    const { classifyClients } = await import('../telecalling/client-segments');
    const m = await classifyClients([name]);
    const hit: any = m.get(name) ?? [...m.values()][0];
    if (hit?.masterCustomerId) {
      return { isNewSuggested: false, matchMasterId: String(hit.masterCustomerId), matchMasterName: String(hit.masterName ?? name) };
    }
  } catch { /* fail-open: treat as new */ }
  return { isNewSuggested: true, matchMasterId: '', matchMasterName: '' };
}

export async function getFieldStaffData(query: {
  from?: string | null; to?: string | null; staffId?: string | null;
}): Promise<any> {
  const to = String(query.to ?? '').trim() || istDay(0);
  const from = String(query.from ?? '').trim() || istDay(-13);
  const staffId = String(query.staffId ?? '').trim() || null;
  return cached(`field-staff:data:${from}:${to}:${staffId ?? 'all'}`, 30_000, async () => {
    const { getD1Database } = await import('../../shared/prisma-d1');
    const db = getD1Database();
    const [staff, visits] = await Promise.all([
      listFieldStaff(db).catch(() => []),
      listVisits(db, from, to, staffId).catch(() => []),
    ]);
    const nameById = new Map((staff as any[]).map((s: any) => [String(s.id), s]));
    const visitIds = (visits as any[]).map((v: any) => String(v.id));
    const visitDayById = new Map((visits as any[]).map((v: any) => [String(v.id), String(v.day ?? '')]));
    const visitStaffById = new Map((visits as any[]).map((v: any) => [String(v.id), String(v.telecallerId ?? '')]));
    const [mills, visitExpenses, rangeExpenses, visitFollowups, rangeFollowups] = await Promise.all([
      listMills(db, visitIds).catch(() => []),
      listExpenses(db, visitIds).catch(() => []),
      listExpenses(db, [], { from, to, staffId }).catch(() => []),
      listFollowups(db, visitIds.length > 0 ? visitIds : null, null).catch(() => []),
      listFollowups(db, null, null, { from, to, staffId }).catch(() => []),
    ]);
    // Merge visit-bound + day-based rows, deduped by id (backfilled rows carry
    // both a visitId and a day, so they appear in both fetches).
    const expenseById = new Map<string, any>();
    for (const e of [...(rangeExpenses as any[]), ...(visitExpenses as any[])] as any[]) {
      const id = String(e.id);
      if (!expenseById.has(id)) {
        const vDay = visitDayById.get(String(e.visitId)) ?? '';
        const vStaff = visitStaffById.get(String(e.visitId)) ?? '';
        expenseById.set(id, {
          ...e,
          day: String(e.day ?? vDay ?? ''),
          staffId: String(e.staffId ?? vStaff ?? ''),
        });
      }
    }
    const expenses = [...expenseById.values()];
    const followupById = new Map<string, any>();
    for (const f of [...(rangeFollowups as any[]), ...(visitFollowups as any[])] as any[]) {
      const id = String(f.id);
      if (!followupById.has(id)) followupById.set(id, f);
    }
    const followups = [...followupById.values()];
    const millsByVisit = new Map<string, any[]>();
    for (const m of mills as any[]) {
      const k = String(m.visitId);
      const row = {
        ...m,
        isNew: effectiveIsNew(!!m.isNewSuggested, m.isNewManual === null || m.isNewManual === undefined ? null : !!m.isNewManual),
        isNewManual: m.isNewManual === null || m.isNewManual === undefined ? null : !!m.isNewManual,
        isNewSuggested: !!m.isNewSuggested,
        followUpNeeded: !!m.followUpNeeded,
      };
      if (!millsByVisit.has(k)) millsByVisit.set(k, []);
      millsByVisit.get(k)!.push(row);
    }
    const millNameById = new Map((mills as any[]).map((m: any) => [String(m.id), String(m.millName ?? '')]));
    const expByVisit = new Map<string, any[]>();
    const expTotalByVisit = new Map<string, number>();
    for (const e of expenses as any[]) {
      const k = String(e.visitId);
      if (!expByVisit.has(k)) expByVisit.set(k, []);
      expByVisit.get(k)!.push(e);
    }
    for (const v of visits as any[]) {
      const rows = expByVisit.get(String(v.id)) ?? [];
      expTotalByVisit.set(String(v.id), rows.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0));
    }
    const folByVisit = new Map<string, any[]>();
    for (const f of followups as any[]) {
      const k = String(f.visitId);
      const row = { ...f, millName: millNameById.get(String(f.millVisitId)) ?? '' };
      if (!folByVisit.has(k)) folByVisit.set(k, []);
      folByVisit.get(k)!.push(row);
    }
    const enriched = (visits as any[]).map((v: any) => {
      const s: any = nameById.get(String(v.telecallerId));
      return {
        ...v,
        staffName: s?.name ?? '',
        region: s?.region ?? '',
        mills: millsByVisit.get(String(v.id)) ?? [],
        expenses: expByVisit.get(String(v.id)) ?? [],
        expenseTotal: expTotalByVisit.get(String(v.id)) ?? 0,
        followups: folByVisit.get(String(v.id)) ?? [],
      };
    });
    const openFollowups = (followups as any[])
      .filter((f: any) => String(f.status ?? 'open') === 'open')
      .map((f: any) => ({ ...f, millName: millNameById.get(String(f.millVisitId)) ?? '' }));
    // Day-wise expense log for the calendar (global — not confined to a visit).
    const expensesByDay: Record<string, { total: number; rows: any[] }> = {};
    for (const e of expenses as any[]) {
      const d = String(e.day ?? '').slice(0, 10) || String(e.createdAt ?? '').slice(0, 10);
      if (!d) continue;
      if (!expensesByDay[d]) expensesByDay[d] = { total: 0, rows: [] };
      expensesByDay[d].rows.push(e);
      expensesByDay[d].total += Number(e.amount ?? 0);
    }
    for (const d of Object.keys(expensesByDay)) {
      expensesByDay[d].rows.sort((a: any, b: any) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
    }
    return {
      from, to,
      staff: (staff as any[]).map((s: any) => ({ id: String(s.id), name: String(s.name ?? ''), region: String(s.region ?? '') })),
      visits: enriched,
      openFollowups,
      allFollowups: (followups as any[]).map((f: any) => ({ ...f, millName: millNameById.get(String(f.millVisitId)) ?? '' })),
      expenses: expenses as any[],
      expensesByDay,
      totals: {
        visits: enriched.length,
        mills: (mills as any[]).length,
        expenses: (expenses as any[]).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0),
        openFollowups: openFollowups.length,
      },
    };
  });
}
