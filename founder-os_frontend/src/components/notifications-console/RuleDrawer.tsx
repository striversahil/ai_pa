"use client";

// RuleDrawer — author one notification rule.
//
// The whole contract is visible on one screen: who (audience) · what metric
// (SQL, with a dry-run Test) · how bad (level from the row, or thresholds) ·
// what it says (mustache template + live preview) · when (cadence).
//
// Test writes NOTHING; Run now dispatches for real (manual cadence's only
// trigger). Level 1 rows are never toasted by the engine.
import React, { useMemo, useState } from "react";
import { Button, ConfirmDialog, Drawer } from "@/components/ui";
import { deleteNotificationRule, runNotificationRule, saveNotificationRule, testNotificationRule, type TestRuleResponse } from "@/notifications/api";
import { BUILTIN_TOKENS, renderTemplate } from "@/notifications/template";
import { cadenceLabel, clockToMinute, emptyRule, minuteToClock, relTime, WEEKDAYS } from "@/notifications/helpers";
import type { NotificationLevelDef, NotificationOptions, NotificationRule, NotificationThreshold } from "@/notifications/types";
import { LevelDot } from "@/components/notifications/LevelDot";
import { Chips, Field, Section, inputCls, monoCls } from "./ui";

const OPS: Array<NotificationThreshold["op"]> = ["lt", "lte", "gt", "gte", "eq"];

