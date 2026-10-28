"use client";

// Task list renderer shared by the employee "my day" view and HR's team view.
// Sections + sorting come from @/hr/delegation (mirror of the backend rules).
import React from "react";
import TaskCard, { Section } from "@/components/human-resources/TaskCard";
import { taskSections } from "@/hr/delegation";
import type { HrDelegationTask } from "@/hr/types";

export default function TaskBoard({
  tasks, mode, today, selfMemberId, onChanged, onEdit, onDelete, onOpenHistory,
  showAssignee = true, doneTitle = "Completed",
  emptyOverdue = "Nothing overdue.",
  emptyToday = "No tasks due today.",
  emptyUpcoming = "No upcoming tasks.",
  emptyDone = "No completed tasks yet.",
}: {
  tasks: HrDelegationTask[];
  mode: "manager" | "self";
  today: string;
  selfMemberId?: string | null;
  onChanged: () => void;
  onEdit: (task: HrDelegationTask) => void;
  onDelete: (task: HrDelegationTask) => void;
  onOpenHistory: (task: HrDelegationTask) => void;
  showAssignee?: boolean;
  doneTitle?: string;
  emptyOverdue?: string;
  emptyToday?: string;
  emptyUpcoming?: string;
  emptyDone?: string;
}) {
  const s = taskSections(tasks, today);
  const card = (t: HrDelegationTask) => (
    <TaskCard
      key={t.id}
      task={t}
      mode={mode}
      today={today}
      selfMemberId={selfMemberId}
      onChanged={onChanged}
      onEdit={(t) => onEdit(t as HrDelegationTask)}
      onDelete={(t) => onDelete(t as HrDelegationTask)}
      onOpenHistory={(t) => onOpenHistory(t as HrDelegationTask)}
      showAssignee={showAssignee}
      compact
    />
  );

  return (
    <div className="space-y-4">
      <Section title="Overdue" count={s.overdue.length} tone="rose" empty={emptyOverdue}>
        {s.overdue.map(card)}
      </Section>
      <Section title="Today" count={s.today.length} tone="amber" empty={emptyToday}>
        {s.today.map(card)}
      </Section>
      <Section title="Upcoming" count={s.upcoming.length} tone="indigo" empty={emptyUpcoming}>
        {s.upcoming.map(card)}
      </Section>
      <Section title={doneTitle} count={s.done.length} tone="emerald" empty={emptyDone}>
        {s.done.slice(0, 30).map(card)}
      </Section>
    </div>
  );
}
