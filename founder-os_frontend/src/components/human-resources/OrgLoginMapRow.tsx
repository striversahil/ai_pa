"use client";

// OrgLoginMapRow — Map/Link controls for ONE directory login.
//
// Extracted from the retired sales-controller-panel/RosterMappingSection.tsx
// (founder decision 2026-11-13: unmapped-people mapping leaves the HR
// Employees tab and the Sales Controller; the HR Organization tree is its one
// home). Same endpoints, same requireRosterManager gate, same 409 → Link
// behaviour — extracted, not rewritten.
//
// Presentational: all fetching/mutation goes through the telecalling domain api
// module (never inline fetch).
import { useState } from "react";
import type { DirectoryRow } from "@/auth/directory";
import { linkRosterByLogin, mapRosterFromDirectory } from "@/telecalling/api";

const REGIONS = ["R1", "R2", "R3", "R4"];
const TYPES = [
  { value: "telecaller", label: "Telecaller" },
  { value: "field_staff", label: "Field Staff" },
  { value: "team_lead", label: "Team Lead" },
] as const;

const select = "rounded-lg border border-zinc-300 bg-white px-1.5 py-1 text-[11px] outline-none dark:border-zinc-700 dark:bg-zinc-950";

export default function OrgLoginMapRow({ row, onMapped }: {
  row: DirectoryRow;
  onMapped: () => void;
}) {
  const [region, setRegion] = useState("");
  const [type, setType] = useState<string>("telecaller");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ linkTo: string; name: string } | null>(null);

  const map = async () => {
    if (!region) { setError("Pick a region first."); return; }
    setBusy(true); setError(null);
    try {
      await mapRosterFromDirectory({
        userId: row.id,
        region,
        type: type as "telecaller" | "field-staff" | "team_lead",
      });
      onMapped();
    } catch (e: unknown) {
      const linkTo = e != null && typeof e === "object" ? (e as { linkTo?: unknown }).linkTo : undefined;
      if (typeof linkTo === "string" && linkTo) {
        const linkName = (e as { linkName?: unknown }).linkName;
        setConflict({ linkTo, name: typeof linkName === "string" ? linkName : "" });
        setError(`${row.name || row.email} is already on the roster — use Link.`);
      } else {
        setError(e instanceof Error ? e.message : "Map failed");
      }
    } finally { setBusy(false); }
  };

  const link = async () => {
    if (!conflict) return;
    setBusy(true); setError(null);
    try {
      await linkRosterByLogin(conflict.linkTo, row.id);
      setConflict(null);
      onMapped();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-amber-500/30 bg-white px-2 py-1.5 dark:bg-zinc-950">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-bold text-zinc-800 dark:text-zinc-100">{row.name || row.email}</div>
        <div className="truncate text-[10px] text-zinc-500">{row.email} · {row.via || "no roster match"}</div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <select value={region} onChange={(e) => setRegion(e.target.value)} className={select} aria-label="Region">
          <option value="">Region…</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={select} aria-label="Roster type">
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {conflict ? (
          <button type="button" onClick={() => void link()} disabled={busy}
            title={conflict.name ? `Attach to “${conflict.name}”` : undefined}
            className="rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-500 disabled:opacity-40">
            {busy ? "Linking…" : "Link"}
          </button>
        ) : (
          <button type="button" onClick={() => void map()} disabled={busy}
            className="rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-indigo-500 disabled:opacity-40">
            {busy ? "Mapping…" : "Map"}
          </button>
        )}
      </div>
      {error && <div className="mt-1 text-[10px] font-semibold text-rose-500">{error}</div>}
    </div>
  );
}
