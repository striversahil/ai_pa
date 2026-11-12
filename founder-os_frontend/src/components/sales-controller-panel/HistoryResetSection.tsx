"use client";

// Extracted verbatim from SalesControllerPanel.tsx by scripts/refactor/split-module.mjs.
// SalesControllerPanel.tsx re-exports everything public here, so existing imports keep working.
import { useState } from "react";

/** History reset — purge close credits + stamp the epoch. Two-step: preview
 *  the exact row count, then confirm. */
export function HistoryResetSection({
  epoch,
  busy,
  setBusy,
  setError,
  refreshAll,
}: {
  epoch: string | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  refreshAll: () => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const run = async (dry: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/telecalling/reset-history${dry ? "?dry=1" : ""}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Reset failed (${res.status})`);
      if (dry) setPreview(Number(body?.deleted?.closeRows ?? 0));
      else {
        setPreview(null);
        setDone(String(body?.epoch ?? "done"));
        setConfirming(false);
        refreshAll();
      }
    } catch (e: any) {
      setError(e?.message ?? "Reset failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold mb-1">🧨 Reset history</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xl">
            Deletes every close-credit ledger row and stamps a new epoch — points and wins
            before the epoch stop counting. Estimates, calls and rosters are untouched.
            {epoch ? ` Current epoch: ${epoch}.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {preview === null ? (
            <button
              onClick={() => void run(true)}
              disabled={busy}
              className="text-sm font-semibold rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-4 py-2 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-50"
            >
              Preview purge
            </button>
          ) : confirming ? (
            <>
              <span className="text-xs font-semibold text-rose-500">Delete {preview} credit row{preview === 1 ? "" : "s"}?</span>
              <button
                onClick={() => { setConfirming(false); setPreview(null); }}
                disabled={busy}
                className="text-sm font-semibold rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-4 py-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void run(false)}
                disabled={busy}
                className="text-sm font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 disabled:opacity-50"
              >
                Reset NOW
              </button>
            </>
          ) : (
            <>
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{preview} close-credit row{preview === 1 ? "" : "s"} would be purged</span>
              <button
                onClick={() => setConfirming(true)}
                className="text-sm font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-4 py-2"
              >
                Continue
              </button>
            </>
          )}
        </div>
      </div>
      {done && <p className="text-[11px] text-emerald-500 dark:text-emerald-400 mt-2 font-semibold">History reset — new epoch {done}.</p>}
    </section>
  );
}
