"use client";

// ui.tsx — small presentational primitives shared by the Customer Master
// components. Deliberately local: the dashboard has one look (theme tokens),
// and these wrappers keep the tab files about data + layout.
import type { ReactNode } from "react";

export const inputClass =
  "w-full rounded-[var(--radius-control)] border border-[var(--border-card)] bg-[var(--bg-input)] px-3 py-2 text-label text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-tertiary)] focus:border-[var(--color-brand-indigo)]";

export function Chip({
  active, onClick, children, title, tone = "brand",
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  title?: string;
  tone?: "brand" | "danger";
}) {
  const activeClass = tone === "danger"
    ? "bg-[var(--color-danger)] text-white border-[var(--color-danger)]"
    : "bg-[var(--color-brand-indigo)] text-white border-[var(--color-brand-indigo)]";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={!!active}
      className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
        active
          ? activeClass
          : "border-[var(--border-card)] bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}

export function FilterSelect({
  label, value, onChange, options, allLabel = "All",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} py-1.5`}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

export function Field({
  label, hint, children, className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-[var(--text-tertiary)]">{hint}</span>}
    </label>
  );
}

export function ReadOnlyValue({ children = "—" }: { children?: ReactNode }) {
  return <p className="break-words text-label text-[var(--text-primary)]">{children || "—"}</p>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">{children}</h4>
      {hint && <span className="text-[10px] text-[var(--text-tertiary)]">{hint}</span>}
    </div>
  );
}

export function Modal({
  open, title, subtitle, onClose, children, footer, wide = false, dismissable = true,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  dismissable?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center"
      onClick={() => dismissable && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-card)] bg-[var(--bg-card)] shadow-2xl ${wide ? "max-w-3xl" : "max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-card)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="font-heading text-card-title font-semibold text-[var(--text-primary)]">{title}</h3>
            {subtitle && <p className="mt-0.5 text-caption text-[var(--text-secondary)]">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-control)] px-2 py-1 text-lg leading-none text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-[var(--border-card)] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({
  open, onClose, title, subtitle, children, footer, width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/40 backdrop-blur-[2px]" onClick={onClose} role="presentation">
      <aside
        role="dialog"
        aria-modal="true"
        className={`flex h-full w-full flex-col border-l border-[var(--border-card)] bg-[var(--bg-card)] shadow-2xl ${width}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-card)] px-5 py-4">
          <div className="min-w-0">{title}{subtitle && <div className="mt-1">{subtitle}</div>}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-control)] px-2 py-1 text-xl leading-none text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-[var(--border-card)] px-5 py-3">{footer}</div>}
      </aside>
    </div>
  );
}

export function PrimaryButton({
  onClick, disabled, children, type = "button", tone = "brand",
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  type?: "button" | "submit";
  tone?: "brand" | "danger";
}) {
  const color = tone === "danger" ? "bg-[var(--color-danger)]" : "bg-[var(--color-brand-indigo)]";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-[var(--radius-control)] ${color} px-4 py-2 text-label font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  onClick, disabled, children, title,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-[var(--radius-control)] border border-[var(--border-card)] bg-[var(--surface-soft)] px-3 py-2 text-label font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
