"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEnquiryData } from "@/hooks/useEnquiryData";
import { useLiveEvent } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import ManagementRatesPanel from "@/components/ManagementRatesPanel";
import Modal from "@/components/Modal";
import { Table, thClass, tdClass } from "@/components/ui/Table";
import type { Enquiry } from "@/types";
import { enquiryLabel, historyDateChip, itemNeedsDecision } from "@/types";

/** Only correct-spec, rate-UNAVAILABLE, rated-but-unfinalized items need a
 *  decision — flagged items stay with Sales until the spec is fixed, then
 *  flow back here. Rate-available items skip the loop entirely. */
export function isManagementPending(e: Enquiry): boolean {
  return (e.items ?? []).some(itemNeedsDecision);
}

type ItemRow = { enquiry: Enquiry; itemIdx: number };

// Management Review dashboard (mounted as the `enquiry-management`
// automation). Pending-only, TABULAR: one row per item awaiting a decision
// with a click-to-open review modal carrying the complete information
// (client, requirements, all items clubbed with their rates, markup +
// finalize). Decision history below, date-wise.
export default function ManagementReview() {
  const { me } = useAuth();
  const scopes = me?.scopes ?? [];
  const allowed = !!me && (me.isAdmin || scopes.includes("mis"));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { enquiries, loaded, agents, updateEnquiry } = useEnquiryData("sales");

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
    if (!e || e.type !== "enquiries" || !e.enquiry) return;
    const id = String(e.enquiry.id ?? "");
    if (!id) return;
    const raw = e.enquiry;
    const count = ((raw.items ?? []) as any[]).reduce((n, it) => n + ((it?.rates ?? []).length), 0);
    if (ratesRef.current[id] !== undefined && count > ratesRef.current[id]) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({
        id,
        label: enquiryLabel({ dailyNo: raw.dailyNo ?? null, createdAt: raw.createdAt ?? "", source: raw.source ?? "TL" }),
        title: String(raw.title || "Untitled enquiry"),
      });
      toastTimer.current = setTimeout(() => setToast(null), 10000);
    }
    ratesRef.current[id] = count;
  });

  const byActivity = (a: Enquiry, b: Enquiry): number =>
    String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? ""));
  const pending = useMemo(() => enquiries.filter(isManagementPending).sort(byActivity), [enquiries]);
  const pendingRows: ItemRow[] = useMemo(() => {
    const out: ItemRow[] = [];
    for (const e of pending) {
      (e.items ?? []).forEach((it, itemIdx) => {
        if (itemNeedsDecision(it)) {
          out.push({ enquiry: e, itemIdx });
        }
      });
    }
    return out;
  }, [pending]);
  // History: finalized, correct-spec items, newest first.
  const historyRows: ItemRow[] = useMemo(() => {
    const done = enquiries
      .filter((e) => (e.items ?? []).some((it) => it.finalRate !== undefined && it.finalRate !== null && !it.specIssue))
      .sort(byActivity);
    const out: ItemRow[] = [];
    for (const e of done) {
      (e.items ?? []).forEach((it, itemIdx) => {
        if (it.finalRate !== undefined && it.finalRate !== null && !it.specIssue) out.push({ enquiry: e, itemIdx });
      });
    }
    return out;
  }, [enquiries]);

  const leadName = useCallback((agentId: string) => {
    if (!agentId) return "";
    return (agents ?? []).find((a: any) => String(a.id) === String(agentId))?.name || "";
  }, [agents]);

  const handleSaveRates = useCallback(async (id: string, items: Enquiry["items"], finalize: boolean) => {
    await updateEnquiry(id, { items, ...(finalize ? { rateStatus: "finalized" } : {}) } as Partial<Enquiry>);
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

  const renderPendingRows = () => pendingRows.map(({ enquiry: e, itemIdx }) => {
    const it = (e.items ?? [])[itemIdx];
    if (!it) return null;
    const quotes = (it.rates ?? []).filter((r) => Number.isFinite(Number(r.rate)));
    return (
      <tr key={`${e.id}-${itemIdx}`} onClick={() => setSelectedId(e.id)}
        className="cursor-pointer transition-colors hover:bg-[var(--bg-input)]/40">
        <td className={tdClass}>
          <span className="text-[11px] font-extrabold text-[var(--color-brand-indigo)] whitespace-nowrap">{enquiryLabel(e)}</span>
          <span className="block text-[11px] text-[var(--text-tertiary)] truncate max-w-[14rem]">{e.title || "Untitled"}</span>
        </td>
        <td className={tdClass}>
          <span className="font-semibold text-[var(--text-primary)]">{e.clientCompany || "—"}</span>
        </td>
        <td className={tdClass}>
          <span className="font-bold text-[var(--text-primary)]">{it.name || `Item ${itemIdx + 1}`}</span>
          {it.qty && <span className="ml-2 text-[11px] text-[var(--text-secondary)]">× {it.qty}</span>}
        </td>
        <td className={tdClass}>
          {quotes.length === 0 ? (
            <span className="text-xs text-[var(--text-tertiary)]">—</span>
          ) : (
            <span className="flex flex-col gap-0.5">
              {quotes.map((r, ri) => (
                <span key={ri} className="text-xs whitespace-nowrap">
                  <span className="text-[var(--text-secondary)]">{r.vendor}</span>
                  <span className="font-mono font-bold text-[var(--text-primary)]"> ₹{Number(r.rate).toLocaleString("en-IN")}</span>
                </span>
              ))}
            </span>
          )}
        </td>
        <td className={tdClass}>
          <span className="text-[11px] text-[var(--text-tertiary)]">{historyDateChip(e.updatedAt ?? e.createdAt)}</span>
        </td>
      </tr>
    );
  });

  const renderHistoryRows = () => historyRows.map(({ enquiry: e, itemIdx }) => {
    const it = (e.items ?? [])[itemIdx];
    if (!it) return null;
    return (
      <tr key={`${e.id}-${itemIdx}`} onClick={() => setSelectedId(e.id)}
        className="cursor-pointer transition-colors hover:bg-[var(--bg-input)]/40">
        <td className={tdClass}>
          <span className="text-[11px] font-extrabold text-[var(--color-brand-indigo)] whitespace-nowrap">{enquiryLabel(e)}</span>
          <span className="block text-[11px] text-[var(--text-tertiary)] truncate max-w-[14rem]">{e.title || "Untitled"}</span>
        </td>
        <td className={tdClass}>
          <span className="font-semibold text-[var(--text-primary)]">{e.clientCompany || "—"}</span>
        </td>
        <td className={tdClass}>
          <span className="font-bold text-[var(--text-primary)]">{it.name || `Item ${itemIdx + 1}`}</span>
        </td>
        <td className={tdClass}>
          <span className="text-xs text-[var(--text-secondary)]">{it.selectedVendor || "—"}</span>
        </td>
        <td className={tdClass}>
          <span className="font-extrabold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">₹{Number(it.finalRate).toLocaleString("en-IN")}</span>
        </td>
        <td className={tdClass}>
          <span className="text-[11px] text-[var(--text-tertiary)]">{historyDateChip(it.finalizedAt ?? e.updatedAt ?? e.createdAt)}</span>
        </td>
      </tr>
    );
  });

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
          {pendingRows.length} awaiting decision
        </span>
      </div>

      {pendingRows.length === 0 && historyRows.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-10 text-center">
          <p className="text-lg font-bold text-[var(--text-primary)]">Nothing awaiting review 🎉</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Rated items will appear here for markup + finalize automatically.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pendingRows.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
                Active — awaiting decision ({pendingRows.length})
              </p>
              <Table stickyFirst>
                <thead>
                  <tr>
                    <th className={thClass}>Enquiry</th>
                    <th className={thClass}>Client</th>
                    <th className={thClass}>Item</th>
                    <th className={thClass}>Quotes</th>
                    <th className={thClass}>Updated</th>
                  </tr>
                </thead>
                <tbody>{renderPendingRows()}</tbody>
              </Table>
            </section>
          )}

          {historyRows.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
                Decision history — already finalized ({historyRows.length})
              </p>
              <Table stickyFirst>
                <thead>
                  <tr>
                    <th className={thClass}>Enquiry</th>
                    <th className={thClass}>Client</th>
                    <th className={thClass}>Item</th>
                    <th className={thClass}>Vendor</th>
                    <th className={thClass}>Final</th>
                    <th className={thClass}>Date</th>
                  </tr>
                </thead>
                <tbody>{renderHistoryRows()}</tbody>
              </Table>
            </section>
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
          <div className="rounded-xl border border-[var(--border-card)]/60 bg-[var(--bg-input)]/30 p-3">
            <p className="text-[9px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">Client</p>
            <p className="text-base font-extrabold text-[var(--text-primary)]">{sel.clientCompany || "—"}</p>
            {sel.contactName && (
              <p className="mt-0.5 text-xs font-semibold text-[var(--text-secondary)]">
                {sel.contactName}
                {sel.contactPhone ? ` · ${sel.contactPhone}` : ""}
                {sel.contactEmail ? ` · ${sel.contactEmail}` : ""}
              </p>
            )}
          </div>
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
          </div>
          {info.length > 0 && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1.5 rounded-xl border border-[var(--border-card)]/60 bg-[var(--bg-input)]/30 p-3">
              {info.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[9px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">{k}</dt>
                  <dd className="text-xs font-semibold text-[var(--text-primary)] break-words">{v}</dd>
                </div>
              ))}
            </dl>
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
