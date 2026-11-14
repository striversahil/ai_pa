"use client";

// Task list renderer shared by the employee "my day" view and HR's team view.
// Sections + sorting come from @/hr/delegation (mirror of the backend rules).
// The four buckets are now a horizontal filter strip (shared TabBar) — one
// bucket visible at a time, no vertical stack of sections.
import React, { useState } from "react";
import TaskCard, { Section } from "@/components/human-resources/TaskCard";
import { TabBar, type TabBarItem } from "@/components/ui/TabBar";
import { taskSections } from "@/hr/delegation";
import type { HrTask } from "@/hr/types";

type TaskFilter = "open" | "overdue" | "today" | "upcoming" | "done" | "all";
type SectionTone = "rose" | "amber" | "indigo" | "emerald";

export default function TaskBoard({
  tasks, mode, today, selfMemberId, onSave, onEdit, onDelete, onOpenHistory,
  showAssignee = true, doneTitle = "Completed",
  emptyOverdue = "Nothing overdue.",
  emptyToday = "No tasks due today.",
  emptyUpcoming = "No upcoming tasks.",
  emptyDone = "No completed tasks yet.",
}: {
  tasks: HrTask[];
  mode: "manager" | "self";
  today: string;
  selfMemberId?: string | null;
  onSave: (task: HrTask, body: Record<string, unknown>) => Promise<unknown>;
  onEdit: (task: HrTask) => void;
  onDelete: (task: HrTask) => void;
  onOpenHistory?: (task: HrTask) => void;
  showAssignee?: boolean;
  doneTitle?: string;
  emptyOverdue?: string;
  emptyToday?: string;
  emptyUpcoming?: string;
  emptyDone?: string;
}) {
  // Work first: the board opens on UNCOMPLETED tasks (overdue + today +
  // upcoming). Done is its own filter; All is the everything view.
  const [filter, setFilter] = useState<TaskFilter>("open");
  const s = taskSections(tasks, today);
  const open = [...s.overdue, ...s.today, ...s.upcoming];
  const all = [...open, ...s.done];

  const filters: TabBarItem<TaskFilter>[] = [
    { key: "open", label: "Open", count: open.length },
    { key: "overdue", label: "Overdue", count: s.overdue.length, tone: "danger" },
    { key: "today", label: "Today", count: s.today.length },
    { key: "upcoming", label: "Upcoming", count: s.upcoming.length },
    { key: "done", label: "Done", count: s.done.length },
    { key: "all", label: "All", count: all.length },
  ];

  const view: { title: string; list: HrTask[]; tone: SectionTone; empty: string } =
    filter === "overdue" ? { title: "Overdue", list: s.overdue, tone: "rose", empty: emptyOverdue }
    : filter === "today" ? { title: "Today", list: s.today, tone: "amber", empty: emptyToday }
    : filter === "upcoming" ? { title: "Upcoming", list: s.upcoming, tone: "indigo", empty: emptyUpcoming }
    : filter === "done" ? { title: doneTitle, list: s.done, tone: "emerald", empty: emptyDone }
    : filter === "all" ? { title: "All tasks", list: all, tone: "indigo", empty: "No tasks yet." }
    : { title: "Open tasks", list: open, tone: "indigo", empty: "Nothing open — all caught up." };

  const card = (t: HrTask) => (
    <TaskCard
      key={t.id}
      task={t}
      mode={mode}
      today={today}
      selfMemberId={selfMemberId}
      onSave={onSave}
      onEdit={onEdit}
      onDelete={onDelete}
      onOpenHistory={onOpenHistory}
      showAssignee={showAssignee}
      compact
    />
  );

  return (
    <div className="space-y-3">
      <TabBar
        items={filters}
        active={filter}
        onChange={setFilter}
        ariaLabel="Task filters"
      />
      <Section title={view.title} count={view.list.length} tone={view.tone} empty={view.empty}>
        {view.list.map(card)}
      </Section>
    </div>
  );
}
