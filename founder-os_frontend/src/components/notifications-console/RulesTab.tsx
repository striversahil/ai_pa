"use client";

// RulesTab — the authored rules at a glance.
//
// One row per rule: name + audience + cadence + last run, level palette strip,
// enable switch and the drawer opener. The rule's own `lastStatus` (written by
// the sweep) is what proves the cron actually ran it.
import React from "react";
import { Badge, Button, EmptyState, Table, thClass, tdClass } from "@/components/ui";
import { audienceLabel, cadenceLabel, relTime, ruleStatusLabel } from "@/notifications/helpers";
import type { NotificationLevelDef, NotificationRule } from "@/notifications/types";
import { LevelDot } from "@/components/notifications/LevelDot";

export function RulesTab({
  rules, levels, onEdit, onCreate, onToggle, busy,
}: {
  rules: NotificationRule[];
  levels: NotificationLevelDef[];
  onEdit: (rule: NotificationRule) => void;
  onCreate: () => void;
  onToggle: (rule: NotificationRule) => void;
  busy: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--text-secondary)]">
          Each rule = one SQL query + one audience + one message template. The <span className="font-bold">* * * * *</span> cron evaluates
          due rules and dispatches the rows inside them — one row, one person.
        </p>
        <Button size="sm" variant="primary" onClick={onCreate}>New rule</Button>
      </div>

      {rules.length === 0 ? (
        <EmptyState
          icon={<span className="text-lg font-black">◎</span>}
          title="No notification rules yet"
          description="Create a rule to start sending position-wise escalations. Start from the sample telecaller hourly query, then point it at your own metric."
          action={<Button size="sm" variant="primary" onClick={onCreate}>Create the first rule</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-card)]">
          <Table>
            <thead>
              <tr>
                <th className={thClass}>Rule</th>
                <th className={thClass}>Audience</th>
                <th className={thClass}>Cadence</th>
                <th className={thClass}>Levels</th>
                <th className={thClass}>Last run</th>
                <th className={thClass}>Live</th>
                <th className={thClass} />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const status = ruleStatusLabel(rule);
                const trimmed = (rule.thresholds ?? []).map((t) => t.level);
                return (
                  <tr key={rule.key} className="hover:bg-[var(--surface-sunken)]/60">
                    <td className={tdClass}>
                      <button type="button" onClick={() => onEdit(rule)} className="text-left">
                        <p className="text-xs font-bold text-[var(--text-primary)]">{rule.name}</p>
                        <p className="font-mono text-[10px] text-[var(--text-tertiary)]">{rule.key}</p>
                      </button>
                    </td>
                    <td className={`${tdClass} text-[11px] text-[var(--text-secondary)]`}>{audienceLabel(rule.audience)}</td>
                    <td className={`${tdClass} text-[11px] text-[var(--text-secondary)]`}>{cadenceLabel(rule.cadence)}</td>
                    <td className={tdClass}>
                      <div className="flex items-center gap-1">
                        {levels.filter((l) => l.level >= 2).map((l) => (
                          <LevelDot key={l.level} hex={l.hexColor} size={trimmed.includes(l.level) ? 9 : 5} />
                        ))}
                        <span className="ml-1 text-[10px] text-[var(--text-tertiary)]">from SQL/thresholds</span>
                      </div>
                    </td>
                    <td className={tdClass}>
                      <p className="text-[11px] font-semibold text-[var(--text-secondary)]">{rule.lastRunAt ? relTime(rule.lastRunAt) : "—"}</p>
                      <span className="text-[10px] text-[var(--text-tertiary)]">{status.text}</span>
                    </td>
                    <td className={tdClass}>
                      <button
                        type="button"
                        onClick={() => onToggle(rule)}
                        disabled={busy === rule.key}
                        className={`relative h-5 w-9 rounded-full transition disabled:opacity-50 ${rule.enabled ? "bg-[var(--color-brand-indigo)]" : "bg-[var(--border-card)]"}`}
                        aria-label={rule.enabled ? `Pause ${rule.name}` : `Enable ${rule.name}`}
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${rule.enabled ? "left-[1.15rem]" : "left-0.5"}`} />
                      </button>
                    </td>
                    <td className={tdClass}>
                      <div className="flex items-center justify-end gap-2">
                        {rule.cadence.kind === "manual" ? <Badge tone="neutral">manual</Badge> : null}
                        <Button size="sm" variant="secondary" onClick={() => onEdit(rule)}>Open</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
