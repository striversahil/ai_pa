"use client";

// Extracted verbatim from FieldStaffPanel.tsx by scripts/refactor/split-module.mjs.
// FieldStaffPanel.tsx re-exports everything public here, so existing imports keep working.
import { setFollowupStatus } from "@/field-staff/api";

export function FollowupBox({ open, onDone }: {
  open: Array<any>; onDone: () => void;
}) {
  const done = async (id: string) => {
    await setFollowupStatus(id, "done");
    onDone();
  };

  return (
    <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3">
      <p className="text-xs font-extrabold text-[var(--text-primary)]">Follow-ups <span className="text-[var(--text-tertiary)]">({open.length} open)</span></p>
      <div className="mt-2 max-h-[380px] space-y-1.5 overflow-y-auto">
        {open.map((f) => {
          const dueLabel = String(f.dueDate ?? "").slice(0, 10);
          return (
          <div key={f.id} className="rounded-lg bg-amber-500/5 p-2 text-[11px] ring-1 ring-amber-500/20">
            <div className="flex items-center gap-2">
              <span className="truncate font-extrabold text-[var(--text-primary)]">
                {f.millName || "Follow-up"} <span className="font-bold text-amber-700 dark:text-amber-300">· {dueLabel ? `due ${dueLabel.slice(5)}` : "no date"}</span>
              </span>
            </div>
            {f.note && <p className="mt-0.5 whitespace-pre-wrap text-[var(--text-secondary)]">{f.note}</p>}
            <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">logged {f.day ? `${f.day}` : ""}</p>
            <div className="mt-1 flex gap-2">
              <button onClick={() => void done(f.id)} className="text-[10px] font-extrabold text-emerald-600">✓ Done</button>
              <button onClick={async () => { await setFollowupStatus(f.id, "cancelled"); onDone(); }} className="text-[10px] font-bold text-[var(--text-tertiary)]">Cancel</button>
            </div>
          </div>
          );
        })}
        {open.length === 0 && <p className="text-[11px] text-[var(--text-tertiary)]">Nothing pending here. Done items leave this queue.</p>}
      </div>
    </div>
  );
}
