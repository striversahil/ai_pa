"use client";

// Controller → Auto Dialer: pair phones to agents, watch them live, read the
// hourly report, and set timers, dispositions and break reasons. All reads
// refresh on the `device-calls` live event (phones sync after every call).
import { useCallback, useMemo, useState } from "react";
import { PhoneCall } from "lucide-react";
import { useLiveQuery } from "@/hooks/useLiveData";
import { ConfirmDialog } from "@/components/ui";
import { DIALER_EVENTS, dialerApi, istToday, type CallSource } from "@/telecalling/dialer";
import type { RosterRow } from "../../TelecallingDashboard";
import { PairRequests, type AgentOption } from "./PairRequests";
import { LiveBoard } from "./LiveBoard";
import { HourlyReport } from "./HourlyReport";
import { DialerSettings } from "./DialerSettings";
import { AppDownload } from "./AppDownload";

type Pending = { kind: "recall" | "unpair"; id: string; name: string } | null;

export default function AutoDialerSection({ rosterRows }: { rosterRows: RosterRow[] }) {
  const [day, setDay] = useState(istToday());
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const opts = { events: DIALER_EVENTS };
  const requests = useLiveQuery(dialerApi.pairRequests, { ...opts, pollMs: 15_000 });
  // Polled too: "offline" is the absence of syncs, which emits no event.
  const board = useLiveQuery(dialerApi.board, { ...opts, pollMs: 60_000 });
  const report = useLiveQuery(() => dialerApi.report(day), { ...opts, deps: [day] });
  const source = useLiveQuery(dialerApi.callSource, { events: ["telecalling"] });
  // New builds come from GitHub, not a live event; the server caches 5 min.
  const app = useLiveQuery(dialerApi.app, { ...opts, pollMs: 300_000 });

  const paired = useMemo(() => new Set((board.data?.agents ?? []).map((r) => r.telecallerId)), [board.data]);
  const agents: AgentOption[] = useMemo(
    () => rosterRows.map((r) => ({ id: r.id, name: r.name, region: r.region, paired: paired.has(r.id) })),
    [rosterRows, paired],
  );

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e: any) { setError(e?.message ?? "Request failed"); }
    requests.refresh(); board.refresh();
  }, [requests, board]);

  const doConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    await run(() => (confirm.kind === "recall" ? dialerApi.recall(confirm.id) : dialerApi.revokeDevice(confirm.id)));
    setBusy(false);
    setConfirm(null);
  };

  const setSource = (mode: CallSource) => run(async () => { await dialerApi.setCallSource(mode); source.refresh(); });
  const config = board.data?.config ?? report.data?.config ?? null;

  return (
    <section className="space-y-5 rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold"><PhoneCall className="h-4 w-4 text-indigo-500" /> Auto Dialer</h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Pair agents&apos; phones, watch who is calling or on break, and set how the dialer behaves. Push leads to it from Customer push below.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px]">
          <span className="font-semibold uppercase tracking-wide text-zinc-500">Leaderboard counts calls from</span>
          <select
            id="dialer-call-source"
            value={source.data?.mode ?? "neodove"}
            onChange={(e) => void setSource(e.target.value as CallSource)}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950"
          >
            <option value="neodove">NeoDove</option>
            <option value="device">Founder OS dialer</option>
            <option value="manual">Manual log</option>
          </select>
        </label>
      </div>

      <AppDownload release={app.data ?? null} loading={app.loading} />

      {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      <PairRequests
        requests={requests.data?.requests ?? []}
        agents={agents}
        onApprove={async (id, telecallerId) => { await dialerApi.approve(id, telecallerId); requests.refresh(); board.refresh(); }}
        onReject={(id) => run(() => dialerApi.reject(id))}
      />

      <div className="space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Live board · today</h4>
        <LiveBoard
          rows={board.data?.agents ?? []}
          onRecall={(id, name) => setConfirm({ kind: "recall", id, name })}
          onUnpair={(id, name) => setConfirm({ kind: "unpair", id, name })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Hourly report</h4>
          <input id="dialer-report-day" type="date" value={day} max={istToday()} onChange={(e) => setDay(e.target.value || istToday())}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950" />
        </div>
        {report.data && config ? <HourlyReport agents={report.data.agents} config={config} /> : <p className="text-[11px] text-zinc-500">Loading…</p>}
      </div>

      <details className="space-y-2">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-zinc-500">Dialer settings</summary>
        {config && <DialerSettings config={config} onSave={async (cfg) => { await dialerApi.saveConfig(cfg); board.refresh(); report.refresh(); }} />}
      </details>

      <ConfirmDialog
        open={!!confirm}
        busy={busy}
        title={confirm?.kind === "recall" ? `Clear ${confirm?.name}'s queue?` : `Unpair ${confirm?.name}'s phone?`}
        message={confirm?.kind === "recall"
          ? "Every lead still waiting in this agent's dialer queue is pulled back. Calls already made stay in the report."
          : "The phone stops syncing and must be paired again. Anything it has not synced yet stays on the phone until it is re-paired."}
        confirmLabel={confirm?.kind === "recall" ? "Clear queue" : "Unpair"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void doConfirm()}
      />
    </section>
  );
}
