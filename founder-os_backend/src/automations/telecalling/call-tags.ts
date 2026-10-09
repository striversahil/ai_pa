// call-tags.ts — agent call dispositions + dated next steps (holder-written).
//
// Verbatim extract from service.ts (Phase-3 split): validated writes for
// call tags (NO_ANSWER/BUSY/CALLBACK) and next-step commitments, plus the
// Sheets-style live overlays that merge them onto cached dashboard rows.
// Engines never write these columns — the risk model only reads them.
import { prisma } from '../../shared/prisma';
import { DATE_RE, IN_BATCH, istDate } from './util';

// ── Agent call-disposition tags ─────────────────────────────────────────────
// Per-estimate tags the sales team sets from the Lead Conversion view:
//   NO_ANSWER — client not picking up the phone
//   BUSY      — client busy, call back later (no fixed date)
//   CALLBACK  — follow up on a specific date (callbackDate, max +10 days IST)
// Sticky until the agent changes/clears them; NO engine writes or clears these
// columns (assignment, snatch, bulk-assign all leave them untouched).
export const CALL_TAGS = ['NO_ANSWER', 'BUSY', 'CALLBACK'] as const;
export type CallTag = (typeof CALL_TAGS)[number];
/** Callback dates may not be more than this many days after today (IST). */
export const CALLBACK_MAX_DAYS = 10;

function istDayPlus(n: number): string {
  return istDate(new Date(Date.now() + n * 86400000));
}

/**
 * Validate + persist an agent's call-disposition tag on one estimate.
 * Returns { ok, error?, status? } so route handlers stay thin.
 * CALLBACK requires callbackDate (YYYY-MM-DD, today..today+10 IST); any other
 * tag clears a stale date. tag null/undefined clears the whole disposition.
 */
export async function setEstimateCallTag(opts: {
  estimateId: string;
  tag: string | null | undefined;
  callbackDate?: string | null | undefined;
  actorTelecallerId?: string | null | undefined;
}): Promise<{ ok: boolean; error?: string; status?: number; estimate?: any }> {
  const estimateId = String(opts.estimateId || '').trim();
  if (!estimateId) return { ok: false, error: 'estimate id required', status: 400 };
  const rawTag = opts.tag === null || opts.tag === undefined || opts.tag === '' ? null : String(opts.tag).toUpperCase();
  if (rawTag !== null && !(CALL_TAGS as readonly string[]).includes(rawTag)) {
    return { ok: false, error: `tag must be one of ${CALL_TAGS.join(', ')}`, status: 400 };
  }
  let date: string | null = null;
  if (rawTag === 'CALLBACK') {
    const d = String(opts.callbackDate || '').trim();
    if (!DATE_RE.test(d)) return { ok: false, error: 'callbackDate (YYYY-MM-DD) required for CALLBACK', status: 400 };
    const today = istDate();
    const max = istDayPlus(CALLBACK_MAX_DAYS);
    if (d < today) return { ok: false, error: 'callbackDate cannot be in the past', status: 400 };
    if (d > max) return { ok: false, error: `callbackDate cannot be more than ${CALLBACK_MAX_DAYS} days out (max ${max})`, status: 400 };
    date = d;
  }
  const exists = await prisma.estimate.findUnique({
    where: { estimateId },
    select: { estimateId: true },
  });
  if (!exists) return { ok: false, error: 'estimate not found', status: 404 };
  const estimate = await prisma.estimate.update({
    where: { estimateId },
    data: {
      callTag: rawTag,
      callbackDate: date,
      callTagBy: rawTag ? (opts.actorTelecallerId ?? null) : null,
      callTagAt: rawTag ? new Date().toISOString() : null,
    },
  });
  // DELIBERATELY no invalidateRiskCache(): tags bypass the dashboard cache via
  // the post-cache overlay in getTelecallingDashboardData (Sheets-style — the
  // write is a single-row UPDATE and the next read merges it live, so a tag
  // save never forces the multi-second risk/leaderboard recompute).
  return { ok: true, estimate };
}

/** Max horizon for a dated next step (IST days out). Commitments further out
 *  than this are planning noise, not protection. */
export const NEXT_STEP_MAX_DAYS = 30;

/**
 * Validate + persist a dated next step (customer commitment) on one estimate.
 * Holder or MIS only (enforced at the route). Date must be today..today+30
 * IST; null clears both columns. Engines never write these — the risk model
 * only reads them (future/today date protects from red + EOD, past date reads
 * red until chased).
 */
