// ─────────────────────────────────────────────────────────────────────────────
// accounts/thread-io.ts — the I/O half of task threads (migration 0166).
//
// Kept beside service-parts/io.ts (not inside it) because that file is already
// the largest in the domain. Same module shape: pure rules live in
// service-parts/thread.ts, everything that touches D1 lives here.
//
// What this owns:
//  • ensureThreadInstances — one row per due date × slot for a date range, so
//    a month with two repeats (15 & 30) is two entries of ONE task;
//  • materialiseMisses — writes the engine's own "not done" entry for a past
//    due day nobody logged (idempotent; a window's inner days are grace);
//  • runThreadMaintenance — the daily job (also the year backfill);
//  • getThread / getThreadSummaries — read side (thread page + counts).
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from '../../shared/prisma';
import {
  addDays, istDateStr, ISO_DAY, slotsFor, slotKey, SLOT_MAIN, toAttachmentJson,
} from './service-parts/pure';
import {
  bucketOf, dueDatesBetween, emptyCounts, isMissable, missLabel, longDate, completionPct, threadWindow,
  addToCounts, type ThreadCounts,
} from './service-parts/thread';

// NOTE: service-parts/io.ts imports this module for the dashboard payload, so
// its cache/core helpers are imported lazily inside runThreadMaintenance — a
// static import here would form a cycle at module init.

/** Daily maintenance looks this far back (a missed day is caught next run). */
export const MAINTENANCE_LOOKBACK_DAYS = 14;
/** Max entries one thread page returns (a daily task over a year is ~300). */
export const THREAD_PAGE_MAX = 400;
const CHUNK = 100;

/** Active task templates (payment dues live in their own tab, never threads). */
export async function activeTaskTemplates(): Promise<any[]> {
  const rows = (await prisma.accountsTaskTemplate.findMany({
    where: { active: true },
    orderBy: { order: 'asc' },
  }).catch(() => [])) as any[];
  return rows.filter((t) => String((t as any).kind || 'task') !== 'payment');
}

/**
 * Ensure one log row per (due date × slot) in [from, to]. Idempotent: existing
 * keys are read first (bounded by the range), so a repeated run inserts nothing.
 */
export async function ensureThreadInstances(templates: any[], from: string, to: string): Promise<number> {
  if (!templates.length || !ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) return 0;
  const wanted: Array<{ templateId: string; dueDate: string; slot: string; status: string }> = [];
  for (const t of templates) {
    if (!t || t.active === false) continue;
    for (const dueDate of dueDatesBetween(t, from, to)) {
      for (const slot of slotsFor(t)) {
        wanted.push({ templateId: String(t.id), dueDate, slot, status: 'pending' });
      }
    }
  }
  if (!wanted.length) return 0;
  const ids = [...new Set(wanted.map((r) => r.templateId))];
  const existing = await (prisma as any).accountsTaskLog.findMany({
    where: { templateId: { in: ids }, dueDate: { gte: from, lte: to } },
    select: { templateId: true, dueDate: true, slot: true },
  }).catch(() => []);
  const have = new Set<string>((existing as any[]).map((r) =>
    `${r.templateId}|${String(r.dueDate).slice(0, 10)}|${r.slot ?? SLOT_MAIN}`));
  const missing = wanted.filter((r) => !have.has(`${r.templateId}|${r.dueDate}|${r.slot}`));
  let created = 0;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    try {
      const out = await (prisma as any).accountsTaskLog.createManyAndReturn({ data: chunk });
      created += Array.isArray(out) ? out.length : chunk.length;
    } catch {
      // Unique race (a concurrent run / another tab) → idempotent per row.
      for (const row of chunk) {
        try { await prisma.accountsTaskLog.create({ data: row as any }); created += 1; } catch { /* already there */ }
      }
    }
  }
  return created;
}

/**
 * Turn past unresolved rows into the engine's own missed-day entries.
 *
 * Founder rule: a day with no update is recorded as "Task not done on <date>"
 * and stays not done. `entryKind='auto_miss'` is the marker; the sentence is
 * rendered from the date, never stored. Window days keep their grace: only a
 * closed window's final day is a miss (`isMissable`), so a 15–18 range does not
 * produce four reds.
 */
