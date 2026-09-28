"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveDashboard, useLiveEvent } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import ManagementRatesPanel from "@/components/ManagementRatesPanel";
import Modal from "@/components/Modal";
import { Table, thClass, tdClass } from "@/components/ui/Table";
import type { Enquiry } from "@/types";
import { enquiryLabel, historyDateChip } from "@/types";
import { itemNeedsDecision, isOpenSpecFlag, isManagementPendingEnquiry, isManagementHistoryEnquiry, itemHasUnreviewedQuotes, isZohoClosedStatus, ratesCoverage } from "@/enquiry/queue";
import { matchesEnquiryQuery } from "@/enquiry/search";
import { toEnquiry } from "@/enquiry/normalize";

/** Only correct-spec, rate-UNAVAILABLE, rated-but-unfinalized items need a
 *  decision — flagged items stay with Sales until the spec is fixed, then
 *  flow back here. Rate-available items skip the loop entirely. */
export function isManagementPending(e: Enquiry): boolean {
  return isManagementPendingEnquiry(e);
}

// Numbered page jumper (History footer): ‹ Prev · 1 … 4 5 6 … 12 · Next ›.
// Windowed to 7 slots so it stays compact at hundreds of pages. Pages over
// the COMPLETE local history set — every row, however old, no 100-row cap.
function pageWindow(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set<number>([1, 2, current - 1, current, current + 1, total - 1, total]);
  const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] - nums[i - 1] > 1) out.push("…");
    out.push(nums[i]);
  }
  return out;
}

