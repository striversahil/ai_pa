"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useLiveQuery, useLiveEvent } from "@/hooks/useLiveData";
import { TabBar } from "@/components/ui/TabBar";
// Sales-leaderboard board pieces (region podium, KPI strip, holding pens).
// Mirror: `src/telecalling/view-types.ts` documents the narrow shapes these
// components render; adapters below feed them from the Worker payload.
import { BoardHeader } from "@/components/telecalling/BoardHeader";
import { MetricStrip } from "@/components/telecalling/MetricStrip";
import { PodiumRow } from "@/components/telecalling/PodiumRow";
import { TlStrip } from "@/components/telecalling/TlStrip";
import { HoldingPens } from "@/components/telecalling/HoldingPens";
import { CARD } from "@/components/telecalling/surface";
import type { BoardRegion, BoardStaff } from "@/telecalling/view-types";
import type { TeamTarget } from "@/telecalling/targets";
import { DAILY_REGION_TARGET } from "@/telecalling/targets";
import { workspaceDataUrl } from "@/workspaces/api";
import type { View, DashData, CallTagValue, AgentViewData, CallTagDelta } from "./telecalling-dashboard/types";
import { adaptDashData, TELECALLING_EVENTS, regionKey, regionQuery, adaptAgentView, adaptBoardStaff, TABS, fmtNum, CALL_TAG_META, worst, LIGHT_CHIP, OVERALL_LABEL } from "./telecalling-dashboard/helpers";
import { QueryErrorBanner } from "./telecalling-dashboard/QueryErrorBanner";
import { SatChip } from "./telecalling-dashboard/SatChip";
import { StaleChip } from "./telecalling-dashboard/StaleChip";
import { SnatchChip } from "./telecalling-dashboard/SnatchChip";
import { OrgBadge } from "./telecalling-dashboard/OrgBadge";
import { LeadChips } from "./telecalling-dashboard/LeadChips";
import { CallTagControl } from "./telecalling-dashboard/CallTagControl";
import { NextStepControl } from "./telecalling-dashboard/NextStepControl";
import { KraBar } from "./telecalling-dashboard/KraBar";
import { ShieldChip } from "./telecalling-dashboard/ShieldChip";

// Pieces split into ./telecalling-dashboard/ (importable on their own); re-exported for compat.
export type { DashData, DailyRow, CallTagDelta, RosterRow } from "./telecalling-dashboard/types";
export { adaptDashData, fmtNum } from "./telecalling-dashboard/helpers";

