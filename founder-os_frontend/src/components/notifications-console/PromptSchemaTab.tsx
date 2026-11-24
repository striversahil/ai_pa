"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PromptSchemaTab — author rules with an AI agent instead of by hand.
//
// Two copyable artefacts:
//   1. PROMPT  — the saved instruction (Setting `notifications:prompt`): the row
//      contract, the ?1/?2/?3 window params, the level meaning, template rules.
//   2. SCHEMA  — the LIVE D1 schema (business tables, KV-cached 10 min), so the
//      agent writes SQL against real columns instead of guessing.
//
// Flow: copy both → describe the escalation in words → paste the returned SQL +
// template into a New rule → Test (dry run) → Run now / Live.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import { Button, SearchSelect } from "@/components/ui";
import { fetchNotificationPrompt, fetchNotificationSchema, saveNotificationPrompt } from "@/notifications/api";
import type { NotificationSchema, NotificationSchemaTable } from "@/notifications/types";
import { Field, Section, inputCls } from "./ui";

/** One table as a paste-ready block: columns then its outgoing edges. */
function tableBlock(t: NotificationSchemaTable): string {
  return [
    t.table + (t.note ? `  -- ${t.note}` : ""),
    ...t.columns.map((c) => `  ${c.name} ${c.type || "TEXT"}`),
    ...(t.joins ?? []).map((j) => `  -> ${j.field} = ${j.model}.${j.ref}   (${j.kind})`),
  ].join("\n");
}

/** Just the graph — for an agent whose context limit cannot take every column. */
function relationsBlock(s: NotificationSchema): string {
  const lines = ["Founder OS relationships (`from.field = to.ref  (kind)`). JOIN only along these edges."];
  for (const t of s.tables) {
    for (const j of t.joins ?? []) lines.push(`${t.table}.${j.field} = ${j.model}.${j.ref}   (${j.kind})`);
  }
  return lines.join("\n");
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs a secure context; fall back to a temp textarea.
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      document.body.removeChild(el);
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
  }, []);
  return { copied, copy };
}

