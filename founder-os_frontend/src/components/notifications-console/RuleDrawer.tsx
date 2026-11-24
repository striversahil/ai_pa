"use client";

// RuleDrawer — author one notification rule.
//
// The whole contract is visible on one screen: who (audience) · what metric
// (SQL, with a dry-run Test) · how bad (level from the row, or thresholds) ·
// what it says (mustache template + live preview) · when (cadence).
//
// Test writes NOTHING; Run now dispatches for real (manual cadence's only
// trigger). Level 1 rows are never toasted by the engine.
import React, { useState } from "react";
import { Button, ConfirmDialog, Drawer, SearchMultiSelect, SearchSelect } from "@/components/ui";
import { deleteNotificationRule, runNotificationRule, saveNotificationRule, testNotificationRule, type TestRuleResponse } from "@/notifications/api";
import { cadenceLabel, clockToMinute, columnToken, emptyRule, minuteToClock, relTime, renderPreview, windowLabel, WEEKDAYS } from "@/notifications/helpers";
import type { NotificationLevelDef, NotificationOptions, NotificationRule, NotificationThreshold } from "@/notifications/types";
import { LevelDot } from "@/components/notifications/LevelDot";
import { Field, Section, inputCls, monoCls } from "./ui";
import { ResultTable } from "./ResultTable";
const OPS: Array<NotificationThreshold["op"]> = ["lt", "lte", "gt", "gte", "eq"];

/** Always-available engine fields (founder 2026-11-24: EMPLOYEE_NAME is
 *  necessary). The metric SQL returns ids, so the name can only come from the
 *  HR register — the engine fills these, the SQL never has to. */
const DEFAULT_FIELDS = ["EMPLOYEE_NAME"];

/** Dry-run lookbacks. A quiet hour legitimately returns 0 rows, which hides the
 *  columns and the message shape — widening ONLY the Test window makes the rule
 *  inspectable without touching what the cron evaluates. */
