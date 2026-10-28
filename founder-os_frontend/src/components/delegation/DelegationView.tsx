"use client";

// ─────────────────────────────────────────────────────────────────────────────
// DelegationView — the employee-facing Delegation board (/delegation).
//
// One task model, two views over the same payload (GET /api/delegation/board):
//   * employee → "My day": their tasks, stats, add-my-own-task, daily remarks
//   * HR/MIS   → the same board plus per-member day cards, the day's activity
//                feed and the login-linking panel
// Every write goes through /api/delegation/* which scopes itself server-side.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { fetchDelegationBoard, deleteDelegationTask } from "@/hr/api";
import { dayCounts } from "@/hr/delegation";
import { dateLabel, shiftDate, todayIST } from "@/hr/format";
import type { HrDelegationTask } from "@/hr/types";
import TaskFormModal from "@/components/human-resources/TaskFormModal";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import TaskBoard from "./TaskBoard";
import MyDayPanel from "./MyDayPanel";
import TeamPanel from "./TeamPanel";
import ActivityFeed from "./ActivityFeed";
import LoginsPanel from "./LoginsPanel";
import TaskHistoryModal from "./TaskHistoryModal";

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${tone}`}>
      {label} {value}
    </span>
  );
}

export default function DelegationView() {
  const [date, setDate] = useState(todayIST());
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; task: HrDelegationTask | null }>({ open: false, task: null });
  const [deleting, setDeleting] = useState<HrDelegationTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HrDelegationTask | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const board = useLiveDashboard(() => fetchDelegationBoard(date), { deps: [date], pollMs: 60000 });
  const data = board.data;
  const isManager = !!data?.meta.isManager;
  const today = data?.meta.today ?? todayIST();

  const counts = useMemo(
    () => (data ? dayCounts(data.tasks, today, data.meta.date) : null),
    [data, today],
  );

  const visibleTasks = useMemo(() => {
    if (!data) return [];
    if (!isManager || !memberFilter) return data.tasks;
    return data.tasks.filter((t) => String(t.assignedToId ?? "") === memberFilter);
  }, [data, isManager, memberFilter]);

  const filterName = useMemo(() => {
    if (!memberFilter) return null;
    return data?.team?.find((row) => row.memberId === memberFilter)?.name
      ?? data?.meta.self?.selfName
      ?? "member";
  }, [data, memberFilter]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteDelegationTask(deleting.id);
      setDeleting(null);
      board.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const openHistory = (task: HrDelegationTask) => setHistory(task);

  if (board.loading && !data) {
    return <div className="p-6 text-sm text-zinc-500">Loading delegation board…</div>;
  }
  if (board.error && !data) {
    return (
      <div className="space-y-2 p-6">
        <h2 className="text-lg font-bold">Delegation board unavailable</h2>
        <p className="text-sm text-zinc-500">{(board.error as Error)?.message ?? "Request failed"}</p>
        <button onClick={board.refresh} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white">Retry</button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-extrabold tracking-tight">Delegation</h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            {isManager
              ? "Daily work board — what each person is doing, what got done, and what needs an update."
              : "Your tasks, your daily updates."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isManager && (
            <div className="flex items-center gap-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-1">
              <button onClick={() => setDate(shiftDate(date, -1))} title="Previous day" className="rounded-lg px-2 py-1 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">‹</button>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value || todayIST())}
                className="bg-transparent px-1 text-xs font-semibold outline-none"
              />
              <button onClick={() => setDate(shiftDate(date, 1))} title="Next day" className="rounded-lg px-2 py-1 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">›</button>
              {date !== today && (
                <button onClick={() => setDate(today)} className="rounded-lg bg-indigo-500/10 px-2 py-1 text-[11px] font-bold text-indigo-500">Today</button>
              )}
            </div>
          )}
          <button onClick={board.refresh} className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700">Refresh</button>
        </div>
      </div>

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}

      {!isManager ? (
        <MyDayPanel
          board={data}
          onChanged={board.refresh}
          onAddTask={() => setForm({ open: true, task: null })}
          onEdit={(task) => setForm({ open: true, task })}
          onDelete={setDeleting}
          onOpenHistory={openHistory}
        />
      ) : (
        <>
          {counts && (
            <div className="flex flex-wrap gap-1.5">
              <Stat label="Open" value={counts.open} tone="border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300" />
              <Stat label="Overdue" value={counts.overdue} tone="border-rose-500/30 bg-rose-500/10 text-rose-500" />
              <Stat label="Due this day" value={counts.today} tone="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" />
              <Stat label="Done this day" value={counts.doneToday} tone="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Team · {dateLabel(data.meta.date)}
                </h2>
                {memberFilter && (
                  <button onClick={() => setMemberFilter(null)} className="text-[11px] font-bold text-indigo-500">Clear filter</button>
                )}
              </div>
              <TeamPanel team={data.team ?? []} selectedId={memberFilter} onSelect={setMemberFilter} />
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                Activity · {dateLabel(data.meta.date)}
              </h2>
              <div className="max-h-[420px] overflow-y-auto pr-1">
                <ActivityFeed
                  activity={data.activity ?? []}
                  date={data.meta.date}
                  today={today}
                  onOpenTask={(taskId) => {
                    const hit = data.tasks.find((t) => t.id === taskId);
                    if (hit) setHistory(hit);
                  }}
                />
              </div>
            </section>
          </div>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                {filterName ? `${filterName} · tasks` : "All tasks"}
                <span className="ml-2 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-500">{visibleTasks.length}</span>
              </h2>
              <button onClick={() => setForm({ open: true, task: null })} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">
                + New task
              </button>
            </div>
            <TaskBoard
              tasks={visibleTasks}
              mode="manager"
              today={today}
              onChanged={board.refresh}
              onEdit={(task) => setForm({ open: true, task })}
              onDelete={setDeleting}
              onOpenHistory={openHistory}
              showAssignee
            />
          </section>

          <details className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2">
            <summary className="cursor-pointer text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
              Logins · {data.logins?.filter((m) => m.linked).length ?? 0}/{data.logins?.length ?? 0} linked
            </summary>
            <div className="mt-3">
              <LoginsPanel logins={data.logins ?? []} onChanged={board.refresh} />
            </div>
          </details>
        </>
      )}

      {form.open && (
        <TaskFormModal
          task={form.task}
          roster={isManager ? (data.roster ?? []) : []}
          mode={isManager ? "manager" : "self"}
          selfMemberId={data.meta.self?.selfId ?? null}
          onClose={() => setForm({ open: false, task: null })}
          onSaved={board.refresh}
        />
      )}

      {history && (
        <TaskHistoryModal
          taskId={history.id}
          title={history.title}
          today={today}
          onClose={() => setHistory(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete task?"
        message={<>Delete <b>{deleting?.title}</b>? Its daily updates are removed with it.</>}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