export default function TelecallingDashboard() {
  const [view, setView] = useState<View>("dashboard");
  const [period, setPeriod] = useState<"today" | "week" | "lastweek" | "month" | "lastmonth" | "year" | "lastyear">("week");
  const PERIOD_OPTIONS: { key: typeof period; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "lastweek", label: "Last Week" },
    { key: "month", label: "This Month" },
    { key: "lastmonth", label: "Last Month" },
    { key: "year", label: "This Year" },
    { key: "lastyear", label: "Last Year" },
  ];
  const dash = useLiveQuery<DashData>(
    async () => {
      const res = await fetch(`${workspaceDataUrl("telecalling")}?period=${period}`);
      if (!res.ok) throw new Error(`Failed to load leaderboard (HTTP ${res.status})`);
      return adaptDashData(await res.json());
    },
    { events: TELECALLING_EVENTS, deps: [period], clearOnError: true },
  );

  // Lead Conversion is the default view with no period filtering — it hits the
  // plain dashboard endpoint (no ?period=) and stays independent of the
  // Dashboard's filter.
  const convDash = useLiveQuery<DashData>(
    async () => {
      const res = await fetch(workspaceDataUrl("telecalling"));
      if (!res.ok) throw new Error("Conversion load failed");
      return adaptDashData(await res.json());
    },
    { events: TELECALLING_EVENTS, clearOnError: true },
  );

  // Lead Generation has its OWN period filter — independent of the leaderboard
  // period, so filtering the dashboard/conversion never changes the Generation
  // view. Same endpoint, different period param.
  const [genPeriod, setGenPeriod] = useState<typeof period>("today");
  const genDash = useLiveQuery<DashData>(
    async () => {
      const res = await fetch(`${workspaceDataUrl("telecalling")}?period=${genPeriod}`);
      if (!res.ok) throw new Error("Gen load failed");
      return adaptDashData(await res.json());
    },
    { events: TELECALLING_EVENTS, deps: [genPeriod], clearOnError: true },
  );

  const [regionFilter, setRegionFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Call-tag filters (Sheets-style): Not answering / Busy / Callback (+ due-by
  // date for callbacks). Pure client-side over the loaded follow-ups.
  const [tagFilter, setTagFilter] = useState<"ALL" | CallTagValue>("ALL");
  const [callbackDueBy, setCallbackDueBy] = useState<string>("");

  // A scoped (non-manager) sales agent is locked to their OWN region: the
  // conversion view always opens on their region and they cannot switch tabs.
  const selfAgentId = dash.data?.meta?.selfAgentId ?? convDash.data?.meta?.selfAgentId ?? null;
  const selfRegion = dash.data?.meta?.viewer?.region ?? convDash.data?.meta?.viewer?.region ?? "";
  useEffect(() => {
    if (selfAgentId) setRegionFilter(regionKey(selfRegion));
  }, [selfAgentId, selfRegion]);

  // ── Root estimate assignment overrides (lock to one agent / never assign) ──
  const [overrideBusy, setOverrideBusy] = useState(false);

  // Prefetch EVERY region's pipeline in parallel (one round of requests),
  // refreshed on live events. Switching region tabs then reads from the local
  // map — instant, and it never shows another region's stale data while
  // loading. Region keys: R1–R4 (+ UNMAPPED for managers).
  const activeRegionKeys = (convDash.data?.regions ?? dash.data?.regions ?? [])
    .map((r) => r.id);
  if ((convDash.data?.unmapped?.items?.length ?? 0) > 0) activeRegionKeys.push("UNMAPPED");
  // A scoped (non-manager) agent only ever sees their OWN region — prefetch
  // just that key, never every region.
  const regionKeysKey = selfAgentId ? regionKey(selfRegion) : activeRegionKeys.join(",");
  const agentViews = useLiveQuery<Record<string, AgentViewData | null>>(
    async () => {
      if (!regionKeysKey) return {};
      const keys = regionKeysKey.split(",");
      const entries = await Promise.all(
        keys.map(async (key) => {
          try {
            const res = await fetch(`${workspaceDataUrl("telecalling")}?region=${encodeURIComponent(regionQuery(key))}`);
            return [key, res.ok ? adaptAgentView(await res.json()) : null] as const;
          } catch {
            return [key, null] as const;
          }
        }),
      );
      return Object.fromEntries(entries);
    },
    { events: TELECALLING_EVENTS, deps: [regionKeysKey], clearOnError: true },
  );
  // ── Sheets-style instant tags ──────────────────────────────────────────
  // The backend pushes the changed row INSIDE the telecalling live event
  // (delta, not a full refetch — same idea as Sheets cell ops over one
  // socket), and a tag tap applies locally on click (optimistic echo). This
  // override map is the local model patch: event deltas + own taps land here
  // in milliseconds. The debounced refetch (whose rows carry server-overlaid
  // fresh tags) reconciles and clears it — a failed save reverts + shows the
  // error instead of lying.
  const [tagOverrides, setTagOverrides] = useState<Record<string, CallTagDelta>>({});
  // NOTE: overrides are deliberately NEVER bulk-cleared on refetch. Clearing
  // them on every agentViews.data change caused the production bug where rapid
  // taps appeared to shift/vanish: overlapping single-agent refreshes resolve
  // out of order, and a stale (older-read) response arriving last overwrote
  // newer taps after the wipe removed their protection. An override can only
  // ever equal confirmed server state, because: (a) a tap writes the override
  // and the PUT commits before any refresh reads; a failed PUT removes its
  // override in save()'s catch; (b) any other tab/user's change arrives as a
  // live tag delta that overwrites the override; (c) tags are sticky
  // server-side (engines never clear them), so a persisted override cannot
  // shadow a newer server state. A stale refresh is therefore always
  // corrected by the override, never the other way round.
  useLiveEvent((e) => {
    // Tag deltas arrive as their own "telecalling-tag" type precisely so they
    // do NOT match TELECALLING_EVENTS (no ~20-request refetch storm — the
    // delta patch below is the whole update). The legacy "telecalling" match
    // covers the brief window where the backend ships ahead of this bundle.
    if (e.type !== "telecalling-tag" && e.type !== "telecalling") return;
    const d = (e as unknown as { callTag?: { estimateId?: unknown } }).callTag;
    if (d && typeof d.estimateId === "string") {
      const dd = d as unknown as CallTagDelta & { estimateId: string };
      setTagOverrides((prev) => ({
        ...prev,
        [String(dd.estimateId)]: {
          callTag: dd.callTag ?? null,
          callbackDate: dd.callbackDate ?? null,
          callTagBy: dd.callTagBy ?? null,
          callTagByName: dd.callTagByName ?? null,
          callTagAt: dd.callTagAt ?? null,
        },
      }));
    }
  });
  const applyTagOverride = useCallback((estimateId: string, delta: CallTagDelta | null) => {
    setTagOverrides((prev) => {
      if (!delta) {
        const { [estimateId]: _omit, ...rest } = prev;
        return rest;
      }
      return { ...prev, [estimateId]: delta };
    });
  }, []);
  /**
   * Reconcile ONE agent's view after a tag save (1 request) instead of
   * re-fetching every agent. The optimistic override already painted the tap;
   * this confirms server state (setter name, timestamp) without the storm.
   */
  const refreshOneAgent = useCallback(async (key: string | null) => {
    if (!key) { agentViews.refresh(); return; }
    try {
      const res = await fetch(`${workspaceDataUrl("telecalling")}?region=${encodeURIComponent(regionQuery(key))}`);
      if (!res.ok) return;
      const view = adaptAgentView(await res.json());
      agentViews.setData((prev) => ({ ...(prev ?? {}), [key]: view }));
    } catch { /* override patch already shows the tap; next event refetch reconciles */ }
  }, [agentViews]);
  const agentViewsMap = useMemo(() => {
    const src = agentViews.data ?? {};
    if (Object.keys(tagOverrides).length === 0) return src;
    const out: Record<string, AgentViewData | null> = {};
    for (const [id, v] of Object.entries(src)) {
      if (!v || !Array.isArray(v.followUps)) { out[id] = v; continue; }
      out[id] = {
        ...v,
        followUps: v.followUps.map((f) => (tagOverrides[f.estimateId] ? { ...f, ...tagOverrides[f.estimateId] } : f)),
      };
    }
    return out;
  }, [agentViews.data, tagOverrides]);
  const getAgentView = (key: string | null): AgentViewData | null => (key ? agentViewsMap[key] ?? null : null);
  const selectedAgentView = getAgentView(regionFilter);
  // No-pickup subset of the selected agent's follow-ups (NeoDove dial outcome).
  const convFollowUps = selectedAgentView?.followUps ?? [];
  // Call-tag filter counts ( Sheets-style quick filters over the same rows).
  const tagCounts = useMemo(() => {
    const c: Record<CallTagValue, number> = { NO_ANSWER: 0, BUSY: 0, CALLBACK: 0 };
    for (const f of convFollowUps) {
      const t = (f.callTag ?? null) as CallTagValue | null;
      if (t && c[t] !== undefined) c[t] += 1;
    }
    return c;
  }, [convFollowUps]);
  const filtersActive = tagFilter !== "ALL";
  const visibleFollowUps = convFollowUps.filter((f) => {
    if (tagFilter !== "ALL") {
      if ((f.callTag ?? null) !== tagFilter) return false;
      if (tagFilter === "CALLBACK" && callbackDueBy && (f.callbackDate ?? "") > callbackDueBy) return false;
    }
    return true;
  });
  // Distinct Zoho orgs across the loaded follow-ups + at-risk rows. The org
  // badges render only when 2+ orgs are present (single-org = today's view).
  const teleOrgs = useMemo(() => {
    const set = new Set<string>();
    for (const v of Object.values(agentViews.data ?? {})) {
      for (const f of v?.followUps ?? []) {
        if (f?.organizationId) set.add(String(f.organizationId));
      }
    }
    for (const r of dash.data?.risk?.atRisk ?? []) {
      if ((r as any)?.organizationId) set.add(String((r as any).organizationId));
    }
    return [...set].sort();
  }, [agentViews.data, dash.data]);

  const refreshAll = useCallback(() => {
    dash.refresh();
    convDash.refresh();
    genDash.refresh();
    agentViews.refresh();
  }, [dash, convDash, genDash, agentViews]);

  // Risk is informational in the region model (red/zombie + stale next step
  // surface as attention flags; nothing is re-poached at EOD anymore).
  const showRisk = true;

  const kpi = dash.data?.kpi;
  // Lead Conversion board — driven by ITS OWN convDash/period, not the dashboard.
  const convBoard = [...(convDash.data?.leaderboard ?? [])];
  // Lead Generation board — driven by its OWN genDash/period, not the leaderboard period.
  const genBoard = [...(genDash.data?.leaderboard ?? [])];
  const genActiveBoard = genBoard;
  // Region cards drive the Lead Conversion tabs (R1–R4 + Unmapped for managers).
  const regionBoard = convDash.data?.regions ?? dash.data?.regions ?? [];
  const unmappedBlock = convDash.data?.unmapped ?? dash.data?.unmapped ?? null;
  // Region performance — dashboard period, regions own the estimates. Full
  // close credits roll up into the region totals automatically.
  const dashRegions = dash.data?.regions ?? [];

  // ── Sales-leaderboard board state (podium drawers) ─────────────────────
  const [openWeeks, setOpenWeeks] = useState<string | null>(null);
  const [closedOpen, setClosedOpen] = useState<string | null>(null);
  /** Region whose "what did we lose?" list is open (one drawer at a time). */
  const [declinedOpen, setDeclinedOpen] = useState<string | null>(null);
  const teamTarget = (dash.data?.meta?.teamTarget ?? null) as TeamTarget | null;
  const riskByStaff = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of dash.data?.risk?.atRisk ?? []) {
      const id = (r as any).telecallerId ? String((r as any).telecallerId) : "";
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [dash.data?.risk]);
  // Region cards → BoardRegion: the podium renders server numbers verbatim
  // (rank, target ledger, accepted list), sorted by rank.
  const boardRegions: BoardRegion[] = useMemo(
    () => [...dashRegions]
      .sort((a: any, b: any) => Number(a.rank ?? 99) - Number(b.rank ?? 99))
      .map((r: any) => ({
        id: String(r.id),
        name: String(r.name ?? r.id),
        tl: String(r.tl ?? ""),
        states: r.states ?? [],
        rank: Number(r.rank ?? 0),
        won: r.won ?? { count: 0, value: 0 },
        accepted: r.accepted,
        acceptedItems: r.acceptedItems ?? [],
        declined: r.declined ?? { count: 0, value: 0 },
        declinedItems: r.declinedItems ?? [],
        target: r.target ?? null,
        // Filter-period consumer target + Won split — without these the row
        // falls back to the since-start headline (2026-11-03 incident: rows
        // read the October ledger while the tiles read the filter).
        periodTarget: r.periodTarget ?? null,
        wonSplit: r.wonSplit,
        open: r.open ?? { count: 0, value: 0 },
        callsConnected: Number(r.callsConnected ?? 0),
        leadsGenerated: Number(r.leadsGenerated ?? 0),
        points: Number(r.points ?? 0),
        kra: r.kra,
        staff: [],
      })),
    [dashRegions],
  );
  const boardStaffByRegion = useMemo(() => {
    const m = new Map<string, BoardStaff[]>();
    for (const r of dashRegions as any[]) {
      m.set(String(r.id), (r.staff ?? []).map((s: any) => adaptBoardStaff(s, r, riskByStaff)));
    }
    return m;
  }, [dashRegions, riskByStaff]);
  /** Region → TL names covering it (two-region model: one region can have two TLs). */
  const tlByRegion = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const t of ((dash.data as any)?.tlTargets ?? []) as Array<{ name?: string; regions?: string[] }>) {
      for (const r of t?.regions ?? []) {
        const key = String(r);
        const list = m.get(key) ?? [];
        if (t?.name) list.push(String(t.name));
        m.set(key, list);
      }
    }
    return m;
  }, [(dash.data as any)?.tlTargets]);
  return (
    <div className="space-y-6">
      <BoardHeader
        meta={{
          day: dash.data?.meta?.day,
          periodLabel: dash.data?.meta?.periodLabel,
          periodFrom: dash.data?.meta?.periodFrom,
          periodTo: dash.data?.meta?.periodTo,
          workingDays: dash.data?.meta?.workingDays,
          activeCount: dash.data?.meta?.activeCount,
          telecallerCount: dash.data?.meta?.telecallerCount,
          unattributedLeads: Number((dash.data?.meta as any)?.unattributedLeads ?? 0),
        }}
        period={period}
        periods={PERIOD_OPTIONS}
        onPeriod={(k) => setPeriod(k as typeof period)}
        loading={dash.loading}
        showControls={view === "dashboard"}
      />
      <div className="flex flex-col gap-6">
        {/* Tabs (full-width horizontal row) */}
        <aside className="w-full shrink-0">
          <TabBar
            items={TABS}
            active={view}
            onChange={setView}
          />
        </aside>

        {/* Content (seamless switch — queries stay mounted) */}
        <div className="flex-1 min-w-0">
          {view === "dashboard" && (
            <div className="fos-board space-y-4">
              {Boolean(dash.error) && !dash.loading && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-300"
                >
                  <span>Leaderboard failed to load — {String((dash.error as any)?.message ?? dash.error)}</span>
                  <button type="button" onClick={() => dash.refresh()} className="underline">retry</button>
                </div>
              )}

              <MetricStrip kpi={kpi} teamTarget={teamTarget} loading={dash.loading} />

              {/* ONE leaderboard: regions ranked by attainment, telecallers as
                  their always-open children. Money lives on the region line —
                  per-agent ₹ would double-count the same accepted estimate. */}
              <section className={`${CARD} p-0`}>
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border-card)] px-4 py-3 md:px-5">
                  <div className="min-w-0">
                    <h2 className="font-heading text-sm font-bold tracking-tight text-[var(--text-primary)]">
                      Region race · {dash.data?.meta?.periodLabel ?? "today"}
                    </h2>
                    <p className="mt-0.5 max-w-3xl text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                      Every region team owes{" "}
                      <span className="font-bold text-[var(--text-secondary)]">₹{fmtNum(DAILY_REGION_TARGET)}</span> of accepted
                      estimate value per working day (Mon–Sat) from <span className="font-bold text-[var(--text-secondary)]">end consumers</span> —
                      reseller and unclassified ₹ never count. Ranks read this filter&apos;s consumer attainment; a week&apos;s
                      shortfall still carries forward on the ledger below each bar.
                    </p>
                  </div>
                  <span className="rounded-full border border-[var(--border-card)] bg-[var(--surface-sunken)] px-2 py-1 text-[10px] font-bold text-[var(--text-tertiary)]">
                    wins &amp; ₹ follow the selected period
                  </span>
                </div>

                <div className="space-y-3 p-3 md:p-4">
                  {boardRegions.map((r, i) => (
                    <PodiumRow
                      key={`${r.id}-${period}`}
                      region={r}
                      index={i}
                      staff={boardStaffByRegion.get(r.id) ?? []}
                      tlName={(tlByRegion.get(r.id) ?? []).join(" · ") || undefined}
                      weeksOpen={openWeeks === r.id}
                      onToggleWeeks={() => setOpenWeeks((cur) => (cur === r.id ? null : r.id))}
                      closedOpen={closedOpen === r.id}
                      onToggleClosed={() => {
                        setClosedOpen((cur) => (cur === r.id ? null : r.id));
                        setDeclinedOpen(null);
                      }}
                      declinedOpen={declinedOpen === r.id}
                      onToggleDeclined={() => {
                        setDeclinedOpen((cur) => (cur === r.id ? null : r.id));
                        setClosedOpen(null);
                      }}
                      onOpenRegion={() => { setRegionFilter(regionKey(r.id)); setView("conversion"); }}
                      targetStart={teamTarget?.targetStart}
                      workingDays={dash.data?.meta?.workingDays}
                    />
                  ))}
                  {boardRegions.length === 0 && (
                    <p className="py-10 text-center text-sm text-[var(--text-tertiary)]">No regions loaded.</p>
                  )}
                </div>
              </section>

              {/* Accepted value no region can claim — real revenue that must
                  reconcile, parked below the race on purpose. */}
              <TlStrip items={(dash.data as any)?.tlTargets ?? []} periodLabel={dash.data?.meta?.periodLabel} />
              <HoldingPens
                direct={dash.data?.direct ?? null}
                unlinked={dash.data?.unlinked ?? null}
                onOpenUnlinked={() => { setRegionFilter("UNMAPPED"); setView("conversion"); }}
              />
            </div>
          )}
          {view === "conversion" && (
            <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <div className="mb-3">
                <h3 className="text-lg font-bold mb-1">📨 Lead Conversion</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {selfAgentId
                    ? "Your region's open estimates — call them and log a meaningful update."
                    : "Estimates are owned by regions. Switch between region tabs to see each region's pipeline."}
                </p>
              </div>

              {/* Horizontal region tabs — hidden for scoped (self-region) staff */}
              {!selfAgentId && (
                <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
                  <button
                    onClick={() => setRegionFilter(null)}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                      !regionFilter
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                        : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500"
                    }`}
                  >
                    All regions
                  </button>
                  {regionBoard.map((r) => {
                    const active = regionFilter === r.id;
                    return (
                      <button
                        key={r.id}
                        onClick={() => setRegionFilter(active ? null : r.id)}
                        title={`${r.name} · ${r.tl} · ${r.states.join(", ")}`}
                        className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                          active
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                            : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500"
                        }`}
                      >
                        {r.id} · {r.name}
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${active ? "bg-white/20" : "bg-zinc-100 dark:bg-zinc-700/60 text-zinc-500 dark:text-zinc-400"}`}>
                          {r.open.count}
                        </span>
                      </button>
                    );
                  })}
                  {(unmappedBlock?.count ?? 0) > 0 && (
                    <button
                      onClick={() => setRegionFilter(regionFilter === "UNMAPPED" ? null : "UNMAPPED")}
                      title="Open estimates with no region — root should link them"
                      className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                        regionFilter === "UNMAPPED"
                          ? "bg-amber-600 text-white border-amber-600 shadow-sm"
                          : "bg-white dark:bg-zinc-800 text-amber-600 dark:text-amber-400 border-amber-500/40 hover:border-amber-400"
                      }`}
                    >
                      Unmapped
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-amber-500/15">{unmappedBlock?.count ?? 0}</span>
                    </button>
                  )}
                </div>
              )}

              {!selfAgentId && !regionFilter && (
                <div className="space-y-2 relative">
                  {convDash.loading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/40 dark:bg-zinc-950/40 backdrop-blur-[1px]" aria-hidden="true">
                      <svg className="animate-spin w-6 h-6 text-indigo-500" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
                      </svg>
                    </div>
                  )}
                  {Boolean(convDash.error) && !convDash.loading && (
                    <QueryErrorBanner message={String((convDash.error as any)?.message ?? convDash.error)} onRetry={() => convDash.refresh()} />
                  )}
                  {regionBoard.length === 0 && <p className="text-sm text-zinc-500">No regions loaded.</p>}
                  {regionBoard.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRegionFilter(r.id)}
                      className="w-full flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors cursor-pointer group text-left"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-zinc-900 dark:text-white group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors">
                          {r.id} · {r.name}
                        </span>
                        <span className="block text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                          {r.tl} · {r.states.join(", ")}
                        </span>
                      </span>
                      <span className="text-xs text-zinc-600 dark:text-zinc-400 font-mono shrink-0 text-right">
                        {r.open.count} open · {r.won.count} won · ₹{fmtNum(r.open.value)} · {r.points} pts
                      </span>
                    </button>
                  ))}
                  {(unmappedBlock?.count ?? 0) > 0 && (
                    <button
                      onClick={() => setRegionFilter("UNMAPPED")}
                      className="w-full flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 hover:border-amber-400 transition-colors cursor-pointer text-left"
                    >
                      <span className="font-semibold text-amber-600 dark:text-amber-400">Unmapped estimates</span>
                      <span className="text-xs text-amber-700/80 dark:text-amber-400/80 font-mono shrink-0">
                        {unmappedBlock?.count ?? 0} open · ₹{fmtNum(unmappedBlock?.value ?? 0)} — link them in Controller
                      </span>
                    </button>
                  )}
                </div>
              )}

              {regionFilter && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-zinc-900 dark:text-white">
                      {selectedAgentView?.meta?.regionName ?? selectedAgentView?.agent?.name ?? (regionFilter === "UNMAPPED" ? "Unmapped" : regionFilter)} — follow-ups ({selectedAgentView?.agent?.followUpCount ?? 0})
                    </h4>
                    {!selfAgentId && (
                      <button onClick={() => setRegionFilter(null)} className="text-xs text-indigo-400 hover:underline">Back to all</button>
                    )}
                  </div>
                  {/* Call-tag filters (Sheets-style): Not answering / Busy /
                      Callback (+ due-by date). Pure client-side over the
                      loaded follow-ups — instant, no refetch. */}
                  {(tagCounts.NO_ANSWER + tagCounts.BUSY + tagCounts.CALLBACK > 0 || tagFilter !== "ALL") && (
                    <div className="flex flex-wrap items-center gap-2">
                      {(Object.keys(CALL_TAG_META) as CallTagValue[]).map((t) => {
                        const active = tagFilter === t;
                        return (
                          <button
                            key={t}
                            onClick={() => { setTagFilter(active ? "ALL" : t); if (t !== "CALLBACK") setCallbackDueBy(""); }}
                            title={t === "CALLBACK" ? "Show only follow-ups marked for callback" : CALL_TAG_META[t].title}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                              active
                                ? "bg-sky-600 text-white border-sky-600 shadow-sm"
                                : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-sky-400 dark:hover:border-sky-500"
                            }`}
                          >
                            <span>{CALL_TAG_META[t].icon}</span> {CALL_TAG_META[t].label} ({tagCounts[t]})
                          </button>
                        );
                      })}
                      {tagFilter === "CALLBACK" && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                          due by
                          <input
                            type="date"
                            value={callbackDueBy}
                            onChange={(e) => setCallbackDueBy(e.target.value)}
                            title="Show callbacks due on or before this date"
                            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-1 text-xs text-zinc-900 dark:text-zinc-100"
                          />
                          {callbackDueBy && (
                            <button onClick={() => setCallbackDueBy("")} className="text-indigo-400 hover:underline">clear</button>
                          )}
                        </span>
                      )}
                      {tagFilter !== "ALL" && (
                        <button onClick={() => { setTagFilter("ALL"); setCallbackDueBy(""); }} className="text-xs text-indigo-400 hover:underline">Show all</button>
                      )}
                    </div>
                  )}
                  {agentViews.loading && !selectedAgentView && <p className="text-sm text-zinc-500">Loading…</p>}
                  {!agentViews.loading && !selectedAgentView && Boolean(agentViews.error) && (
                    <p className="text-sm text-rose-500">Couldn't load follow-ups — <button className="underline font-semibold" onClick={() => agentViews.refresh()}>retry</button>.</p>
                  )}
                  {!agentViews.loading && selectedAgentView && (selectedAgentView?.followUps?.length ?? 0) === 0 && (
                    <p className="text-sm text-zinc-500">No follow-up estimates in this region.</p>
                  )}
                  {!agentViews.loading && (selectedAgentView?.followUps?.length ?? 0) > 0 && visibleFollowUps.length === 0 && (
                    <p className="text-sm text-zinc-500">{filtersActive ? "No follow-ups match the active filters." : "No follow-ups in this region."}</p>
                  )}
                  <div className="space-y-2">
                    {visibleFollowUps.map((f) => (
                      <div key={f.estimateId} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 space-y-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="font-semibold text-sm text-zinc-900 dark:text-white truncate min-w-0">{f.customerName ?? "—"}</div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <SatChip value={f.satisfactory} />
                            <StaleChip staleHours={f.staleHours} />
                            {showRisk && <SnatchChip risk={f.risk} snatchInHours={f.snatchInHours} />}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{f.estimateNumber ?? f.estimateId} <OrgBadge orgId={f.organizationId} orgs={teleOrgs} /></div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-zinc-700 dark:text-zinc-300">{f.status ?? "—"}</span>
                            <span className="text-xs font-mono text-emerald-400">₹{fmtNum(Number(f.total ?? 0))}</span>
                          </div>
                        </div>
                        <LeadChips f={f} />
                        <CallTagControl f={f} onSaved={() => void refreshOneAgent(regionFilter)} onTag={applyTagOverride} />
                        <NextStepControl f={f} onSaved={() => void refreshOneAgent(regionFilter)} />
                        {f.latestComment ? (
                          <p
                            className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-snug line-clamp-2"
                            title={`${f.latestComment.commentedBy}${f.latestComment.dateFormatted ? ` · ${f.latestComment.dateFormatted}` : ""}\n${f.latestComment.text}`}
                          >
                            “{f.latestComment.text}”
                            <span className="text-zinc-500 dark:text-zinc-400">
                              {" "}— {f.latestComment.commentedBy}
                              {f.latestComment.dateFormatted ? ` · ${f.latestComment.dateFormatted}` : ""}
                            </span>
                          </p>
                        ) : (
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">No sales notes yet.</p>
                        )}
                        {showRisk && (f.risk === "red" || f.risk === "zombie") && (f.staleReason ?? f.snatchReason) && (
                          <p className="text-[11px] text-rose-600/80 dark:text-rose-400/70 leading-snug line-clamp-2" title={(f.staleReason ?? f.snatchReason) ?? undefined}>
                            {f.staleReason ?? f.snatchReason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unmapped drill: the endpoint returns no region for "unmapped",
                  so show the privileged linking queue instead of follow-ups. */}
              {regionFilter === "UNMAPPED" && (unmappedBlock?.count ?? 0) > 0 && (
                <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  {unmappedBlock?.count ?? 0} unmapped estimates (₹{fmtNum(unmappedBlock?.value ?? 0)}). Link each one to a region in the Controller tab.
                </div>
              )}
            </section>
          )}

          {view === "generation" && (
            <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-lg font-bold mb-1">📞 Lead Generation</h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Per-agent enquiries created (live) + NeoDove call performance — calls from the NeoDove worker database.
                  </p>
                </div>
                {/* Independent period filter for Lead Generation */}
                <div className="flex flex-wrap gap-1.5">
                  {PERIOD_OPTIONS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => setGenPeriod(p.key)}
                      className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                        genPeriod === p.key
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:border-indigo-400"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                {genDash.data?.meta?.targets ? (
                  <span>
                    Benchmarks per agent for <span className="font-bold">{genDash.data.meta.periodLabel ?? "Today"}</span>
                    {genDash.data.meta.workingDays && genDash.data.meta.workingDays > 1 ? ` (${genDash.data.meta.workingDays} working days × daily target)` : ""}:{" "}
                    <span className="text-zinc-700 dark:text-zinc-300 font-semibold">≥ {genDash.data.meta.targets.connectedCallsPerDay} connected calls</span> ·{" "}
                    <span className="text-zinc-700 dark:text-zinc-300 font-semibold">≥ {genDash.data.meta.targets.leadsPerAgentPerDay} leads</span> (enquiries created). Traffic light: 🟢 ≥100% · 🟡 60–99% · 🔴 &lt;60%
                  </span>
                ) : null}
              </p>
              {Boolean(genDash.error) && !genDash.loading && (
                <QueryErrorBanner message={String((genDash.error as any)?.message ?? genDash.error)} onRetry={() => genDash.refresh()} />
              )}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 relative">
                {genDash.loading && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/40 dark:bg-zinc-950/40 backdrop-blur-[1px]" aria-hidden="true">
                    <svg className="animate-spin w-6 h-6 text-indigo-500" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
                    </svg>
                  </div>
                )}
                {genActiveBoard.map((t) => {
                  const g = t.generation;
                  const overall = worst(g.connectedStatus, g.leadsStatus);
                  return (
                    <div
                      key={t.id}
                      className={`rounded-xl border p-4 space-y-3 bg-zinc-50 dark:bg-zinc-900 ${
                        overall === "green" ? "border-emerald-500/30" : overall === "amber" ? "border-amber-500/30" : "border-rose-500/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-bold text-zinc-900 dark:text-white truncate block">{t.name}</span>
                          <span className="text-[10px] text-zinc-600 dark:text-zinc-500">{t.region || "Unmapped"} · {t.tlLevel || "—"}</span>
                        </div>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-extrabold uppercase tracking-wide ${LIGHT_CHIP[overall]}`}>
                          {OVERALL_LABEL[overall]}
                        </span>
                      </div>
                      <KraBar label="Connected Calls" value={g.callsConnected} target={g.connectedTarget} pct={g.connectedPct} status={g.connectedStatus} />
                      <KraBar label="Leads Generated" value={g.leadsGenerated} target={g.leadsTarget} pct={g.leadsPct} status={g.leadsStatus} />
                      <div className="flex items-center justify-between pt-1 border-t border-zinc-200/80 dark:border-zinc-800/80 text-[10px] text-zinc-600 dark:text-zinc-500">
                        <span>Lead Conversion</span>
                        <span className="font-mono text-zinc-500 dark:text-zinc-400">
                          {t.conversion.won} won · {fmtNum(t.points ?? 0)} pts
                        </span>
                      </div>
                      {(() => {
                        const open = expandedId === t.id;
                        const rk = regionKey(t.region);
                        const view = getAgentView(rk);
                        return (
                          <div className="pt-1 border-t border-zinc-200/80 dark:border-zinc-800/80">
                            <button
                              onClick={() => setExpandedId(open ? null : t.id)}
                              className="w-full inline-flex items-center justify-between gap-2 text-xs font-semibold text-indigo-500 dark:text-indigo-400 hover:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
                            >
                              <span>Region pipeline ({view?.agent?.followUpCount ?? t.conversion.assigned})</span>
                              <span className={`text-[10px] text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
                            </button>
                            {open && (
                              <div className="mt-2 space-y-1.5">
                                {agentViews.loading && !view && <p className="text-[11px] text-zinc-500">Loading…</p>}
                                {!agentViews.loading && !view && Boolean(agentViews.error) && (
                                  <p className="text-[11px] text-rose-500">Couldn't load estimates — <button className="underline font-semibold" onClick={() => agentViews.refresh()}>retry</button>.</p>
                                )}
                                {!agentViews.loading && view && (view?.followUps?.length ?? 0) === 0 && (
                                  <p className="text-[11px] text-zinc-500">No open estimates in this region.</p>
                                )}
                                {(view?.followUps ?? []).map((f) => (
                                  <div key={f.estimateId} className="rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 bg-white dark:bg-zinc-950">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="text-[11px] font-semibold text-zinc-900 dark:text-white truncate">{f.customerName ?? "—"}</div>
                                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{f.estimateNumber ?? f.estimateId}</div>
                                      </div>
                                      <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                                        <div className="flex items-center gap-1">
                                          <SatChip value={f.satisfactory} compact />
                                          <StaleChip staleHours={f.staleHours} compact />
                                        </div>
                                        {showRisk && <SnatchChip risk={f.risk} snatchInHours={f.snatchInHours} compact />}
                                        {showRisk && <ShieldChip shield={f.shield} compact />}
                                        <div className="text-[10px] text-zinc-600 dark:text-zinc-300">{f.status ?? "—"}</div>
                                        <div className="text-[10px] font-mono text-emerald-400">₹{fmtNum(Number(f.total ?? 0))}</div>
                                      </div>
                                    </div>
                                    <LeadChips f={f} />
                                    <CallTagControl f={f} compact onSaved={() => void refreshOneAgent(rk)} onTag={applyTagOverride} />
                                    <NextStepControl f={f} onSaved={() => void refreshOneAgent(rk)} />
                                    {f.latestComment ? (
                                      <p
                                        className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-snug line-clamp-2"
                                        title={`${f.latestComment.commentedBy}${f.latestComment.dateFormatted ? ` · ${f.latestComment.dateFormatted}` : ""}\n${f.latestComment.text}`}
                                      >
                                        “{f.latestComment.text}”
                                        <span className="text-zinc-500 dark:text-zinc-400">
                                          {" "}— {f.latestComment.commentedBy}
                                          {f.latestComment.dateFormatted ? ` · ${f.latestComment.dateFormatted}` : ""}
                                        </span>
                                      </p>
                                    ) : (
                                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">No sales notes yet.</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
                {genActiveBoard.length === 0 && (
                  <p className="text-sm text-zinc-500">No active telecallers yet — add them in the Controller roster and map each to a region.</p>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
