// Extracted verbatim from loops.ts by scripts/refactor/split-module.mjs.
// loops.ts re-exports everything public here, so existing imports keep working.
import type { LoopKind, LoopParty, LoopStatus, EnquiryMedia, LoopRecord } from "../types";
import { parseItemMedia } from "../parse";
import type { LoopWriter } from "./types";

export const LOOP_KINDS: readonly LoopKind[] = ['spec', 'query', 'rates', 'not_available', 'note'];

export const LOOP_PARTIES: readonly LoopParty[] = ['sales', 'procurement', 'management'];

export const LOOP_STATUSES: readonly LoopStatus[] = ['open', 'answered', 'withdrawn', 'rejected'];

export const MAX_LOOPS = 100;

export function isParty(v: unknown): v is LoopParty {
  return v === 'sales' || v === 'procurement' || v === 'management';
}

export function isKind(v: unknown): v is LoopKind {
  return (LOOP_KINDS as readonly string[]).includes(String(v ?? ''));
}

export function cleanText(v: unknown, n = 2000): string {
  return String(v ?? '').trim().slice(0, n);
}

export function cleanMedia(raw: unknown): EnquiryMedia[] | undefined {
  const list = parseItemMedia(raw);
  return list.length > 0 ? list : undefined;
}

export function parseLoopRecords(raw: unknown): LoopRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: LoopRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const kind = (r as any)?.kind;
    if (!isKind(kind)) continue;
    const status = (r as any)?.status;
    if (!(LOOP_STATUSES as readonly string[]).includes(String(status ?? ''))) continue;
    const openedBy = (r as any)?.openedBy;
    const holder = (r as any)?.holder;
    if (!isParty(openedBy) || !isParty(holder)) continue;
    const text = cleanText((r as any)?.text, 2000);
    if (!text && kind !== 'note') continue;
    const rec: LoopRecord = {
      id: String((r as any)?.id ?? '').slice(0, 64) || `lp_${Math.random().toString(36).slice(2, 10)}`,
      kind,
      text: text || '(note)',
      openedBy,
      openedAt: String((r as any)?.openedAt ?? '') || new Date().toISOString(),
      holder,
      status: status as LoopStatus,
    };
    const media = cleanMedia((r as any)?.media);
    if (media) rec.media = media;
    const a = (r as any)?.answer;
    if (a && typeof a === 'object' && cleanText((a as any)?.text, 2000) && isParty((a as any)?.by)) {
      rec.answer = {
        text: cleanText((a as any).text, 2000),
        by: (a as any).by,
        at: String((a as any)?.at ?? '') || new Date().toISOString(),
      };
      const am = cleanMedia((a as any)?.media);
      if (am) rec.answer.media = am;
    }
    const f = (r as any)?.forwarded;
    if (f && typeof f === 'object' && isParty((f as any)?.by) && isParty((f as any)?.from) && isParty((f as any)?.to)) {
      rec.forwarded = { by: f.by, at: String(f?.at ?? '') || '', from: f.from, to: f.to };
    }
    if ((r as any)?.closedAt) rec.closedAt = String((r as any).closedAt);
    if ((r as any)?.internal === true) rec.internal = true;
    out.push(rec);
  }
  return out.slice(0, MAX_LOOPS);
}

/** Open records on an item, optionally filtered by kind and/or holder. */
export function openLoops(item: any, kind?: LoopKind, holder?: LoopParty): LoopRecord[] {
  const loops = Array.isArray((item as any)?.loops) ? (item as any).loops : [];
  return loops.filter((l: any) =>
    l && typeof l === 'object' && l.status === 'open'
    && (!kind || l.kind === kind)
    && (!holder || l.holder === holder));
}

/** Legacy → records migration (pure, idempotent): old text flags, requests
 *  and thread entries become explicit records. Open loops keep their
 *  effective holder (query routing preserved); closed history becomes
 *  answered/note records so no audit is lost. */
