// enquiry/loops.ts — deterministic loop records (frontend mirror).
// Backend source of truth: founder-os_backend/src/modules/enquiries/loops.ts
// Queues read ONLY holder + status — no inference, so a message for one desk
// can never surface in another's queue.
import type { EnquiryMedia, LoopKind, LoopParty, LoopRecord, LoopStatus } from "@/types";

const KIND_SET = new Set<string>(['spec', 'query', 'rates', 'not_available', 'note']);
const PARTY_SET = new Set<string>(['sales', 'procurement', 'management']);
const STATUS_SET = new Set<string>(['open', 'answered', 'withdrawn', 'rejected']);

function cleanMedia(raw: unknown): EnquiryMedia[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = (raw as any[])
    .map((m: any) => ({
      type: m?.type === "video" ? "video" : m?.type === "pdf" ? "pdf" : "image",
      url: String(m?.url ?? ""),
      name: m?.name ? String(m.name) : undefined,
    }))
    .filter((m: any) => m.url.length > 0);
  return out.length > 0 ? (out as EnquiryMedia[]) : undefined;
}

export function parseLoopRecords(raw: unknown): LoopRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: LoopRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const kind = String((r as any)?.kind ?? "");
    const status = String((r as any)?.status ?? "");
    if (!KIND_SET.has(kind) || !STATUS_SET.has(status)) continue;
    const openedBy = String((r as any)?.openedBy ?? "");
    const holder = String((r as any)?.holder ?? "");
    if (!PARTY_SET.has(openedBy) || !PARTY_SET.has(holder)) continue;
    const text = String((r as any)?.text ?? "").trim().slice(0, 2000);
    if (!text && kind !== "note") continue;
    const rec: LoopRecord = {
      id: String((r as any)?.id ?? "").slice(0, 64) || `lp_${Math.random().toString(36).slice(2, 10)}`,
      kind: kind as LoopKind,
      text: text || "(note)",
      openedBy: openedBy as LoopParty,
      openedAt: String((r as any)?.openedAt ?? "") || new Date().toISOString(),
      holder: holder as LoopParty,
      status: status as LoopStatus,
    };
    const media = cleanMedia((r as any)?.media);
    if (media) rec.media = media;
    const a = (r as any)?.answer;
    if (a && typeof a === "object" && String((a as any)?.text ?? "").trim() && PARTY_SET.has(String((a as any)?.by ?? ""))) {
      rec.answer = {
        text: String((a as any).text).trim().slice(0, 2000),
        by: (a as any).by as LoopParty,
        at: String((a as any)?.at ?? "") || new Date().toISOString(),
      };
      const am = cleanMedia((a as any)?.media);
      if (am) rec.answer.media = am;
    }
    const f = (r as any)?.forwarded;
    if (f && typeof f === "object" && PARTY_SET.has(String(f?.by ?? "")) && PARTY_SET.has(String(f?.from ?? "")) && PARTY_SET.has(String(f?.to ?? ""))) {
      rec.forwarded = { by: f.by, at: String(f?.at ?? ""), from: f.from, to: f.to };
    }
    if ((r as any)?.closedAt) rec.closedAt = String((r as any).closedAt);
    if ((r as any)?.internal === true) rec.internal = true;
    out.push(rec);
  }
  return out.slice(0, 100);
}

/** Open records on an item, optionally filtered by kind and/or holder. */
export function openLoops(item: any, kind?: LoopKind, holder?: LoopParty): LoopRecord[] {
  const loops = parseLoopRecords((item as any)?.loops);
  return loops.filter((l) => (!kind || l.kind === kind) && (!holder || l.holder === holder) && l.status === "open");
}

/** All records on an item (open + closed audit). */
export function allLoops(item: any): LoopRecord[] {
  return parseLoopRecords((item as any)?.loops);
}
