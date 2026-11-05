"use client";

// ui.tsx — small presentational primitives shared by the Customer Master
// components. Deliberately local: the dashboard speaks the Dispatch Floor
// dialect (zinc + indigo, lucide icons, compact type scale), and these
// wrappers keep the tab files about data + layout.
import { X } from "lucide-react";
import type { ReactNode } from "react";

export const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100";

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
    ? "bg-rose-600 text-white border-rose-600"
    : "bg-indigo-600 text-white border-indigo-600";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={!!active}
      className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? activeClass
          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
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
      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{hint}</span>}
    </label>
  );
}

export function ReadOnlyValue({ children = "—" }: { children?: ReactNode }) {
  return <p className="break-words text-sm text-zinc-800 dark:text-zinc-100">{children || "—"}</p>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{children}</h4>
      {hint && <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{hint}</span>}
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
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 ${wide ? "max-w-3xl" : "max-w-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">{footer}</div>}
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
        className={`flex h-full w-full flex-col border-l border-zinc-200 bg-white text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 ${width}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">{title}{subtitle && <div className="mt-1">{subtitle}</div>}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50/60 px-5 py-4 dark:bg-zinc-900/30">{children}</div>
        {footer && <div className="border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">{footer}</div>}
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
  const color = tone === "danger" ? "bg-rose-600 hover:bg-rose-500" : "bg-indigo-600 hover:bg-indigo-500";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg ${color} px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50`}
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
      className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}