export function migrateItemLoops(item: any): LoopRecord[] {
  const existing = parseLoopRecords((item as any)?.loops);
  if (existing.length > 0) {
    // Already migrated — only fill gaps the old writer may still echo.
    // (Legacy fields on a migrated row are ignored: records are truth.)
    return existing;
  }
  const out: LoopRecord[] = [];
  const at = (v: unknown, fb: string): string => String(v ?? '').trim() || fb;
  const nowFb = new Date().toISOString();
  const thread = Array.isArray((item as any)?.thread) ? (item as any).thread : [];
  const resolved = (item as any)?.threadResolved === true;
  const resolvedBy = isParty((item as any)?.threadResolvedBy) ? (item as any).threadResolvedBy : 'management';
  const resolvedAt = at((item as any)?.threadResolvedAt, nowFb);

  // Open legacy asks → open records with their effective holder.
  const specText = cleanText((item as any)?.specIssue, 2000);
  if (specText) {
    out.push({
      id: `lp_mig_${Math.random().toString(36).slice(2, 10)}`,
      kind: 'spec', text: specText, openedBy: 'procurement',
      openedAt: at((item as any)?.specFlaggedAt, nowFb),
      holder: 'sales', status: resolved ? 'answered' : 'open',
      ...(resolved ? { answer: { text: 'Resolved', by: resolvedBy, at: resolvedAt }, closedAt: resolvedAt } : {}),
    });
  }
  const varText = cleanText((item as any)?.variationRequest, 500);
  if (varText) {
    const withDesk = (item as any)?.queryWith === 'procurement' ? 'procurement' : 'management';
    const answeredAt = String((item as any)?.queryResolvedAt ?? '');
    const answered = !answeredAt ? false : true;
    out.push({
      id: `lp_mig_${Math.random().toString(36).slice(2, 10)}`,
      kind: 'query', text: varText,
      media: cleanMedia((item as any)?.variationRequestMedia),
      openedBy: 'sales', openedAt: nowFb,
      holder: withDesk, status: answered ? 'answered' : 'open',
      ...(answered ? {
        answer: {
          text: 'Answered', by: isParty((item as any)?.queryResolvedBy) ? (item as any).queryResolvedBy : withDesk,
          at: answeredAt,
        }, closedAt: answeredAt,
      } : {}),
    });
  }
  const ratesText = cleanText((item as any)?.ratesRequested, 500);
  if (ratesText) {
    out.push({
      id: `lp_mig_${Math.random().toString(36).slice(2, 10)}`,
      kind: 'rates', text: ratesText, openedBy: 'management',
      openedAt: at((item as any)?.ratesRequestedAt, nowFb),
      holder: 'procurement', status: 'open',
    });
  }
  const naText = cleanText((item as any)?.notAvailableRequested, 500);
  if (naText) {
    out.push({
      id: `lp_mig_${Math.random().toString(36).slice(2, 10)}`,
      kind: 'not_available', text: naText, openedBy: 'procurement',
      openedAt: at((item as any)?.notAvailableRequestedAt, nowFb),
      holder: 'management', status: 'open',
    });
  }
  // Thread entries → note records (audit preserved, zero queue effect).
  // Entries that OPENED the loops above are skipped when their text matches
  // the migrated ask (same ask, one record — never a duplicate).
  const askTexts = new Set(out.map((r) => `${r.kind}|${r.text}`));
  for (const e of thread) {
    if (!e || typeof e !== 'object') continue;
    const text = cleanText((e as any)?.text, 2000);
    const media = cleanMedia((e as any)?.media);
    if (!text && !media) continue;
    const kind = String((e as any)?.kind ?? 'remark');
    const by = isParty((e as any)?.by) ? (e as any).by : 'sales';
    const entryAt = at((e as any)?.at, nowFb);
    const matchKind = kind === 'flag' && text.startsWith('Info/alternate requested: ') ? 'query'
      : kind === 'request' && text.startsWith('Not available requested: ') ? 'not_available'
      : kind === 'request' ? 'rates' : '';
    if (matchKind && askTexts.has(`${matchKind}|${text.replace(/^(Info\/alternate requested: |Not available requested: )/, '').slice(0, 500)}`)) continue;
    if (kind === 'flag' && matchKind !== 'query' && specText && text.includes(specText.slice(0, 120))) continue;
    out.push({
      id: `lp_mig_${Math.random().toString(36).slice(2, 10)}`,
      kind: 'note', text: text || '(attachment)', media,
      openedBy: by, openedAt: entryAt, holder: by,
      status: 'answered',
      answer: { text: text || '(attachment)', by, at: entryAt },
      closedAt: entryAt,
    });
  }
  return out.slice(0, MAX_LOOPS);
}

/** Answer every open record on an item (conclude paths). */
export function answerAllOpen(loops: LoopRecord[], by: LoopParty, text: string, at: string): LoopRecord[] {
  return (Array.isArray(loops) ? loops : []).map((l) => {
    if (!l || l.status !== 'open') return l;
    return { ...l, status: 'answered' as LoopStatus, answer: { text, by, at }, closedAt: at };
  });
}

