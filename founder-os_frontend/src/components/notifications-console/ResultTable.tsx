"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ResultTable — the authored SQL's REAL output, as a table.
//
// The dry run returns the actual rows (engine: `sampleRows`, capped 50×30), so
// the console shows exactly what the query produced: one line per person, every
// header in SELECT order. Identity/level columns stay visible but dimmed — they
// are the engine's row contract, not message material.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";

const PLUMBING = /^(telecaller_id|employee_key|value|level|severity|escalation_level|escalationlevel)$/i;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(v);
}

export function ResultTable({
  columns, rows, emptyHint,
}: {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  emptyHint?: string;
}) {
  const cols = columns.length > 0 ? columns : Object.keys(rows[0] ?? {});
  if (cols.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--border-card)] px-3 py-3 text-center text-[10px] text-[var(--text-tertiary)]">
        {emptyHint ?? "No rows — nothing to show yet."}
      </p>
    );
  }
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-[var(--border-card)]">
      <table className="w-full border-collapse text-left font-mono text-[10px]">
        <thead className="sticky top-0 bg-[var(--surface-sunken)]">
          <tr>
            <th className="w-8 border-b border-[var(--border-card)] px-2 py-1 text-right text-[var(--text-tertiary)]">#</th>
            {cols.map((c) => (
              <th
                key={c}
                className={`whitespace-nowrap border-b border-[var(--border-card)] px-2 py-1 font-bold ${PLUMBING.test(c) ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"}`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length + 1} className="px-2 py-3 text-center text-[10px] text-[var(--text-tertiary)]">
                {emptyHint ?? "The query returned no rows."}
              </td>
            </tr>
          ) : rows.map((row, i) => (
            <tr key={i} className={i === 0 ? "bg-[var(--color-brand-indigo)]/5" : undefined}>
              <td className="border-b border-[var(--border-card)]/60 px-2 py-1 text-right text-[var(--text-tertiary)]">{i + 1}</td>
              {cols.map((c) => (
                <td
                  key={c}
                  className={`max-w-[16rem] truncate border-b border-[var(--border-card)]/60 px-2 py-1 ${PLUMBING.test(c) ? "text-[var(--text-tertiary)]" : "text-[var(--text-secondary)]"}`}
                  title={cell(row[c])}
                >
                  {cell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
