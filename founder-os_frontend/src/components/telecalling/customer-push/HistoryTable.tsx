"use client";

// Customer push → history. One row per push action; the destination column
// labels the retired NeoDove rows so old history stays readable.
import {
  batchDistributionLabel, batchOutcome, batchTargetLabel, formatStamp,
  type PushBatch,
} from "@/telecalling/customer-push";

const STATUS_TONE: Record<string, string> = {
  done: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  running: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  queued: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
};

export default function HistoryTable({
  batches, loading,
}: {
  batches: PushBatch[];
  loading: boolean;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Recent pushes</h4>
      {loading && <p className="text-[11px] text-zinc-500">Loading history…</p>}
      {!loading && batches.length === 0 && (
        <p className="text-[11px] text-zinc-500">No push in this region yet.</p>
      )}
      {batches.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">Where</th>
                <th className="px-3 py-2 font-semibold">To</th>
                <th className="px-3 py-2 font-semibold">Outcome</th>
                <th className="px-3 py-2 font-semibold">How</th>
                <th className="px-3 py-2 font-semibold">By</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id} className="border-t border-zinc-200 align-top dark:border-zinc-800">
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-500">{formatStamp(batch.createdAt)}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold">{batch.region} · {batch.state || "—"}</span>
                    {batch.district && <span className="block text-[10px] text-zinc-500">{batch.district}</span>}
                  </td>
                  <td className="px-3 py-2">{batchTargetLabel(batch)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 font-semibold ${STATUS_TONE[batch.status] ?? STATUS_TONE.queued}`}>
                      {batchOutcome(batch)}
                    </span>
                    {batch.error && <span className="mt-1 block text-[10px] text-rose-500">{batch.error}</span>}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{batchDistributionLabel(batch)}</td>
                  <td className="px-3 py-2 text-zinc-500">{batch.requestedByName || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
