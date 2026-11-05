"use client";

// CallsPanel — the Sales → Calls tab.
//
// Source switch (neodove / manual / device), the device call log with filters
// and playback, and the device provisioning desk. `manual` renders the legacy
// hand-count sheet; `device` renders the Android app log. Agents see only their
// own rows server-side; managers see every region.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useLiveQuery } from "@/hooks/useLiveData";
import { hasSalesManagerAccess } from "./SalesControllerPanel";
import ManualCallsPanel from "./ManualCallsPanel";
import {
  fetchCalls,
  fetchDevices,
  fetchSource,
  fetchSummary,
  issuePairCode,
  revokeDevice,
  setLoggingOnly,
  setSource,
} from "@/device-calls/api";
import { displayNumber, emptyTotals, fmtDuration, fmtTalk, fmtTime, istToday, monthAgo } from "@/device-calls/normalize";
import type { CallFilters, CallSource, DeviceCall, DeviceRow } from "@/device-calls/types";

const STATUSES = ["CONNECTED", "MISSED", "REJECTED", "BLOCKED", "FAILED"];

function statusTone(status: string): string {
  switch (status) {
    case "CONNECTED": return "bg-emerald-100 text-emerald-800 ring-emerald-300";
    case "MISSED": return "bg-red-100 text-red-700 ring-red-300";
    case "REJECTED": return "bg-orange-100 text-orange-700 ring-orange-300";
    case "BLOCKED": return "bg-violet-100 text-violet-700 ring-violet-300";
    default: return "bg-slate-100 text-slate-600 ring-slate-300";
  }
}

