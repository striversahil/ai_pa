"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/ui/SearchSelect.tsx — searchable dropdowns (single + multi).
//
// Why: a rule's audience can list dozens of positions/people. Chips turn that
// into a wall of selection surface; a dropdown keeps one control with a search
// box, and the multi variant shows its selection as ROWS (removable), never as
// chips.
//
// Self-contained (no Portal, no library): a relative wrapper + absolute panel,
// closed on outside click / Escape. Keyboard: ↑ ↓ Enter, Esc.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from "react";

export interface SearchOption {
  value: string;
  label: string;
  hint?: string;
}

const PANEL = "absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] shadow-[var(--shadow-float)]";
const FIELD = "flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-2.5 py-2 text-left text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--color-brand-indigo)] disabled:opacity-50";
const SEARCH = "w-full border-0 border-b border-[var(--border-card)] bg-transparent px-2.5 py-2 text-[11px] text-[var(--text-primary)] outline-none";

function useOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return ref;
}

function filterOptions(options: SearchOption[], q: string): SearchOption[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return options;
  return options.filter((o) => `${o.label} ${o.value} ${o.hint ?? ""}`.toLowerCase().includes(needle));
}

/** Single choice, searchable. `value` is "" when nothing is chosen. */
export function SearchSelect({
  value, options, onChange, placeholder = "Select…", clearLabel = "None", disabled, className = "", id,
}: {
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Label for the clear entry; omit to make the control non-clearable. */
  clearLabel?: string | null;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const ref = useOutside(() => setOpen(false));
  const list = useMemo(() => filterOptions(options, q), [options, q]);
  const current = options.find((o) => o.value === value) ?? null;

  const pick = (v: string) => { onChange(v); setOpen(false); setQ(""); };

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button type="button" id={id} disabled={disabled} onClick={() => setOpen((o) => !o)} className={FIELD}>
        <span className={`truncate ${current ? "" : "text-[var(--text-tertiary)]"}`}>{current?.label ?? placeholder}</span>
        <span className="shrink-0 text-[9px] text-[var(--text-tertiary)]">▾</span>
      </button>
      {open ? (
        <div className={PANEL}>
          <input
            autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }}
            placeholder="Type to filter…" className={SEARCH} spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); const hit = list[active]; if (hit) pick(hit.value); }
            }}
          />
          <div className="max-h-56 overflow-auto">
            {clearLabel !== null ? (
              <button type="button" onClick={() => pick("")}
                className="block w-full px-2.5 py-1.5 text-left text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--surface-sunken)]">
                {clearLabel}
              </button>
            ) : null}
            {list.length === 0 ? (
              <p className="px-2.5 py-2 text-[11px] text-[var(--text-tertiary)]">No match</p>
            ) : list.map((o, i) => (
              <button
                key={o.value} type="button" onClick={() => pick(o.value)}
                className={`block w-full px-2.5 py-1.5 text-left text-[11px] ${i === active ? "bg-[var(--surface-sunken)]" : ""} ${o.value === value ? "font-bold text-[var(--color-brand-indigo)]" : "text-[var(--text-primary)]"} hover:bg-[var(--surface-sunken)]`}
              >
                {o.label}
                {o.hint ? <span className="ml-1.5 text-[10px] font-normal text-[var(--text-tertiary)]">{o.hint}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Multi choice, searchable: selected items are ROWS (with ×), never chips. */
export function SearchMultiSelect({
  values, options, onChange, placeholder = "Add…", emptyText = "Nothing selected", disabled, maxHeight = "max-h-40",
}: {
  values: string[];
  options: SearchOption[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  maxHeight?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useOutside(() => setOpen(false));
  const selected = values ?? [];
  const available = useMemo(
    () => filterOptions(options.filter((o) => !selected.includes(o.value)), q),
    [options, selected, q],
  );
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const hintOf = (v: string) => options.find((o) => o.value === v)?.hint ?? "";

  const add = (v: string) => { onChange([...selected, v]); setQ(""); setOpen(false); };
  const remove = (v: string) => onChange(selected.filter((x) => x !== v));

  return (
    <div className="relative" ref={ref}>
      <div className={`rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] ${disabled ? "opacity-50" : ""}`}>
        <div className={`${maxHeight} overflow-auto`}>
          {selected.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-[var(--text-tertiary)]">{emptyText}</p>
          ) : selected.map((v) => (
            <div key={v} className="flex items-center gap-2 border-b border-[var(--border-card)]/60 px-2.5 py-1.5 last:border-0">
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[var(--text-primary)]">{labelOf(v)}</span>
              {hintOf(v) ? <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">{hintOf(v)}</span> : null}
              <button type="button" disabled={disabled} onClick={() => remove(v)} aria-label={`Remove ${labelOf(v)}`}
                className="shrink-0 rounded px-1.5 text-[12px] leading-none text-[var(--text-tertiary)] hover:text-[var(--color-danger)]">×</button>
            </div>
          ))}
        </div>
        <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 border-t border-[var(--border-card)] px-2.5 py-1.5 text-left text-[11px] text-[var(--color-brand-indigo)] disabled:opacity-50">
          <span>＋ {placeholder}</span>
          <span className="text-[9px] text-[var(--text-tertiary)]">▾</span>
        </button>
      </div>
      {open ? (
        <div className={PANEL}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to filter…" className={SEARCH} spellCheck={false} />
          <div className="max-h-56 overflow-auto">
            {available.length === 0 ? (
              <p className="px-2.5 py-2 text-[11px] text-[var(--text-tertiary)]">
                {options.length === 0 ? "No options available" : "No match"}
              </p>
            ) : available.map((o) => (
              <button key={o.value} type="button" onClick={() => add(o.value)}
                className="block w-full px-2.5 py-1.5 text-left text-[11px] text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]">
                {o.label}
                {o.hint ? <span className="ml-1.5 text-[10px] font-normal text-[var(--text-tertiary)]">{o.hint}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
