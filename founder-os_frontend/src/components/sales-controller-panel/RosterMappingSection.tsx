"use client";

// Roster mapping queue (Phase A): directory logins with no sales-roster row.
// HR creates the person; the sales head maps region (+type) here, or Links
// when the email is already rostered (backend 409 carries linkTo — never a
// silent double-create). Reads directory live; Map/Link go through the
// telecalling domain api module (never inline fetch).
import { useMemo, useState } from "react";
import { fetchDirectory } from "@/auth/api";
import type { DirectoryRow } from "@/auth/directory";
import { mapRosterFromDirectory, linkRosterByLogin } from "@/telecalling/api";
import { useLiveDashboard } from "@/hooks/useLiveData";
import type { RosterRow } from "../TelecallingDashboard";

const REGIONS = ["R1", "R2", "R3", "R4"];
const TYPES = [
  { value: "telecaller", label: "Telecaller" },
  { value: "field_staff", label: "Field Staff" },
  { value: "team_lead", label: "Team Lead" },
] as const;

export function RosterMappingSection({
  rosterRows,
  refreshAll,
}: {
  rosterRows: RosterRow[];
  refreshAll: () => void;
}) {
  const dir = useLiveDashboard(() => fetchDirectory(), { events: ["telecalling"] });
  const [regionById, setRegionById] = useState<Record<string, string>>({});
  const [typeById, setTypeById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, { linkTo: string; name: string }>>({});

  const unmapped: DirectoryRow[] = useMemo(() => {
    const rosterEmails = new Set(
      rosterRows.map((t) => String(t.email ?? "").toLowerCase().trim()).filter(Boolean),
    );
    return (dir.data?.directory ?? []).filter(
      (u) => u.email && !rosterEmails.has(u.email.toLowerCase().trim()),
    );
  }, [dir.data, rosterRows]);

  const mapRow = async (u: DirectoryRow) => {
    const region = regionById[u.id] ?? "";
    if (!region) {
      setError(`Pick a region for ${u.name || u.email} first.`);
      return;
    }
    setBusyId(u.id);
    setError(null);
    try {
      await mapRosterFromDirectory({
        userId: u.id,
        region,
        type: (typeById[u.id] as "telecaller" | "field-staff" | "team_lead" | undefined) ?? "telecaller",
      });
      refreshAll();
      dir.refresh();
    } catch (e: unknown) {
      const linkTo = e != null && typeof e === "object" ? (e as { linkTo?: unknown }).linkTo : undefined;
      if (typeof linkTo === "string" && linkTo) {
        const linkName = (e as { linkName?: unknown }).linkName;
        setConflicts((c) => ({ ...c, [u.id]: { linkTo, name: typeof linkName === "string" ? linkName : "" } }));
        setError(`${u.name || u.email} is already on the roster — use Link instead.`);
      } else {
        setError(e instanceof Error ? e.message : "Map failed");
      }
    } finally {
      setBusyId(null);
    }
  };

  const linkRow = async (u: DirectoryRow) => {
    const c = conflicts[u.id];
    if (!c) return;
    setBusyId(u.id);
    setError(null);
    try {
      await linkRosterByLogin(c.linkTo, u.id);
      setConflicts((prev) => {
        const next = { ...prev };
        delete next[u.id];
        return next;
      });
      refreshAll();
      dir.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-bold">Unmapped logins → roster</h3>
        <span className="text-xs font-bold text-zinc-500">{unmapped.length} waiting</span>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
        Logins HR created with no sales-roster row. Map assigns region (+type);
        field staff take region like everyone else. Email already rostered → Link instead of Map.
      </p>
      {dir.loading && !dir.data && <div className="py-6 text-center text-sm text-zinc-500 animate-pulse">Loading logins…</div>}
      {Boolean(dir.error) && <div className="mb-3 text-xs font-semibold text-rose-500 bg-rose-500/10 rounded-lg px-3 py-2">Directory failed to load: {String(dir.error)}</div>}
      {error && <div className="mb-3 text-xs font-semibold text-rose-500 bg-rose-500/10 rounded-lg px-3 py-2">{error}</div>}
      {dir.data && unmapped.length === 0 && (
        <p className="text-sm text-zinc-500">Every login is roster-linked. Nothing waiting.</p>
      )}
      {unmapped.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {unmapped.map((u) => {
            const conflict = conflicts[u.id];
            return (
              <div key={u.id} className="rounded-xl border border-amber-500/30 bg-white dark:bg-zinc-950 p-4">
                <div className="font-semibold text-zinc-900 dark:text-white truncate">{u.name || u.email}</div>
                <div className="text-[11px] text-zinc-500 truncate">{u.email}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <select value={regionById[u.id] ?? ""} onChange={(e) => setRegionById((m) => ({ ...m, [u.id]: e.target.value }))}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none">
                    <option value="">Region…</option>
                    {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select value={typeById[u.id] ?? "telecaller"} onChange={(e) => setTypeById((m) => ({ ...m, [u.id]: e.target.value }))}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none">
                    {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="mt-3 flex gap-2">
                  {conflict ? (
                    <button onClick={() => linkRow(u)} disabled={busyId === u.id} title={conflict.name ? `Attach to “${conflict.name}”` : undefined}
                      className="flex-1 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white py-2 font-bold disabled:opacity-40 cursor-pointer border-0">
                      {busyId === u.id ? "Linking…" : "Link to existing row"}
                    </button>
                  ) : (
                    <button onClick={() => mapRow(u)} disabled={busyId === u.id}
                      className="flex-1 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white py-2 font-bold disabled:opacity-40 cursor-pointer border-0">
                      {busyId === u.id ? "Mapping…" : "Map to roster"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
