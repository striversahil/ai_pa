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
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-[var(--color-zinc-300)] bg-[var(--surface-sunken)] px-6 py-14 text-center">
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius-control)] bg-[var(--surface-soft)] text-[var(--color-brand-indigo)]">
          {icon}
        </div>
      )}
      <p className="font-heading text-card-title font-semibold text-[var(--text-primary)]">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-label text-[var(--text-secondary)]">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
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
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-[color-mix(in_srgb,var(--color-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_6%,transparent)] px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)] text-[var(--color-danger)]">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86l-8.48 14.7A1.5 1.5 0 003.09 21h17.82a1.5 1.5 0 001.28-2.44l-8.48-14.7a1.5 1.5 0 00-2.62 0z" />
        </svg>
      </div>
      <p className="font-heading text-card-title font-semibold text-[var(--text-primary)]">{title}</p>
      {message && <p className="mt-1.5 max-w-sm text-label text-[var(--text-secondary)]">{message}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 rounded-[var(--radius-control)] bg-[var(--color-brand-indigo)] px-4 py-2 text-label font-semibold text-white transition-opacity hover:opacity-90"
        >
          Retry
        </button>
      )}
    </div>
  );
}