/** Answer open records of one kind (optionally one holder). Returns the new
 *  array (same reference when nothing matched). Used by field-change auto
 *  answers in normalizeItemWrites. */
export function answerOpen(
  loops: LoopRecord[],
  kind: LoopKind,
  text: string,
  by: LoopParty,
  at: string,
  holder?: LoopParty,
  media?: EnquiryMedia[],
): LoopRecord[] {
  let changed = false;
  const out = (Array.isArray(loops) ? loops : []).map((l) => {
    if (!l || l.status !== 'open' || l.kind !== kind) return l;
    if (holder && l.holder !== holder) return l;
    changed = true;
    return {
      ...l,
      status: 'answered' as LoopStatus,
      answer: { text, ...(media && media.length ? { media } : {}), by, at },
      closedAt: at,
    };
  });
  return changed ? out : loops;
}

/** Open-permission matrix: who may open which kind. Asks ride their desk
 *  (surface-declared) — a privileged user covering the sales desk asks as
 *  sales; whoever covers the procurement desk flags specs / asks
 *  not-available. Plain writers ask by default. Procurement can never open a
 *  sales ask (it answers them); sales can never forge procurement's
 *  flag/request channels. */
export function canOpen(kind: LoopKind, w: LoopWriter): boolean {
  if (kind === 'note') return true;
  if (kind === 'query') return !w.restricted && (w.desk === 'sales' || !w.privileged);
  // Rate asks are the management→procurement signal: privileged only.
  if (kind === 'rates') return w.privileged;
  // Spec / not-available asks ride the procurement desk, whoever covers it.
  return w.desk === 'procurement';
}

/**
 * Apply one save's loop intents (explicit verbs + legacy bridge) to an item's
 * records. Returns the new records array. Invalid ops (wrong desk, unknown
 * id, answered record) are ignored — never half-applied, never throwing.
 */