export async function materialiseMisses(templates: any[], from: string, today: string): Promise<number> {
  if (!templates.length || from >= today) return 0;
  const byId = new Map<string, any>(templates.map((t) => [String(t.id), t]));
  const rows = await (prisma as any).accountsTaskLog.findMany({
    where: {
      templateId: { in: [...byId.keys()] },
      dueDate: { gte: from, lt: today },
      status: 'pending',
      entryKind: 'instance',
    },
    select: { id: true, templateId: true, dueDate: true },
  }).catch(() => []);
  const ids = (rows as any[])
    .filter((r) => {
      const t = byId.get(String(r.templateId));
      return !!t && isMissable(t, String(r.dueDate).slice(0, 10));
    })
    .map((r) => String(r.id));
  if (!ids.length) return 0;
  const data = { status: 'not_done', entryKind: 'auto_miss' };
  let marked = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    try {
      const r = await (prisma as any).accountsTaskLog.updateMany({ where: { id: { in: chunk } }, data });
      marked += Number(r?.count ?? chunk.length) || 0;
    } catch {
      for (const id of chunk) {
        try { await (prisma as any).accountsTaskLog.update({ where: { id }, data }); marked += 1; } catch { /* gone */ }
      }
    }
  }
  return marked;
}

/**
 * The daily job: keep the rolling range instantiated and stamp the days nobody
 * logged. `from` widens it to a full-window backfill (route/trigger use that).
 * Deterministic — no LLM, no Zoho, so it is safe to run inside the Worker cron
 * at the daily slot even in quiet hours.
 */
export async function runThreadMaintenance(
  today: string = istDateStr(),
  opts: { from?: string } = {},
): Promise<{ from: string; to: string; templates: number; created: number; missed: number }> {
  const templates = await activeTaskTemplates();
  const from = opts.from && ISO_DAY.test(opts.from) ? opts.from : addDays(today, -MAINTENANCE_LOOKBACK_DAYS);
  const created = await ensureThreadInstances(templates, from, today);
  const missed = await materialiseMisses(templates, from, today);
  if (created || missed) {
    const { invalidateAccountsCache } = await import('./service-parts/io');
    await invalidateAccountsCache().catch(() => null);
  }
  const { syncDueReceiptMirror } = await import('./service-parts/io');
  await syncDueReceiptMirror(today).catch(() => null);
  return { from, to: today, templates: templates.length, created, missed };
}

export interface ThreadEntryJson {
  logId: string;
  dueDate: string;
  bucket: string;
  status: string;
  entryKind: string;
  /** "Task not done on <date>" for a missed/late day; null when a human logged it. */
  systemText: string | null;
  remark: string | null;
  lateNote: string | null;
  lateNoteBy: string | null;
  lateNoteAt: string | null;
  doneBy: string | null;
  timeSpentMin: number | null;
  updatedAt: string | null;
  attachments: unknown[];
}

/**
 * One task's thread. `from`/`to` default to the performance window; the page is
 * capped at THREAD_PAGE_MAX newest entries (counts describe the fetched page).
 */