export function RuleDrawer({
  rule, isNew, options, levels, onClose, onSaved,
}: {
  rule: NotificationRule;
  isNew: boolean;
  options: NotificationOptions;
  levels: NotificationLevelDef[];
  onClose: () => void;
  onSaved: (rule?: NotificationRule) => void;
}) {
  const [draft, setDraft] = useState<NotificationRule>(isNew ? { ...emptyRule(), sqlText: options.sampleSql, bodyTpl: options.sampleTemplate } : rule);
  const [test, setTest] = useState<TestRuleResponse | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "run" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (patch: Partial<NotificationRule>) => setDraft((d) => ({ ...d, ...patch }));
  const setAudience = (key: keyof NotificationRule["audience"], value: string[]) =>
    setDraft((d) => ({ ...d, audience: { ...d.audience, [key]: value } }));

  const preview = useMemo(() => {
    const sample = {
      AGENT_NAME: options.people[0]?.name ?? "Ravi",
      POSITION: options.positions[0] ?? draft.audience.positions?.[0] ?? "Telecaller",
      VALUE: 2,
      LEVEL: 3,
      LEVEL_LABEL: levels[2]?.label ?? "Warning / Moderate",
      LEVEL_COLOR: levels[2]?.colorName ?? "Yellow",
      WINDOW: "13:00–14:00 IST",
      DATE: "today",
      RULE_NAME: draft.name || "rule",
      HOURLY_CONNECTED_CALL: 2,
      CONNECTED: 2,
    };
    return { title: renderTemplate(draft.titleTpl || draft.name || "Notification", sample), body: renderTemplate(draft.bodyTpl, sample) };
  }, [draft.titleTpl, draft.bodyTpl, draft.name, options.people, options.positions, draft.audience.positions, levels]);

  const appendToken = (token: string) => set({ bodyTpl: `${draft.bodyTpl}${draft.bodyTpl.endsWith(" ") || !draft.bodyTpl ? "" : " "}{${token}}` });

  const call = async (kind: "save" | "test" | "run" | "delete") => {
    setBusy(kind); setError(null);
    try {
      if (kind === "delete") {
        await deleteNotificationRule(rule.key);
        setConfirmDelete(false);
        onSaved();
        return;
      }
      if (kind === "test") {
        const res = await testNotificationRule(isNew ? "new" : rule.key, draft);
        setTest(res);
        return;
      }
      const saved = await saveNotificationRule(isNew ? "new" : rule.key, draft);
      onSaved(saved.rule);
      if (kind === "run") {
        const res = await runNotificationRule(saved.rule.key);
        setTest({ result: res.result, tokens: [], nextDueAt: saved.rule.nextDueAt });
      }
    } catch (e: any) {
      setError(e?.message ?? "Request failed");
    } finally {
      setBusy(null);
    }
  };

  const thresholdRows = draft.thresholds ?? [];
  const setThreshold = (i: number, patch: Partial<NotificationThreshold>) =>
    set({ thresholds: thresholdRows.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });

  return (
    <Drawer
      title={isNew ? "New notification rule" : draft.name || draft.key}
      subtitle={isNew ? "Audience · SQL · level · message · cadence" : `${draft.key} · ${cadenceLabel(draft.cadence)}${draft.nextDueAt ? ` · next ${relTime(draft.nextDueAt).replace(" ago", "")}` : ""}`}
      onClose={onClose}
      width="max-w-3xl"
      headerRight={
        <>
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void call("test")}>{busy === "test" ? "Testing…" : "Test"}</Button>
          {!isNew && <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void call("run")}>{busy === "run" ? "Running…" : "Run now"}</Button>}
          <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void call("save")}>{busy === "save" ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-4 p-4">
        {error ? <p className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-[11px] font-bold text-[var(--color-danger)]">{error}</p> : null}

        <Section title="Basics">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Name" hint={isNew ? "The key is derived from this (lowercase, dashes)." : `Key: ${draft.key}`}>
              <input className={inputCls} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Telecaller hourly connected calls" />
            </Field>
            <Field label="Description" hint="Only you see this.">
              <input className={inputCls} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-secondary)]">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Live — the cron will evaluate this rule
          </label>
        </Section>

        <Section title="Audience (position-wise)" desc="A row only dispatches when its person sits in this audience. Positions are the HR designation (chart title).">
          <Field label="Positions"><Chips options={options.positions.map((p) => ({ value: p }))} selected={draft.audience.positions ?? []} onChange={(v) => setAudience("positions", v)} /></Field>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Departments"><Chips options={options.departments.map((p) => ({ value: p }))} selected={draft.audience.departments ?? []} onChange={(v) => setAudience("departments", v)} /></Field>
            <Field label="Regions (sales roster)"><Chips options={options.regions.map((p) => ({ value: p }))} selected={draft.audience.regions ?? []} onChange={(v) => setAudience("regions", v)} /></Field>
            <Field label="Roster types"><Chips options={options.rosterTypes.map((p) => ({ value: p }))} selected={draft.audience.rosterTypes ?? []} onChange={(v) => setAudience("rosterTypes", v)} /></Field>
            <Field label="Roles"><Chips options={options.roles.map((r) => ({ value: r.key, label: r.position ? `${r.key} · ${r.position}` : r.key }))} selected={draft.audience.roles ?? []} onChange={(v) => setAudience("roles", v)} /></Field>
          </div>
          <Field label="Specific people (optional — narrows the filter above)">
            <Chips
              options={options.people.slice(0, 40).map((p) => ({ value: p.employeeKey, label: `${p.name}${p.position ? ` · ${p.position}` : ""}` }))}
              selected={draft.audience.employees ?? []}
              onChange={(v) => setAudience("employees", v)}
            />
          </Field>
        </Section>

        <Section title="Metric query" desc="One read-only SELECT. It receives ?1 = window start, ?2 = window end, ?3 = IST day. Each row needs telecaller_id (or employee_key), value, and level.">
          <textarea className={`${monoCls} min-h-[11rem]`} spellCheck={false} value={draft.sqlText} onChange={(e) => set({ sqlText: e.target.value })} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => set({ sqlText: options.sampleSql })}>Load sample (DeviceCall hourly)</Button>
            <span className="text-[10px] text-[var(--text-tertiary)]">Row contract: <code className="font-mono">telecaller_id | employee_key</code> · <code className="font-mono">value</code> · <code className="font-mono">level</code> 1–5</span>
          </div>
        </Section>

        <Section title="Escalation" desc="The row's level column wins. Thresholds are the fallback for rules whose SQL does not compute a level.">
          <div className="space-y-2">
            {thresholdRows.length === 0 ? (
              <p className="text-[10px] text-[var(--text-tertiary)]">No thresholds — the query must return a <code className="font-mono">level</code> column.</p>
            ) : thresholdRows.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase text-[var(--text-tertiary)]">if value</span>
                <select className={`${inputCls} !w-24`} value={t.op} onChange={(e) => setThreshold(i, { op: e.target.value as NotificationThreshold["op"] })}>
                  {OPS.map((op) => <option key={op} value={op}>{op}</option>)}
                </select>
                <input className={`${inputCls} !w-24`} type="number" value={t.value} onChange={(e) => setThreshold(i, { value: Number(e.target.value) })} />
                <span className="text-[10px] font-bold uppercase text-[var(--text-tertiary)]">→ level</span>
                <select className={`${inputCls} !w-28`} value={t.level} onChange={(e) => setThreshold(i, { level: Number(e.target.value) })}>
                  {levels.filter((l) => l.level >= 1).map((l) => <option key={l.level} value={l.level}>{l.level} — {l.label}</option>)}
                </select>
                <LevelDot hex={levels.find((l) => l.level === t.level)?.hexColor ?? "#888"} size={9} />
                <Button size="sm" variant="ghost" onClick={() => set({ thresholds: thresholdRows.filter((_, idx) => idx !== i) })}>Remove</Button>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => set({ thresholds: [...thresholdRows, { level: 3, op: "lt", value: 4 }] })}>Add threshold</Button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Bump a level every N windows" hint="Only when the SQL returns no level. 0 = never.">
              <input
                className={inputCls} type="number" min={0} max={24}
                value={draft.escalation?.bumpEvery ?? 0}
                onChange={(e) => set({ escalation: { ...(draft.escalation ?? {}), bumpEvery: Number(e.target.value) || 0 } })}
              />
            </Field>
            <label className="flex items-end gap-2 pb-2 text-[11px] font-semibold text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={draft.escalation?.notifyOnRecovery === true}
                onChange={(e) => set({ escalation: { ...(draft.escalation ?? {}), notifyOnRecovery: e.target.checked } })}
              />
              Send a level-1 “resolved” note when a breach clears
            </label>
          </div>
        </Section>

        <Section title="Message" desc="Mustache-lite: {TOKEN}. Any alias your SQL returns (e.g. {HOURLY_CONNECTED_CALL}) plus the built-ins below.">
          <Field label="Title"><input className={inputCls} value={draft.titleTpl} onChange={(e) => set({ titleTpl: e.target.value })} placeholder={draft.name || "Notification title"} /></Field>
          <Field label="Body template">
            <textarea className={`${inputCls} min-h-[5rem]`} value={draft.bodyTpl} onChange={(e) => set({ bodyTpl: e.target.value })} placeholder="{AGENT_NAME} heads up you only have {HOURLY_CONNECTED_CALL} in last hour…" />
          </Field>
          <div className="flex flex-wrap gap-1">
            {BUILTIN_TOKENS.map((t) => (
              <button key={t} type="button" onClick={() => appendToken(t)} className="rounded-md border border-dashed border-[var(--border-card)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] hover:border-[var(--color-brand-indigo)] hover:text-[var(--color-brand-indigo)]">
                {`{${t}}`}
              </button>
            ))}
          </div>
          <div className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] p-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">Preview (sample values)</p>
            <p className="mt-1 text-xs font-bold text-[var(--text-primary)]">{preview.title}</p>
            <p className="text-[11px] text-[var(--text-secondary)]">{preview.body}</p>
          </div>
        </Section>

        <Section title="Cadence" desc="Windows are IST-aligned: an hourly rule at 14:00 evaluates 13:00–14:00.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Every">
              <select className={inputCls} value={draft.cadence.kind} onChange={(e) => set({ cadence: { ...draft.cadence, kind: e.target.value as NotificationRule["cadence"]["kind"] } })}>
                <option value="hourly">Hour</option>
                <option value="everyNMin">N minutes</option>
                <option value="daily">Day</option>
                <option value="weekly">Week</option>
                <option value="manual">Manual only</option>
              </select>
            </Field>
            {draft.cadence.kind === "everyNMin" ? (
              <Field label="Minutes"><input className={inputCls} type="number" min={5} max={1440} value={draft.cadence.n ?? 60} onChange={(e) => set({ cadence: { ...draft.cadence, n: Number(e.target.value) || 60 } })} /></Field>
            ) : null}
            {draft.cadence.kind === "daily" || draft.cadence.kind === "weekly" ? (
              <Field label="At (IST)">
                <input className={inputCls} type="time" value={minuteToClock(draft.cadence.atMinute)} onChange={(e) => set({ cadence: { ...draft.cadence, atMinute: clockToMinute(e.target.value) } })} />
              </Field>
            ) : null}
          </div>
          {draft.cadence.kind === "weekly" ? (
            <Field label="Days">
              <Chips
                options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
                selected={(draft.cadence.days ?? []).map(String)}
                onChange={(v) => set({ cadence: { ...draft.cadence, days: v.map(Number) } })}
              />
            </Field>
          ) : null}
          <p className="text-[10px] text-[var(--text-tertiary)]">Next run: {draft.nextDueAt ? relTime(draft.nextDueAt) : draft.cadence.kind === "manual" ? "manual only (Run now)" : "computed on save"}</p>
        </Section>

        {test ? (
          <Section title={`Test result${test.result.dryRun ? " (nothing written)" : ""}`} desc={`${test.result.scanned} row(s) · ${test.result.matched} in audience · ${test.result.dispatched} dispatched · ${test.result.skipped} skipped`}>
            {test.result.errors.length > 0 ? (
              <ul className="space-y-0.5 text-[11px] font-semibold text-[var(--color-danger)]">
                {test.result.errors.map((e) => <li key={e}>• {e}</li>)}
              </ul>
            ) : null}
            {test.result.unmatched.length > 0 ? (
              <p className="text-[10px] text-[var(--text-tertiary)]">
                Unmatched rows: <span className="font-mono">{test.result.unmatched.slice(0, 8).join(", ")}</span> — the query key has no seat in the HR register.
              </p>
            ) : null}
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {test.result.results.map((r) => (
                <div key={r.employeeKey} className="flex items-start gap-2 rounded-md border border-[var(--border-card)] p-2">
                  <LevelDot hex={r.colorHex} size={9} ring />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-[var(--text-primary)]">{r.name} <span className="font-normal text-[var(--text-tertiary)]">· L{r.level} · value {r.value}</span></p>
                    <p className="text-[10px] text-[var(--text-secondary)]">{r.title}</p>
                    <p className="text-[10px] text-[var(--text-tertiary)]">{r.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {!isNew ? (
          <div className="flex justify-end border-t border-[var(--border-card)] pt-3">
            <Button size="sm" variant="danger" disabled={!!busy} onClick={() => setConfirmDelete(true)}>Delete rule</Button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this notification rule?"
        message={<>“{draft.name}” will stop evaluating. Already-sent notifications stay in each person's audit.</>}
        confirmLabel="Delete rule"
        busy={busy === "delete"}
        onConfirm={() => void call("delete")}
        onCancel={() => setConfirmDelete(false)}
      />
    </Drawer>
  );
}