export function applyLoopOps(
  stored: any,
  it: any,
  w: LoopWriter,
  nowIso: string,
): LoopRecord[] {
  let loops = migrateItemLoops(stored);
  const touch = () => { loops = [...loops]; };
  const findOpen = (id: string): LoopRecord | undefined =>
    loops.find((l) => l && String(l.id) === String(id) && l.status === 'open');

  const doOpen = (kind: LoopKind, text: string, media?: EnquiryMedia[], by?: LoopParty, at?: string, holder?: LoopParty): LoopRecord | undefined => {
    // Bypassed items run no quoting loop (rate available / not available /
    // internal) — asks on them strand in queues no desk can clear by quoting
    // (seen live: an open query sitting with management on a rate-available
    // item). Notes stay composable everywhere.
    if (kind !== 'note') {
      const s: any = stored ?? {};
      if (s.rateAvailable === true || s.notAvailable === true || s.internalRates === true) return undefined;
    }
    const t = cleanText(text, kind === 'note' ? 2000 : kind === 'query' ? 500 : kind === 'rates' ? 500 : 2000);
    if (!t) return undefined;
    const opener = by ?? w.desk;
    const rec: LoopRecord = {
      id: `lp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      kind, text: t, openedBy: opener, openedAt: at ?? nowIso,
      holder: holder ?? defaultHolder(kind, opener), status: 'open',
    };
    const m = media && media.length ? media : undefined;
    if (m) rec.media = m;
    // Notes are fire-and-forget: answered at creation, audit only.
    if (kind === 'note') {
      rec.status = 'answered';
      rec.answer = { text: t, ...(m ? { media: m } : {}), by: opener, at: at ?? nowIso };
      rec.closedAt = at ?? nowIso;
    }
    touch();
    loops.push(rec);
    return rec;
  };

  const doAnswer = (id: string, text: string, media?: EnquiryMedia[], by?: LoopParty, at?: string): boolean => {
    const rec = findOpen(id);
    if (!rec) return false;
    const actor = by ?? w.desk;
    if (actor !== rec.holder) return false;
    const t = cleanText(text, 2000);
    if (!t && !(media && media.length)) return false;
    touch();
    Object.assign(rec, {
      status: 'answered' as LoopStatus,
      answer: { text: t || '(attachment)', ...(media && media.length ? { media } : {}), by: actor, at: at ?? nowIso },
      closedAt: at ?? nowIso,
    });
    return true;
  };

  // ── Explicit verbs (new clients) ──────────────────────────────────────────
  const verb = (v: unknown): any => (v && typeof v === 'object' ? v : undefined);
  const vo = verb((it as any)?.loopOpen);
  if (vo && isKind(vo.kind) && canOpen(vo.kind, w)) {
    const t = cleanText(vo.text, 2000);
    if (t && !(vo.kind !== 'note' && loops.some((l) => l.status === 'open' && l.kind === vo.kind && l.text === t))) {
      doOpen(vo.kind, t, cleanMedia(vo.media));
    }
  }
  const va = verb((it as any)?.loopAnswer);
  if (va && typeof va.id === 'string' && va.id) {
    doAnswer(va.id, cleanText(va.text, 2000), cleanMedia(va.media));
  }
  const vf = verb((it as any)?.loopForward);
  if (vf && typeof vf.id === 'string' && vf.id && isParty(vf.to)) {
    // Forward: management-only, query records only.
    const rec = findOpen(vf.id);
    if (rec && rec.kind === 'query' && w.privileged && vf.to !== rec.holder) {
      touch();
      Object.assign(rec, {
        holder: vf.to,
        forwarded: { by: w.desk, at: nowIso, from: rec.holder, to: vf.to },
      });
    }
  }
  const vw = verb((it as any)?.loopWithdraw);
  if (vw && typeof vw.id === 'string' && vw.id) {
    const rec = findOpen(vw.id);
    if (rec && rec.openedBy === w.desk) {
      touch();
      Object.assign(rec, { status: 'withdrawn' as LoopStatus, closedAt: nowIso });
    }
  }
  const vr = verb((it as any)?.loopReject);
  if (vr && typeof vr.id === 'string' && vr.id) {
    const rec = findOpen(vr.id);
    if (rec && rec.holder === w.desk) {
      touch();
      const t = cleanText(vr.text, 500);
      Object.assign(rec, {
        status: 'rejected' as LoopStatus, closedAt: nowIso,
        ...(t ? { answer: { text: t, by: w.desk, at: nowIso } } : {}),
      });
    }
  }

  // ── Legacy bridge (older clients echoing text fields / thread arrays) ────
  // Sales ask / withdraw.
  if (!w.privileged && !w.restricted) {
    const inVar = (it as any)?.variationRequest;
    const stVar = String(stored?.variationRequest ?? '').trim();
    const text = typeof inVar === 'string' ? inVar.trim().slice(0, 500) : '';
    const inMedia = cleanMedia((it as any)?.variationRequestMedia);
    if (text && text !== stVar) {
      if (!loops.some((l) => l.status === 'open' && l.kind === 'query')) {
        doOpen('query', text, inMedia, 'sales', nowIso, 'management');
      }
    } else if (inVar === '' && stVar) {
      for (const l of loops) {
        if (l.status === 'open' && l.kind === 'query' && l.openedBy === 'sales') {
          touch();
          Object.assign(l, { status: 'withdrawn' as LoopStatus, closedAt: nowIso });
        }
      }
    }
  }
  // Procurement spec flag.
  if (w.restricted || w.privileged) {
    const incoming = (it as any)?.specIssue;
    const hadStored = !!String(stored?.specIssue ?? '').trim();
    if (typeof incoming === 'string' && incoming.trim() && !hadStored) {
      if (!loops.some((l) => l.status === 'open' && l.kind === 'spec')) {
        doOpen('spec', incoming.trim().slice(0, 2000), undefined, w.desk, nowIso, 'sales');
      }
    }
  }
  // Management rate request set / withdraw.
  if (w.privileged) {
    const incoming = (it as any)?.ratesRequested;
    const hadStored = !!String(stored?.ratesRequested ?? '').trim();
    if (typeof incoming === 'string' && incoming.trim() && !hadStored) {
      if (!loops.some((l) => l.status === 'open' && l.kind === 'rates')) {
        doOpen('rates', incoming.trim().slice(0, 500), undefined, 'management', nowIso, 'procurement');
      }
    } else if (incoming === '' && hadStored) {
      for (const l of loops) {
        if (l.status === 'open' && l.kind === 'rates' && l.openedBy === 'management') {
          touch();
          Object.assign(l, { status: 'withdrawn' as LoopStatus, closedAt: nowIso });
        }
      }
    }
  } else if (!w.restricted) {
    // Plain sales writers never touch rate requests (pinned to stored).
    void 0;
  }
  // Procurement not-available request set / withdraw.
  if (w.restricted) {
    const incoming = (it as any)?.notAvailableRequested;
    const hadStored = !!String(stored?.notAvailableRequested ?? '').trim();
    // Old UI quirk: notAvailable:true means "request". Mirror it.
    const reqText = typeof incoming === 'string' && incoming.trim() ? incoming.trim().slice(0, 500)
      : (it as any)?.notAvailable === true && !hadStored ? String((it as any)?.notAvailableReason ?? 'Not available').trim().slice(0, 500) || 'Not available'
      : '';
    if (reqText && !hadStored) {
      if (!loops.some((l) => l.status === 'open' && l.kind === 'not_available')) {
        doOpen('not_available', reqText, undefined, 'procurement', nowIso, 'management');
      }
    } else if ((incoming === '' || incoming === undefined && (it as any)?.notAvailable === false) && hadStored) {
      void 0; // clears are handled by approve/withdraw paths below
    }
  }
  // Legacy queryAnswer / queryWith markers (previous new-client protocol).
  if (w.privileged) {
    if ((it as any)?.queryAnswer === true) {
      const rec = loops.find((l) => l.status === 'open' && l.kind === 'query' && l.holder === 'management');
      if (rec) {
        const reply = '';
        void reply;
        // The reply text rode the appended thread remark in the old flow;
        // without a thread the marker alone carries no answer text, so it
        // becomes a management note instead of a silent clear.
        touch();
        Object.assign(rec, { status: 'answered' as LoopStatus, answer: { text: '(answered by management)', by: 'management' as LoopParty, at: nowIso }, closedAt: nowIso });
      }
    }
    if (typeof (it as any)?.queryWith === 'string') {
      const to = (it as any).queryWith === 'procurement' ? 'procurement' : (it as any).queryWith === 'management' ? 'management' : '';
      const rec = loops.find((l) => l.status === 'open' && l.kind === 'query');
      if (rec && to && to !== rec.holder) {
        touch();
        Object.assign(rec, { holder: to, forwarded: { by: 'management' as LoopParty, at: nowIso, from: rec.holder, to } });
      }
    }
  }
  // Legacy thread payloads (older clients appending remarks / resolve flags).
  const incomingThread = Array.isArray((it as any)?.thread) ? (it as any).thread : [];
  if (incomingThread.length > 0) {
    const storedThread = Array.isArray(stored?.thread) ? stored.thread : [];
    const seen = new Set(storedThread.map((e: any) => `${e?.at}|${e?.kind}|${e?.text}`));
    for (const e of incomingThread) {
      if (!e || typeof e !== 'object') continue;
      if (seen.has(`${(e as any)?.at}|${(e as any)?.kind}|${(e as any)?.text}`)) continue;
      if ((e as any)?.kind !== 'remark') continue;
      const t = cleanText((e as any)?.text, 2000);
      const m = cleanMedia((e as any)?.media);
      if (!t && !m) continue;
      const by = isParty((e as any)?.by) ? (e as any).by : w.desk;
      doOpen('note', t || '(attachment)', m, by, String((e as any)?.at ?? nowIso) || nowIso, by);
    }
  }
  if ((it as any)?.threadResolved === true && !stored?.threadResolved) {
    // Old generic resolve toggle: answer everything this desk holds.
    for (const l of loops) {
      if (l.status === 'open' && l.holder === w.desk) {
        touch();
        Object.assign(l, { status: 'answered' as LoopStatus, answer: { text: 'Resolved', by: w.desk, at: nowIso }, closedAt: nowIso });
      }
    }
  }

  // ── Auto-answer triggers (field changes, any writer) ─────────────────────
  const specChanged = String((it as any)?.spec ?? '') !== String(stored?.spec ?? '');
  if (specChanged) {
    for (const l of loops) {
      if (l.status === 'open' && l.kind === 'spec') {
        touch();
        Object.assign(l, { status: 'answered' as LoopStatus, answer: { text: 'Spec corrected', by: w.desk, at: nowIso }, closedAt: nowIso });
      }
    }
  }
  return loops.slice(0, MAX_LOOPS);
}

export function defaultHolder(kind: LoopKind, opener: LoopParty): LoopParty {
  if (kind === 'query') return 'management';
  if (kind === 'rates') return 'procurement';
  if (kind === 'spec') return 'sales';
  if (kind === 'not_available') return 'management';
  return opener;
}

/** Note helper for server-authored audit entries (kept visible, no routing). */
export function auditNote(text: string, by: LoopParty, at: string, internal = false): LoopRecord {
  const t = cleanText(text, 500);
  return {
    id: `lp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    kind: 'note', text: t || '(note)',
    openedBy: by, openedAt: at, holder: by,
    status: 'answered',
    answer: { text: t || '(note)', by, at },
    closedAt: at,
    ...(internal ? { internal: true } : {}),
  };
}
