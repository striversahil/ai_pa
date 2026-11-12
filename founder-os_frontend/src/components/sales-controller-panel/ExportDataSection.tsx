"use client";

// Extracted verbatim from SalesControllerPanel.tsx by scripts/refactor/split-module.mjs.
// SalesControllerPanel.tsx re-exports everything public here, so existing imports keep working.
import { adaptDashData } from "../TelecallingDashboard";
import type { RosterRow, DashData, DailyRow } from "../TelecallingDashboard";
import { useState } from "react";
import { workspaceDataUrl } from "@/workspaces/api";
import { downloadCsv, EXPORT_PERIODS } from "./helpers";

export function ExportDataSection({ rosterRows, showRisk }: { rosterRows: RosterRow[]; showRisk: boolean }) {
  const [period, setPeriod] = useState("week");
  const [subset, setSubset] = useState("all");
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(false);
  const [loadingEst, setLoadingEst] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subsetRows = () => {
    if (subset === "followups") return rosterRows.filter((r) => r.assignEstimateFollowUps);
    if (subset === "leadgen") return rosterRows.filter((r) => !r.assignEstimateFollowUps);
    if (subset !== "all" && subset !== "") return rosterRows.filter((r) => r.id === subset);
    return rosterRows;
  };

  const doExport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${workspaceDataUrl("telecalling")}?period=${period}&daily=1`);
      if (!res.ok) throw new Error(`Failed to load telecalling data (HTTP ${res.status})`);
      const data: DashData = adaptDashData(await res.json());
      const wanted = subsetRows();
      const wantedIds = new Set(wanted.map((r) => r.id));

      const stamp = new Date().toISOString().slice(0, 10);
      const periodLabel = data.meta?.periodLabel ?? period;
      const base = `founder-os_all_${periodLabel.replace(/\s+/g, "_").toLowerCase()}_${stamp}.csv`;
      const rows: (string | number | null | undefined)[][] = [];

      // Section 1 — Performance (per-telecaller leaderboard)
      rows.push(["═══ PERFORMANCE (LEADERBOARD) ═══"]);
      rows.push([
        "Rank", "Sales staff", "Type", "Follow-ups", "NeoDove user",
        "Open (region)", "Won", "Conv %", "Pipeline ₹", "Closed ₹",
        "Calls Attempted", "Calls Connected", "Calls %", "Talk (min)",
        "Leads Generated", "Leads %", "Score",
        ...(showRisk ? ["At Risk", "Zombie"] : []),
      ]);
      data.leaderboard
        .filter((r) => wantedIds.has(r.id))
        .forEach((r, i) => {
          rows.push([
            i + 1,
            r.name,
            r.type === "field_staff" ? "Field Staff" : r.type === "team_lead" ? "Team Lead" : "Telecaller",
            r.type === "field_staff" ? "n/a" : r.type === "team_lead" ? "reseller target" : r.assignEstimateFollowUps ? "yes" : "no",
            r.neodoveUserName,
            r.conversion.assigned,
            r.conversion.won,
            r.conversion.conversionRate,
            r.conversion.pipelineValue,
            r.conversion.acceptedValue ?? r.conversion.estimatedConversion?.value ?? 0,
            r.generation.callsAttempted,
            r.generation.callsConnected,
            r.generation.connectedPct,
            Math.round((r.generation.talkTimeSec ?? 0) / 60),
            r.generation.leadsGenerated,
            r.generation.leadsPct,
            r.score,
            ...(showRisk ? [r.risk?.atRisk ?? 0, r.risk?.zombie ?? 0] : []),
          ]);
        });
      rows.push([]);

      // Section 2 — Assignments (conversion summary)
      rows.push(["═══ ASSIGNMENTS (CONVERSION) ═══"]);
      rows.push(["Sales staff", "Type", "Open (region)", "Won", "Conv %", "Pipeline ₹", "Closed ₹"]);
      data.leaderboard
        .filter((r) => wantedIds.has(r.id))
        .forEach((r) => {
          rows.push([
            r.name,
            r.type === "field_staff" ? "Field Staff" : r.type === "team_lead" ? "Team Lead" : "Telecaller",
            r.conversion.assigned,
            r.conversion.won,
            r.conversion.conversionRate,
            r.conversion.pipelineValue,
            r.conversion.acceptedValue ?? r.conversion.estimatedConversion?.value ?? 0,
          ]);
        });
      rows.push([]);

      // Section 3 — Risk (open pipeline, informational only).
      if (showRisk) {
      rows.push(["═══ RISK (OPEN PIPELINE — INFORMATIONAL) ═══"]);
      rows.push([
        "Estimate", "Customer", "Lead owner", "Total ₹", "Risk",
        "Last Comment", "Stale (h)", "Reason",
      ]);
      (data.risk?.atRisk ?? [])
        .filter((r) => !wantedIds.size || (r.telecallerId && wantedIds.has(r.telecallerId)))
        .forEach((r) => {
          rows.push([
            r.estimateNumber ?? r.estimateId,
            r.customerName,
            r.telecallerName,
            r.total,
            r.risk,
            r.lastCommentDate,
            r.staleHours,
            r.snatchReason ?? r.reasoning,
          ]);
        });
      }

      // Section 4 — Daily (per-day × per-agent: every tag, call, lead)
      rows.push([]);
      rows.push(["═══ DAILY (DAY × AGENT — ROOT DETAIL) ═══"]);
      rows.push(["NOTE: Won day = conversion day from the close ledger (20% generator / 80% closer)."]);
      if (data.dailyError) {
        rows.push([`Daily unavailable: ${data.dailyError}`]);
      } else {
        rows.push([
          "Date", "Day", "Telecaller", "Region",
          "Won", "Closed ₹", "Closed Estimates",
          "Calls Attempted", "Calls Connected", "Calls Not Conn.", "Talk (min)",
          "Leads Generated", "Leads Converted", "Score",
        ]);
        const daily = (data.daily ?? []).filter((d) => !wantedIds.size || wantedIds.has(d.telecallerId));
        const byDate = new Map<string, DailyRow[]>();
        for (const d of daily) {
          const arr = byDate.get(d.date) ?? [];
          arr.push(d);
          byDate.set(d.date, arr);
        }
        for (const [date, list] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          const team = {
            won: 0, closedValue: 0, callsAttempted: 0, callsConnected: 0, callsNotConnected: 0,
            talkTimeMin: 0, leadsGenerated: 0, leadsConverted: 0, score: 0,
          };
          const closedTags: string[] = [];
          const regionTags = new Set<string>();
          for (const d of list) {
            team.won += d.won; team.closedValue += d.closedValue;
            team.callsAttempted += d.callsAttempted;
            team.callsConnected += d.callsConnected; team.callsNotConnected += d.callsNotConnected;
            team.talkTimeMin += d.talkTimeMin; team.leadsGenerated += d.leadsGenerated;
            team.leadsConverted += d.leadsConverted; team.score += d.score;
            if (d.closedEstimates) closedTags.push(`${d.telecallerName}: ${d.closedEstimates}`);
            rows.push([
              d.date, d.weekday, d.telecallerName,
              (d as any).region ?? "",
              d.won, d.closedValue, d.closedEstimates,
              d.callsAttempted, d.callsConnected, d.callsNotConnected, d.talkTimeMin,
              d.leadsGenerated, d.leadsConverted, d.score,
            ]);
          }
          rows.push([
            date, list[0]?.weekday ?? "", "— TEAM —", [...regionTags].join(" "),
            team.won, team.closedValue, closedTags.join(" ‖ "),
            team.callsAttempted, team.callsConnected, team.callsNotConnected, team.talkTimeMin,
            team.leadsGenerated, team.leadsConverted, team.score,
          ]);
        }
        if (daily.length === 0) rows.push(["No daily rows (empty range or single-day period)."]);
      }

      downloadCsv(base, rows);
    } catch (e: any) {
      setError(e?.message ?? "Export failed");
    } finally {
      setLoading(false);
    }
  };

  // Per-estimate root export — one row per estimate in the last N days (by
  // estimate/sent date), all statuses (sent/accepted/declined/confirmed), with
  // full lead detail. "Converted By" shows ONLY the lead generator's name
  // (from the +100 close ledger, which credits Estimate.createdBy) on
  // accepted/confirmed rows — blank on declined and still-open rows, by rule.
  const doExportEstimates = async () => {
    setLoadingEst(true);
    setError(null);
    try {
      const n = Math.min(365, Math.max(1, parseInt(days, 10) || 30));
      // IST day N days ago (matches the backend ledger's IST day strings).
      const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
      const since = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - n))
        .toISOString().slice(0, 10);
      const dayOf = (d: any): string => {
        const s = String(d ?? "");
        const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
        const t = Date.parse(s);
        return Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10);
      };
      const [estRes, convRes] = await Promise.all([
        fetch("/api/estimates"),
        fetch(`${workspaceDataUrl("telecalling")}?converters=1&since=${since}`),
      ]);
      if (!estRes.ok) throw new Error(`Failed to load estimates (HTTP ${estRes.status})`);
      if (!convRes.ok) throw new Error(`Failed to load converters (HTTP ${convRes.status})`);
      const estPayload = await estRes.json();
      const convPayload = await convRes.json();
      const converters: Record<string, { name: string; day: string }> = convPayload?.converters ?? {};
      const wanted = new Set(["sent", "accepted", "declined", "confirmed"]);
      const list: any[] = (estPayload?.estimates ?? []).filter(
        (e: any) => wanted.has(String(e?.status ?? "").toLowerCase()) && dayOf(e?.date) >= since
      );
      list.sort((a, b) => dayOf(a?.date).localeCompare(dayOf(b?.date))
        || String(a?.estimateNumber ?? "").localeCompare(String(b?.estimateNumber ?? "")));

      const stamp = new Date().toISOString().slice(0, 10);
      const rows: (string | number | null | undefined)[][] = [];
      rows.push([`ESTIMATES — LAST ${n} DAYS (SINCE ${since}) — ${list.length} ROWS`]);
      rows.push([
        "Estimate", "Sent", "Enq", "Customer", "Contact", "Mobile",
        "Loc", "Source", "By", "Status", "Total ₹", "Converted By",
      ]);
      for (const e of list) {
        const status = String(e?.status ?? "").toLowerCase();
        const won = status === "accepted" || status === "confirmed";
        rows.push([
          e?.estimateNumber ?? e?.estimateId,
          dayOf(e?.date),
          e?.enquiryNumber ?? "",
          e?.customerName ?? "",
          e?.contactName ?? "",
          e?.contactPhone ?? "",
          e?.location ?? "",
          e?.sourceLead ?? "",
          e?.leadOf ?? "",
          status,
          e?.total ?? 0,
          won ? (converters[String(e?.estimateId ?? "")]?.name ?? "") : "",
        ]);
      }
      if (list.length === 0) rows.push(["No estimates in this window."]);
      downloadCsv(`founder-os_estimates_last_${n}days_${stamp}.csv`, rows);
    } catch (e: any) {
      setError(e?.message ?? "Estimates export failed");
    } finally {
      setLoadingEst(false);
    }
  };

  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <h3 className="text-lg font-bold mb-1">📤 Export Data</h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
        Download the FULL telecalling payload as one CSV — performance (leaderboard), assignments (conversion),
        {showRisk ? " risk (open pipeline)," : ""} daily (day × agent: accepted/declined tags, calls, leads) sections.
        Generated client-side from the live dashboard endpoint. The estimates download below is the
        per-estimate root ledger for the last N days (by sent date) — contact, location, source, lead
        creator and Converted By (lead generator only; blank on declined/open rows).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 cursor-pointer focus:outline-none">
            {EXPORT_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Telecallers
          <select value={subset} onChange={(e) => setSubset(e.target.value)}
            className="px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 cursor-pointer focus:outline-none">
            <option value="all">All</option>
            <option value="followups">Follow-up specialists</option>
            <option value="leadgen">Lead-gen only</option>
            {rosterRows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <button onClick={() => void doExport()} disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
          {loading ? "Exporting…" : "⬇ Download CSV"}
        </button>
        {error && <span className="text-xs text-rose-500">{error}</span>}
      </div>
      <div className="flex flex-wrap items-end gap-3 mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Last N days (by sent date)
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" placeholder="30"
            className="w-24 px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 focus:outline-none" />
        </label>
        <button onClick={() => void doExportEstimates()} disabled={loadingEst}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
          {loadingEst ? "Exporting…" : "⬇ Download Estimates CSV"}
        </button>
        {error && <span className="text-xs text-rose-500">{error}</span>}
      </div>
      <p className="text-[11px] text-zinc-500 dark:text-zinc-600 mt-2">
        Exports use their own period picker above (independent of the Dashboard
        leaderboard filter) plus the telecaller filter. Deleted agents and unassigned estimates
        are excluded. The daily section covers up to 93 days (year periods export the other sections only).
      </p>
    </section>
  );
}
