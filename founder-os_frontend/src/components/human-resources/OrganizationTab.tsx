"use client";

// OrganizationTab — the live organization chart as a tree (first HR tab).
//
// Founder decision 2026-11-13: HR sees WHO is active in every position, what
// each position is responsible for, and which dashboard logins resolve to it
// (hover peeks, click pins). Seats come from the employee master — the chart's
// `count` is never shown. Login → sales-roster mapping lives on the node too,
// replacing the retired "Unmapped logins" sections in Employees and Controller.
import { useMemo } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { fetchDirectory } from "@/auth/api";
import { fetchSalesRoster } from "@/telecalling/api";
import { listMembers } from "@/hr/api";
import type { HrEmployee } from "@/hr/types";
import type { DirectoryRow } from "@/auth/directory";
import { buildOrgTree, isOrgTitle, loginPositionsFor, ORG_POSITIONS, suggestOrgTitle, type OrgTreeNode } from "@/hr/organization";
import OrgNodeCard from "./OrgNodeCard";

export default function OrganizationTab() {
  const dash = useLiveDashboard(async () => {
    // Seats are the chart's real data — these must succeed. Directory + roster
    // only decorate the tree (logins, Map/Link), so a 403 there (a viewer
    // without HR/user-management width) degrades to "logins unavailable"
    // instead of blanking the whole chart.
    const members = await listMembers();
    const [dir, roster] = await Promise.all([
      fetchDirectory().catch(() => null),
      fetchSalesRoster().catch(() => []),
    ]);
    return {
      members,
      directory: dir?.directory ?? [],
      canManage: !!dir?.canManage,
      loginsBlocked: dir === null,
      rosterEmails: roster.map((r) => String(r.email ?? "").toLowerCase().trim()).filter(Boolean),
    };
  }, { events: ["human-resources", "telecalling"], pollMs: 60000 });

  const members: HrEmployee[] = dash.data?.members ?? [];
  const directory: DirectoryRow[] = dash.data?.directory ?? [];
  const canManage = dash.data?.canManage ?? false;
  const loginsBlocked = dash.data?.loginsBlocked ?? false;
  const rosterEmails = useMemo(() => new Set(dash.data?.rosterEmails ?? []), [dash.data]);

  /** Active employees per chart title — exact designation match (the picker
   *  guarantees it for every row saved since 2026-11-13). */
  const seatsByTitle = useMemo(() => {
    const map = new Map<string, HrEmployee[]>();
    for (const m of members) {
      if (!m.active) continue;
      const key = String(m.designation ?? "").trim();
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return map;
  }, [members]);

  /** Directory logins per chart title, via the login-position taxonomy. */
  const loginsByTitle = useMemo(() => {
    const map = new Map<string, DirectoryRow[]>();
    for (const p of ORG_POSITIONS) {
      const keys = loginPositionsFor(p.title);
      if (keys.length === 0) continue;
      const rows = directory.filter((d) => keys.includes(String(d.position ?? "")));
      if (rows.length > 0) map.set(p.title, rows);
    }
    return map;
  }, [directory]);

  const tree = useMemo(() => buildOrgTree(), []);

  /** Active people whose designation is not on the chart (legacy free text). */
  const legacy = useMemo(
    () => members.filter((m) => m.active && String(m.designation ?? "").trim() && !isOrgTitle(m.designation)),
    [members],
  );

  const activeSeats = members.filter((m) => m.active && isOrgTitle(m.designation)).length;
  const filledPositions = ORG_POSITIONS.filter((p) => (seatsByTitle.get(p.title)?.length ?? 0) > 0).length;

  const renderNode = (node: OrgTreeNode, depth: number) => (
    <div key={node.title} className="space-y-0.5">
      <OrgNodeCard
        node={node}
        depth={depth}
        seats={seatsByTitle.get(node.title) ?? []}
        logins={loginsByTitle.get(node.title) ?? []}
        rosterEmails={rosterEmails}
        canManage={canManage}
        onChanged={() => dash.refresh()}
      />
      {node.children.map((child) => renderNode(child, depth + 1))}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Chart positions" value={String(ORG_POSITIONS.length)} />
        <Stat label="Filled" value={`${filledPositions}/${ORG_POSITIONS.length}`} tone="emerald" />
        <Stat label="Active seats" value={String(activeSeats)} />
        <Stat label="Logins mapped" value={loginsBlocked ? "—" : String(directory.length)} tone="sky" />
      </div>

      {loginsBlocked && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
          Seats are live, but dashboard logins need HR or user-management access — open this chart with an HR login to see who holds each position.
        </p>
      )}

      {dash.loading && !dash.data && <div className="py-12 text-center text-sm text-zinc-500 animate-pulse">Loading the organization chart…</div>}
      {Boolean(dash.error) && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">
          Chart failed to load: {String(dash.error)}
          <button onClick={() => dash.refresh()} className="ml-2 underline">retry</button>
        </div>
      )}

      {dash.data && (
        <>
          <section className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold">{tree.title} · {tree.title === "MD" ? "Managing Director" : tree.title}</h3>
                <p className="text-[11px] text-zinc-500">
                  Hover a position to peek at its dashboard logins · click to see who sits there and map a waiting login.
                </p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">live chart</span>
            </div>
            <div className="space-y-0.5">
              {tree.children.map((child) => renderNode(child, 0))}
            </div>
          </section>

          {legacy.length > 0 && (
            <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-amber-700 dark:text-amber-400">Not on the chart ({legacy.length})</h3>
                <span className="text-[10px] text-amber-700/80 dark:text-amber-400/80">open the employee and pick a chart position</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {legacy.map((m) => {
                  const suggested = suggestOrgTitle(m.designation);
                  return (
                    <span key={m.id} className="rounded-full border border-amber-500/30 bg-white px-2 py-0.5 text-[11px] dark:bg-zinc-950">
                      <span className="font-semibold text-zinc-700 dark:text-zinc-200">{m.name}</span>
                      <span className="text-zinc-400"> · {m.designation ?? m.department ?? "no designation"}</span>
                      {suggested && <span className="text-emerald-600 dark:text-emerald-400"> → {suggested}</span>}
                    </span>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "sky" }) {
  const color = tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : tone === "sky" ? "text-sky-600 dark:text-sky-400" : "text-zinc-800 dark:text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-base font-extrabold ${color}`}>{value}</div>
    </div>
  );
}