export default function CallsPanel() {
  const { me } = useAuth();
  const canManage = hasSalesManagerAccess(me as any);
  const [source, setSourceState] = useState<CallSource>("neodove");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [filters, setFilters] = useState<CallFilters>({ from: istToday(), to: istToday() });
  const [selected, setSelected] = useState<DeviceCall | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [message, setMessage] = useState("");

  const loadSource = useCallback(async () => {
    try { setSourceState((await fetchSource()).mode); } catch { /* default */ }
  }, []);
  useEffect(() => { void loadSource(); }, [loadSource]);

  const changeSource = async (next: CallSource) => {
    setSourceBusy(true);
    setMessage("");
    try {
      await setSource(next);
      setSourceState(next);
      setMessage(next === "device"
        ? "Device log is now the leaderboard source."
        : next === "manual"
          ? "Manual log is now the leaderboard source."
          : "NeoDove is now the leaderboard source.");
    } catch (e: any) {
      setMessage(e?.message ?? "switch failed");
    } finally {
      setSourceBusy(false);
    }
  };

  if (source === "manual") {
    return (
      <div className="space-y-4">
        <SourceSwitch source={source} canManage={canManage} busy={sourceBusy} onChange={changeSource} message={message} />
        <ManualCallsPanel />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SourceSwitch source={source} canManage={canManage} busy={sourceBusy} onChange={changeSource} message={message} />
      {source === "neodove" && (
        <div className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-xs text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
          The leaderboard currently reads NeoDove. This view still shows the device log for review.
        </div>
      )}
      <DeviceCallsView
        canManage={canManage}
        filters={filters}
        setFilters={setFilters}
        onSelect={setSelected}
        devicesOpen={devicesOpen}
        setDevicesOpen={setDevicesOpen}
      />
      {selected && <CallDrawer call={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function SourceSwitch({ source, canManage, busy, onChange, message }: {
  source: CallSource;
  canManage: boolean;
  busy: boolean;
  onChange: (s: CallSource) => void;
  message: string;
}) {
  const options: Array<{ key: CallSource; label: string }> = [
    { key: "device", label: "Device app" },
    { key: "manual", label: "Manual" },
    { key: "neodove", label: "NeoDove" },
  ];
  return (
    <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">Connected-call source</p>
          <p className="text-[11px] text-[var(--text-tertiary)]">Only the selected source feeds the leaderboard — no double counting.</p>
        </div>
        <div className="flex gap-1 rounded-full bg-black/5 p-1">
          {options.map((o) => (
            <button
              key={o.key}
              disabled={!canManage || busy}
              onClick={() => onChange(o.key)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${source === o.key ? "bg-indigo-600 text-white shadow" : "text-[var(--text-secondary)] hover:bg-white/70"} disabled:opacity-60`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {message && <p className="mt-2 text-[11px] text-[var(--text-secondary)]">{message}</p>}
    </div>
  );
}

function DeviceCallsView({ canManage, filters, setFilters, onSelect, devicesOpen, setDevicesOpen }: {
  canManage: boolean;
  filters: CallFilters;
  setFilters: (f: CallFilters) => void;
  onSelect: (c: DeviceCall) => void;
  devicesOpen: boolean;
  setDevicesOpen: (v: boolean) => void;
}) {
  const query = useLiveQuery(
    async () => fetchCalls(filters),
    { events: ["device-calls", "telecalling"], deps: [filters], clearOnError: true },
  );
  const summary = useLiveQuery(
    async () => fetchSummary(filters),
    { events: ["device-calls", "telecalling"], deps: [filters], clearOnError: true },
  );
  const devices = useLiveQuery(
    async () => (canManage ? fetchDevices() : { devices: [] as DeviceRow[] }),
    { events: ["device-calls"], deps: [canManage], clearOnError: true },
  );
  const agents = useLiveQuery(
    async () => {
      if (!canManage) return { agents: [] as Array<{ id: string; name: string; region: string }> };
      const res = await fetch(`/api/telecalling/manual-calls?from=${filters.from}&to=${filters.to}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      return { agents: (body?.agents ?? []) as Array<{ id: string; name: string; region: string }> };
    },
    { deps: [canManage, filters.from] },
  );

  const totals = summary.data?.totals ?? emptyTotals();
  const rows = query.data?.calls ?? [];
  const isManager = query.data?.viewer.isManager ?? canManage;

  return (
    <>
      <div className="grid gap-2 rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="text-[11px] text-[var(--text-secondary)]">From
          <input type="date" value={filters.from} max={filters.to} onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            className="mt-1 w-full rounded-lg border border-[var(--border-card)] bg-white px-2 py-1 text-xs text-black" />
        </label>
        <label className="text-[11px] text-[var(--text-secondary)]">To
          <input type="date" value={filters.to} min={filters.from} onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            className="mt-1 w-full rounded-lg border border-[var(--border-card)] bg-white px-2 py-1 text-xs text-black" />
        </label>
        {isManager && (
          <label className="text-[11px] text-[var(--text-secondary)]">Agent
            <select value={filters.agentId ?? ""} onChange={(e) => setFilters({ ...filters, agentId: e.target.value || undefined })}
              className="mt-1 w-full rounded-lg border border-[var(--border-card)] bg-white px-2 py-1 text-xs text-black">
              <option value="">All agents</option>
              {(agents.data?.agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.region || "—"}</option>)}
            </select>
          </label>
        )}
        <label className="text-[11px] text-[var(--text-secondary)]">Direction
          <select value={filters.direction ?? ""} onChange={(e) => setFilters({ ...filters, direction: e.target.value || undefined })}
            className="mt-1 w-full rounded-lg border border-[var(--border-card)] bg-white px-2 py-1 text-xs text-black">
            <option value="">Both</option><option value="IN">Incoming</option><option value="OUT">Outgoing</option>
          </select>
        </label>
        <label className="text-[11px] text-[var(--text-secondary)]">Status
          <select value={filters.status ?? ""} onChange={(e) => setFilters({ ...filters, status: e.target.value || undefined })}
            className="mt-1 w-full rounded-lg border border-[var(--border-card)] bg-white px-2 py-1 text-xs text-black">
            <option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-[var(--text-secondary)]">Number / name
          <input value={filters.q ?? ""} onChange={(e) => setFilters({ ...filters, q: e.target.value || undefined })} placeholder="search"
            className="mt-1 w-full rounded-lg border border-[var(--border-card)] bg-white px-2 py-1 text-xs text-black" />
        </label>
        <div className="flex items-end gap-2">
          <button onClick={() => setFilters({ from: monthAgo(), to: istToday() })} className="rounded-lg px-2 py-1 text-[11px] font-bold ring-1 ring-[var(--border-card)] hover:bg-black/5">30 days</button>
          {canManage && <button onClick={() => setDevicesOpen(!devicesOpen)} className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-indigo-700">Devices</button>}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Kpi label="Attempts" value={totals.attempts} />
        <Kpi label="Connected" value={totals.connected} tone="text-emerald-600" />
        <Kpi label="Connect rate" value={`${totals.connectRate}%`} />
        <Kpi label="Missed" value={totals.missed} tone="text-red-600" />
        <Kpi label="Rejected" value={totals.rejected} tone="text-orange-600" />
        <Kpi label="Talk time" value={fmtTalk(totals.talkSec)} />
      </div>

      {devicesOpen && canManage && (
        <DevicesDesk devices={devices.data?.devices ?? []} agents={agents.data?.agents ?? []} onChanged={() => devices.refresh()} />
      )}

      {query.error && <p className="text-xs text-red-600">Load failed: {String(query.error)}</p>}
      <div className="overflow-x-auto rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)]">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-black/[0.03] text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
            <tr>
              <th className="px-3 py-2">When</th><th className="px-3 py-2">Agent</th><th className="px-3 py-2">Direction</th>
              <th className="px-3 py-2">Number</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Talk</th>
              <th className="px-3 py-2">Audio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} onClick={() => onSelect(c)} className="cursor-pointer border-t border-[var(--border-card)] hover:bg-black/[0.03]">
                <td className="px-3 py-2">{fmtTime(c.attemptAt)}</td>
                <td className="px-3 py-2">{c.agentName || "—"}</td>
                <td className="px-3 py-2">{c.direction === "IN" ? "↙ In" : c.direction === "OUT" ? "↗ Out" : "—"}</td>
                <td className="px-3 py-2 font-semibold">{displayNumber(c)}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${statusTone(c.status)}`}>{c.status}</span></td>
                <td className="px-3 py-2">{fmtDuration(c.durationSec)}</td>
                <td className="px-3 py-2">{c.hasRecording ? `🎙 ${c.audioSource}` : c.recordingState === "expired" ? "expired" : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && !query.loading && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--text-secondary)]">No calls in this window.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[var(--text-tertiary)]">Repeat numbers: {totals.repeatedNumbers} · total attempts {totals.attempts}</p>
    </>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{label}</p>
      <p className={`text-xl font-extrabold ${tone ?? "text-[var(--text-primary)]"}`}>{value}</p>
    </div>
  );
}

function CallDrawer({ call, onClose }: { call: DeviceCall; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-[var(--bg-card)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-extrabold">Call detail</h3>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm ring-1 ring-[var(--border-card)]">Close</button>
        </div>
        <div className="mt-4 space-y-2 text-xs">
          <Fact label="Number" value={call.number || "Unknown"} />
          <Fact label="Contact" value={call.contactName || "—"} />
          <Fact label="Agent" value={call.agentName || "—"} />
          <Fact label="Device" value={call.deviceLabel || "—"} />
          <Fact label="When" value={fmtTime(call.attemptAt)} />
          <Fact label="Status" value={call.status} />
          <Fact label="Direction" value={call.direction} />
          <Fact label="Ring / talk" value={`${call.ringSec}s / ${fmtDuration(call.durationSec)}`} />
          <Fact label="Audio source" value={call.audioSource || "—"} />
        </div>
        <div className="mt-4">
          {call.hasRecording ? (
            <audio controls preload="metadata" className="w-full" src={`/api/call-log/recording/${call.id}`} />
          ) : (
            <p className="text-xs text-[var(--text-secondary)]">
              {call.recordingState === "expired" ? "Recording expired after 90 days." : "No recording for this call."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--border-card)] pb-1">
      <span className="text-[var(--text-tertiary)]">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

function DevicesDesk({ devices, agents, onChanged }: {
  devices: DeviceRow[];
  agents: Array<{ id: string; name: string; region: string }>;
  onChanged: () => void;
}) {
  const [agentId, setAgentId] = useState("");
  const [code, setCode] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const issue = async () => {
    if (!agentId) return setError("Pick an agent first.");
    setBusy(true); setError("");
    try {
      const res = await issuePairCode(agentId);
      setCode(res.code);
      setExpires(res.expiresAt);
      onChanged();
    } catch (e: any) { setError(e?.message ?? "failed"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-indigo-300 bg-indigo-50/60 p-4 dark:bg-indigo-950/20">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-bold text-[var(--text-secondary)]">Issue pairing code
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
            className="mt-1 block rounded-lg border border-[var(--border-card)] bg-white px-2 py-1 text-xs text-black">
            <option value="">Select agent…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.region || "—"}</option>)}
          </select>
        </label>
        <button onClick={issue} disabled={busy} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{busy ? "…" : "Generate code"}</button>
        {code && (
          <div className="rounded-lg bg-white px-3 py-1.5 text-xs shadow">
            <span className="font-mono text-base font-extrabold tracking-widest">{code}</span>
            <span className="ml-2 text-[10px] text-[var(--text-tertiary)]">expires {expires ? fmtTime(expires) : ""}</span>
          </div>
        )}
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>

      <div className="space-y-1">
        {devices.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/80 px-3 py-1.5 text-xs">
            <span>
              <b>{d.agentName || d.telecallerId}</b> · {d.label || d.deviceId.slice(0, 8)}
              <span className="ml-2 rounded bg-black/5 px-1 text-[10px]">{d.region || "—"}</span>
              <span className={`ml-2 rounded px-1 text-[10px] font-bold ${d.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{d.status}</span>
            </span>
            <span className="flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
              last seen {d.lastSeenAt ? fmtTime(d.lastSeenAt) : "never"}
              {d.status === "active" && (
                <>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={!!d.loggingOnly} onChange={async (e) => { await setLoggingOnly(d.id, e.target.checked); onChanged(); }} />
                    logging only
                  </label>
                  <button onClick={async () => { await revokeDevice(d.id); onChanged(); }} className="rounded px-1.5 py-0.5 font-bold text-red-600 ring-1 ring-red-300">Revoke</button>
                </>
              )}
            </span>
          </div>
        ))}
        {devices.length === 0 && <p className="text-[11px] text-[var(--text-secondary)]">No devices paired yet.</p>}
      </div>
    </div>
  );
}
