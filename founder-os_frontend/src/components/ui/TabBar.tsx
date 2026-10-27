"use client";

/**
 * Shared horizontal tab bar used by automation dashboards (Accounts, Digital
 * Marketing, Telecalling, Debtors Tracker). One visual contract: wrapping row
 * of rounded pills, indigo active state, optional icon + count.
 */
export type TabBarItem<K extends string = string> = {
  key: K;
  label: string;
  icon?: string;
  count?: number | null;
  disabled?: boolean;
  title?: string;
  /** 'danger' paints the count rose (e.g. incomplete backlog). */
  tone?: "danger";
};

export function TabBar<K extends string>({
  items, active, onChange, className = "", ariaLabel = "Dashboard tabs",
}: {
  items: TabBarItem<K>[];
  active: K;
  onChange: (key: K) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <nav aria-label={ariaLabel} className={`flex flex-row flex-wrap gap-2 ${className}`}>
      {items.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            disabled={t.disabled}
            title={t.title}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-[var(--radius-control)] px-4 py-2.5 text-left text-label font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isActive
                ? "bg-[var(--color-brand-indigo)] text-white shadow-[var(--shadow-soft)]"
                : "bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:bg-[var(--bg-input)]"
            }`}
          >
            {t.icon && <span className="text-base leading-none">{t.icon}</span>}
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold ${
                isActive
                  ? "bg-white/25 text-white"
                  : t.tone === "danger"
                    ? "bg-rose-500/15 text-rose-500 dark:text-rose-400"
                    : "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400"
              }`}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export default TabBar;
