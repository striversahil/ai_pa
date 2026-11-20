"use client";

// Controller → Auto Dialer → Recordings: every call with audio for the chosen
// day, newest first, with an inline player and a download. Audio streams from
// /api/call-log/recording/:id (never the storage key). Some phones record AMR,
// which browsers cannot play — Download still works for those.
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { fmtDuration, recordingUrl, type DialerConfig, type RecordedCall } from "@/telecalling/dialer";

const timeIst = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function Recordings({ calls, config }: { calls: RecordedCall[]; config: DialerConfig | null }) {
  const [agent, setAgent] = useState("");
  const label = useMemo(() => new Map((config?.dispositions ?? []).map((d) => [d.key, d.label])), [config]);
  const agents = useMemo(() => [...new Map(calls.map((c) => [c.telecallerId, c.agentName || c.telecallerId])).entries()], [calls]);
  const rows = agent ? calls.filter((c) => c.telecallerId === agent) : calls;

  if (calls.length === 0) {
    return <p className="text-[11px] text-zinc-500">No recordings on this day yet. They arrive a few minutes after each call once the phone syncs.</p>;
  }

  return (
    <div className="space-y-2">
      {agents.length > 1 && (
        <select id="dialer-recordings-agent" value={agent} onChange={(e) => setAgent(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <option value="">All agents ({calls.length})</option>
          {agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      )}
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
        {rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-xs">
            <div className="min-w-[180px] flex-1">
              <p className="font-semibold">{c.contactName || c.number}</p>
              <p className="text-[11px] text-zinc-500">
                {timeIst(c.attemptAt)} · {c.agentName} · {fmtDuration(c.durationSec)}
                {c.disposition && ` · ${label.get(c.disposition) ?? c.disposition}`}
                {c.manual && " · manual"}
              </p>
              {c.remarks && <p className="text-[11px] text-zinc-500 italic">“{c.remarks}”</p>}
            </div>
            <audio controls preload="none" src={recordingUrl(c.id)} className="h-8 w-full max-w-xs" />
            <a href={recordingUrl(c.id, true)} title="Download recording"
              className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 font-semibold hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900">
              <Download className="h-3.5 w-3.5" /> Download
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
