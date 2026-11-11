// enquiry/sales-signal.ts — sales-authored signal surfaced inline on queue rows.
//
// The queue tables (ProcurementQueue, ManagementReview) render one row per
// enquiry, but anything "written for sales" used to hide inside the modal
// (per-rate salesNote, expected note, loop records). This helper picks the
// first non-empty sales signal per item so rows can preview it without a click.
//
// Priority: expectedNote (sales negotiation target) → latest open sales
// query text → latest answered query text → forwarded salesNote
// (selected/shared rate). Truncated to ~200 chars for the row; the modal
// still carries the full text.
import type { EnquiryItem } from "@/types";
import { allLoops } from "./loops";

export function salesSignalOf(it: any): string {
  if (!it || typeof it !== "object") return "";
  const exp = String((it as any)?.expectedNote ?? "").trim();
  if (exp) return exp.slice(0, 200);
  const loops = allLoops(it);
  const openQuery = loops.find(
    (l) => l.kind === "query" && l.status === "open" && l.openedBy === "sales"
      && String(l.text ?? "").trim().length > 0,
  );
  if (openQuery) return String(openQuery.text).trim().slice(0, 200);
  for (let k = loops.length - 1; k >= 0; k--) {
    const l = loops[k];
    if (l.kind !== "query" || l.status !== "answered") continue;
    const t = String(l.answer?.text ?? l.text ?? "").trim();
    if (t) return t.slice(0, 200);
  }
  const rates = Array.isArray((it as any)?.rates) ? (it as any).rates : [];
  const selIdx = (it as any)?.selectedRateIdx;
  const sel = (typeof selIdx === "number" ? rates[selIdx] : undefined)
    ?? rates.find((r: any) => (r as any)?.selected === true)
    ?? rates.find((r: any) => (it as any)?.selectedVendor && r?.vendor === (it as any).selectedVendor);
  const shared = rates.find((r: any) => (r as any)?.sharedWithSales === true && String((r as any)?.salesNote ?? "").trim());
  const note = String((sel as any)?.salesNote ?? (shared as any)?.salesNote ?? "").trim();
  if (note) return note.slice(0, 200);
  return "";
}

/** First item signal across the enquiry (for the row preview). */
export function enquirySalesSignal(e: { items?: EnquiryItem[] }): string {
  for (const it of (e as any)?.items ?? []) {
    const s = salesSignalOf(it);
    if (s) return s;
  }
  return "";
}
