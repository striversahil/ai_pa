"use client";

// Shared bits of the notification console (inputs, chips, fields).
import React from "react";

export const inputCls =
  "w-full rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--color-brand-indigo)] disabled:opacity-50";

export const monoCls = `${inputCls} font-mono text-[11px] leading-relaxed`;

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">{label}</span>
      {children}
      {hint ? <span className="block text-[10px] text-[var(--text-tertiary)]">{hint}</span> : null}
    </label>
  );
}

/** Toggle chips for a multi-select (audience selectors). */
export function Chips({
  options, selected, onChange, emptyLabel = "No values configured",
}: {
  options: Array<{ value: string; label?: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
}) {
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };
  if (options.length === 0) return <p className="text-[10px] text-[var(--text-tertiary)]">{emptyLabel}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            aria-pressed={on}
            className={`rounded-[var(--radius-pill)] border px-2.5 py-1 text-[11px] font-semibold transition ${
              on
                ? "border-[var(--color-brand-indigo)] bg-[var(--color-brand-indigo)] text-white"
                : "border-[var(--border-card)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {o.label ?? o.value}
          </button>
        );
      })}
    </div>
  );
}

export function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)]/40 p-3.5">
      <div>
        <h4 className="text-xs font-extrabold text-[var(--text-primary)]">{title}</h4>
        {desc ? <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">{desc}</p> : null}
      </div>
      {children}
    </section>
  );
}
