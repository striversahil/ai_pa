// src/work/queue.ts — frontend work-queue predicates.
// Mirror: founder-os_backend/src/modules/core/projectors.ts (selection) —
// change together, never drift. Backend owns truth; these are display helpers.
import type { WorkAction } from "./api";

export function isOverdue(a: WorkAction, todayYmd: string): boolean {
  return !!a.dueAt && a.dueAt.slice(0, 10) < todayYmd;
}

export function groupByAssignee(actions: WorkAction[]): Array<{ name: string; items: WorkAction[] }> {
  const map = new Map<string, WorkAction[]>();
  for (const a of actions) {
    const k = a.assigneeName || "Unassigned";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(a);
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }));
}

export function sortWork(actions: WorkAction[], todayYmd: string): WorkAction[] {
  return [...actions].sort((x, y) => {
    const xo = isOverdue(x, todayYmd) ? 0 : 1;
    const yo = isOverdue(y, todayYmd) ? 0 : 1;
    if (xo !== yo) return xo - yo;
    return String(x.dueAt ?? "9999").localeCompare(String(y.dueAt ?? "9999"));
  });
}