export async function getThread(
  templateId: string,
  slot: string,
  from: string,
  to: string,
  today: string = istDateStr(),
) {
  const t: any = await prisma.accountsTaskTemplate.findUnique({ where: { id: templateId } }).catch(() => null);
  if (!t) return null;
  const logs = await (prisma as any).accountsTaskLog.findMany({
    where: { templateId, slot: slot || SLOT_MAIN, dueDate: { gte: from, lte: to } },
    orderBy: { dueDate: 'desc' },
    take: THREAD_PAGE_MAX,
  }).catch(() => []);
  const ids = (logs as any[]).map((l) => String(l.id)).filter(Boolean);
  const files = ids.length
    ? await (prisma as any).accountsTaskAttachment.findMany({
      where: { logId: { in: ids } },
      orderBy: { createdAt: 'asc' },
    }).catch(() => [])
    : [];
  const byLog = new Map<string, any[]>();
  for (const f of files as any[]) {
    const k = String(f.logId);
    if (!byLog.has(k)) byLog.set(k, []);
    byLog.get(k)!.push(toAttachmentJson(f));
  }
  const counts: ThreadCounts = emptyCounts();
  const entries: ThreadEntryJson[] = (logs as any[]).map((l) => {
    const dueDate = String(l.dueDate).slice(0, 10);
    const entryKind = String(l.entryKind ?? 'instance');
    const hasLate = !!(l.lateNote && String(l.lateNote).trim());
    const hasRemark = !!(l.remark && String(l.remark).trim());
    const bucket = bucketOf(String(l.status), entryKind, hasLate, dueDate, today, hasRemark);
    addToCounts(counts, bucket);
    return {
      logId: String(l.id),
      dueDate,
      bucket,
      status: String(l.status),
      entryKind,
      systemText: bucket === 'missed' || bucket === 'late' ? missLabel(dueDate) : null,
      remark: l.remark ?? null,
      lateNote: l.lateNote ?? null,
      lateNoteBy: l.lateNoteBy ?? null,
      lateNoteAt: l.lateNoteAt ? String(l.lateNoteAt) : null,
      doneBy: l.doneBy ?? null,
      timeSpentMin: l.timeSpentMin ?? null,
      updatedAt: l.updatedAt ? String(l.updatedAt) : null,
      attachments: byLog.get(String(l.id)) ?? [],
    };
  });
  return {
    template: {
      id: String(t.id),
      title: String(t.title ?? ''),
      shortTitle: (t as any).shortTitle ?? null,
      dueTime: (t as any).dueTime ?? null,
      frequency: String(t.frequency ?? 'daily'),
      ownerRole: String(t.ownerRole ?? 'either'),
      isShared: !!t.isShared,
      rawText: (t as any).rawText ?? null,
    },
    slot,
    from,
    to,
    counts,
    completionPct: completionPct(counts),
    entries,
  };
}

/**
 * Per-thread counts for the dashboard list, folded through the SAME `bucketOf`
 * the thread page uses. One aggregate query (GROUP BY the raw dimensions) keeps
 * the payload small: a year of entries collapses to a handful of rows per task.
 *
 * `lastDue` stands in for each aggregated row's date when deciding
 * pending vs missed. Past unresolved rows are converted by materialiseMisses,
 * so an aggregated `instance/pending` row is today's by construction.
 */
export async function getThreadSummaries(
  templates: any[], from: string, to: string, today: string,
): Promise<Map<string, ThreadCounts>> {
  const out = new Map<string, ThreadCounts>();
  const ids = templates.map((t) => String(t.id));
  if (!ids.length) return out;
  const sql = `SELECT "templateId" AS templateId, "slot" AS slot, "status" AS status, "entryKind" AS entryKind,
      CASE WHEN "lateNote" IS NOT NULL AND TRIM("lateNote") <> '' THEN 1 ELSE 0 END AS hasLate,
      CASE WHEN "remark" IS NOT NULL AND TRIM("remark") <> '' THEN 1 ELSE 0 END AS hasRemark,
      COUNT(*) AS c, MAX("dueDate") AS lastDue
    FROM "AccountsTaskLog"
    WHERE "templateId" IN (${ids.map(() => '?').join(',')}) AND "dueDate" >= ? AND "dueDate" <= ?
    GROUP BY "templateId", "slot", "status", "entryKind", hasLate, hasRemark`;
  const rows = await (prisma as any).$queryRawUnsafe(sql, ...ids, from, to).catch((e: any) => {
    // Never silently zero the list: a broken aggregate must be visible in logs.
    console.error('[accounts] thread summaries failed:', String(e?.message ?? e).slice(0, 200));
    return [];
  });
  for (const r of (rows as any[])) {
    const key = slotKey(r.templateId, r.slot ?? SLOT_MAIN);
    const c = out.get(key) ?? emptyCounts();
    const n = Number(r.c) || 0;
    const bucket = bucketOf(
      String(r.status), String(r.entryKind ?? 'instance'), Number(r.hasLate) === 1,
      String(r.lastDue ?? '').slice(0, 10), today, Number(r.hasRemark) === 1,
    );
    for (let i = 0; i < n; i++) addToCounts(c, bucket);
    out.set(key, c);
  }
  return out;
}

