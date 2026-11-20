"use client";

// Phones waiting to pair. The agent opens the app, it shows a 6-digit code and
// lands here; the sales head picks which agent owns the phone (one active
// phone per agent — approving retires that agent's previous phone).
import { useState } from "react";
import { ConfirmDialog, Badge } from "@/components/ui";
import { relActive } from "@/lib/format";
import type { PairRequest } from "@/telecalling/dialer";

export interface AgentOption { id: string; name: string; region?: string; paired: boolean }

export function PairRequests({
  requests, agents, onApprove, onReject,
}: {
  requests: PairRequest[];
  agents: AgentOption[];
  onApprove: (requestId: string, telecallerId: string) => Promise<void>;
  onReject: (requestId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState<PairRequest | null>(null);
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (r: PairRequest) => {
    setOpen(r);
    setError(null);
    // Pre-select the roster agent whose name matches what the agent typed.
    const hint = r.agentHint.trim().toLowerCase();
    setAgentId(agents.find((a) => hint && a.name.toLowerCase().includes(hint))?.id ?? "");
  };

  const confirm = async () => {
    if (!open || !agentId) { setError("Pick the agent who owns this phone."); return; }
    setBusy(true);
    try {
      await onApprove(open.id, agentId);
      setOpen(null);
    } catch (e: any) {
      setError(e?.message ?? "Pairing failed");
    } finally {
      setBusy(false);
    }
  };

  const chosen = agents.find((a) => a.id === agentId);

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Phones waiting to pair</h4>
      {requests.length === 0 ? (
        <p className="text-[11px] text-zinc-500">
          No phone is waiting. Ask the agent to open the dialer app — it shows a 6-digit code and appears here.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
              <span className="font-mono text-base font-bold tracking-widest">{r.code}</span>
              <span className="min-w-0 flex-1">
                <b>{r.agentHint || "Unnamed agent"}</b> · {r.label || "Android phone"}
                <span className="block text-[11px] text-zinc-500">asked {relActive(r.createdAt)} · app {r.appVersion || "?"}</span>
              </span>
              <button type="button" onClick={() => pick(r)} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-bold text-white hover:bg-indigo-500">
                Pair…
              </button>
              <button type="button" onClick={() => void onReject(r.id)} className="rounded-lg px-2 py-1.5 font-semibold text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800">
                Reject
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!open}
        danger={false}
        busy={busy}
        title={`Pair phone ${open?.code ?? ""}`}
        confirmLabel="Pair to agent"
        onCancel={() => setOpen(null)}
        onConfirm={() => void confirm()}
        message={
          <div className="space-y-2">
            <p>Check the code on the agent&apos;s screen matches, then choose who owns this phone.</p>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide">Agent</span>
              <select
                id="dialer-pair-agent"
                value={agentId}
                onChange={(e) => { setAgentId(e.target.value); setError(null); }}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="">Select an agent…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.region ? ` · ${a.region}` : ""}{a.paired ? " (has a phone)" : ""}</option>
                ))}
              </select>
            </label>
            {chosen?.paired && <Badge tone="warning">{chosen.name}&apos;s current phone will be unpaired</Badge>}
            {error && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
          </div>
        }
      />
    </div>
  );
}
