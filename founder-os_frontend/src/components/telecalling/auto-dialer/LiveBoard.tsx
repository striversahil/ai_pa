"use client";

// One row per paired phone: live state, sync backlog, queue and today's totals.
import { Badge } from "@/components/ui";
import { relActive } from "@/lib/format";
import { LIVE_STATE_LABEL, fmtDuration, stateTone, type BoardRow } from "@/telecalling/dialer";

const TONE = { good: "success", watch: "warning", bad: "danger" } as const;

export function LiveBoard({
  rows, onRecall, onUnpair,
}: {
  rows: BoardRow[];
  onRecall: (telecallerId: string, name: string) => void;
  onUnpair: (deviceId: string, name: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-[11px] text-zinc-500">No paired phones yet. Paired phones appear here with their live status.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-[11px]">
        <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold">Agent</th>
            <th className="px-2 py-1.5 text-left font-semibold">Status</th>
            <th className="px-2 py-1.5 text-right font-semibold">Calls</th>
            <th className="px-2 py-1.5 text-right font-semibold">Connected</th>
            <th className="px-2 py-1.5 text-right font-semibold">Talk</th>
            <th className="px-2 py-1.5 text-right font-semibold">Breaks</th>
            <th className="px-2 py-1.5 text-right font-semibold">Queue</th>
            <th className="px-2 py-1.5 text-right font-semibold">Unsynced</th>
            <th className="px-2 py-1.5" />
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => {
            const brk = r.openBreak;
            return (
              <tr key={r.deviceId} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-2 py-1.5">
                  <b>{r.agentName || "Unknown"}</b> <span className="text-zinc-500">{r.region}</span>
                  <span className="block text-zinc-500">{r.label || "phone"} · v{r.appVersion || "?"}</span>
                </td>
                <td className="px-2 py-1.5">
                  <Badge tone={brk && brk.overrunSec > 0 ? "danger" : TONE[stateTone(r.liveState)]} dot>
                    {LIVE_STATE_LABEL[r.liveState] ?? r.liveState}
                  </Badge>
                  <span className="block text-zinc-500">
                    {brk ? `${brk.reason.toLowerCase()} · ${fmtDuration(brk.durationSec)}${brk.overrunSec > 0 ? ` (+${fmtDuration(brk.overrunSec)} over)` : ""}`
                      : r.liveState === "offline" ? `seen ${relActive(r.lastSeenAt)}` : r.liveDetail}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">{r.attempted}</td>
                <td className="px-2 py-1.5 text-right">{r.connected}</td>
                <td className="px-2 py-1.5 text-right">{fmtDuration(r.talkSec)}</td>
                <td className="px-2 py-1.5 text-right">{fmtDuration(r.breakSec)}</td>
                <td className="px-2 py-1.5 text-right">{r.queueDue}{r.queueLater ? <span className="text-zinc-500"> +{r.queueLater}</span> : null}</td>
                <td className={`px-2 py-1.5 text-right ${r.pendingSync > 0 ? "font-bold text-amber-600 dark:text-amber-400" : "text-zinc-500"}`}>{r.pendingSync}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right">
                  <button type="button" onClick={() => onRecall(r.telecallerId, r.agentName)} className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800">Clear queue</button>
                  <button type="button" onClick={() => onUnpair(r.deviceId, r.agentName)} className="rounded px-1.5 py-0.5 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400">Unpair</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
