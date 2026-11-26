"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/user-admin/ViewAsTab.tsx — root's "view as" launcher.
//
// The founder's flow: pick a POSITION → pick the PERSON seated there → Enter.
// Entering sets the read-only overlay cookie, swaps the identity for every API
// call, and lands on that person's dashboard gallery (/session) — their sidebar,
// their dashboards, their notification bell.
//
// Data is reused, not re-invented: `GET /api/org/people` already returns the
// chart person + their login + roles, and `GET /api/auth/view-as` is the audit
// trail this same action writes.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { fetchOrgChart, fetchOrgPeople, type OrgChartPosition, type OrgPerson } from "@/org/api";
import { fetchViewAsLog, type ViewAsLogRow } from "@/api/auth-view-as";
import { fmtIstDateTime } from "@/lib/format";
import { useHashRoute } from "@/hooks/useHashRoute";

const UNSEATED = "Not seated";
const CARD = "rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900";
const BTN = "rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-40";

interface Seat {
  title: string;
  people: OrgPerson[];
}

export function ViewAsTab() {
  const { me, isViewingAs, enterViewAs, exitViewAs, viewAsBusy } = useAuth();
  const { navigate } = useHashRoute();
  const [people, setPeople] = useState<OrgPerson[]>([]);
  const [positions, setPositions] = useState<OrgChartPosition[]>([]);
  const [log, setLog] = useState<ViewAsLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [org, rows, chart] = await Promise.all([fetchOrgPeople(), fetchViewAsLog(), fetchOrgChart().catch(() => null)]);
      setPeople(Array.isArray(org?.people) ? org.people : []);
      setPositions(chart?.positions ?? []);
      setLog(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the chart");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Chart order, then anything with no chart title (logins not yet seated).
  const seats = useMemo<Seat[]>(() => {
    const byTitle = new Map<string, OrgPerson[]>();
    for (const p of people) {
      const t = (p.employee.designation || "").trim() || UNSEATED;
      if (!byTitle.has(t)) byTitle.set(t, []);
      byTitle.get(t)!.push(p);
    }
    const order = positions.map((x) => x.title);
    const titles = [...order.filter((t) => byTitle.has(t)), ...[...byTitle.keys()].filter((t) => !order.includes(t))];
    return titles.map((title) => ({
      title,
      people: (byTitle.get(title) ?? []).sort((a, b) => ((a.employee.displayName || a.employee.name) || "").localeCompare((b.employee.displayName || b.employee.name) || "")),
    }));
  }, [people, positions]);

  // Default to the first position that actually has someone with a login.
  useEffect(() => {
    if (position || seats.length === 0) return;
    const first = seats.find((s) => s.people.some((p) => p.login)) ?? seats[0];
    setPosition(first.title);
  }, [seats, position]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const pick = seats.find((s) => s.title === position);
    const base = q ? seats.flatMap((s) => s.people) : (pick?.people ?? []);
    if (!q) return base;
    return base.filter((p) => {
      const hay = `${p.employee.displayName ?? p.employee.name ?? ""} ${p.employee.name ?? ""} ${p.employee.email ?? ""} ${p.login?.email ?? ""} ${(p.login?.roles ?? []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [seats, position, q]);

  const target = useMemo(() => people.find((p) => p.login?.id === selected) ?? null, [people, selected]);

  const enter = async () => {
    if (!target?.login?.id) return;
    try {
      await enterViewAs(target.login.id);
      navigate("/session");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enter view-as");
    }
  };

  const seatCount = (s: Seat) => s.people.filter((p) => p.login).length;

  return (
    <section className="space-y-4">
      {isViewingAs && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
            You are currently viewing as <b>{me?.user.displayName || me?.user.name}</b> ({me?.user.email}) — read-only.
          </p>
          <button type="button" onClick={() => void exitViewAs()} disabled={viewAsBusy}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-amber-500 disabled:opacity-40">
            Exit view-as
          </button>
        </div>
      )}

      <div className={`${CARD} p-4`}>
        <h3 className="font-heading text-sm font-bold">View a dashboard as someone else</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Pick a position, pick the person seated there, then <b>Enter</b>. You get their sidebar, their dashboards and
          their notification bell — exactly what they see right now. <b>Read-only</b>: saves are refused while you are
          inside, and their own session and live notifications keep running untouched. Every view is logged below.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-semibold text-rose-600 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[260px_1fr]">
        {/* Positions */}
        <div className={`${CARD} overflow-hidden`}>
          <div className="border-b border-zinc-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:border-zinc-800">
            Positions · {seats.length}
          </div>
          <div className="max-h-[420px] overflow-auto p-1.5">
            {loading && <p className="p-3 text-xs text-zinc-500">Loading chart…</p>}
            {!loading && seats.length === 0 && <p className="p-3 text-xs text-zinc-500">No employees on the chart yet.</p>}
            {seats.map((s) => {
              const active = s.title === position && !q;
              return (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => { setPosition(s.title); setSelected(null); setQuery(""); }}
                  className={`mb-1 flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ${
                    active ? "bg-indigo-600 text-white" : "hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span className="truncate font-semibold">{s.title}</span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/25" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                    {seatCount(s)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* People at that position */}
        <div className={`${CARD} flex flex-col overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              {q ? "Search — all positions" : position ?? "People"}
            </span>
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              placeholder="Search name, email, role…"
              className="ml-auto w-[210px] rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs outline-none dark:border-zinc-700 dark:bg-zinc-950"
            />
          </div>
          <div className="max-h-[360px] overflow-auto">
            {!loading && visible.length === 0 && (
              <p className="p-4 text-xs text-zinc-500">
                Nobody seated here yet. Seat a person in HR → People (chart title), or search to reach a login that is not on the chart.
              </p>
            )}
            {visible.map((p) => {
              const login = p.login;
              const active = login?.id === selected;
              return (
                <button
                  key={p.employee.id}
                  type="button"
                  disabled={!login}
                  onClick={() => login && setSelected(login.id)}
                  className={`flex w-full items-center gap-3 border-b border-zinc-200/60 px-3 py-2 text-left text-xs last:border-0 dark:border-zinc-800/60 ${
                    active ? "bg-indigo-500/10" : login ? "hover:bg-zinc-100 dark:hover:bg-zinc-800/60" : "opacity-45"
                  }`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
                    {(p.employee.displayName || p.employee.name || "?").replace(/\([^)]*\)/g, " ").trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {p.employee.displayName || p.employee.name}
                      {p.employee.designation && p.employee.designation !== position && !q && (
                        <span className="ml-1.5 text-[10px] font-normal text-zinc-500">{p.employee.designation}</span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-zinc-500">
                      {login?.email || p.employee.email || "no email"}
                      {login ? ` · ${login.roles.length ? login.roles.join(", ") : "no role"} · ${login.scopes.length} dashboard${login.scopes.length === 1 ? "" : "s"}` : " · no login — grant a role first"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[10px] text-zinc-500">
                    {login?.lastLoginAt ? fmtIstDateTime(login.lastLoginAt) : login ? "never signed in" : "—"}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
            <span className="text-[11px] text-zinc-500">
              {target ? <>Entering as <b className="text-zinc-700 dark:text-zinc-200">{target.employee.displayName || target.employee.name}</b> — read-only</> : "Select a person to continue"}
            </span>
            <button type="button" onClick={() => void enter()} disabled={!target || viewAsBusy} className={BTN}>
              {viewAsBusy ? "Entering…" : "Enter dashboard →"}
            </button>
          </div>
        </div>
      </div>

      {/* Audit trail */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Recent views {log.length > 0 && `· ${log.length}`}</span>
          <button type="button" onClick={() => void load()} className="text-[11px] font-semibold text-indigo-500 hover:underline">Refresh</button>
        </div>
        {log.length === 0 ? (
          <p className="p-3 text-xs text-zinc-500">No impersonation recorded yet.</p>
        ) : (
          <div className="max-h-[180px] divide-y divide-zinc-200/60 overflow-auto dark:divide-zinc-800/60">
            {log.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-[11px]">
                <span className="truncate">
                  <b>{r.rootEmail ?? "root"}</b> → <b>{r.targetName ?? r.targetEmail ?? "unknown"}</b>
                  {r.targetEmail && <span className="text-zinc-500"> · {r.targetEmail}</span>}
                </span>
                <span className="shrink-0 text-zinc-500">
                  {fmtIstDateTime(r.startedAt)}{r.endedAt ? ` · ended ${fmtIstDateTime(r.endedAt)}` : " · still open"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default ViewAsTab;
