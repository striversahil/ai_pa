"use client";

// Hour-by-hour calling per agent for one IST day, plus disposition mix and
// breaks. Connected follows the disposition (talk time can be an operator
// announcement); "Review" counts calls whose timer ran out with talk time.
import { activeHours, fmtDuration, hourLabel, type AgentDay, type DialerConfig } from "@/telecalling/dialer";

export function HourlyReport({ agents, config }: { agents: AgentDay[]; config: DialerConfig }) {
  if (agents.length === 0) return <p className="text-[11px] text-zinc-500">No dialer calls or breaks on this day.</p>;
  const hours = activeHours(agents);
  const label = new Map(config.dispositions.map((d) => [d.key, d.label]));
  const reasons = new Map(config.breakReasons.map((b) => [b.key, b.label]));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-[11px] tabular-nums">
          <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="sticky left-0 bg-zinc-50 px-2 py-1.5 text-left font-semibold dark:bg-zinc-900">Agent</th>
              {hours.map((h) => <th key={h} className="px-2 py-1.5 text-right font-semibold">{hourLabel(h)}</th>)}
              <th className="px-2 py-1.5 text-right font-semibold">Total</th>
              <th className="px-2 py-1.5 text-right font-semibold">Talk</th>
              <th className="px-2 py-1.5 text-right font-semibold">Manual</th>
              <th className="px-2 py-1.5 text-right font-semibold">Review</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.telecallerId} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="sticky left-0 bg-white px-2 py-1.5 dark:bg-zinc-950"><b>{a.name}</b> <span className="text-zinc-500">{a.region}</span></td>
                {hours.map((h) => {
                  const c = a.hours[String(h)];
                  return (
                    <td key={h} className="px-2 py-1.5 text-right" title={c ? `${c.connected} connected of ${c.attempted} · ${fmtDuration(c.talkSec)} talk` : ""}>
                      {c ? <><b>{c.connected}</b><span className="text-zinc-500">/{c.attempted}</span></> : <span className="text-zinc-400">·</span>}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right"><b>{a.connected}</b><span className="text-zinc-500">/{a.attempted}</span></td>
                <td className="px-2 py-1.5 text-right">{fmtDuration(a.talkSec)}</td>
                <td className="px-2 py-1.5 text-right">{a.manual}</td>
                <td className={`px-2 py-1.5 text-right ${a.flagged ? "font-bold text-amber-600 dark:text-amber-400" : "text-zinc-500"}`}>{a.flagged}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-zinc-500">Each cell is connected / attempted for that hour (IST). Review = the disposition timer ran out on a call with talk time.</p>

      <div className="grid gap-3 md:grid-cols-2">
        {agents.map((a) => (
          <div key={a.telecallerId} className="rounded-lg border border-zinc-200 p-3 text-[11px] dark:border-zinc-800">
            <p className="mb-1 font-bold">{a.name}</p>
            <p className="text-zinc-600 dark:text-zinc-300">
              {Object.entries(a.dispositions).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${label.get(k) ?? (k === "NONE" ? "No disposition" : k === "NOT_DISPOSED" ? "Not disposed" : k)} ${n}`).join(" · ") || "No calls"}
            </p>
            {a.breaks.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-zinc-500">
                {a.breaks.map((b, i) => (
                  <li key={i} className={b.overrunSec > 0 ? "text-rose-600 dark:text-rose-400" : ""}>
                    {reasons.get(b.reason) ?? b.reason} · {new Date(b.startAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    {" · "}{fmtDuration(b.durationSec)}{b.endAt ? "" : " (on break now)"}{b.overrunSec > 0 ? ` · ${fmtDuration(b.overrunSec)} over` : ""}{b.note ? ` · ${b.note}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