export async function setEstimateNextStep(opts: {
  estimateId: string;
  date: string | null | undefined;
  note?: string | null | undefined;
}): Promise<{ ok: boolean; error?: string; status?: number; estimate?: any }> {
  const estimateId = String(opts.estimateId || '').trim();
  if (!estimateId) return { ok: false, error: 'estimate id required', status: 400 };
  const raw = opts.date === null || opts.date === undefined || opts.date === '' ? null : String(opts.date).trim();
  let date: string | null = null;
  if (raw !== null) {
    if (!DATE_RE.test(raw)) return { ok: false, error: 'date must be YYYY-MM-DD', status: 400 };
    const today = istDate();
    const max = istDayPlus(NEXT_STEP_MAX_DAYS);
    if (raw < today) return { ok: false, error: 'next-step date cannot be in the past', status: 400 };
    if (raw > max) return { ok: false, error: `next-step date cannot be more than ${NEXT_STEP_MAX_DAYS} days out (max ${max})`, status: 400 };
    date = raw;
  }
  const note = date ? String(opts.note ?? '').trim().slice(0, 200) : null;
  const exists = await prisma.estimate.findUnique({
    where: { estimateId },
    select: { estimateId: true },
  });
  if (!exists) return { ok: false, error: 'estimate not found', status: 404 };
  const estimate = await prisma.estimate.update({
    where: { estimateId },
    data: { nextStep: note, nextStepDate: date },
  });
  return { ok: true, estimate };
}

/**
 * Sheets-style freshness for holder-written next steps (mirrors
 * overlayCallTags): merges the LIVE nextStep columns onto cached follow-up
 * rows with one indexed query, so a save is visible on the very next read
 * without busting the 5-min dashboard cache. Also busts the risk cache — the
 * risk verdict itself depends on these columns (unlike tags).
 */
export async function overlayNextSteps(rows: any[]): Promise<void> {
  const ids = [...new Set((rows || []).map((r) => String(r?.estimateId || '')).filter(Boolean))];
  if (ids.length === 0) return;
  const byId = new Map<string, any>();
  // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const found = await prisma.estimate.findMany({
      where: { estimateId: { in: ids.slice(i, i + IN_BATCH) } },
      select: { estimateId: true, nextStep: true, nextStepDate: true },
    });
    for (const e of found as any[]) byId.set(String(e.estimateId), e);
  }
  for (const r of rows) {
    const live = byId.get(String(r?.estimateId ?? ''));
    if (!live) continue;
    r.nextStep = (live as any).nextStep ?? null;
    r.nextStepDate = (live as any).nextStepDate ?? null;
  }
}

/**
 * Sheets-style freshness for agent-written tags: merge the LIVE tag columns
 * onto cached follow-up rows with one indexed query (~ms), AFTER the KV
 * cache. The 5-min dashboard payload stays warm (no recompute storms) while
 * tag taps are visible on the very next read. Best-effort — cached rows
 * render untouched if the overlay query fails.
 */
export async function overlayCallTags(rows: any[]): Promise<void> {
  const ids = [...new Set((rows || []).map((r) => String(r?.estimateId || '')).filter(Boolean))];
  if (ids.length === 0) return;
  const byId = new Map<string, any>();
  // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const found = await prisma.estimate.findMany({
      where: { estimateId: { in: ids.slice(i, i + IN_BATCH) } },
      select: { estimateId: true, callTag: true, callbackDate: true, callTagBy: true, callTagAt: true },
    });
    for (const e of found as any[]) byId.set(String(e.estimateId), e);
  }
  let names: Map<string, string> | null = null;
  for (const r of rows) {
    const live = byId.get(String(r?.estimateId ?? ''));
    if (!live) continue;
    r.callTag = (live as any).callTag ?? null;
    r.callbackDate = (live as any).callbackDate ?? null;
    r.callTagBy = (live as any).callTagBy ?? null;
    r.callTagAt = (live as any).callTagAt ?? null;
    const by = (live as any).callTagBy ? String((live as any).callTagBy) : '';
    if (by) {
      if (!names) {
        try {
          const tcs = await prisma.telecaller.findMany({ select: { id: true, name: true } });
          names = new Map((tcs as any[]).map((t) => [String(t.id), String(t.name ?? '')]));
        } catch { names = new Map(); }
      }
      r.callTagByName = names.get(by) ?? null;
    } else {
      r.callTagByName = null;
    }
  }
}
