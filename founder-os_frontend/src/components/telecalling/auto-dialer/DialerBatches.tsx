"use client";

// Dialer push batches (last 30 days): where each batch's leads stand, and a
// Remove that takes the batch's waiting leads off every agent's phone.
import type { DialerBatch } from "@/telecalling/dialer";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function DialerBatches({ batches, onRemove }: { batches: DialerBatch[]; onRemove: (b: DialerBatch) => void }) {
  if (batches.length === 0) return <p className="text-[11px] text-zinc-500">No leads pushed to the dialer in the last 30 days.</p>;
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-zinc-50 text-zinc-500 dark:bg-zinc-900">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold">Pushed</th>
            <th className="px-2 py-1.5 text-left font-semibold">Region</th>
            <th className="px-2 py-1.5 text-right font-semibold">Agents</th>
            <th className="px-2 py-1.5 text-right font-semibold">Leads</th>
            <th className="px-2 py-1.5 text-right font-semibold">Waiting</th>
            <th className="px-2 py-1.5 text-right font-semibold">Worked</th>
            <th className="px-2 py-1.5 text-right font-semibold">Removed</th>
            <th className="px-2 py-1.5" />
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {batches.map((b) => (
            <tr key={b.batchId} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="px-2 py-1.5">{when(b.createdAt)}{b.requestedByName && <span className="block text-zinc-500">{b.requestedByName}</span>}</td>
              <td className="px-2 py-1.5">{[b.region, b.state].filter(Boolean).join(" · ") || "—"}</td>
              <td className="px-2 py-1.5 text-right">{b.agents}</td>
              <td className="px-2 py-1.5 text-right">{b.total}</td>
              <td className="px-2 py-1.5 text-right font-semibold">{b.waiting}</td>
              <td className="px-2 py-1.5 text-right">{b.worked}</td>
              <td className="px-2 py-1.5 text-right text-zinc-500">{b.removed}</td>
              <td className="px-2 py-1.5 text-right">
                {b.waiting > 0 && (
                  <button type="button" onClick={() => onRemove(b)} className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
