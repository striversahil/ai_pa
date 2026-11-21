"use client";

// Leads that hit the "stop re-queuing after N tries" cap: marked not reachable
// and never dialed again (a fresh Customer push can queue them again).
import type { DialerConfig, UnreachableLead } from "@/telecalling/dialer";

export function Unreachable({ items, config }: { items: UnreachableLead[]; config: DialerConfig | null }) {
  if (items.length === 0) return <p className="text-[11px] text-zinc-500">No leads gave up in the last 7 days.</p>;
  const label = new Map((config?.dispositions ?? []).map((d) => [d.key, d.label]));
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold">Lead</th>
            <th className="px-2 py-1.5 text-left font-semibold">Agent</th>
            <th className="px-2 py-1.5 text-right font-semibold">Tries</th>
            <th className="px-2 py-1.5 text-left font-semibold">Last result</th>
            <th className="px-2 py-1.5 text-left font-semibold">Given up</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <tr key={l.id} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="px-2 py-1.5"><b>{l.name || l.mobile}</b> {l.name && <span className="text-zinc-500">{l.mobile}</span>}</td>
              <td className="px-2 py-1.5">{l.agentName || "—"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{l.attempts}</td>
              <td className="px-2 py-1.5">{label.get(l.lastDisposition) ?? l.lastDisposition}</td>
              <td className="px-2 py-1.5 text-zinc-500">{new Date(l.updatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