function PageJumper({ page, totalPages, onJump }: { page: number; totalPages: number; onJump: (n: number) => void }) {
  if (totalPages <= 1) return null;
  const btn = "px-2.5 py-1 rounded-lg border border-[var(--border-card)] text-xs font-bold cursor-pointer bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]";
  const btnSel = "px-2.5 py-1 rounded-lg border-0 text-xs font-extrabold cursor-pointer bg-[var(--color-brand-indigo)] text-white";
  return (
    <div className="flex items-center gap-1">
      <button type="button" disabled={page <= 1} onClick={() => onJump(page - 1)} className={`${btn} disabled:opacity-40`}>‹ Prev</button>
      {pageWindow(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-xs text-[var(--text-tertiary)]">…</span>
        ) : (
          <button key={p} type="button" onClick={() => onJump(p)}
            className={p === page ? btnSel : btn} aria-current={p === page ? "page" : undefined}>{p}</button>
        ),
      )}
      <button type="button" disabled={page >= totalPages} onClick={() => onJump(page + 1)} className={`${btn} disabled:opacity-40`}>Next ›</button>
    </div>
  );
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

  // ── Data layer: KV-cached server queues (flat D1 cost) ──
  // Active + Unprocessed + History ALL arrive COMPLETE from cached
  // computations (`GET /api/enquiries/queues`, history with `&all=1`):
  // every row however old, zero paging, zero D1 per render (the full scan
  // runs at most once per 60s TTL and is busted on every write).
  const byActivity = (a: Enquiry, b: Enquiry): number =>
    String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? ""));
  type QueuesPayload = { active: Enquiry[]; unprocessed: Enquiry[]; empty: Enquiry[]; historyTotal: number };
  const queues = useLiveDashboard<QueuesPayload>(async () => {
    const res = await fetch("/api/enquiries/queues", { cache: "no-store" });
    if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);
    const d = await res.json();
    return {
      active: Array.isArray(d.active) ? (d.active as any[]).map(toEnquiry) : [],
      unprocessed: Array.isArray(d.unprocessed) ? (d.unprocessed as any[]).map(toEnquiry) : [],
      empty: Array.isArray(d.empty) ? (d.empty as any[]).map(toEnquiry) : [],
      historyTotal: Number(d.historyTotal ?? 0),
    };
  }, { pollMs: 60000 });
  const queuesLoaded = queues.data != null;

  // Complete server history — one fetch off the same cached computation
  // (no D1 within TTL), revalidated on the same live events as the queues.
  type HistPayload = { rows: Enquiry[]; total: number };
  const hist = useLiveDashboard<HistPayload>(async () => {
    const res = await fetch("/api/enquiries/queues?queue=history&all=1", { cache: "no-store" });
    if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);
    const d = await res.json();
    return {
      rows: Array.isArray(d.rows) ? (d.rows as any[]).map(toEnquiry) : [],
      total: Number(d.total ?? 0),
    };
  }, { pollMs: 60000 });

  // Refresh-all handle with a stable identity for effects (the hook result
  // object itself is new every render — never put it in a dep array).
  const refreshAllRef = useRef(() => {});
  refreshAllRef.current = () => { queues.refresh(); hist.refresh(); };

  // Roster for the Lead column (tiny lookup, once per mount).
  const [agents, setAgents] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/enquiries/agents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setAgents(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // Server search (≥2 chars, debounced 300ms, min 2, in-flight aborted):
  // the match set spans ALL rows; tabs split it with the same predicates.
  // Clearing restores the queue views. A late response for a stale query is
  // ignored so it can never freeze the match set on screen (empty box, no ×).
  //
  // Local-first: the tabs already hold EVERY row, so a query that matches
  // locally filters instantly with zero backend traffic (`searchLocal`); the
  // database search below fires ONLY on a local miss. The gate and the tab
  // memos share `matchesEnquiryQuery` (+ roster agent name), so a gate "hit"
  // always renders and a "miss" always falls through.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [searchLocal, setSearchLocal] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchRows, setSearchRows] = useState<Enquiry[]>([]);
  const searchActiveRef = useRef(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchQueryRef = useRef("");
  const clearSearch = useCallback(() => { setSearchQuery(""); }, []);
  useEffect(() => {
    const q = searchQuery.trim();
    searchQueryRef.current = searchQuery;
    if (q.length < 2) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setSearching(false);
      setSearchLocal(false);
      if (searchActiveRef.current) {
        searchActiveRef.current = false;
        setSearchActive(false);
        setSearching(false);
        setSearchHasMore(false);
        setSearchRows([]);
        refreshAllRef.current();
      }
      return;
    }
    // Local-first gate (synchronous — paints on the same keystroke): every
    // loaded row across all three queues plus the item-less set. A hit stays
    // fully local; only a miss pays for the database round-trip below.
    const agentOf = (id: any) => (agents ?? []).find((a: any) => String(a.id) === String(id))?.name ?? "";
    const localHit = (e: any) => matchesEnquiryQuery(e, q, [agentOf((e as any).assignedAgentId)]);
    const pool = [...(queues.data?.active ?? []), ...(queues.data?.unprocessed ?? []), ...(hist.data?.rows ?? []), ...(queues.data?.empty ?? [])];
    if (pool.some(localHit)) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setSearching(false);
      setSearchHasMore(false);
      if (searchActiveRef.current) {
        // Coming back from a server match set: drop it — the queues underneath
        // are already complete, so the local filter has everything to show.
        searchActiveRef.current = false;
        setSearchActive(false);
        setSearchRows([]);
      }
      setSearchLocal(true);
      return;
    }
    setSearchLocal(false);
    setSearching(true);
    const t = setTimeout(async () => {
      searchAbortRef.current?.abort();
      const ac = new AbortController();
      searchAbortRef.current = ac;
      try {
        const res = await fetch(`/api/enquiries?q=${encodeURIComponent(q.slice(0, 40))}&limit=50`, { signal: ac.signal });
        if (!res.ok) throw new Error("search failed");
        const data = await res.json();
        if (searchAbortRef.current !== ac) return; // superseded
        if (searchQueryRef.current.trim() !== q) return; // box moved on
        setSearchRows(((data.enquiries ?? []) as any[]).map(toEnquiry));
        setSearchHasMore(data.hasMore === true);
        searchActiveRef.current = true;
        setSearchActive(true);
        setSearchLocal(false);
      } catch (e: any) {
        if (e?.name !== "AbortError") console.error("Search failed:", e);
      } finally {
        if (searchAbortRef.current === ac) { searchAbortRef.current = null; setSearching(false); }
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Live intimation: procurement logged fresh vendor rates (act on the item).
  const [toast, setToast] = useState<{ id: string; label: string; title: string } | null>(null);
  const ratesRef = useRef<Record<string, number>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  // Seed baseline rate counts from the open queues (toast fires only when a
  // LATER live event reports more rates than the baseline).
  const openSeedRows = useMemo(() => [...(queues.data?.active ?? []), ...(queues.data?.unprocessed ?? [])], [queues.data]);
  useEffect(() => {
    if (!queuesLoaded) return;
    for (const e of openSeedRows) {
      if (ratesRef.current[e.id] === undefined) {
        ratesRef.current[e.id] = (e.items ?? []).reduce((n, it) => n + (it.rates ?? []).length, 0);
      }
    }
  }, [queuesLoaded, openSeedRows]);
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

  // Queue tabs (server-partitioned, same predicates as the backend compute):
  // Active/Unprocessed are the COMPLETE cached sets; History is the current
  // server page. While searching, the match set is split the same way.
  const queueActive = useMemo(() => [...(queues.data?.active ?? [])].sort(byActivity), [queues.data]);
  const queueUnprocessed = useMemo(() => [...(queues.data?.unprocessed ?? [])].sort(byActivity), [queues.data]);
  const serverHistoryRows = useMemo(() => [...(hist.data?.rows ?? [])].sort(byActivity), [hist.data]);
  // Roster-resolved agent name for search (local-only field — passed as
  // `extraHay` so the gate and every memo stay consistent).
  const agentNameOf = (id: any) => (agents ?? []).find((a: any) => String(a.id) === String(id))?.name ?? "";
  const pending = useMemo(() => {
    // Server match set while it owns the search; otherwise the complete
    // cached queue filtered instantly (local-first — any query length).
    if (searchActive) return searchRows.filter(isManagementPending).sort(byActivity);
    const q = searchQuery.trim();
    if (!q) return queueActive;
    return queueActive.filter((e) => matchesEnquiryQuery(e, q, [agentNameOf((e as any).assignedAgentId)]));
  }, [searchActive, searchRows, queueActive, searchQuery, agents]);
  // Item-level count for the header badge (the table itself stays one row
  // per enquiry — quote detail lives in the modal).
  const pendingItemCount = useMemo(
    () => pending.reduce((n, e) => n + (e.items ?? []).filter(itemNeedsDecision).length, 0),
    [pending],
  );
  // History: the COMPLETE decided set (or the search match set while the
  // server owns the search) — fully decided rows only, so a
  // partially-decided enquiry never appears twice.
  const historyEnquiries: Enquiry[] = useMemo(() => {
    if (searchActive) return searchRows.filter(isManagementHistoryEnquiry).sort(byActivity);
    return serverHistoryRows;
  }, [searchActive, searchRows, serverHistoryRows]);
  // Unprocessed: the COMPLETE cached open set (or the search match set) —
  // everything not fully decided, items still with procurement included.
  const unprocessedEnquiries: Enquiry[] = useMemo(() => {
    if (searchActive) {
      return searchRows.filter((e) => !isManagementHistoryEnquiry(e as any) && (e.items ?? []).length > 0).sort(byActivity);
    }
    return queueUnprocessed;
  }, [searchActive, searchRows, queueUnprocessed]);
  // History search is local-first: instant filter over loaded rows (any
  // length); the server/database search fires only on a local miss. Server
  // matches still pass the History predicate, so tabs never leak rows.
  const filteredHistory = useMemo(() => {
    if (searchActive) return historyEnquiries;
    const q = searchQuery.trim();
    if (!q) return historyEnquiries;
    return historyEnquiries.filter((e) => matchesEnquiryQuery(e, q, [agentNameOf((e as any).assignedAgentId)]));
  }, [historyEnquiries, searchActive, searchQuery, agents]);
  // History renders from the COMPLETE cached set and pages locally —
  // every decided row however old, no 100-row cap.
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState<number>(50);
  const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
  useEffect(() => { setHistoryPage(1); }, [historyPageSize, searchQuery]);
  const visibleHistory = filteredHistory;
  const serverHistoryTotal = hist.data?.total ?? queues.data?.historyTotal ?? 0;
  // The count follows what's listed: a typed query (either mode) counts the
  // filtered set, otherwise the server total.
  const historyTotal = searchQuery.trim() ? filteredHistory.length : serverHistoryTotal;
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / historyPageSize));
  const historyPageClamped = Math.min(historyPage, historyTotalPages);
  const visibleHistoryPage = visibleHistory.slice((historyPageClamped - 1) * historyPageSize, historyPageClamped * historyPageSize);
  // Unprocessed search (same local-first UX as history)
  const filteredUnprocessed = useMemo(() => {
    if (searchActive) return unprocessedEnquiries;
    const q = searchQuery.trim();
    if (!q) return unprocessedEnquiries;
    return unprocessedEnquiries.filter((e) => matchesEnquiryQuery(e, q, [agentNameOf((e as any).assignedAgentId)]));
  }, [unprocessedEnquiries, searchActive, searchQuery, agents]);
  // Unprocessed renders whole (complete cached set) — no paging.
  const visibleUnprocessed = filteredUnprocessed;
  // Item-less rows sit in NO tab queue (every predicate needs items) — the
  // server ships them separately so a fresh enquiry is never invisible.
  // Closed requirements are dead/won — never "waiting on sales".
  const emptyEnquiries = useMemo(
    () => {
      const base = [...(queues.data?.empty ?? [])]
        .filter((e) => (e.items ?? []).length === 0 && !isZohoClosedStatus((e as any)?.zohoStatus))
        .sort(byActivity);
      const q = searchQuery.trim();
      return q ? base.filter((e) => matchesEnquiryQuery(e, q, [agentNameOf((e as any).assignedAgentId)])) : base;
    },
    [queues.data, searchQuery, agents],
  );

  const tab: MgmtTab = tabPick
    ?? (pending.length > 0 ? "active"
      : unprocessedEnquiries.length > 0 ? "unprocessed" : "history");
  const tabs: Array<{ id: MgmtTab; label: string; count: number }> = [
    { id: "active", label: "Active", count: pending.length },
    { id: "unprocessed", label: "Unprocessed", count: unprocessedEnquiries.length },
    { id: "history", label: "History", count: historyTotal },
  ];

  // Writes go straight to the API (queues cache is busted server-side, live
  // events + the dashboard hooks refetch within a beat). No local list to
  // patch — the tabs render server-partitioned sets.
  const updateEnquiry = useCallback(async (id: string, updates: Partial<Enquiry>) => {
    const res = await fetch(`/api/enquiries/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error((data && (data.error || data.message)) || "request failed");
    }
    refreshAllRef.current();
    return res.json().catch(() => null);
  }, []);

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

  // Queue rows ship WITHOUT media bytes (payload size — one row alone is
  // ~2.5MB of embedded photos/video). The modal fetches the open row whole
  // on demand and prefers it the moment it lands; until then the queue row
  // renders (all workflow fields intact, media fills in). Saves before it
  // arrives are safe: the backend preserves stored media on privileged
  // management-surface writes.
  // NOTE: hooks — these must stay above ALL early returns below (a hook
  // after a conditional return crashes React #310 the moment the gate
  // flips, e.g. on the loading→loaded transition).
  const [selFull, setSelFull] = useState<Enquiry | null>(null);
  useEffect(() => {
    setSelFull(null);
    if (!selectedId) return;
    let dead = false;
    fetch(`/api/enquiries/${encodeURIComponent(selectedId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!dead && d?.enquiry) setSelFull(toEnquiry(d.enquiry)); })
      .catch(() => {});
    return () => { dead = true; };
  }, [selectedId]);

  if (!allowed) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm font-semibold text-zinc-500 dark:text-zinc-400">
        Management access only.
      </div>
    );
  }

  const allOpenRows = useMemo(() => [...pending, ...unprocessedEnquiries, ...visibleHistory], [pending, unprocessedEnquiries, visibleHistory]);
  const selQueued = selectedId ? allOpenRows.find((e) => e.id === selectedId) ?? null : null;
  const sel = selFull && selFull.id === selectedId ? selFull : selQueued;
  if (!queuesLoaded) {
    return <div className="flex min-h-[50vh] items-center justify-center text-zinc-500 animate-pulse">Loading review queue…</div>;
  }

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
    const loop = (e.items ?? []).filter((it) => !isOpenSpecFlag(it) && !it.rateAvailable);
    // Items with new unshared quotes since the decision still need a review
    // pass — never count them done while the row sits in Active.
    const done = loop.filter((it) => it.finalRate !== undefined && it.finalRate !== null && !itemHasUnreviewedQuotes(it as any)).length;
    return { done, total: loop.length };
  };

  const renderEnquiryRows = (list: Enquiry[], mode: "active" | "history") => list.map((e) => {
    const items = e.items ?? [];
    const { done, total } = loopProgress(e);
    const held = items.filter((it) => isOpenSpecFlag(it)).length;
    // Rates coverage badge: did procurement quote every loop item?
    // True bypasses (rateAvailable/internal/notAvailable) are excluded, but
    // spec-HELD items still have no rates — they block green and show as
    // held (with sales). Count + tooltip naming what's missing; row only.
    const cov = ratesCoverage(e);
    const covDenom = cov.total + cov.held;
    const covBits: string[] = [];
    if (cov.pending.length > 0) covBits.push(`Awaiting rates: ${cov.pending.slice(0, 5).join(", ")}${cov.pending.length > 5 ? ` +${cov.pending.length - 5} more` : ""}`);
    if (cov.held > 0) covBits.push(`Held — awaiting sales fix: ${cov.heldNames.slice(0, 5).join(", ")}${cov.heldNames.length > 5 ? ` +${cov.heldNames.length - 5} more` : ""}`);
    const covTitle = covDenom === 0
      ? "No quotable items — bypass only"
      : cov.complete
        ? `All ${cov.total} items quoted by procurement`
        : covBits.join(" · ");
    const covBadge = covDenom === 0 ? (
      <span title={covTitle}
        className="ml-2 inline-block px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-zinc-500/10 text-zinc-500 border border-zinc-500/30 align-middle">No rates needed</span>
    ) : cov.complete ? (
      <span title={covTitle}
        className="ml-2 inline-block px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 align-middle">✓ {cov.rated}/{covDenom} rates in</span>
    ) : (
      <span title={covTitle}
        className="ml-2 inline-block px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 align-middle">{cov.rated}/{covDenom} rates in{cov.held > 0 ? ` · ${cov.held} held` : ""}</span>
    );
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
          <span className="font-bold text-[var(--text-primary)]">{items.length} item{items.length === 1 ? "" : "s"}</span>{covBadge}
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

      {pending.length === 0 && historyTotal === 0 && unprocessedEnquiries.length === 0 ? (
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
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 relative">
                    <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10 18a8 8 0 110-16 8 8 0 010 16z" /></svg>
                    <input value={searchQuery} onChange={(e)=> setSearchQuery(e.target.value)} placeholder="Search EST No., enquiry no., client, item, vendor… (all enquiries)" className="w-full pl-8 pr-3 py-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-card)] text-xs focus:outline-none focus:border-brand-indigo" />
                    {(searchQuery || searchActive) && <button type="button" onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs">×</button>}
                  </div>
                  {searching ? <span className="text-xs text-[var(--text-secondary)]">Searching…</span>
                    : (searchActive || searchLocal) ? <span className="text-xs text-[var(--text-secondary)]">{pending.length} match{pending.length === 1 ? "" : "es"} across all{searchHasMore ? " · top 50" : ""}</span> : null}
                </div>
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
                  <input value={searchQuery} onChange={(e)=> setSearchQuery(e.target.value)} placeholder="Search EST No., enquiry no., client, item, vendor… (all enquiries)" className="w-full pl-8 pr-3 py-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-card)] text-xs focus:outline-none focus:border-brand-indigo" />
                  {(searchQuery || searchActive) && <button type="button" onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs">×</button>}
                </div>
                {searching ? <span className="text-xs text-[var(--text-secondary)]">Searching…</span>
                  : (searchActive || searchLocal) ? <span className="text-xs text-[var(--text-secondary)]">{filteredUnprocessed.length} match{filteredUnprocessed.length === 1 ? "" : "es"} across all{searchHasMore ? " · top 50" : ""}</span> : null}
              </div>
              {enquiryTable(visibleUnprocessed, "history")}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-[var(--border-card)] mt-3">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">Showing all {filteredUnprocessed.length} open row{filteredUnprocessed.length === 1 ? "" : "s"}</span>
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
            ((searchActive || searchLocal) ? historyEnquiries.length : historyTotal) > 0 ? (
              <section className="space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10 18a8 8 0 110-16 8 8 0 010 16z" /></svg>
                  <input value={searchQuery} onChange={(e)=> setSearchQuery(e.target.value)} placeholder="Search EST No., enquiry no., client, item, vendor… (all enquiries)" className="w-full pl-8 pr-3 py-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-card)] text-xs focus:outline-none focus:border-brand-indigo" />
                  {(searchQuery || searchActive) && <button type="button" onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs">×</button>}
                </div>
                {searching ? <span className="text-xs text-[var(--text-secondary)]">Searching…</span>
                  : (searchActive || searchLocal) ? <span className="text-xs text-[var(--text-secondary)]">{filteredHistory.length} match{filteredHistory.length === 1 ? "" : "es"} across all{searchHasMore ? " · top 50" : ""}</span> : null}
              </div>
              {(!searchActive && !searchLocal && hist.data == null)
                ? <p className="text-xs font-semibold text-[var(--text-secondary)] animate-pulse py-6 text-center">Loading history…</p>
                : enquiryTable(visibleHistoryPage, "history")}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-[var(--border-card)] mt-3">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">Showing {filteredHistory.length ? (historyPageClamped - 1) * historyPageSize + 1 : 0}–{Math.min(historyPageClamped * historyPageSize, filteredHistory.length)} of {filteredHistory.length} {historyTotalPages > 1 ? `· page ${historyPageClamped} of ${historyTotalPages}` : ""}</span>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">Show</label>
                  <select value={historyPageSize} onChange={(e) => setHistoryPageSize(Number(e.target.value))} className="px-2 py-1 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg text-xs font-semibold cursor-pointer">
                    {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
                  </select>
                  <PageJumper page={historyPageClamped} totalPages={historyTotalPages} onJump={setHistoryPage} />
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

          {emptyEnquiries.length > 0 && (
            <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4 space-y-2">
              <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
                Enquiries with no items yet ({emptyEnquiries.length})
              </p>
              {emptyEnquiries.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <span className="font-extrabold text-[var(--color-brand-indigo)]">{enquiryLabel(e)}</span>
                  <span className="font-semibold text-[var(--text-primary)]">{e.title || "Untitled enquiry"}</span>
                  <span className="text-[var(--text-tertiary)]">· {historyDateChip(e.createdAt)}</span>
                  <span className="text-[var(--text-tertiary)]">— waiting on sales to add items</span>
                </div>
              ))}
            </div>
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
