"use client";

// RulesTab — the authored rules at a glance, with collapsed-view filtering.
//
// One row per rule: name + position + cadence + last run, level palette strip,
// enable switch and the drawer opener. The rule's own `lastStatus` (written by
// the sweep) is what proves the cron actually ran it.
//
// Filters (founder ask 2026-11-24): search + position + live/paused, plus a
// per-position summary so every position's active/inactive state is readable
// without opening anything. Pure logic lives in notifications/helpers.ts
// (rulePositions / filterRules) and is guarded.
import React, { useMemo, useState } from "react";
import { Badge, Button, EmptyState, SearchSelect, Table, thClass, tdClass } from "@/components/ui";
import { audienceLabel, cadenceLabel, filterRules, relTime, rulePosition, rulePositions, ruleStatusLabel } from "@/notifications/helpers";
import type { NotificationLevelDef, NotificationRule } from "@/notifications/types";
import { LevelDot } from "@/components/notifications/LevelDot";

type Status = "all" | "live" | "paused";

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
  const [q, setQ] = useState("");
  const [position, setPosition] = useState("");
  const [status, setStatus] = useState<Status>("all");

  const summaries = useMemo(() => rulePositions(rules), [rules]);
  const visible = useMemo(() => filterRules(rules, { q, position, status }), [rules, q, position, status]);
  const positionOptions = useMemo(
    () => summaries.map((s) => ({ value: s.position, label: s.position, hint: `${s.live} live · ${s.paused} paused` })),
    [summaries],
  );
  const filtered = q.trim() !== "" || position !== "" || status !== "all";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--text-secondary)]">
          Each rule = one SQL query + one audience + one message template. The <span className="font-bold">* * * * *</span> cron evaluates
          due rules and dispatches the rows inside them — one row, one person.
        </p>
        <Button size="sm" variant="primary" onClick={onCreate}>New rule</Button>
      </div>

      {rules.length > 0 ? (
        <>
          {/* Per-position state, collapsed: how many rules are live vs paused. */}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setPosition("")}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${position === "" ? "border-[var(--color-brand-indigo)] bg-[var(--color-brand-indigo)]/10 text-[var(--color-brand-indigo)]" : "border-[var(--border-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"}`}>
              All positions <span className="font-normal text-[var(--text-tertiary)]">{rules.length}</span>
            </button>
            {summaries.map((s) => (
              <button key={s.position} type="button" onClick={() => setPosition(position === s.position ? "" : s.position)}
                title={`${s.position}: ${s.live} live, ${s.paused} paused`}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${position === s.position ? "border-[var(--color-brand-indigo)] bg-[var(--color-brand-indigo)]/10 text-[var(--color-brand-indigo)]" : "border-[var(--border-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"}`}>
                {s.position}
                <span className="ml-1.5 font-normal text-[var(--text-tertiary)]">
                  {s.live} live{s.paused > 0 ? ` · ${s.paused} paused` : ""}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search rules…" spellCheck={false}
              className="min-w-[12rem] flex-1 rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-2.5 py-2 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--color-brand-indigo)]"
            />
            <div className="w-48"><SearchSelect value={position} options={positionOptions} onChange={setPosition} placeholder="All positions" clearLabel="All positions" /></div>
            <div className="w-36">
              <SearchSelect
                value={status === "all" ? "" : status}
                options={[{ value: "live", label: "Live only" }, { value: "paused", label: "Paused only" }]}
                onChange={(v) => setStatus((v || "all") as Status)}
                placeholder="Any status" clearLabel="Any status"
              />
            </div>
            {filtered ? (
              <Button size="sm" variant="ghost" onClick={() => { setQ(""); setPosition(""); setStatus("all"); }}>Clear</Button>
            ) : null}
            <span className="text-[10px] text-[var(--text-tertiary)]">{visible.length} of {rules.length}</span>
          </div>
        </>
      ) : null}

      {rules.length === 0 ? (
        <EmptyState
          icon={<span className="text-lg font-black">◎</span>}
          title="No notification rules yet"
          description="Create a rule to start sending position-wise escalations. Start from the sample telecaller hourly query, then point it at your own metric."
          action={<Button size="sm" variant="primary" onClick={onCreate}>Create the first rule</Button>}
        />
      ) : visible.length === 0 ? (
        <EmptyState title="No rule matches this filter" description="Clear the filters or pick another position." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-card)]">
          <Table>
            <thead>
              <tr>
                <th className={thClass}>Rule</th>
                <th className={thClass}>Position</th>
                <th className={thClass}>Cadence</th>
                <th className={thClass}>Levels</th>
                <th className={thClass}>Last run</th>
                <th className={thClass}>Live</th>
                <th className={thClass} />
              </tr>
            </thead>
            <tbody>
              {visible.map((rule) => {
                const state = ruleStatusLabel(rule);
                const trimmed = (rule.thresholds ?? []).map((t) => t.level);
                return (
                  <tr key={rule.key} className="hover:bg-[var(--surface-sunken)]/60">
                    <td className={tdClass}>
                      <button type="button" onClick={() => onEdit(rule)} className="text-left">
                        <p className="text-xs font-bold text-[var(--text-primary)]">{rule.name}</p>
                        <p className="font-mono text-[10px] text-[var(--text-tertiary)]">{rule.key}</p>
                      </button>
                    </td>
                    <td className={tdClass}>
                      <p className="text-[11px] font-semibold text-[var(--text-secondary)]">{rulePosition(rule)}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)]">{audienceLabel(rule.audience)}</p>
                    </td>
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
                      <span className="text-[10px] text-[var(--text-tertiary)]">{state.text}</span>
                    </td>
                    <td className={tdClass}>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onToggle(rule)}
                          disabled={busy === rule.key}
                          className={`relative h-5 w-9 rounded-full transition disabled:opacity-50 ${rule.enabled ? "bg-[var(--color-brand-indigo)]" : "bg-[var(--border-card)]"}`}
                          aria-label={rule.enabled ? `Pause ${rule.name}` : `Enable ${rule.name}`}
                        >
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${rule.enabled ? "left-[1.15rem]" : "left-0.5"}`} />
                        </button>
                        <Badge tone={rule.enabled ? "success" : "neutral"}>{rule.enabled ? "Live" : "Paused"}</Badge>
                      </div>
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
