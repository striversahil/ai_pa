"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEnquiryData } from "@/hooks/useEnquiryData";
import { useLiveEvent } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import ManagementRatesPanel from "@/components/ManagementRatesPanel";
import Modal from "@/components/Modal";
import { Table, thClass, tdClass } from "@/components/ui/Table";
import type { Enquiry } from "@/types";
import { enquiryLabel, historyDateChip } from "@/types";
import { itemNeedsDecision, isManagementPendingEnquiry, isManagementHistoryEnquiry, itemHasUnreviewedQuotes } from "@/enquiry/queue";

/** Only correct-spec, rate-UNAVAILABLE, rated-but-unfinalized items need a
 *  decision — flagged items stay with Sales until the spec is fixed, then
 *  flow back here. Rate-available items skip the loop entirely. */
export function isManagementPending(e: Enquiry): boolean {
  return isManagementPendingEnquiry(e);
}

// Management Review dashboard (mounted as the `enquiry-management`
// automation). TABULAR with queue tabs (Active / Unprocessed / History):
// one row per enquiry, click-to-open review modal carrying the complete
// information (client, requirements, all items clubbed with their rates,
// markup + finalize).
export default function ManagementReview() {
  const { me } = useAuth();
  const scopes = me?.scopes ?? [];
  const allowed = !!me && (me.isAdmin || scopes.includes("mis"));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Queue tabs: Active (awaiting decision) / Unprocessed (open work not yet
  // fully decided) / History (fully decided). Manual pick wins; otherwise
  // land on the first non-empty queue.
  type MgmtTab = "active" | "unprocessed" | "history";
  const [tabPick, setTabPick] = useState<MgmtTab | null>(null);

  const { enquiries, loaded, agents, updateEnquiry } =
    useEnquiryData("sales");

  // Live intimation: procurement logged fresh vendor rates (act on the item).
  const [toast, setToast] = useState<{ id: string; label: string; title: string } | null>(null);
  const ratesRef = useRef<Record<string, number>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    if (!loaded) return;
    for (const e of enquiries) {
      if (ratesRef.current[e.id] === undefined) {
        ratesRef.current[e.id] = (e.items ?? []).reduce((n, it) => n + (it.rates ?? []).length, 0);
      }
    }
  }, [loaded, enquiries]);
  useLiveEvent((e: any) => {
    // Scope-safe: live events carry summaries only — this is toast-only, the
    // full payload refetches in useEnquiryData.
    if (!e || e.type !== "enquiries") return;
    const s = e.summary ?? e.enquiry;
    if (!s) return;
    const id = String(s.id ?? e.id ?? e.enquiryId ?? "");
    if (!id) return;
    const raw = e.enquiry ?? {};
    const count = typeof s.ratesCount === "number"
      ? s.ratesCount
      : ((raw.items ?? []) as any[]).reduce((n, it) => n + ((it?.rates ?? []).length), 0);
    if (ratesRef.current[id] !== undefined && count > ratesRef.current[id]) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({
        id,
        label: enquiryLabel({ dailyNo: s.dailyNo ?? null, createdAt: s.createdAt ?? "", source: s.source ?? "TL" }),
        title: String(s.title || "Untitled enquiry"),
      });
      toastTimer.current = setTimeout(() => setToast(null), 10000);
    }
    ratesRef.current[id] = count;
  });

  const byActivity = (a: Enquiry, b: Enquiry): number =>
    String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? ""));
  const pending = useMemo(() => enquiries.filter(isManagementPending).sort(byActivity), [enquiries]);
  // Item-level count for the header badge (the table itself stays one row
  // per enquiry — quote detail lives in the modal).
  const pendingItemCount = useMemo(
    () => pending.reduce((n, e) => n + (e.items ?? []).filter(itemNeedsDecision).length, 0),
    [pending],
  );
  // History: fully decided enquiries — disjoint from pending, so a
  // partially-decided enquiry never appears twice.
  const historyEnquiries: Enquiry[] = useMemo(() => {
    return enquiries.filter(isManagementHistoryEnquiry).sort(byActivity);
  }, [enquiries]);
  // Unprocessed (new): everything not fully decided — includes items still
  // with procurement (e.g. Enq 3 - 18 SEP one line without rates) + partially
  // decided. Lets management see all open work at a glance.
  const unprocessedEnquiries: Enquiry[] = useMemo(() => {
    return enquiries.filter((e) => !isManagementHistoryEnquiry(e as any) && (e.items ?? []).length > 0).sort(byActivity);
  }, [enquiries]);
  // History search + pagination (like Daily Enquiries) — client/EST/title/item
  const [historySearch, setHistorySearch] = useState("");
  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return historyEnquiries;
    const qDigits = q.replace(/\D/g, "");
    return historyEnquiries.filter(e => {
      const hay = [
        e.clientCompany ?? "", e.title ?? "", e.estNumber ?? "", (e as any).enquiryNumber ?? "", (e as any).sourceLead ?? "", (e as any).location ?? "",
        e.contactName ?? "", (e as any).contactEmail ?? "", e.contactPhone ?? "", e.description ?? "", e.source ?? "", String(e.dailyNo ?? ""),
        ...((e.items ?? []) as any[]).flatMap((it: any) => [it?.name ?? "", it?.qty ?? "", it?.spec ?? "", it?.verbatim ?? "", ...((it?.rates ?? []).map((r:any)=> r?.vendor ?? ""))]),
        (agents ?? []).find((a:any)=> String(a.id)===String((e as any).assignedAgentId))?.name ?? "",
      ].join(" ").toLowerCase();
      if (hay.includes(q)) return true;
      if (qDigits.length >= 3 && (e.estNumber ?? "").replace(/\D/g,"").includes(qDigits)) return true;
      return false;
    });
  }, [historyEnquiries, historySearch, agents]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState<number>(50);
  const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
  useEffect(() => { setHistoryPage(1); }, [filteredHistory.length, historyPageSize, historySearch]);
  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / historyPageSize));
  const historyPageClamped = Math.min(historyPage, historyTotalPages);
  const visibleHistory = useMemo(() => filteredHistory.slice((historyPageClamped - 1) * historyPageSize, historyPageClamped * historyPageSize), [filteredHistory, historyPageClamped, historyPageSize]);
  // Unprocessed search + pagination (same UX as history)
  const [unprocessedSearch, setUnprocessedSearch] = useState("");
  const filteredUnprocessed = useMemo(() => {
    const q = unprocessedSearch.trim().toLowerCase();
    if (!q) return unprocessedEnquiries;
    const qDigits = q.replace(/\D/g, "");
    return unprocessedEnquiries.filter(e => {
      const hay = [
        e.clientCompany ?? "", e.title ?? "", e.estNumber ?? "", (e as any).enquiryNumber ?? "", (e as any).sourceLead ?? "", (e as any).location ?? "",
        e.contactName ?? "", (e as any).contactEmail ?? "", e.contactPhone ?? "", e.description ?? "", e.source ?? "", String(e.dailyNo ?? ""),
        ...((e.items ?? []) as any[]).flatMap((it: any) => [it?.name ?? "", it?.qty ?? "", it?.spec ?? "", it?.verbatim ?? "", ...((it?.rates ?? []).map((r:any)=> r?.vendor ?? ""))]),
        (agents ?? []).find((a:any)=> String(a.id)===String((e as any).assignedAgentId))?.name ?? "",
      ].join(" ").toLowerCase();
      if (hay.includes(q)) return true;
      if (qDigits.length >= 3 && (e.estNumber ?? "").replace(/\D/g,"").includes(qDigits)) return true;
      return false;
    });
  }, [unprocessedEnquiries, unprocessedSearch, agents]);
  const [unprocessedPage, setUnprocessedPage] = useState(1);
  const [unprocessedPageSize, setUnprocessedPageSize] = useState<number>(50);
  useEffect(() => { setUnprocessedPage(1); }, [filteredUnprocessed.length, unprocessedPageSize, unprocessedSearch]);
  const unprocessedTotalPages = Math.max(1, Math.ceil(filteredUnprocessed.length / unprocessedPageSize));
  const unprocessedPageClamped = Math.min(unprocessedPage, unprocessedTotalPages);
  const visibleUnprocessed = useMemo(() => filteredUnprocessed.slice((unprocessedPageClamped - 1) * unprocessedPageSize, unprocessedPageClamped * unprocessedPageSize), [filteredUnprocessed, unprocessedPageClamped, unprocessedPageSize]);

  const tab: MgmtTab = tabPick
    ?? (pending.length > 0 ? "active"
      : unprocessedEnquiries.length > 0 ? "unprocessed" : "history");
  const tabs: Array<{ id: MgmtTab; label: string; count: number }> = [
    { id: "active", label: "Active", count: pending.length },
    { id: "unprocessed", label: "Unprocessed", count: unprocessedEnquiries.length },
    { id: "history", label: "History", count: historyEnquiries.length },
  ];

  const leadName = useCallback((agentId: string) => {
    if (!agentId) return "";
    return (agents ?? []).find((a: any) => String(a.id) === String(agentId))?.name || "";
  }, [agents]);

  const handleSaveRates = useCallback(async (id: string, items: Enquiry["items"], finalize: boolean) => {
    await updateEnquiry(id, { items, ...(finalize ? { rateStatus: "finalized" } : {}) } as Partial<Enquiry>);
  }, [updateEnquiry]);

  // Sent-revision: reopen a `sent` enquiry for additional scope (MIS only).
  // The row drops to `finalized` with a revision marker — new items then loop
  // procurement → management → sent again instead of stranding invisible.
  const [reviseBusy, setReviseBusy] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);
  const handleRevise = useCallback(async (id: string) => {
    setReviseBusy(true);
    setReviseError(null);
    try {
      await updateEnquiry(id, { reviseSent: true } as any);
    } catch (e: any) {
      setReviseError(e?.message || "Reopen failed");
    } finally {
      setReviseBusy(false);
    }
  }, [updateEnquiry]);

  if (!allowed) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm font-semibold text-zinc-500 dark:text-zinc-400">
        Management access only.
      </div>
    );
  }

  if (!loaded) {
    return <div className="flex min-h-[50vh] items-center justify-center text-zinc-500 animate-pulse">Loading review queue…</div>;
  }

  const sel = selectedId ? enquiries.find((e) => e.id === selectedId) ?? null : null;

  // Club rows under their enquiry: header expands to the item table.
  // One row per enquiry — quote detail (vendors, markup inputs) lives in
  // the modal. Decided items never appear as rows; the progress column
  // keeps partial work visible ("2 of 5 decided").
  const itemNames = (e: Enquiry): string => {
    const names = (e.items ?? []).map((it, idx) => {
      const n = it.name || `Item ${idx + 1}`;
      return it.qty ? `${n} \u00d7 ${it.qty}` : n;
    });
    if (names.length === 0) return "\u2014";
    const shown = names.slice(0, 3).join(" \u00b7 ");
    return names.length > 3 ? `${shown} +${names.length - 3} more` : shown;
  };

  const loopProgress = (e: Enquiry): { done: number; total: number } => {
    const loop = (e.items ?? []).filter((it) => !it.specIssue && !it.rateAvailable);
    // Items with new unshared quotes since the decision still need a review
    // pass — never count them done while the row sits in Active.
    const done = loop.filter((it) => it.finalRate !== undefined && it.finalRate !== null && !itemHasUnreviewedQuotes(it as any)).length;
    return { done, total: loop.length };
  };

  const renderEnquiryRows = (list: Enquiry[], mode: "active" | "history") => list.map((e) => {
    const items = e.items ?? [];
    const { done, total } = loopProgress(e);
    const held = items.filter((it) => it.specIssue).length;
    const latest = mode === "history"
      ? (items.map((it) => it.finalizedAt ?? "").sort().reverse()[0] || undefined)
      : undefined;
    return (
      <tr key={e.id} onClick={() => setSelectedId(e.id)}
        className="cursor-pointer transition-colors hover:bg-[var(--bg-input)]/40">
        <td className={tdClass}>
          <span className="text-[11px] font-extrabold text-[var(--color-brand-indigo)] whitespace-nowrap">{enquiryLabel(e)}</span>
          <span className="block text-[11px] text-[var(--text-tertiary)] truncate max-w-[14rem]">{e.title || "Untitled"}</span>
        </td>
        <td className={tdClass}>
          <span className="font-semibold text-[var(--text-primary)]">{e.clientCompany || "\u2014"}</span>
        </td>
        <td className={tdClass}>
          <span className="font-bold text-[var(--text-primary)]">{items.length} item{items.length === 1 ? "" : "s"}</span>
          <span className="block text-[11px] text-[var(--text-secondary)] truncate max-w-[22rem]">{itemNames(e)}</span>
        </td>
        <td className={tdClass}>
          <span className="text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
            {mode === "active" ? `${total - done} awaiting decision` : `${done} decided`}
            <span className="text-[var(--text-tertiary)]"> · {done}/{total} decided{held > 0 ? ` · ${held} held` : ""}</span>
          </span>
        </td>
        <td className={tdClass}>
          <span className="text-[11px] text-[var(--text-tertiary)]">{historyDateChip((mode === "history" ? latest : undefined) ?? e.updatedAt ?? e.createdAt)}</span>
        </td>
      </tr>
    );
  });

  const enquiryTable = (list: Enquiry[], mode: "active" | "history") => (
    <Table stickyFirst>
      <thead>
        <tr>
          <th className={thClass}>Enquiry</th>
          <th className={thClass}>Client</th>
          <th className={thClass}>Items</th>
          <th className={thClass}>Decisions</th>
          <th className={thClass}>Updated</th>
        </tr>
      </thead>
      <tbody>{renderEnquiryRows(list, mode)}</tbody>
    </Table>
  );

  const info: Array<[string, string]> = sel ? ([
    ["Company", sel.clientCompany || ""],
    ["Contact", sel.contactName || ""],
    ["Email", sel.contactEmail || ""],
    ["Phone", sel.contactPhone || ""],
    ["Location", (sel as any).location || ""],
    ["EST No.", sel.estNumber || ""],
    ["Lead", leadName(sel.assignedAgentId)],
    ["Source", (sel as any).sourceLead || ""],
  ].filter(([, v]) => v) as Array<[string, string]>) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-zinc-900 dark:text-white">Management Review</h1>
        <span className="px-3 py-1 text-xs font-extrabold rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30">
          {pending.length} enquir{pending.length === 1 ? "y" : "ies"} · {pendingItemCount} awaiting decision
        </span>
      </div>

      {pending.length === 0 && historyEnquiries.length === 0 && unprocessedEnquiries.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-10 text-center">
          <p className="text-lg font-bold text-[var(--text-primary)]">Nothing awaiting review 🎉</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Rated items will appear here for markup + finalize automatically.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div role="tablist" aria-label="Management queues"
            className="flex flex-wrap gap-1 rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-1.5">
            {tabs.map((t) => {
              const selected = tab === t.id;
              return (
                <button key={t.id} type="button" role="tab" aria-selected={selected}
                  onClick={() => setTabPick(t.id)}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold cursor-pointer border-0 transition-colors ${
                    selected
                      ? "bg-[var(--color-brand-indigo)] text-white shadow"
                      : "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-input)]"
                  }`}>
                  {t.label}
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                    selected ? "bg-white/20 text-white" : "bg-[var(--bg-input)] text-[var(--text-secondary)]"
                  }`}>{t.count}</span>
                </button>
              );
            })}
          </div>

          {tab === "active" && (
            pending.length > 0 ? (
              <section className="space-y-2">
                {enquiryTable(pending, "active")}
              </section>
            ) : (
              <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-10 text-center">
                <p className="text-sm font-bold text-[var(--text-primary)]">No active decisions</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Every quoted item is decided — new vendor rates will land here automatically.</p>
              </div>
            )
          )}

          {tab === "unprocessed" && (
            unprocessedEnquiries.length > 0 ? (
              <section className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10 18a8 8 0 110-16 8 8 0 010 16z" /></svg>
                  <input value={unprocessedSearch} onChange={(e)=> setUnprocessedSearch(e.target.value)} placeholder="Search client, EST No., title, item, vendor…" className="w-full pl-8 pr-3 py-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-card)] text-xs focus:outline-none focus:border-brand-indigo" />
                  {unprocessedSearch && <button type="button" onClick={()=> setUnprocessedSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs">×</button>}
                </div>
                {unprocessedSearch && <span className="text-xs text-[var(--text-secondary)]">{filteredUnprocessed.length} match</span>}
              </div>
              {enquiryTable(visibleUnprocessed, "history")}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-[var(--border-card)] mt-3">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">Showing {filteredUnprocessed.length ? (unprocessedPageClamped - 1) * unprocessedPageSize + 1 : 0}–{Math.min(unprocessedPageClamped * unprocessedPageSize, filteredUnprocessed.length)} of {filteredUnprocessed.length} {unprocessedTotalPages > 1 ? `· page ${unprocessedPageClamped} of ${unprocessedTotalPages}` : ""}</span>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">Show</label>
                  <select value={unprocessedPageSize} onChange={(e) => setUnprocessedPageSize(Number(e.target.value))} className="px-2 py-1 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg text-xs font-semibold cursor-pointer">
                    {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
                  </select>
                  <button type="button" disabled={unprocessedPageClamped <= 1} onClick={() => setUnprocessedPage(unprocessedPageClamped - 1)} className="px-2.5 py-1 rounded-lg border border-[var(--border-card)] text-xs font-bold disabled:opacity-40 cursor-pointer">‹ Prev</button>
                  <button type="button" disabled={unprocessedPageClamped >= unprocessedTotalPages} onClick={() => setUnprocessedPage(unprocessedPageClamped + 1)} className="px-2.5 py-1 rounded-lg border border-[var(--border-card)] text-xs font-bold disabled:opacity-40 cursor-pointer">Next ›</button>
                </div>
              </div>
              </section>
            ) : (
              <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-10 text-center">
                <p className="text-sm font-bold text-[var(--text-primary)]">Nothing unprocessed</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">All open work is either awaiting your decision or fully decided.</p>
              </div>
            )
          )}

          {tab === "history" && (
            historyEnquiries.length > 0 ? (
              <section className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10 18a8 8 0 110-16 8 8 0 010 16z" /></svg>
                  <input value={historySearch} onChange={(e)=> setHistorySearch(e.target.value)} placeholder="Search client, EST No., title, item, vendor…" className="w-full pl-8 pr-3 py-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-card)] text-xs focus:outline-none focus:border-brand-indigo" />
                  {historySearch && <button type="button" onClick={()=> setHistorySearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs">×</button>}
                </div>
                {historySearch && <span className="text-xs text-[var(--text-secondary)]">{filteredHistory.length} match</span>}
              </div>
              {enquiryTable(visibleHistory, "history")}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-[var(--border-card)] mt-3">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">Showing {filteredHistory.length ? (historyPageClamped - 1) * historyPageSize + 1 : 0}–{Math.min(historyPageClamped * historyPageSize, filteredHistory.length)} of {filteredHistory.length} {historyTotalPages > 1 ? `· page ${historyPageClamped} of ${historyTotalPages}` : ""}</span>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">Show</label>
                  <select value={historyPageSize} onChange={(e) => setHistoryPageSize(Number(e.target.value))} className="px-2 py-1 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg text-xs font-semibold cursor-pointer">
                    {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
                  </select>
                  <button type="button" disabled={historyPageClamped <= 1} onClick={() => setHistoryPage(historyPageClamped - 1)} className="px-2.5 py-1 rounded-lg border border-[var(--border-card)] text-xs font-bold disabled:opacity-40 cursor-pointer">‹ Prev</button>
                  <button type="button" disabled={historyPageClamped >= historyTotalPages} onClick={() => setHistoryPage(historyPageClamped + 1)} className="px-2.5 py-1 rounded-lg border border-[var(--border-card)] text-xs font-bold disabled:opacity-40 cursor-pointer">Next ›</button>
                </div>
              </div>
              </section>
            ) : (
              <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-10 text-center">
                <p className="text-sm font-bold text-[var(--text-primary)]">No decision history yet</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Finalized enquiries will appear here date-wise.</p>
              </div>
            )
          )}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border border-emerald-500/40 p-4 shadow-2xl animate-scale-up bg-[var(--bg-card)]">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-base bg-emerald-500/15">💰</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">New vendor rates</p>
              <p className="truncate text-sm font-bold text-[var(--text-primary)]">{toast.title}</p>
              <p className="text-[11px] font-semibold text-[var(--color-brand-indigo)]">{toast.label}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => { setSelectedId(toast.id); setToast(null); }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer border-0">
                  Review
                </button>
                <button type="button" onClick={() => setToast(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer border-0 bg-transparent">
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {sel && (
        <Modal
          title={sel.title || "Untitled enquiry"}
          subtitle={`${enquiryLabel(sel)}${sel.clientCompany ? ` · ${sel.clientCompany}` : ""}${sel.estNumber ? ` · ${sel.estNumber}` : ""}`}
          onClose={() => setSelectedId(null)}
          wide
        >
          {/* Floating client details sit FLUSH under the modal header (gap 0):
              first child + -mt-4 cancels the modal body's top padding, so no
              transparent strip remains where scrolled text could show through.
              Solid bg (no translucency) for the same reason. The old separate
              client card below was removed (same fields live here) so opening
              the enquiry shows details instantly. */}
          {info.length > 0 && (
            <div className="sticky top-0 z-10 -mx-5 -mt-4 px-5 py-3 bg-[var(--bg-card)] border-b border-[var(--border-card)]/50">
              <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1.5 rounded-xl border border-[var(--border-card)]/60 bg-[var(--bg-input)]/30 p-3">
                {info.map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-[9px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">{k}</dt>
                    <dd className="text-xs font-semibold text-[var(--text-primary)] break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border ${
              sel.priority === "high"
                ? "bg-red-500/10 text-red-500 border-red-500/30"
                : sel.priority === "low"
                  ? "bg-zinc-500/10 text-zinc-500 border-zinc-500/30"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
            }`}>{sel.priority}</span>
            {sel.status && (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] border border-[var(--border-card)]">
                {sel.status}
              </span>
            )}
            {(sel as any).sentRevisionAt && (
              <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30"
                title="Reopened for additional scope — new items loop procurement → management → sent again">
                Under revision
              </span>
            )}
            {sel.rateStatus === "sent" && !(sel as any).sentRevisionAt && (
              <button type="button" disabled={reviseBusy} onClick={() => void handleRevise(sel.id)}
                title="Reopen this sent enquiry for additional scope — drops to finalized so new items loop procurement → management → sent again"
                className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-bold cursor-pointer border-0">
                {reviseBusy ? "Reopening…" : "Reopen for revision"}
              </button>
            )}
          </div>
          {reviseError && (
            <p className="text-xs font-semibold text-red-500">{reviseError}</p>
          )}
          {sel.description && (
            <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{sel.description}</p>
          )}
          {(sel.additionalRequirements ?? []).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
                Additional Requirements ({(sel.additionalRequirements ?? []).length})
              </p>
              <ul className="space-y-1.5">
                {(sel.additionalRequirements ?? []).map((r, i) => {
                  const text = typeof r === "string" ? r : String(r?.text ?? "");
                  const img = typeof r === "string" ? undefined : (r as any)?.imageUrl;
                  if (!text.trim() && !img) return null;
                  return (
                    <li key={i} className="flex items-start gap-2.5 text-xs text-[var(--text-secondary)] font-medium bg-[var(--bg-input)]/25 p-2.5 rounded-lg border border-[var(--border-card)]/50">
                      {img && (
                        <a href={img} target="_blank" rel="noreferrer" className="flex-shrink-0">
                          <img src={img} alt="Requirement attachment"
                            className="w-14 h-14 rounded-lg object-cover border border-[var(--border-card)]" />
                        </a>
                      )}
                      <span className="pt-1 whitespace-pre-wrap">{text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <ManagementRatesPanel
            enquiry={sel}
            onSave={(items, finalize) => handleSaveRates(sel.id, items, finalize)}
          />
        </Modal>
      )}
    </div>
  );
}