const LOOKBACKS = [
  { value: "0", label: "Current window (rule cadence)" },
  { value: "24", label: "Last 24 hours (sample)" },
  { value: "168", label: "Last 7 days (sample)" },
  { value: "720", label: "Last 30 days (sample)" },
];

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
  const [lookback, setLookback] = useState("0");
  // Which result row the message preview speaks for (founder spec: the SQL's
  // output IS the preview; row 1 by default, per-agent on demand).
  const [previewIdx, setPreviewIdx] = useState(0);

  const set = (patch: Partial<NotificationRule>) => setDraft((d) => ({ ...d, ...patch }));
  const setAudience = (key: keyof NotificationRule["audience"], value: string[]) =>
    setDraft((d) => ({ ...d, audience: { ...d.audience, [key]: value } }));

  const previewRows = test?.result.sampleRows ?? [];
  const previewRow = previewRows.length > 0 ? previewRows[Math.min(previewIdx, previewRows.length - 1)] : null;
  const previewWin = test
    ? {
        windowStart: test.result.windowStart,
        windowEnd: test.result.windowEnd,
        ruleName: draft.name,
        agentName: test.result.results[0]?.name,
        names: test.result.sampleNames ?? {},
      }
    : { ruleName: draft.name };
  const preview = {
    title: renderPreview(draft.titleTpl || draft.name || "Notification", previewRow, previewWin),
    body: renderPreview(draft.bodyTpl, previewRow, previewWin),
  };

  const appendToken = (token: string, field: "bodyTpl" | "titleTpl" = "bodyTpl") =>
    setDraft((d) => {
      const cur = String(d[field] ?? "");
      const sep = cur === "" || cur.endsWith(" ") ? "" : " ";
      return { ...d, [field]: `${cur}${sep}{${token}}` };
    });
  // Real headers of the authored SQL (from the last Test) — offered as tokens
  // so the message never depends on hand-typed mustache keys. Identity/level
  // columns are engine plumbing, not message material.
  const detected = (test?.result.columns ?? []).filter((c) => !/^(telecaller_id|employee_key|value|level|severity)$/i.test(c));

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
        const res = await testNotificationRule(isNew ? "new" : rule.key, draft, Number(lookback) || 0);
        setTest(res);
        return;
      }
      const saved = await saveNotificationRule(isNew ? "new" : rule.key, draft);
      onSaved(saved.rule);
      if (kind === "run") {
        const res = await runNotificationRule(saved.rule.key, Number(lookback) || 0);
        setTest({ result: res.result, tokens: [], nextDueAt: saved.rule.nextDueAt, lookbackHours: res.lookbackHours });
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
        <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void call("save")}>{busy === "save" ? "Saving…" : "Save"}</Button>
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

        <Section title="Audience (position-wise)" desc="A row only dispatches when its person sits in this audience. Positions are the HR designation (chart title). Everything is a searchable dropdown; an empty list means no filter.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Positions" hint="Primary selector — drives the position summary in the rules list.">
              <SearchMultiSelect
                values={draft.audience.positions ?? []} onChange={(v) => setAudience("positions", v)}
                options={options.positions.map((p) => ({ value: p, label: p, hint: `${options.people.filter((x) => x.position === p).length} seated` }))}
                placeholder="Add position" emptyText="No position filter — every seat the other filters allow" maxHeight="max-h-32"
              />
            </Field>
            <Field label="Roles">
              <SearchMultiSelect
                values={draft.audience.roles ?? []} onChange={(v) => setAudience("roles", v)}
                options={options.roles.map((r) => ({ value: r.key, label: r.key, hint: r.position || "" }))}
                placeholder="Add role" emptyText="No role filter" maxHeight="max-h-32"
              />
            </Field>
            <Field label="Departments">
              <SearchMultiSelect
                values={draft.audience.departments ?? []} onChange={(v) => setAudience("departments", v)}
                options={options.departments.map((p) => ({ value: p, label: p }))}
                placeholder="Add department" emptyText="No department filter" maxHeight="max-h-32"
              />
            </Field>
            <Field label="Regions (sales roster)">
              <SearchMultiSelect
                values={draft.audience.regions ?? []} onChange={(v) => setAudience("regions", v)}
                options={options.regions.map((p) => ({ value: p, label: p }))}
                placeholder="Add region" emptyText="No region filter" maxHeight="max-h-32"
              />
            </Field>
            <Field label="Roster types">
              <SearchMultiSelect
                values={draft.audience.rosterTypes ?? []} onChange={(v) => setAudience("rosterTypes", v)}
                options={options.rosterTypes.map((p) => ({ value: p, label: p }))}
                placeholder="Add roster type" emptyText="No roster-type filter" maxHeight="max-h-32"
              />
            </Field>
          </div>
          <Field label="Specific people (optional — narrows the filters above)" hint="Search by name, position or department. Leave empty to address the whole audience.">
            <SearchMultiSelect
              values={draft.audience.employees ?? []} onChange={(v) => setAudience("employees", v)}
              options={options.people.map((p) => ({ value: p.employeeKey, label: p.name, hint: [p.position, p.department].filter(Boolean).join(" · ") }))}
              placeholder="Add person" emptyText="Nobody singled out — the audience filters decide" maxHeight="max-h-40"
            />
          </Field>
        </Section>

        <Section title="Metric query" desc="One read-only SELECT. It receives ?1 = window start, ?2 = window end, ?3 = IST day. Each row needs telecaller_id (or employee_key), value, and level.">
          <textarea className={`${monoCls} min-h-[11rem]`} spellCheck={false} value={draft.sqlText} onChange={(e) => set({ sqlText: e.target.value })} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void call("test")}>{busy === "test" ? "Testing…" : "Test (no send)"}</Button>
            {!isNew ? <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void call("run")}>{busy === "run" ? "Running…" : "Run now (sends)"}</Button> : null}
            <div className="w-56">
              <SearchSelect value={lookback} options={LOOKBACKS} onChange={setLookback} clearLabel={null} />
            </div>
            <Button size="sm" variant="ghost" onClick={() => set({ sqlText: options.sampleSql })}>Load sample</Button>
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)]">
            The window selector applies to <b>Test</b> and <b>Run now</b> — the cron always uses the cadence. Widen it when the hour is quiet.
            Row contract: <code className="font-mono">telecaller_id | employee_key</code> · <code className="font-mono">value</code> · <code className="font-mono">level</code> 1–5.
          </p>
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

        <Section title="Message" desc="Mustache-lite: {TOKEN}. Tokens come ONLY from your query's own output — return the words you want to say (e.g. SELECT m.name AS agent_name).">
          <Field label="Title"><input className={inputCls} value={draft.titleTpl} onChange={(e) => set({ titleTpl: e.target.value })} placeholder={draft.name || "Notification title"} /></Field>
          <Field label="Body template">
            <textarea className={`${inputCls} min-h-[5rem]`} value={draft.bodyTpl} onChange={(e) => set({ bodyTpl: e.target.value })} placeholder="You have {hourly_connected_call} connected calls in {WINDOW} — pick up your pace." />
          </Field>
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
              {detected.length > 0 ? "Your SQL's columns — click to add to the body" : "No columns detected yet — run Test to read your query's headers"}
            </p>
            {detected.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {detected.map((c) => (
                  <button key={c} type="button" onClick={() => appendToken(columnToken(c))}
                    className="rounded-md border border-[var(--color-brand-indigo)]/40 bg-[var(--color-brand-indigo)]/5 px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-brand-indigo)] hover:bg-[var(--color-brand-indigo)]/15">
                    {`{${columnToken(c)}}`}
                  </button>
                ))}
              </div>
            ) : null}
            {DEFAULT_FIELDS.filter((t) => !detected.some((c) => columnToken(c) === t)).length > 0 ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-[var(--text-tertiary)]">Default field{detected.length > 0 ? "s" : "s (always available)"}:</span>
                {DEFAULT_FIELDS.filter((t) => !detected.some((c) => columnToken(c) === t)).map((t) => (
                  <button key={t} type="button" onClick={() => appendToken(t)} title="Filled by the engine from the HR register"
                    className="rounded-md border border-dashed border-[var(--border-card)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)] hover:border-[var(--color-brand-indigo)] hover:text-[var(--color-brand-indigo)]">
                    {`{${t}}`}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
                Preview — your query's row {previewRow ? `${Math.min(previewIdx, previewRows.length - 1) + 1} of ${previewRows.length}` : "(none returned)"}
              </p>
              {previewRows.length > 1 ? (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={previewIdx <= 0} onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))}>←</Button>
                  <Button size="sm" variant="ghost" disabled={previewIdx >= previewRows.length - 1} onClick={() => setPreviewIdx((i) => Math.min(previewRows.length - 1, i + 1))}>→</Button>
                </div>
              ) : null}
            </div>
            <p className="mt-1 text-xs font-bold text-[var(--text-primary)]">{preview.title}</p>
            <p className="text-[11px] text-[var(--text-secondary)]">{preview.body}</p>
            {previewRow === null ? (
              <p className="mt-1.5 text-[10px] text-[var(--text-tertiary)]">
                No rows to preview — every token shows <code className="font-mono">null</code>. Run Test (widen the window if the hour is quiet)
                to preview against real output.
              </p>
            ) : null}
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
              <SearchMultiSelect
                values={(draft.cadence.days ?? []).map(String)}
                onChange={(v) => set({ cadence: { ...draft.cadence, days: v.map(Number) } })}
                options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
                placeholder="Add day" emptyText="Every day" maxHeight="max-h-32"
              />
            </Field>
          ) : null}
          <p className="text-[10px] text-[var(--text-tertiary)]">Next run: {draft.nextDueAt ? relTime(draft.nextDueAt) : draft.cadence.kind === "manual" ? "manual only (Run now)" : "computed on save"}</p>
        </Section>

        {test ? (
          <Section
            title={test.result.dryRun ? "Test result — nothing sent" : "Run result — sent"}
            desc={test.result.dryRun
              ? `${test.result.scanned} row(s) scanned · ${test.result.matched} in audience · ${test.result.results.length} would be notified · 0 sent (dry run) · window ${windowLabel(test.result.windowStart, test.result.windowEnd)}`
              : `${test.result.scanned} row(s) scanned · ${test.result.matched} in audience · ${test.result.dispatched} notified · ${test.result.skipped} skipped · window ${windowLabel(test.result.windowStart, test.result.windowEnd)}`}
            right={<Button size="sm" variant="ghost" onClick={() => { setTest(null); setPreviewIdx(0); }}>Clear output</Button>}
          >
            <ResultTable
              columns={test.result.columns ?? []}
              rows={test.result.sampleRows ?? []}
              emptyHint={
                test.result.dryRun
                  ? "The query ran but returned no rows in this window — widen the window and Test again."
                  : "A real run keeps no result data — Test shows the rows."
              }
            />
            {test.result.scanned === 0 ? (
              <div className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2.5">
                <p className="text-[11px] font-bold text-[var(--color-warning)]">
                  The query ran fine but returned no rows for {windowLabel(test.result.windowStart, test.result.windowEnd)}.
                </p>
                <p className="mt-1 text-[10px] text-[var(--text-secondary)]">
                  Either the source table is quiet (nothing was written in this window — check that the feed is syncing) or the window is too
                  narrow. Sample a wider window to prove the query and see its headers and message shape.
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => { setLookback("168"); void (async () => {
                    setBusy("test"); setError(null);
                    try { setTest(await testNotificationRule(isNew ? "new" : rule.key, draft, 168)); }
                    catch (e: any) { setError(e?.message ?? "Test failed"); }
                    finally { setBusy(null); }
                  })(); }}>
                    Sample last 7 days
                  </Button>
                  <span className="self-center text-[10px] text-[var(--text-tertiary)]">Nothing is sent by a test.</span>
                </div>
              </div>
            ) : null}
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
