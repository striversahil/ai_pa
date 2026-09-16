"use client";

import React, { useState, useEffect } from "react";
import type { Enquiry, EnquiryItem, EnquiryItemRate } from "@/types";
import { parseMoneyInput, historyDateChip } from "@/types";
import FlagThread from "@/components/FlagThread";
import ItemRateForm from "@/components/ItemRateForm";

export const RATE_STATUS_LABEL: Record<string, string> = {
  "": "Rate Pending",
  rate_pending: "Rate Pending",
  rates_received: "Rates Received",
  finalized: "Finalized",
  sent: "Sent to Client",
};

const fmtINR = (n: number | null | undefined): string =>
  `₹${Number(n || 0).toLocaleString("en-IN")}`;

/** Round UP to the next multiple of 5 (exact multiples stay). The 1e-6
 *  epsilon keeps float dust (e.g. 1050.0000001) from jumping a bracket. */
export const ceil5 = (x: number): number => Math.ceil((x - 1e-6) / 5) * 5;

type MarkupMode = "percent" | "final";

interface ManagementRatesPanelProps {
  enquiry: Enquiry;
  onSave: (items: EnquiryItem[], finalize: boolean) => Promise<void> | void;
}

/** MIS-only rate review: vendor rates per item, markup decision, finalize.
 *  Finalize PATCHes items + rateStatus='finalized'; the live event pushes the
 *  updated rates to Sales automatically (same useLiveQuery subscription). */
