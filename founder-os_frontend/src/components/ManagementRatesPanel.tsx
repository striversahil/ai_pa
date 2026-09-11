"use client";

import React, { useState, useEffect } from "react";
import type { Enquiry, EnquiryItem } from "@/types";
import { parseMoneyInput } from "@/types";

export const RATE_STATUS_LABEL: Record<string, string> = {
  "": "Rate Pending",
  rate_pending: "Rate Pending",
  rates_received: "Rates Received",
  finalized: "Finalized",
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
  const [sel, setSel] = useState<Record<number, string>>({});
  const [modes, setModes] = useState<Record<number, MarkupMode>>({});
  const [pctInputs, setPctInputs] = useState<Record<number, string>>({});
  const [finalInputs, setFinalInputs] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);
  // Rate-requests back to procurement (incorrect quote / different vendor
  // needed): per-item note overrides applied at save time.
  const [reqs, setReqs] = useState<Record<number, string | null>>({});
  const [reqOpen, setReqOpen] = useState<number | null>(null);
  const [reqNote, setReqNote] = useState("");

  useEffect(() => {
    const s: Record<number, string> = {};
    const p: Record<number, string> = {};
    const f: Record<number, string> = {};
    items.forEach((it, i) => {
      if (it.selectedVendor) s[i] = it.selectedVendor;
      const rate = (it.rates ?? []).find((r) => r.vendor === (it.selectedVendor ?? ""))?.rate;
      if (it.markup !== undefined && it.markup !== null && rate) {
        const pct = (Number(it.markup) / rate) * 100;
        if (Number.isFinite(pct)) p[i] = String(Math.round(pct * 100) / 100);
      }
      if (it.finalRate !== undefined && it.finalRate !== null) f[i] = String(it.finalRate);
    });
    setSel(s);
    setModes({});
    setPctInputs(p);
    setFinalInputs(f);
    setReqs({});
    setReqOpen(null);
    setReqNote("");
    setConfirming(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enquiry.id]);

  const finalized = enquiry.rateStatus === "finalized";
  // Rate-available items skip the loop entirely: never shown, never touched,
  // never counted here (same rule as the pending queue predicate).
  const actionableCount = items.filter((it) => !it.specIssue && !it.rateAvailable).length;

  const vendorRate = (idx: number, vendor: string): number | undefined =>
    items[idx] ? (items[idx].rates ?? []).find((r) => r.vendor === vendor)?.rate : undefined;

  /** Effective { markup, finalRate } for item i under its current mode.
   *  Null when nothing is entered and nothing was stored (preserve as-is). */
  const computeItem = (i: number, it: EnquiryItem): { markup: number; finalRate: number; unrounded: number } | null => {
    const vendor = sel[i] ?? it.selectedVendor ?? "";
    const rate = vendorRate(i, vendor);
    const mode: MarkupMode = modes[i] ?? "percent";
    if (mode === "final") {
      const raw = finalInputs[i];
      const f = raw !== undefined && raw.trim() !== ""
        ? parseMoneyInput(raw)
        : (it.finalRate !== undefined && it.finalRate !== null ? Number(it.finalRate) : NaN);
      if (f === null || !Number.isFinite(f) || f < 0) return null;
      const final = ceil5(f);
      return { markup: rate !== undefined ? final - rate : final, finalRate: final, unrounded: f };
    }
    const raw = pctInputs[i];
    const p = raw !== undefined && raw.trim() !== ""
      ? parseMoneyInput(raw)
      : (it.markup !== undefined && it.markup !== null && rate ? (Number(it.markup) / rate) * 100 : NaN);
    if (p === null || !Number.isFinite(p) || rate === undefined) return null;
    const unrounded = rate * (1 + p / 100);
    const final = ceil5(unrounded);
    return { markup: final - rate, finalRate: final, unrounded };
  };

  const buildItems = (finalize: boolean): EnquiryItem[] =>
    items.map((it, i) => {
      // Held for a sales spec correction, or rate already available: never
      // touched here, never finalized.
      if (it.specIssue || it.rateAvailable) return { ...it };
      const vendor = sel[i] ?? it.selectedVendor ?? "";
      const out: EnquiryItem = { ...it, selectedVendor: vendor || undefined };
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
      if (c) {
        out.markup = c.markup;
        out.finalRate = c.finalRate;
        if (finalize) out.finalizedAt = new Date().toISOString();
      }
      return out;
    });

  const dropRate = (i: number, ri: number) => {
    void onSave(
      items.map((it, j) => (j === i ? { ...it, rates: (it.rates ?? []).filter((_, k) => k !== ri) } : it)),
      false,
    );
  };

  const submitRequest = (i: number) => {
    setReqs((prev) => ({ ...prev, [i]: reqNote.trim() }));
    setReqOpen(null);
    setReqNote("");
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
      setModes({});
      setReqs({});
      setReqOpen(null);
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

      {items.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">No items on this enquiry yet.</p>
      ) : (
        <div className="space-y-3">
          {items.some((it) => it.specIssue) && (
            <p className="text-[11px] font-semibold text-amber-400/90">
              {items.filter((it) => it.specIssue).length} item{items.filter((it) => it.specIssue).length === 1 ? "" : "s"} held — spec correction with Sales (shown again once fixed).
            </p>
          )}
          {items.some((it) => it.rateAvailable) && (
            <p className="text-[11px] font-semibold text-zinc-500">
              {items.filter((it) => it.rateAvailable).length} item{items.filter((it) => it.rateAvailable).length === 1 ? "" : "s"} with available rates — skipped (no decision needed).
            </p>
          )}
          {items.map((it, i) => {
            if (it.specIssue) return null; // held out — only correct-spec items are shown
            if (it.rateAvailable) return null; // rate already available — skips Management entirely
            const rates = it.rates ?? [];
            const vendor = sel[i] ?? it.selectedVendor ?? "";
            const rate = rates.find((r) => r.vendor === vendor)?.rate;
            const mode: MarkupMode = modes[i] ?? "percent";
            const computed = computeItem(i, it);
            const preview = computed ? computed.finalRate : null;
            const wasRounded = !!computed && computed.unrounded !== computed.finalRate;
            return (
              <div key={i} className="rounded-xl border border-zinc-800 p-3 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-extrabold text-white">Item {i + 1}{it.name ? ` — ${it.name}` : ""}</span>
                  {it.qty && <span className="text-[11px] text-zinc-400 font-semibold">Qty: {it.qty}</span>}
                </div>
                {rates.length === 0 ? (
                  <p className="text-[11px] text-zinc-500 italic">No vendor rates yet — procurement adds them per item.</p>
                ) : (
                  <div className="space-y-1">
                    {rates.map((r, ri) => (
                      <label key={ri} className="flex items-start gap-2 text-[11px] cursor-pointer rounded-lg border border-transparent has-checked:border-indigo-500/40 has-checked:bg-indigo-500/5 p-1.5">
                        <input
                          type="radio"
                          name={`vendor-${enquiry.id}-${i}`}
                          checked={vendor === r.vendor}
                          onChange={() => setSel((prev) => ({ ...prev, [i]: r.vendor }))}
                          className="accent-indigo-500 mt-0.5"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-zinc-200 font-semibold">{r.vendor}</span>
                            {r.specSame === false && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-amber-500/10 text-amber-400 border border-amber-500/30">Spec differs</span>
                            )}
                            <span className="font-mono text-zinc-400">₹{Number(r.rate).toLocaleString("en-IN")}</span>
                            {!finalized && (
                              <button type="button" onClick={() => dropRate(i, ri)} title="Remove incorrect rate"
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
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
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
                  {mode === "percent" && rate !== undefined && preview !== null && computed && (
                    <p className="text-[10px] text-zinc-500">
                      {fmtINR(rate)} + {fmtINR(computed.markup)} markup
                    </p>
                  )}
                  {mode === "final" && rate !== undefined && preview !== null && computed && (
                    <p className="text-[10px] text-zinc-500">
                      Markup derived: {fmtINR(computed.markup)} over {fmtINR(rate)}
                    </p>
                  )}
                  {finalized && it.finalRate !== undefined && it.finalRate !== null && (
                    <span className="block text-[11px] text-zinc-500">Locked at {fmtINR(it.finalRate)}</span>
                  )}
                  {(it.ratesRequested || reqs[i]) && (
                    <p className="text-[10px] font-semibold text-indigo-400">
                      Rates requested from procurement{it.ratesRequested && it.ratesRequested !== "requested" ? `: ${it.ratesRequested}` : "…"}
                    </p>
                  )}
                </div>
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
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void doSave(false)}
          disabled={busy || actionableCount === 0}
          className="px-4 py-2 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save rates"}
        </button>
        {saveError && (
          <span className="text-[11px] font-semibold text-red-400">{saveError}</span>
        )}
        {savedTick && !saveError && (
          <span className="text-[11px] font-extrabold text-emerald-400">Saved ✓</span>
        )}
        {!finalized ? (
          confirming ? (
            <>
              <button
                onClick={() => void doSave(true)}
                disabled={busy}
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
              disabled={busy || actionableCount === 0}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Finalize rates
            </button>
          )
        ) : (
          <span className="text-[11px] text-emerald-400 font-semibold">Rates finalized — Sales sees them live.</span>
        )}
      </div>
    </div>
  );
}