/**
 * Dashboard rows: one per template × lane, carrying the window's counts.
 * The FE list renders these; expanding one calls `getThread`.
 */
export async function getThreadsForDashboard(today: string = istDateStr()) {
  const { from } = threadWindow(today);
  const templates = await activeTaskTemplates();
  const summaries = await getThreadSummaries(templates, from, today, today);
  return templates.map((t) => {
    const slots = slotsFor(t);
    return {
      templateId: String(t.id),
      title: String(t.title ?? ''),
      shortTitle: (t as any).shortTitle ?? null,
      dueTime: (t as any).dueTime ?? null,
      frequency: String(t.frequency ?? 'daily'),
      ownerRole: String(t.ownerRole ?? 'either'),
      isShared: !!t.isShared,
      rawText: (t as any).rawText ?? null,
      slots: slots.map((slot) => {
        const counts = summaries.get(slotKey(t.id, slot)) ?? emptyCounts();
        return { slot, counts, completionPct: completionPct(counts) };
      }),
    };
  });
}

/**
 * Root export, THREAD shape (migration 0166): one row per task × lane with the
 * window's entries in a single `thread` column, instead of one row per due cell.
 * The daily cell grid stays available with `?shape=daily` for audit/compat.
 */
export async function getThreadsExport(from: string, to: string) {
  const templates = await activeTaskTemplates();
  const ids = templates.map((t) => String(t.id));
  const logs = ids.length
    ? await (prisma as any).accountsTaskLog.findMany({
      where: { templateId: { in: ids }, dueDate: { gte: from, lte: to } },
      orderBy: [{ templateId: 'asc' }, { dueDate: 'asc' }],
      take: 8000,
    }).catch(() => [])
    : [];
  const byKey = new Map<string, any[]>();
  for (const l of logs as any[]) {
    const k = slotKey(l.templateId, l.slot ?? SLOT_MAIN);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(l);
  }
  const today = istDateStr();
  const rows = templates.flatMap((t) => slotsFor(t).map((slot) => {
    const entries = (byKey.get(slotKey(t.id, slot)) ?? [])
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    const counts = emptyCounts();
    const parts: string[] = [];
    for (const l of entries) {
      const dueDate = String(l.dueDate).slice(0, 10);
      const entryKind = String(l.entryKind ?? 'instance');
      const hasLate = !!(l.lateNote && String(l.lateNote).trim());
      const hasRemark = !!(l.remark && String(l.remark).trim());
      const bucket = bucketOf(String(l.status), entryKind, hasLate, dueDate, today, hasRemark);
      addToCounts(counts, bucket);
      const label = bucket === 'done' ? 'Done'
        : bucket === 'late' ? 'Not done (late work described)'
          : bucket === 'missed' ? 'Not done (auto)'
            : bucket === 'pending' ? 'Due'
              : 'Not done';
      const text = hasLate ? String(l.lateNote)
        : hasRemark ? String(l.remark)
          : bucket === 'missed' ? missLabel(dueDate)
            : '';
      parts.push(`${longDate(dueDate)} — ${label}${text ? ` — ${text}` : ''}${l.doneBy ? ` [${l.doneBy}]` : ''}`);
    }
    return {
      task: String(t.title ?? ''),
      shortTitle: (t as any).shortTitle ?? null,
      lane: (t as any).isShared ? slot : String((t as any).ownerRole ?? 'either'),
      schedule: String((t as any).rawText ?? '') || String((t as any).frequency ?? 'daily'),
      dueTime: (t as any).dueTime ?? null,
      window: `${from} → ${to}`,
      due: counts.due,
      done: counts.done,
      notDone: counts.notDone + counts.missed + counts.late,
      unexplained: counts.unresolved,
      completionPct: completionPct(counts),
      thread: parts.join(' | '),
    };
  }));
  return { from, to, rows, total: rows.length };
}
