"use client";

// ManualCallsPanel — TEMPORARY Call Log tab (founder 2026-11-04).
//
// Backfill while NeoDove is unreliable: hand-counted CONNECTED calls per agent
// per IST day + screenshot proof. A month calendar picks the day (back-navigate
// freely); each roster agent gets one connected-calls number + one screenshot
// for that day. The manager-only toggle at the top selects which source the
// leaderboard reads: manual (this log) or NeoDove.
//
// Delete this file + the "calls" tab + backend manual-calls module/routes when
// NeoDove is trusted again.
import React, { useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { hasSalesManagerAccess } from "./SalesControllerPanel";

interface Agent {
  id: string;
  name: string;
  region: string;
}

interface Entry {
  id: string;
  telecallerId: string;
  day: string;
  connectedCalls: number;
  note: string;
  hasScreenshot: boolean;
  screenshotName: string;
  updatedAt?: string | null;
}

interface Payload {
  mode: "manual" | "neodove" | "device";
  day: string;
  from: string;
  to: string;
  agents: Agent[];
  entries: Entry[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function istToday(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${month}-${String(last).padStart(2, "0")}` };
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function ManualCallsPanel() {
  const { me } = useAuth();
  const canManage = hasSalesManagerAccess(me as any);
  const today = useMemo(() => istToday(), []);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const { from, to } = useMemo(() => monthRange(month), [month]);

  const query = useLiveDashboard<Payload>(
    async () => {
      const res = await fetch(`/api/telecalling/manual-calls?from=${from}&to=${to}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      return (await res.json()) as Payload;
    },
    { deps: [from, to] },
  );

  const [drafts, setDrafts] = useState<Record<string, { value: string; note: string }>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [modeBusy, setModeBusy] = useState(false);

  const data = query.data ?? null;
  const mode = data?.mode ?? "neodove";
  const agents = useMemo(
    () => [...(data?.agents ?? [])].sort((a, b) => (a.region || "Z").localeCompare(b.region || "Z") || a.name.localeCompare(b.name)),
    [data],
  );
  const byAgentDay = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const e of data?.entries ?? []) m.set(`${e.day}|${e.telecallerId}`, e);
    return m;
  }, [data]);
  const dayTotals = useMemo(() => {
    const m = new Map<string, { total: number; agents: number; proof: number }>();
    for (const e of data?.entries ?? []) {
      const cur = m.get(e.day) ?? { total: 0, agents: 0, proof: 0 };
      cur.total += e.connectedCalls;
      cur.agents += 1;
      if (e.hasScreenshot) cur.proof += 1;
      m.set(e.day, cur);
    }
    return m;
  }, [data]);

  // Calendar cells: Monday-first grid for the visible month.
  const cells = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Mon=0
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const out: Array<{ day: string | null }> = [];
    for (let i = 0; i < firstDow; i++) out.push({ day: null });
    for (let d = 1; d <= daysInMonth; d++) out.push({ day: `${month}-${String(d).padStart(2, "0")}` });
    return out;
  }, [month]);

  const setMode = async (next: "manual" | "neodove" | "device") => {
    setModeBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/telecalling/manual-calls/mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `toggle failed (${res.status})`);
      setMsg(next === "manual" ? "Manual mode ON — leaderboard reads this log." : next === "device" ? "Device mode — leaderboard reads the Android call log." : "NeoDove mode — leaderboard reads NeoDove.");
      await query.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "toggle failed");
    } finally {
      setModeBusy(false);
    }
  };

  const draftFor = (agentId: string): { value: string; note: string } => {
    const hit = drafts[agentId];
    if (hit) return hit;
    const e = byAgentDay.get(`${selected}|${agentId}`);
    return { value: e ? String(e.connectedCalls) : "", note: e?.note ?? "" };
  };

  const saveRow = async (agent: Agent) => {
    const d = draftFor(agent.id);
    const connected = Math.floor(Number(d.value));
    if (!DAY_RE.test(selected)) return setMsg("Pick a day first.");
    if (!Number.isFinite(connected) || connected < 0 || connected > 10000) {
      return setMsg(`Bad number for ${agent.name}: enter 0–10000.`);
    }
    setSaving(agent.id);
    setMsg(null);
    try {
      const res = await fetch("/api/telecalling/manual-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telecallerId: agent.id, day: selected, connectedCalls: connected, note: d.note.slice(0, 500) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `save failed (${res.status})`);
      const file = files[agent.id];
      if (file) {
        const form = new FormData();
        form.append("file", file);
        form.append("telecallerId", agent.id);
        form.append("day", selected);
        const up = await fetch("/api/telecalling/manual-calls/file", { method: "POST", body: form });
        const uj = await up.json().catch(() => ({}));
        if (!up.ok) throw new Error(uj?.error || `saved, but proof upload failed (${up.status})`);
      }
      setDrafts((p) => {
        const n = { ...p };
        delete n[agent.id];
        return n;
      });
      setFiles((p) => ({ ...p, [agent.id]: null }));
      setMsg(`Saved ${agent.name} · ${selected} · ${connected} connected.`);
      await query.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "save failed");
    } finally {
      setSaving(null);
    }
  };

  const removeRow = async (agent: Agent) => {
    if (!window.confirm(`Clear ${agent.name}'s entry for ${selected}?`)) return;
    setSaving(agent.id);
    try {
      const res = await fetch(
        `/api/telecalling/manual-calls?telecallerId=${encodeURIComponent(agent.id)}&day=${encodeURIComponent(selected)}`,
        { method: "DELETE" },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `clear failed (${res.status})`);
      setMsg(`Cleared ${agent.name} · ${selected}.`);
      await query.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "clear failed");
    } finally {
      setSaving(null);
    }
  };

  const selectedTotal = dayTotals.get(selected)?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-500/40 bg-amber-50 p-4 dark:bg-amber-950/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
              TEMPORARY · Manual connected-call log {mode === "manual" ? "· ACTIVE" : "· standby"}
            </p>
            <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
              {mode === "manual"
                ? "Leaderboard connected calls read THIS log (NeoDove ignored)."
                : "Leaderboard reads NeoDove. Flip the toggle to use this log instead."}
            </p>
          </div>
          {canManage ? (
            <div className="flex gap-1 rounded-full bg-white/70 p-1 ring-1 ring-amber-500">
              {(["manual", "device", "neodove"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  disabled={modeBusy || mode === m}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${mode === m ? "bg-amber-600 text-white" : "text-amber-800 hover:bg-amber-100"} disabled:opacity-80`}
                >
                  {m}
                </button>
              ))}
            </div>
          ) : (
            <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-500">
              {mode} mode
            </span>
          )}
        </div>
      </div>

      {msg && (
        <div className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-4 py-2 text-xs text-[var(--text-secondary)]">
          {msg}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Calendar: move back in time and pick the day to mark. */}
        <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <button
              onClick={() => { const m = shiftMonth(month, -1); setMonth(m); }}
              className="rounded-lg px-2 py-1 text-sm ring-1 ring-[var(--border-card)] hover:bg-black/5"
              aria-label="Previous month"
            >
              ←
            </button>
            <p className="text-sm font-bold text-[var(--text-primary)]">{month}</p>
            <button
              onClick={() => { const m = shiftMonth(month, 1); setMonth(m); }}
              className="rounded-lg px-2 py-1 text-sm ring-1 ring-[var(--border-card)] hover:bg-black/5"
              aria-label="Next month"
            >
              →
            </button>
          </div>
          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-[var(--text-tertiary)]">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((c, i) => {
              if (!c.day) return <span key={i} />;
              const t = dayTotals.get(c.day);
              const active = c.day === selected;
              return (
                <button
                  key={i}
                  onClick={() => setSelected(c.day as string)}
                  className={`rounded-lg px-1 py-1.5 text-center ring-1 ${
                    active
                      ? "bg-indigo-600 text-white ring-indigo-600"
                      : "bg-black/[0.02] text-[var(--text-primary)] ring-[var(--border-card)] hover:bg-black/5"
                  }`}
                  title={t ? `${t.total} connected · ${t.agents} agents` : "no entries"}
                >
                  <span className="block text-xs font-bold">{Number((c.day as string).slice(8))}</span>
                  <span className={`block text-[10px] font-mono ${active ? "text-indigo-100" : "text-[var(--text-secondary)]"}`}>
                    {t ? t.total : "·"}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}
            className="mt-3 w-full rounded-lg px-2 py-1.5 text-xs font-semibold ring-1 ring-[var(--border-card)] hover:bg-black/5"
          >
            Jump to today ({today})
          </button>
        </div>

        {/* Day sheet: one connected-calls number + screenshot per agent. */}
        <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-bold text-[var(--text-primary)]">
              {selected} <span className="text-xs font-normal text-[var(--text-secondary)]">· {selectedTotal} connected total</span>
            </h3>
            <span className="text-[11px] text-[var(--text-tertiary)]">{agents.length} agents</span>
          </div>
          {query.loading && <p className="text-xs text-[var(--text-secondary)]">Loading…</p>}
          {query.error ? <p className="text-xs text-red-600">Load failed: {String(query.error)}</p> : null}
          <div className="space-y-2">
            {agents.map((a) => {
              const e = byAgentDay.get(`${selected}|${a.id}`);
              const d = draftFor(a.id);
              const busy = saving === a.id;
              return (
                <div key={a.id} className="rounded-xl border border-[var(--border-card)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      {a.name} <span className="ml-1 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-bold">{a.region || "—"}</span>
                      {e?.hasScreenshot && <span className="ml-1 text-[11px]" title={e.screenshotName || "proof"}>🧾</span>}
                    </p>
                    {e && (
                      <a
                        className="text-[11px] font-semibold text-indigo-600 underline"
                        href={`/api/telecalling/manual-calls/file?telecallerId=${encodeURIComponent(a.id)}&day=${encodeURIComponent(selected)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        view proof
                      </a>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="text-[11px] text-[var(--text-secondary)]">
                      Connected
                      <input
                        type="number"
                        min={0}
                        max={10000}
                        value={d.value}
                        onChange={(ev) => setDrafts((p) => ({ ...p, [a.id]: { value: ev.target.value, note: d.note } }))}
                        placeholder={e ? String(e.connectedCalls) : "0"}
                        className="ml-1 w-24 rounded-lg border border-[var(--border-card)] bg-white px-2 py-1 text-sm text-black"
                      />
                    </label>
                    <input
                      type="text"
                      value={d.note}
                      onChange={(ev) => setDrafts((p) => ({ ...p, [a.id]: { value: d.value, note: ev.target.value } }))}
                      placeholder="note (optional)"
                      maxLength={500}
                      className="min-w-[140px] flex-1 rounded-lg border border-[var(--border-card)] bg-white px-2 py-1 text-xs text-black"
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(ev) => setFiles((p) => ({ ...p, [a.id]: ev.target.files?.[0] ?? null }))}
                      className="text-[11px] text-[var(--text-secondary)]"
                    />
                    {files[a.id] && <span className="text-[11px] text-[var(--text-secondary)]">{files[a.id]?.name}</span>}
                    <span className="flex-1" />
                    {e && canManage && (
                      <button
                        onClick={() => removeRow(a)}
                        disabled={busy}
                        className="rounded-lg px-2 py-1 text-[11px] font-semibold text-red-600 ring-1 ring-red-300 hover:bg-red-50 disabled:opacity-50"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      onClick={() => saveRow(a)}
                      disabled={busy}
                      className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {busy ? "Saving…" : e ? "Update" : "Save"}
                    </button>
                  </div>
                </div>
              );
            })}
            {agents.length === 0 && !query.loading && (
              <p className="text-xs text-[var(--text-secondary)]">No roster agents found.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