export function PromptSchemaTab({
  prompt, defaultPrompt, onPromptSaved,
}: {
  prompt: string;
  defaultPrompt: string;
  onPromptSaved: (text: string) => void;
}) {
  const [text, setText] = useState(prompt);
  const [busy, setBusy] = useState<"save" | "schema" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<NotificationSchema | null>(null);
  const [table, setTable] = useState("");
  const { copied, copy } = useCopy();

  const effective = text.trim() ? text : defaultPrompt;
  const tableOptions = useMemo(
    () => (schema?.tables ?? []).map((t) => ({ value: t.table, label: t.table, hint: `${t.columns.length} cols` })),
    [schema],
  );
  const picked = schema?.tables.find((t) => t.table === table) ?? null;

  const save = async () => {
    setBusy("save"); setError(null);
    try {
      const res = await saveNotificationPrompt(text);
      onPromptSaved(res.text);
      setText(res.text);
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const loadSchema = async () => {
    setBusy("schema"); setError(null);
    try {
      setSchema(await fetchNotificationSchema());
    } catch (e: any) {
      setError(e?.message ?? "Could not read the schema");
    } finally {
      setBusy(null);
    }
  };

  const reloadPrompt = async () => {
    try {
      const res = await fetchNotificationPrompt();
      setText(res.text);
    } catch { /* keep the current text */ }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)]/40 p-3">
        <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
          <b>How this works:</b> copy the <b>prompt</b> and the <b>schema</b> into any AI agent, describe the escalation in plain words
          (“ping the telecaller with fewer than 3 connected calls in the last hour”), then paste the SQL + template it returns into
          <b> New rule</b>. Check its columns with <b>Test</b> (sends nothing), then <b>Run now</b> or go <b>Live</b>.
        </p>
      </div>

      {error ? <p className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-[11px] font-bold text-[var(--color-danger)]">{error}</p> : null}

      <Section title="Prompt (for the AI agent)" desc="Saved with the dashboard. Blank = the built-in default. It already states the row contract, the window parameters and the level scale.">
        <textarea
          className={`${inputCls} min-h-[18rem] font-mono !text-[11px]`}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={defaultPrompt}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void save()}>
            {busy === "save" ? "Saving…" : "Save prompt"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void copy("prompt", effective)}>
            {copied === "prompt" ? "Copied ✓" : "Copy prompt"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setText("")}>Use default</Button>
          <Button size="sm" variant="ghost" onClick={() => void reloadPrompt()}>Reload saved</Button>
          <span className="text-[10px] text-[var(--text-tertiary)]">{effective.length} chars · default {defaultPrompt.length}</span>
        </div>
      </Section>

      <Section title="Live database schema" desc="Read from the D1 catalog (sqlite_master + table_info + foreign_key_list) and cached for 10 minutes. Every table lists its outgoing joins with a confidence label (fk > orm > declared > app > inferred), so the agent joins along real edges instead of guessing.">
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void loadSchema()}>
            {busy === "schema" ? "Reading…" : schema ? "Refresh schema" : "Load schema"}
          </Button>
          <Button size="sm" variant="secondary" disabled={!schema} onClick={() => schema && void copy("schema", schema.text)}>
            {copied === "schema" ? "Copied ✓" : "Copy full schema"}
          </Button>
          <Button size="sm" variant="secondary" disabled={!schema} onClick={() => schema && void copy("rel", relationsBlock(schema))}>
            {copied === "rel" ? "Copied ✓" : "Copy relationships"}
          </Button>
          <div className="w-64">
            <SearchSelect value={table} options={tableOptions} onChange={setTable} placeholder="Inspect a table…" clearLabel="None" />
          </div>
          {schema ? (
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {schema.tables.length} tables · {schema.relationships ?? 0} edges · {schema.text.length} chars · read {new Date(schema.generatedAt).toLocaleTimeString()}
            </span>
          ) : (
            <span className="text-[10px] text-[var(--text-tertiary)]">Not loaded yet</span>
          )}
        </div>

        {picked ? (
          <div className="rounded-lg border border-[var(--border-card)] p-2.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="font-mono text-[11px] font-bold text-[var(--text-primary)]">{picked.table}</p>
              <Button size="sm" variant="ghost" onClick={() => void copy(`table:${picked.table}`, tableBlock(picked))}>
                {copied === `table:${picked.table}` ? "Copied ✓" : "Copy table"}
              </Button>
            </div>
            {picked.note ? <p className="mb-1.5 text-[10px] text-[var(--text-secondary)]">{picked.note}</p> : null}
            <div className="max-h-56 overflow-auto font-mono text-[10px] leading-5 text-[var(--text-secondary)]">
              {picked.columns.map((c) => <div key={c.name}>{c.name} <span className="text-[var(--text-tertiary)]">{c.type}</span></div>)}
              {(picked.joins ?? []).map((j) => (
                <div key={`${j.field}->${j.model}`} className="text-[var(--color-brand-indigo)]">
                  {"-> "}{j.field} = {j.model}.{j.ref} <span className="text-[var(--text-tertiary)]">({j.kind})</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {schema ? (
          <details className="rounded-lg border border-[var(--border-card)] p-2.5">
            <summary className="cursor-pointer text-[11px] font-bold text-[var(--text-primary)]">Preview the copyable block</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-5 text-[var(--text-secondary)]">{schema.text}</pre>
          </details>
        ) : null}

        <Field label="Table list" hint="Only the tables the engine considers business-relevant. A renamed table can never appear wrong — names come from the DB.">
          <p className="text-[10px] text-[var(--text-tertiary)]">
            {schema ? schema.tables.map((t) => t.table).join(" · ") : "Load the schema to list tables."}
          </p>
        </Field>
      </Section>
    </div>
  );
}
