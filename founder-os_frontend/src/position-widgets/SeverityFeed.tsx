"use client";

// position-widgets/SeverityFeed — gamified escalation feed (phase 1).
// Presentational: props only, no fetch. Severity mapping lives in
// hr/position-dashboards.ts (pure, guarded) — never re-derived here.
import { SEVERITY_META, severityFor, shouldFlash, type Severity } from "@/hr/position-dashboards";
import type { PersonalAction } from "@/personal/api";

export default function SeverityFeed({ actions }: { actions: PersonalAction[] }) {
  const ranked = [...actions]
    .map((a) => ({ action: a, severity: severityFor({ dueAt: a.dueAt, priority: a.priority }) as Severity }))
    .sort((x, y) => rank(x.severity) - rank(y.severity))
    .slice(0, 8);
  if (ranked.length === 0) {
    return <p className="text-[11px] text-zinc-500">⚪ Info — nothing escalating. Queue is clean.</p>;
  }
  return (
    <div className="space-y-1.5">
      {ranked.map(({ action, severity }) => {
        const meta = SEVERITY_META[severity];
        const flash = shouldFlash(severity, action.dueAt);
        return (
          <div
            key={action.id}
            className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 text-[11px] ${
              flash
                ? "animate-pulse border-rose-500/50 bg-rose-500/5"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${meta.chip}`}>{meta.label}</span>
                <span className="truncate font-semibold text-zinc-700 dark:text-zinc-200">{action.title}</span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-zinc-500">
                {action.assigneeName ?? "unassigned"} · {action.dueAt ? new Date(action.dueAt).toLocaleString() : "no due date"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function rank(s: Severity): number {
  return s === "critical" ? 0 : s === "high" ? 1 : s === "medium" ? 2 : s === "low" ? 3 : 4;
}