export default function ManagementRatesPanel({ enquiry, onSave }: ManagementRatesPanelProps) {
  const items = Array.isArray(enquiry.items) ? enquiry.items : [];
  // Selected vendor per item, keyed by RATE ROW INDEX (not vendor name):
  // procurement often adds two quotes from the same vendor (two makes /
  // models), and name-keyed selection always resolved to the first match,
  // making the second row unselectable.
  const [sel, setSel] = useState<Record<number, number>>({});
  const [modes, setModes] = useState<Record<number, MarkupMode>>({});
  const [pctInputs, setPctInputs] = useState<Record<number, string>>({});
  const [finalInputs, setFinalInputs] = useState<Record<number, string>>({});
  const [discountInputs, setDiscountInputs] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);
  // Rate-requests back to procurement (incorrect quote / different vendor
  // needed): per-item note overrides applied at save time.
  const [reqs, setReqs] = useState<Record<number, string | null>>({});
  const [reqOpen, setReqOpen] = useState<number | null>(null);
  const [reqNote, setReqNote] = useState("");
  // Optional per-item management remark (e.g. "valid 7 days", "transport
  // extra"): saved into the item thread alongside the rates, visible to
  // Sales under the decided rate.
  const [remarks, setRemarks] = useState<Record<number, string>>({});
  const [remarkOpen, setRemarkOpen] = useState<number | null>(null);
  // Per-item forwardable note: procurement's salesNote for the selected vendor,
  // editable by founder before finalizing (forwarded to sales with finalRate).
  const [salesNotes, setSalesNotes] = useState<Record<number, string>>({});
  // Share-with-sales toggles (founder clicks only — unstaged rows fall back
  // to the stored flag at save, so live procurement edits never silently
  // unshare). Keyed vendor+rate so appended/dropped rows can't shift them.
  const [shareToggled, setShareToggled] = useState<Record<string, boolean>>({});
  const shareKey = (i: number, r: any): string =>
    `${i}|${String(r?.vendor ?? "")}|${Number(r?.rate)}`;
  // Bulk decisions: checkboxes select items, then one margin % applies to
  // all, or one combined final ₹ splits proportionally across selected
  // vendor rates (each ceil5; the computed total is shown).
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [bulkPct, setBulkPct] = useState("");
  const [bulkTotal, setBulkTotal] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  // Founder override on committed (finalized/sent) items: sales keeps the
  // previous rate until a revision is saved — revise unlocks one item at a
  // time, late quotes never auto-clear.
  const [revise, setRevise] = useState<Record<number, boolean>>({});
  // Decided-rates summary: collapsed "Closed" dropdown above the item cards.
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    const s: Record<number, number> = {};
    const p: Record<number, string> = {};
    const f: Record<number, string> = {};
    const d: Record<number, string> = {};
    const sn: Record<number, string> = {};
    items.forEach((it, i) => {
      // Stored vendor NAME resolves to its first matching row (backwards
      // compatible); a deleted vendor leaves the item unselected to pick fresh.
      if (it.selectedVendor) {
        const k = (it.rates ?? []).findIndex((r) => r.vendor === it.selectedVendor);
        if (k >= 0) s[i] = k;
      }
      // Auto-select when only one vendor rate exists — faster processing, no extra click
      else if (!it.specIssue && !it.rateAvailable && (it.rates ?? []).length === 1) s[i] = 0;
      // Markup % was stored over discounted base; reverse with same base.
      const rate = (it.rates ?? []).find((r) => r.vendor === (it.selectedVendor ?? ""))?.rate;
      const disc = (it as any).finalDiscountPercent;
      const base = rate !== undefined && disc !== undefined && disc !== null ? rate * (1 - Number(disc) / 100) : rate;
      if (it.markup !== undefined && it.markup !== null && base) {
        const pct = (Number(it.markup) / base) * 100;
        if (Number.isFinite(pct)) p[i] = String(Math.round(pct * 100) / 100);
      }
      if (it.finalRate !== undefined && it.finalRate !== null) f[i] = String(it.finalRate);
      if (disc !== undefined && disc !== null && String(disc).trim() !== "" && Number(disc) !== 0) d[i] = String(disc);
      const selRate: any = (it.rates ?? []).find((r: any) => r.vendor === (it.selectedVendor ?? ""));
      if (selRate?.salesNote) sn[i] = String(selRate.salesNote);
    });
    setSel(s);
    setModes({});
    setPctInputs(p);
    setFinalInputs(f);
    setDiscountInputs(d);
    setSalesNotes(sn);
    setReqs({});
    setReqOpen(null);
    setReqNote("");
    setRemarks({});
    setRemarkOpen(null);
    setChecked({});
    setBulkPct("");
    setBulkTotal("");
    setBulkError(null);
    setRevise({});
    setConfirming(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enquiry.id]);

  const finalized = enquiry.rateStatus === "finalized";
  // Sent to client = committed quotes: fully locked, like finalized.
  const sent = enquiry.rateStatus === "sent";
  const locked = finalized || sent;
  // Founder revising a committed enquiry: any item in revise mode re-enables
  // Save/Finalize even while `locked` — sales keeps the old rate until save.
  const revisingLocked = locked && Object.values(revise).some(Boolean);
  // Late-added items on a committed enquiry were never decided (no finalRate)
  // — they must stay editable + savable even while the rest of the row is
  // locked. Without this the panel is a dead end: Save disabled, no Revise
  // button on never-committed items (Enquiry No 5 case).
  const hasUndecidedInLocked =
    locked && items.some((it) => !it.specIssue && !it.rateAvailable && (it.finalRate === undefined || it.finalRate === null));
  const canSaveLocked = revisingLocked || hasUndecidedInLocked;

  // Live auto-select single-rate items (procurement just added the only quote while the panel is open)
  useEffect(() => {
    if (locked && !canSaveLocked) return;
    const patch: Record<number, number> = {};
    let changed = false;
    items.forEach((it, i) => {
      if (sel[i] !== undefined || it.selectedVendor) return;
      if (it.specIssue || it.rateAvailable) return;
      if ((it.rates ?? []).length === 1) {
        patch[i] = 0;
        changed = true;
      }
    });
    if (changed) setSel((prev) => ({ ...prev, ...patch }));
  }, [items, locked, sel]);
  // Rate-available items skip the loop entirely: never shown, never touched,
  // never counted here (same rule as the pending queue predicate).
  const actionableCount = items.filter((it) => !it.specIssue && !it.rateAvailable).length;

  // Selected rate ROW for item i: explicit index first, else the stored
  // vendor name's first match (backwards compatible). Every consumer
  // (radio, compute, note box, save) resolves through here so duplicate
  // vendor names stay independently selectable.
  const selRateIdx = (i: number, it: EnquiryItem): number | undefined => {
    const rates = it.rates ?? [];
    const s = sel[i];
    if (s !== undefined) return s >= 0 && s < rates.length ? s : undefined;
    if (!it.selectedVendor) return undefined;
    const k = rates.findIndex((r) => r.vendor === it.selectedVendor);
    return k >= 0 ? k : undefined;
  };

  const discountFor = (i: number, it: EnquiryItem): number => {
    const raw = discountInputs[i];
    if (raw !== undefined && raw.trim() !== "") {
      const n = Number(raw.trim());
      if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
      return NaN;
    }
    const stored = (it as any).finalDiscountPercent;
    if (stored !== undefined && stored !== null && stored !== "") {
      const n = Number(stored);
      if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    }
    return 0;
  };

  /** Effective { markup, finalRate } for item i under its current mode.
   *  Discount (procurement's vendor offer is info-only; management's final
   *  discount is applied on the selected vendor rate before markup):
   *    discountedBase = rate * (1 - finalDiscount/100)
   *    final = ceil5(discountedBase * (1 + markup%/100)) or direct final ₹
   *  Null when nothing is entered and nothing was stored (preserve as-is). */
  const computeItem = (i: number, it: EnquiryItem): { markup: number; finalRate: number; unrounded: number; discount: number } | null => {
    const ri = selRateIdx(i, it);
    const rate = ri === undefined ? undefined : (it.rates ?? [])[ri]?.rate;
    const discount = discountFor(i, it);
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) return null;
    const base = rate !== undefined ? rate * (1 - discount / 100) : undefined;
    const mode: MarkupMode = modes[i] ?? "percent";
    if (mode === "final") {
      const raw = finalInputs[i];
      const f = raw !== undefined && raw.trim() !== ""
        ? parseMoneyInput(raw)
        : (it.finalRate !== undefined && it.finalRate !== null ? Number(it.finalRate) : NaN);
      if (f === null || !Number.isFinite(f) || f < 0) return null;
      const final = ceil5(f);
      const markup = base !== undefined ? final - base : final;
      return { markup, finalRate: final, unrounded: f, discount };
    }
    const raw = pctInputs[i];
    const p = raw !== undefined && raw.trim() !== ""
      ? parseMoneyInput(raw)
      : (it.markup !== undefined && it.markup !== null && base ? (Number(it.markup) / base) * 100 : NaN);
    if (p === null || !Number.isFinite(p) || base === undefined) return null;
    const unrounded = base * (1 + p / 100);
    const final = ceil5(unrounded);
    return { markup: final - base, finalRate: final, unrounded, discount };
  };

  // Partial-decision completeness: every loop item (correct spec, rate not
  // already available) needs a vendor + markup/final before the enquiry may
  // be finalized. Decided items (stored or freshly entered) count — so a
  // partial "Save rates" is progress, and Finalize unlocks only at 100%.
  const actionableIdx = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => !it.specIssue && !it.rateAvailable)
    .map(({ i }) => i);
  const decidedCount = actionableIdx.filter((i) => computeItem(i, items[i]) !== null).length;
  const allDecided = actionableIdx.length > 0 && decidedCount === actionableIdx.length;

  const buildItems = (finalize: boolean): EnquiryItem[] =>
    items.map((it, i) => {
      // Held for a sales spec correction, or rate already available: never
      // touched here, never finalized.
      if (it.specIssue || it.rateAvailable) return { ...it };
      const ri = selRateIdx(i, it);
      const picked = ri === undefined ? undefined : (it.rates ?? [])[ri];
      const out: EnquiryItem = { ...it, selectedVendor: picked?.vendor || undefined };
      // Persist the exact decided ROW (duplicate vendor names) + per-row
      // sales-visibility: the selected row is always shared (it IS the
      // quoted rate); other rows follow the founder's toggle, else stored.
      if (ri !== undefined) (out as any).selectedRateIdx = ri;
      else delete (out as any).selectedRateIdx;
      out.rates = (out.rates ?? []).map((r: any, k: number) => {
        const want = k === ri || shareToggled[shareKey(i, r)] === true
          || (shareToggled[shareKey(i, r)] === undefined && (r as any)?.sharedWithSales === true);
        return { ...r, sharedWithSales: want ? true : undefined };
      });
      // Forwardable salesNote: if founder edited it for the selected ROW,
      // persist it on that row only (procurement's note, founder-editable,
      // sales sees only the selected vendor's note with the final rate).
      const noteEdited = salesNotes[i] !== undefined;
      if (ri !== undefined && noteEdited) {
        out.rates = (out.rates ?? []).map((r: any, k: number) => k === ri ? { ...r, salesNote: salesNotes[i].trim() || undefined } : r);
      }
      // Management rate-request (incorrect quote / different vendor needed):
      // attaches the flag + timestamp; null withdraws an unanswered request.
      if (reqs[i] !== undefined) {
        if (reqs[i] === null) {
          delete out.ratesRequested;
          delete out.ratesRequestedAt;
        } else {
          out.ratesRequested = reqs[i] || "requested";
          out.ratesRequestedAt = new Date().toISOString();
        }
      }
      const c = computeItem(i, it);
      // Final customer discount % (0–100) — management's decided giveaway on
      // this item's vendor rate (before markup). Empty/0 = no discount.
      const discRaw = discountInputs[i];
      const discVal = discRaw !== undefined && discRaw.trim() !== "" ? Number(discRaw.trim()) : ((it as any).finalDiscountPercent ?? undefined);
      const discNum = discVal !== undefined && discVal !== null && String(discVal).trim() !== "" ? Number(String(discVal).trim()) : undefined;
      const finalDisc = discNum !== undefined && Number.isFinite(discNum) && discNum >= 0 && discNum <= 100 && discNum !== 0 ? Math.round(discNum * 100) / 100 : undefined;
      if (finalDisc !== undefined) (out as any).finalDiscountPercent = finalDisc;
      else delete (out as any).finalDiscountPercent;
      if (c) {
        out.markup = c.markup;
        out.finalRate = c.finalRate;
        if (finalize) out.finalizedAt = new Date().toISOString();
      }
      // Optional management remark: appended to the item thread (the
      // server keeps client remark entries, crediting the writer's role),
      // so Sales sees it under the decided rate.
      const remark = (remarks[i] ?? "").trim();
      if (remark) {
        out.thread = [
          ...(it.thread ?? []),
          { by: "management" as const, kind: "remark" as const, text: remark.slice(0, 500), at: new Date().toISOString() },
        ];
      }
      return out;
    });

  const dropRate = (i: number, ri: number) => {
    void onSave(
      items.map((it, j) => (j === i ? { ...it, rates: (it.rates ?? []).filter((_, k) => k !== ri) } : it)),
      false,
    );
  };

  // Management-internal sourcing: add the internally-obtained rate directly
  // (vendor = management's own source). Markup + finalize continue as usual.
  const addInternalRate = async (i: number, rate: EnquiryItemRate) => {
    setSaveError(null);
    try {
      await onSave(
        items.map((it, j) => (j === i ? { ...it, rates: [...(it.rates ?? []), rate] } : it)),
        false,
      );
    } catch (e: any) {
      setSaveError(e?.message || "Save failed — please retry.");
    }
  };

  // Take an item into management-internal sourcing (leaves the procurement
  // queue), or return it. Saves immediately; markup flow continues.
  const toggleInternal = (i: number, next: boolean) => {
    setSaveError(null);
    const at = new Date().toISOString();
    void (async () => {
      try {
        await onSave(
          items.map((it, j) => (j === i ? { ...it, internalRates: next, internalRatesAt: next ? at : undefined } : it)),
          false,
        );
      } catch (e: any) {
        setSaveError(e?.message || "Save failed — please retry.");
      }
    })();
  };

  const submitRequest = (i: number) => {
    setReqs((prev) => ({ ...prev, [i]: reqNote.trim() }));
    setReqOpen(null);
    setReqNote("");
  };

  const checkedIdx = items
    .map((it, i) => ({ it, i }))
    .filter(({ it, i }) => checked[i] && !it.specIssue && !it.rateAvailable)
    .map(({ i }) => i);

  const applyBulkMargin = () => {
    const p = parseMoneyInput(bulkPct);
    if (p === null) { setBulkError("Enter a valid margin %."); return; }
    if (checkedIdx.length === 0) { setBulkError("Select items first."); return; }
    setBulkError(null);
    setPctInputs((prev) => {
      const next = { ...prev };
      for (const i of checkedIdx) next[i] = String(p);
      return next;
    });
    setModes((prev) => {
      const next = { ...prev };
      for (const i of checkedIdx) next[i] = "percent";
      return next;
    });
  };

  const applyBulkTotal = () => {
    const total = parseMoneyInput(bulkTotal);
    if (total === null) { setBulkError("Enter a valid combined final ₹."); return; }
    if (checkedIdx.length === 0) { setBulkError("Select items first."); return; }
    const weights = checkedIdx.map((i) => {
      const ri = selRateIdx(i, items[i]);
      return ri === undefined ? undefined : (items[i].rates ?? [])[ri]?.rate;
    });
    if (weights.some((w) => w === undefined)) {
      setBulkError("Select a vendor for every checked item first.");
      return;
    }
    const sum = (weights as number[]).reduce((a, b) => a + b, 0);
    if (!(sum > 0)) { setBulkError("Vendor rates must be above zero."); return; }
    setBulkError(null);
    setFinalInputs((prev) => {
      const next = { ...prev };
      checkedIdx.forEach((idx, k) => {
        next[idx] = String(Math.round(((total * (weights as number[])[k]) / sum) * 100) / 100);
      });
      return next;
    });
    setModes((prev) => {
      const next = { ...prev };
      for (const i of checkedIdx) next[i] = "final";
      return next;
    });
  };

  const doSave = async (finalize: boolean) => {
    setBusy(true);
    setSaveError(null);
    setSavedTick(false);
    try {
      await onSave(buildItems(finalize), finalize);
      // Success: drop the just-saved drafts so the panel shows stored truth.
      setPctInputs({});
      setFinalInputs({});
      setDiscountInputs({});
      setSalesNotes({});
      setModes({});
      setReqs({});
      setReqOpen(null);
      setRemarks({});
      setRemarkOpen(null);
      setRevise({});
      setSavedTick(true);
    } catch (e: any) {
      setSaveError(e?.message || "Save failed — please retry.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-500/20 bg-[#111726]/80 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-white">💼 Rate Review — {enquiry.estNumber || "—"}</h3>
        <span className={`px-2 py-0.5 text-[10px] rounded-full font-extrabold uppercase tracking-wide border ${
          finalized
            ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
            : "text-amber-400 bg-amber-500/10 border-amber-500/30"
        }`}>
          {RATE_STATUS_LABEL[enquiry.rateStatus ?? ""] ?? "Rate Pending"}
        </span>
      </div>

      {(() => {
        const decided = items
          .map((it, i) => ({ it, i }))
          .filter(({ it }) => it.finalRate !== undefined && it.finalRate !== null);
        if (decided.length === 0) return null;
        return (
          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <button type="button" onClick={() => setShowClosed((o) => !o)}
              className="w-full flex items-center gap-2 px-3 py-2.5 cursor-pointer bg-transparent border-0 text-left hover:bg-zinc-800/40">
              <svg className={`w-4 h-4 text-zinc-500 transition-transform flex-shrink-0 ${showClosed ? "rotate-90" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500">
                Closed — decision made ({decided.length})
              </span>
            </button>
            {showClosed && (
              <ul className="border-t border-zinc-800 divide-y divide-zinc-800/60">
                {decided.map(({ it, i }) => {
                  const selRow = typeof (it as any).selectedRateIdx === "number"
                    ? (it.rates ?? [])[(it as any).selectedRateIdx]
                    : undefined;
                  const vRate = (selRow ?? (it.rates ?? []).find((r) => r.vendor === (it.selectedVendor ?? "")))?.rate;
                  return (
                    <li key={i} className="px-3 py-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
                      <span className="font-extrabold text-zinc-200">
                        Item {i + 1}{it.name ? ` — ${it.name}` : ""}
                      </span>
                      {it.qty && <span className="text-zinc-500 font-semibold">× {it.qty}</span>}
                      <span className="ml-auto font-mono text-zinc-400">
                        {it.selectedVendor ? `${it.selectedVendor} · ` : ""}{vRate !== undefined ? `₹${Number(vRate).toLocaleString("en-IN")} → ` : ""}
                        <span className="font-extrabold text-emerald-400">₹{Number(it.finalRate).toLocaleString("en-IN")}</span>
                      </span>
                      {(it as any).finalDiscountPercent ? (
                        <span className="text-zinc-500">{String((it as any).finalDiscountPercent)}% off</span>
                      ) : null}
                      {it.finalizedAt && (
                        <span className="text-zinc-600">{historyDateChip(it.finalizedAt)}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })()}

      {items.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">No items on this enquiry yet.</p>
      ) : (
        <div className="space-y-3">
          {items.some((it) => it.specIssue) && (
            <p className="text-[11px] font-semibold text-amber-400/90">
              {items.filter((it) => it.specIssue).length} item{items.filter((it) => it.specIssue).length === 1 ? "" : "s"} held — spec correction with Sales, shown below read-only (no rate actions until fixed).
            </p>
          )}
          {items.some((it) => it.rateAvailable) && (
            <p className="text-[11px] font-semibold text-zinc-500">
              {items.filter((it) => it.rateAvailable).length} item{items.filter((it) => it.rateAvailable).length === 1 ? "" : "s"} with available rates — skipped (no decision needed).
            </p>
          )}
          <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-2.5 space-y-2">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-300">Bulk — {checkedIdx.length} selected</p>
            {locked ? (
              <p className="text-[11px] text-zinc-500">Locked — decisions are committed.</p>
            ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input value={bulkPct} onChange={(e) => setBulkPct(e.target.value)} placeholder="Margin %"
                inputMode="decimal"
                className="w-24 px-2 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
              <button type="button" onClick={applyBulkMargin}
                className="px-3 py-1.5 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 font-bold text-[11px] rounded-lg cursor-pointer border-0">
                Apply margin
              </button>
              <input value={bulkTotal} onChange={(e) => setBulkTotal(e.target.value)} placeholder="Combined final ₹"
                inputMode="decimal"
                className="w-36 px-2 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
              <button type="button" onClick={applyBulkTotal}
                className="px-3 py-1.5 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 font-bold text-[11px] rounded-lg cursor-pointer border-0">
                Split final
              </button>
            </div>
            )}
            {bulkError && <p className="text-[11px] font-semibold text-red-400">{bulkError}</p>}
          </div>
          {items.map((it, i) => {
            // Held for a sales spec correction: visible read-only (spec +
            // procurement's flag reason) so Management sees what's stuck and
            // why — no vendor, markup, or request actions until Sales fixes it.
            if (it.specIssue) {
              return (
                <div key={i} className="rounded-xl border border-red-500/25 bg-red-500/5 p-3 space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-xs font-extrabold text-white">
                      Item {i + 1}{it.name ? ` — ${it.name}` : ""}
                    </span>
                    {it.qty && (
                      <span className="text-[11px] text-zinc-400 font-semibold">Qty: {it.qty}</span>
                    )}
                    <span className="ml-auto px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-red-500/10 text-red-400 border-red-500/30">
                      Held with sales
                    </span>
                  </div>
                  {it.spec && (
                    <p className="text-xs text-zinc-300 font-medium whitespace-pre-wrap leading-relaxed">{it.spec}</p>
                  )}
                  <div className="rounded-lg border border-red-500/30 bg-black/20 p-2.5 text-[11px] leading-relaxed">
                    <p className="font-extrabold text-red-400 uppercase tracking-wide text-[10px]">Procurement flagged incorrect spec</p>
                    <p className="mt-0.5 text-zinc-300 whitespace-pre-wrap">{it.specIssue}</p>
                    <p className="mt-1 text-zinc-500">
                      Flagged {historyDateChip(it.specFlaggedAt) || "recently"} · releases automatically when Sales edits the spec.
                    </p>
                  </div>
                  <FlagThread thread={it.thread ?? []} tone="dark" />
                </div>
              );
            }
            if (it.rateAvailable) return null; // rate already available — skips Management entirely
            // Management-internal with no rate yet: enter the sourced rate
            // here, then mark up + finalize as usual. (Rated internal items
            // render through the standard flow below.)
            if (it.internalRates && (it.rates ?? []).length === 0 && !locked) {
              return (
                <div key={i} className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-xs font-extrabold text-white">
                      Item {i + 1}{it.name ? ` — ${it.name}` : ""}
                    </span>
                    {it.qty && (
                      <span className="text-[11px] text-zinc-400 font-semibold">Qty: {it.qty}</span>
                    )}
                    <span className="ml-auto px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-violet-500/10 text-violet-400 border-violet-500/30">
                      Internal — management
                    </span>
                  </div>
                  {it.spec && (
                    <p className="text-xs text-zinc-300 font-medium whitespace-pre-wrap leading-relaxed">{it.spec}</p>
                  )}
                  <FlagThread thread={it.thread ?? []} tone="dark" />
                  <ItemRateForm
                    submitLabel="Add internal rate"
                    onAdd={(rate) => void addInternalRate(i, rate)}
                  />
                  <p className="text-[10px] text-zinc-500">Rate sourced by management — markup and finalize continue below once added.</p>
                  <button type="button" onClick={() => toggleInternal(i, false)}
                    className="px-2 py-1 bg-transparent border-0 text-[11px] font-bold text-violet-400 hover:text-violet-300 cursor-pointer">
                    ← Return to procurement instead
                  </button>
                </div>
              );
            }
            const rates = it.rates ?? [];
            const ri = selRateIdx(i, it);
            const rate = ri === undefined ? undefined : rates[ri]?.rate;
            const mode: MarkupMode = modes[i] ?? "percent";
            const computed = computeItem(i, it);
            const preview = computed ? computed.finalRate : null;
            const wasRounded = !!computed && computed.unrounded !== computed.finalRate;
            const isItemLocked = it.finalRate !== undefined && it.finalRate !== null && !revise[i];
            return (
              <div key={i} className="rounded-xl border border-zinc-800 p-3 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                    {!isItemLocked && (
                    <input type="checkbox" checked={!!checked[i]}
                      onChange={() => setChecked((prev) => ({ ...prev, [i]: !prev[i] }))}
                      className="accent-indigo-500 h-3.5 w-3.5 flex-shrink-0" />
                    )}
                    <span className="text-xs font-extrabold text-white truncate">Item {i + 1}{it.name ? ` — ${it.name}` : ""}</span>
                  {it.internalRates && (
                    <span className="px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-violet-500/10 text-violet-400 border-violet-500/30 flex-shrink-0">
                      Internal
                    </span>
                  )}
                  </label>
                  {it.qty && <span className="text-[11px] text-zinc-400 font-semibold flex-shrink-0">Qty: {it.qty}</span>}
                </div>
                {it.spec && (
                  <p className="text-xs text-zinc-300 font-medium whitespace-pre-wrap leading-relaxed">{it.spec}</p>
                )}
                <FlagThread thread={it.thread ?? []} tone="dark" />
                {(it as any).expectedRate !== undefined && (it as any).expectedRate !== null && (
                  <p className="text-[11px] font-extrabold text-sky-400">
                    🎯 Client expects ₹{Number((it as any).expectedRate).toLocaleString("en-IN")}
                    {(it as any).expectedNote ? ` — ${String((it as any).expectedNote)}` : ""}
                  </p>
                )}
                {rates.length === 0 ? (
                  <p className="text-[11px] text-zinc-500 italic">No vendor rates yet — procurement adds them per item.</p>
                ) : (
                  <div className="space-y-1">
                    {rates.map((r, rj) => (
                      <label key={rj} className={`flex items-start gap-2 text-[11px] rounded-lg border border-transparent p-1.5 ${isItemLocked ? "opacity-60" : "cursor-pointer has-checked:border-indigo-500/40 has-checked:bg-indigo-500/5"}`}>
                        <input
                          type="radio"
                          name={`vendor-${enquiry.id}-${i}`}
                          checked={ri === rj}
                          disabled={isItemLocked}
                          onChange={() => {
                            setSel((prev) => ({ ...prev, [i]: rj }));
                            // Switching rows drops the other row's note draft —
                            // otherwise it would stamp onto this row at save.
                            setSalesNotes((prev) => {
                              if (prev[i] === undefined) return prev;
                              const n = { ...prev };
                              delete n[i];
                              return n;
                            });
                          }}
                          className="accent-indigo-500 mt-0.5 disabled:opacity-50"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-zinc-200 font-semibold">{r.vendor}</span>
                            {r.specSame === false && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-amber-500/10 text-amber-400 border border-amber-500/30">Spec differs</span>
                            )}
                            <span className="font-mono text-zinc-400">₹{Number(r.rate).toLocaleString("en-IN")}</span>
                            {(it as any).expectedRate !== undefined && (it as any).expectedRate !== null && Number(r.rate) <= Number((it as any).expectedRate) && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">✓ within target</span>
                            )}
                            {(r as any).discountPercent !== undefined && (r as any).discountPercent !== null && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">{String((r as any).discountPercent)}% vendor off</span>
                            )}
                            {ri === rj ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-indigo-500/10 text-indigo-300 border border-indigo-500/30" title="The quoted rate — always shown to sales">Quoted ✓</span>
                            ) : !isItemLocked && (
                              <button type="button"
                                onClick={() => {
                                  const k = shareKey(i, r);
                                  setShareToggled((prev) => ({ ...prev, [k]: !(prev[k] ?? (r as any)?.sharedWithSales === true) }));
                                }}
                                title="Show this quote to sales as an alternate option beside the quoted rate"
                                className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide border cursor-pointer ${(shareToggled[shareKey(i, r)] ?? (r as any)?.sharedWithSales === true) ? "bg-sky-500/10 text-sky-300 border-sky-500/30" : "bg-transparent text-zinc-500 border-zinc-700 hover:text-zinc-300"}`}>
                                {(shareToggled[shareKey(i, r)] ?? (r as any)?.sharedWithSales === true) ? "Shared ✓" : "Share with sales"}
                              </button>
                            )}
                 {(!locked || revise[i] || it.finalRate === undefined || it.finalRate === null) && (
                               <button type="button" onClick={() => dropRate(i, rj)} title="Remove incorrect rate"
                                className="text-zinc-600 hover:text-red-400 font-bold cursor-pointer bg-transparent border-0 flex-shrink-0 px-0.5">×</button>
                            )}
                          </span>
                          {r.description && (
                            <span className="block text-zinc-500 whitespace-pre-wrap leading-relaxed mt-0.5">{r.description}</span>
                          )}
                          {r.specSame === false && r.specDiff && (
                            <span className="block text-amber-400/90 whitespace-pre-wrap leading-relaxed mt-0.5">
                              <span className="font-bold">Their spec: </span>{r.specDiff}
                            </span>
                          )}
                          {(r.references ?? []).length > 0 && (
                            <span className="flex flex-wrap gap-1.5 mt-1">
                              {(r.references ?? []).map((m, mi) => (
                                m.type === "video" ? (
                                  <video key={mi} src={m.url} controls preload="metadata" className="w-20 h-12 rounded-lg object-cover border border-zinc-700 bg-black" />
                                ) : m.type === "pdf" ? (
                                  <a key={mi} href={m.url} download={m.name || `vendor-ref-${mi + 1}.pdf`} onClick={(e) => e.stopPropagation()}
                                    className="px-2 py-1.5 rounded-lg border border-zinc-700 bg-red-500/10 hover:bg-red-500/20 transition-colors text-[10px] font-bold text-zinc-200 truncate max-w-[8rem]">
                                    {m.name || "PDF"}
                                  </a>
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img key={mi} src={m.url} alt={`Vendor reference ${mi + 1}`} className="w-12 h-12 rounded-lg object-cover border border-zinc-700" />
                                )
                              ))}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {ri !== undefined && !isItemLocked && (
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-emerald-300 uppercase tracking-wider">Note for sales (forwarded with final rate)</label>
                    <textarea
                      value={salesNotes[i] ?? (rates[ri] as any)?.salesNote ?? ""}
                      onChange={(e) => setSalesNotes((prev) => ({ ...prev, [i]: e.target.value }))}
                      placeholder="Forwarded to sales when this vendor is selected — e.g. delivery terms, warranty, validity…"
                      rows={2}
                      className="w-full px-2.5 py-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-y"
                    />
                    <p className="text-[10px] text-zinc-500">Procurement's draft shows here — edit before finalizing, sales sees only the selected vendor's note.</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  {isItemLocked ? (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 space-y-1.5">
                      <p className="text-[11px] font-extrabold text-emerald-400">
                        {it.internalRates ? "Rate available internally" : "Rate Received"}: ₹{Number(it.finalRate).toLocaleString("en-IN")}
                        {(it as any).finalDiscountPercent ? ` · ${(it as any).finalDiscountPercent}% off` : ""}
                      </p>
                      {(() => {
                        const sr: any = ri !== undefined ? rates[ri] : rates.find((r) => r.vendor === (it.selectedVendor ?? ""));
                        const n = sr?.salesNote ? String(sr.salesNote).trim() : "";
                        const refs: any[] = sr?.references ?? [];
                        return (
                          <>
                            {n && <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{n}</p>}
                            {refs.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {refs.map((m: any, mi: number) => (
                                  m.type === "video" ? (
                                    <video key={mi} src={m.url} controls preload="metadata" className="w-20 h-12 rounded-lg object-cover border border-zinc-700 bg-black" />
                                  ) : m.type === "pdf" ? (
                                    <a key={mi} href={m.url} download={m.name || `vendor-ref-${mi + 1}.pdf`} className="px-2 py-1.5 rounded-lg border border-zinc-700 bg-red-500/10 text-[10px] font-bold truncate max-w-[8rem]">Reference PDF</a>
                                  ) : (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img key={mi} src={m.url} alt={`Vendor reference ${mi + 1}`} className="w-12 h-12 rounded-lg object-cover border border-zinc-700" />
                                  )
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                      <p className="text-[10px] text-zinc-500">Committed — sales sees this rate.{(it as any).finalDiscountPercent ? ` Discount ${String((it as any).finalDiscountPercent)}% applied.` : ""}</p>
                      {locked ? (
                        <button type="button" onClick={() => setRevise((prev) => ({ ...prev, [i]: true }))}
                          className="px-2.5 py-1.5 bg-transparent border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 font-bold text-[11px] rounded-lg cursor-pointer">
                          Revise — override with another rate
                        </button>
                      ) : (
                        <button type="button" onClick={() => setRevise((prev) => ({ ...prev, [i]: true }))}
                          className="px-2.5 py-1.5 bg-transparent border border-zinc-600 text-zinc-400 hover:bg-zinc-700/40 font-bold text-[11px] rounded-lg cursor-pointer">
                          Revise
                        </button>
                      )}
                    </div>
                  ) : (
                  <>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1">
                      <input
                        value={discountInputs[i] ?? ""}
                        onChange={(e) => setDiscountInputs((prev) => ({ ...prev, [i]: e.target.value }))}
                        placeholder="Disc. %"
                        inputMode="decimal"
                        className="w-20 px-2 py-1 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                      />
                      <span className="text-[11px] font-bold text-zinc-400">% off</span>
                    </div>
                    <div className="flex rounded-lg border border-zinc-700 overflow-hidden text-[11px] font-bold">
                      <button type="button"
                        onClick={() => setModes((prev) => ({ ...prev, [i]: "percent" }))}
                        className={`px-2.5 py-1.5 cursor-pointer border-0 ${mode === "percent" ? "bg-indigo-600 text-white" : "bg-transparent text-zinc-400"}`}>
                        % Markup
                      </button>
                      <button type="button"
                        onClick={() => setModes((prev) => ({ ...prev, [i]: "final" }))}
                        className={`px-2.5 py-1.5 cursor-pointer border-0 ${mode === "final" ? "bg-indigo-600 text-white" : "bg-transparent text-zinc-400"}`}>
                        Final ₹
                      </button>
                    </div>
                    {mode === "percent" ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={pctInputs[i] ?? ""}
                          onChange={(e) => setPctInputs((prev) => ({ ...prev, [i]: e.target.value }))}
                          placeholder="30"
                          inputMode="decimal"
                          className="w-20 px-2 py-1 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                        />
                        <span className="text-[11px] font-bold text-zinc-400">%</span>
                      </div>
                    ) : (
                      <input
                        value={finalInputs[i] ?? ""}
                        onChange={(e) => setFinalInputs((prev) => ({ ...prev, [i]: e.target.value }))}
                        placeholder="Final price ₹"
                        inputMode="decimal"
                        className="w-32 px-2 py-1 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                      />
                    )}
                    {preview !== null && (
                      <span className="text-[11px] font-extrabold text-emerald-400">
                        Final: {fmtINR(preview)}{wasRounded ? " (rounded ↑)" : ""}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const disc = discountFor(i, it);
                    const discBase = rate !== undefined ? rate * (1 - (disc || 0) / 100) : undefined;
                    return (
                      <>
                        {disc > 0 && rate !== undefined && discBase !== undefined && (
                          <p className="text-[10px] text-emerald-400/80">{fmtINR(rate)} − {disc}% = {fmtINR(discBase)} discounted base</p>
                        )}
                        {mode === "percent" && discBase !== undefined && preview !== null && computed && (
                          <p className="text-[10px] text-zinc-500">
                            {fmtINR(discBase)} + {fmtINR(computed.markup)} markup{disc > 0 ? " (after discount)" : ""}
                          </p>
                        )}
                        {mode === "final" && discBase !== undefined && preview !== null && computed && (
                          <p className="text-[10px] text-zinc-500">
                            Markup derived: {fmtINR(computed.markup)} over {fmtINR(discBase)}{disc > 0 ? " (discounted)" : ""}
                          </p>
                        )}
                      </>
                    );
                  })()}
                  {(finalized || sent) && it.finalRate !== undefined && it.finalRate !== null && (
                    <span className="block text-[11px] text-zinc-500">Locked at {fmtINR(it.finalRate)}</span>
                  )}
                  {(it.ratesRequested || reqs[i]) && (
                    <p className="text-[10px] font-semibold text-indigo-400">
                      Rates requested from procurement{it.ratesRequested && it.ratesRequested !== "requested" ? `: ${it.ratesRequested}` : "…"}
                    </p>
                  )}
                  {revise[i] && (
                    <button type="button" onClick={() => setRevise((prev) => ({ ...prev, [i]: false }))}
                      className="px-2.5 py-1.5 bg-transparent border-0 text-[11px] font-bold text-zinc-500 hover:text-zinc-300 cursor-pointer">
                      Cancel revise — keep previous rate
                    </button>
                  )}
                  </>
                  )}
                </div>
                {(!locked || revise[i]) && (
                <div className="flex flex-wrap items-center gap-2">
                  {reqOpen === i ? (
                    <div className="flex-1 min-w-[12rem] space-y-1.5 rounded-lg border border-dashed border-indigo-500/40 p-2">
                      <input
                        value={reqNote}
                        onChange={(e) => setReqNote(e.target.value)}
                        placeholder="What is wrong / which vendor? (optional)"
                        className="w-full px-2 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                      />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => submitRequest(i)}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] rounded-lg cursor-pointer border-0">
                          Flag procurement
                        </button>
                        <button type="button" onClick={() => { setReqOpen(null); setReqNote(""); }}
                          className="px-3 py-1.5 font-bold text-[11px] rounded-lg cursor-pointer border-0 bg-transparent text-zinc-400 hover:text-zinc-200">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setReqOpen(i); setReqNote(""); }}
                      className="px-2.5 py-1.5 bg-transparent border border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10 font-bold text-[11px] rounded-lg cursor-pointer">
                      Flag procurement
                    </button>
                  )}
                  {it.internalRates ? (
                    <button type="button" onClick={() => toggleInternal(i, false)}
                      title="Return this item to the procurement queue"
                      className="px-2.5 py-1.5 bg-transparent border border-violet-500/40 text-violet-400 hover:bg-violet-500/10 font-bold text-[11px] rounded-lg cursor-pointer">
                      Return to procurement
                    </button>
                  ) : (
                    <button type="button" onClick={() => toggleInternal(i, true)}
                      title="Management sources this item's rates itself — leaves the procurement queue"
                      className="px-2.5 py-1.5 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 font-bold text-[11px] rounded-lg cursor-pointer border-0">
                      Handle internally
                    </button>
                  )}
                  {remarkOpen === i ? (
                    <div className="flex-1 min-w-[12rem] space-y-1.5 rounded-lg border border-dashed border-zinc-600 p-2">
                      <input
                        value={remarks[i] ?? ""}
                        onChange={(e) => setRemarks((prev) => ({ ...prev, [i]: e.target.value }))}
                        placeholder="Remark for sales, saved with the rates (optional)…"
                        className="w-full px-2 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                      />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setRemarkOpen(null)}
                          className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 font-bold text-[11px] rounded-lg cursor-pointer border-0">
                          Done
                        </button>
                        <button type="button" onClick={() => { setRemarks((prev) => ({ ...prev, [i]: "" })); setRemarkOpen(null); }}
                          className="px-3 py-1.5 font-bold text-[11px] rounded-lg cursor-pointer border-0 bg-transparent text-zinc-400 hover:text-zinc-200">
                          Clear
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setRemarkOpen(i)}
                      className="px-2.5 py-1.5 bg-transparent border border-zinc-600 text-zinc-400 hover:bg-zinc-700/40 font-bold text-[11px] rounded-lg cursor-pointer">
                      Add remark{(remarks[i] ?? "").trim() ? " ✓" : ""}
                    </button>
                  )}
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void doSave(false)}
          disabled={busy || actionableCount === 0 || (locked && !canSaveLocked)}
          className="px-4 py-2 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40"
        >
          {busy ? "Saving…" : revisingLocked ? "Save revised rate" : "Save rates"}
        </button>
        {(!locked || canSaveLocked) && actionableIdx.length > 0 && (
          <span className={`text-[11px] font-bold ${allDecided ? "text-emerald-400" : "text-zinc-500"}`}>
            Decided {decidedCount} of {actionableIdx.length}
            {allDecided ? " — ready to finalize." : " — decide every item to unlock Finalize."}
          </span>
        )}
        {saveError && (
          <span className="text-[11px] font-semibold text-red-400">{saveError}</span>
        )}
        {savedTick && !saveError && (
          <span className="text-[11px] font-extrabold text-emerald-400">Saved ✓</span>
        )}
        {(!locked || canSaveLocked) ? (
          confirming ? (
            <>
              <button
                onClick={() => void doSave(true)}
                disabled={busy || !allDecided}
                title={allDecided ? undefined : `Decide all ${actionableIdx.length} items first (${decidedCount} of ${actionableIdx.length} decided)`}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                Confirm finalize
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={busy || actionableCount === 0 || !allDecided}
              title={allDecided || actionableCount === 0 ? undefined : `Decide all ${actionableIdx.length} items first (${decidedCount} of ${actionableIdx.length} decided)`}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {revisingLocked ? "Finalize revised rate" : "Finalize rates"}
            </button>
          )
        ) : (
          <span className="text-[11px] text-emerald-400 font-semibold">
            {sent ? "Sent to client — locked." : "Rates finalized — Sales sees them live."}
          </span>
        )}
      </div>
    </div>
  );
}
