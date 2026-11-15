"use client";

// position-widgets/MyTasksWidget — the person's open queue (phase 1).
// Presentational: rows in, complete callback out. Fetch + audit live in
// personal/api.ts; the server stamps actor + audit rows.
import type { PersonalAction } from "@/personal/api";

export default function MyTasksWidget({ actions, onComplete, busyId }: {
  actions: PersonalAction[];
  onComplete: (id: string) => void;
  busyId: string | null;
}) {
  if (actions.length === 0) {
    return <p className="text-[11px] text-zinc-500">No open tasks. Clean queue.</p>;
  }
  return (
    <div className="space-y-1.5">
      {actions.slice(0, 10).map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-zinc-700 dark:text-zinc-200">{a.title}</div>
            <div className="truncate text-[10px] text-zinc-500">
              {a.category} · {a.dueAt ? new Date(a.dueAt).toLocaleDateString() : "no due"} · {a.priority ?? "MEDIUM"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onComplete(a.id)}
            disabled={busyId === a.id}
            className="shrink-0 rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {busyId === a.id ? "Done…" : "Done"}
          </button>
        </div>
      ))}
      {actions.length > 10 && <p className="text-[10px] text-zinc-400">+{actions.length - 10} more in the full queue</p>}
    </div>
  );
}
