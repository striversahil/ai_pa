"use client";

// DeliveriesTab — the dispatch audit (newest 200 deliveries, all people).
//
// This is the console's proof: who got what, at which level, and whether they
// have read it. The person-facing bell shows the same rows for one employee.
import React from "react";
import { EmptyState, Table, tdClass, thClass } from "@/components/ui";
import { relTime } from "@/notifications/helpers";
import type { NotificationDelivery, NotificationLevelDef } from "@/notifications/types";
import { LevelChip } from "@/components/notifications/LevelDot";

export function DeliveriesTab({ deliveries, levels }: { deliveries: NotificationDelivery[]; levels: NotificationLevelDef[] }) {
  const def = (level: number) => levels.find((l) => l.level === level) ?? levels[1];
  if (deliveries.length === 0) {
    return <EmptyState title="No notifications dispatched yet" description="Once a rule fires, every notification it sends is listed here — newest first, capped at 200." />;
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[var(--text-secondary)]">
        Newest {deliveries.length} of max 200 dispatches. A row is written only when the engine actually sent the notification.
      </p>
      <div className="overflow-x-auto rounded-xl border border-[var(--border-card)]">
        <Table>
          <thead>
            <tr>
              <th className={thClass}>When</th>
              <th className={thClass}>Person</th>
              <th className={thClass}>Level</th>
              <th className={thClass}>Message</th>
              <th className={thClass}>Rule</th>
              <th className={thClass}>Read</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id} className="hover:bg-[var(--surface-sunken)]/60">
                <td className={`${tdClass} whitespace-nowrap text-[11px] text-[var(--text-tertiary)]`} title={d.createdAt}>{relTime(d.createdAt)}</td>
                <td className={tdClass}>
                  <p className="text-xs font-bold text-[var(--text-primary)]">{d.employeeName ?? d.employeeKey}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)]">{d.position || "—"}</p>
                </td>
                <td className={tdClass}>
                  <LevelChip level={d.level} hex={d.colorHex || def(d.level).hexColor} label={def(d.level).label} />
                </td>
                <td className={tdClass}>
                  <p className="max-w-[22rem] truncate text-[11px] font-semibold text-[var(--text-primary)]" title={d.title}>{d.title}</p>
                  <p className="max-w-[22rem] truncate text-[10px] text-[var(--text-tertiary)]" title={d.body}>{d.body}</p>
                </td>
                <td className={`${tdClass} font-mono text-[10px] text-[var(--text-tertiary)]`}>{d.ruleKey}</td>
                <td className={tdClass}>
                  <span className={`text-[10px] font-bold uppercase ${d.status === "READ" ? "text-[var(--color-success)]" : "text-[var(--text-tertiary)]"}`}>
                    {d.status === "READ" ? "read" : "unread"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
