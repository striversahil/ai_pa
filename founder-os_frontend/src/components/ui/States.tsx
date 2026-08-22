import React from "react";
import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-card)] bg-[var(--surface-sunken)] px-6 py-12 text-center">
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--bg-input)] text-[var(--text-tertiary)]">
          {icon}
        </div>
      )}
      <p className="font-heading text-sm font-bold text-[var(--text-primary)]">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-[var(--text-tertiary)]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--color-danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_6%,transparent)] px-6 py-10 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)] text-[var(--color-danger)]">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86l-8.48 14.7A1.5 1.5 0 003.09 21h17.82a1.5 1.5 0 001.28-2.44l-8.48-14.7a1.5 1.5 0 00-2.62 0z" />
        </svg>
      </div>
      <p className="font-heading text-sm font-bold text-[var(--text-primary)]">{title}</p>
      {message && <p className="mt-1 max-w-sm text-xs text-[var(--text-tertiary)]">{message}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded-xl bg-[var(--color-brand-indigo)] px-4 py-2 text-xs font-bold text-white transition hover:opacity-90"
        >
          Retry
        </button>
      )}
    </div>
  );
}
