"use client";

/**
 * Shared horizontal tab bar used by automation dashboards (Accounts, Digital
 * Marketing, Telecalling, Debtors Tracker). One visual contract: wrapping row
 * of rounded pills, indigo active state, optional icon + count.
 */
export type TabBarBadgeTone = "danger" | "warning" | "neutral";

/** Extra pill after the label — used where one tab carries two live numbers
 *  (e.g. Payment dues: overdue ₹ + this-week ₹, visible before opening the tab). */
export type TabBarBadge = {
  text: string;
  tone: TabBarBadgeTone;
  /** Full-figure explanation; falls back to the tab's own title. */
  title?: string;
};

export type TabBarItem<K extends string = string> = {
  key: K;
  label: string;
  icon?: string;
  count?: number | null;
  disabled?: boolean;
  title?: string;
  /** 'danger' paints the count rose (e.g. incomplete backlog). */
  tone?: "danger";
  /** Up to a few short tone-coded pills rendered next to the label. */
  badges?: TabBarBadge[];
};

/** `pill` (default): wrapping row of brand-filled pills.
 *  `segmented`: one bordered track, active segment lifts onto the card
 *  surface — quieter, reads as "pick one view" (scrolls on narrow screens). */
export type TabBarVariant = "pill" | "segmented";

export function TabBar<K extends string>({
  items, active, onChange, className = "", ariaLabel = "Dashboard tabs",
  variant = "pill", size = "md",
}: {
  items: TabBarItem<K>[];
  active: K;
  onChange: (key: K) => void;
  className?: string;
  ariaLabel?: string;
  variant?: TabBarVariant;
  size?: "sm" | "md";
}) {
  const seg = variant === "segmented";
  const navClass = seg
    ? "flex max-w-full flex-row flex-nowrap gap-1 overflow-x-auto rounded-[var(--radius-control)] border border-[var(--border-card)] bg-[var(--surface-soft)] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    : "flex flex-row flex-wrap gap-2";
  const pad = size === "sm" ? "px-3 py-1.5 text-caption" : seg ? "px-3.5 py-2 text-label" : "px-4 py-2.5 text-label";
  return (
    <nav aria-label={ariaLabel} className={`${navClass} ${className}`}>
      {items.map((t) => {
        const isActive = active === t.key;
        const tone = seg
          ? isActive
            ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-[var(--shadow-soft)]"
            : "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          : isActive
            ? "bg-[var(--color-brand-indigo)] text-white shadow-[var(--shadow-soft)]"
            : "bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:bg-[var(--bg-input)]";
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            disabled={t.disabled}
            title={t.title}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center ${seg ? "shrink-0 gap-2 whitespace-nowrap rounded-[calc(var(--radius-control)-4px)]" : "gap-2.5 rounded-[var(--radius-control)]"} ${pad} text-left font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
          >
            {t.icon && <span className={`${size === "sm" ? "text-sm" : "text-base"} leading-none`}>{t.icon}</span>}
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold ${
                isActive && seg
                  ? "bg-[color-mix(in_srgb,var(--color-brand-indigo)_14%,transparent)] text-[var(--color-brand-indigo)]"
                  : isActive
                  ? "bg-white/25 text-white"
                  : t.tone === "danger"
                    ? "bg-rose-500/15 text-rose-500 dark:text-rose-400"
                    : "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400"
              }`}>
                {t.count}
              </span>
            )}
            {t.badges?.map((b) => (
              <span
                key={`${t.key}-${b.tone}-${b.text}`}
                title={b.title ?? t.title}
                className={`inline-flex h-5 items-center rounded-full px-1.5 font-mono text-[11px] font-extrabold leading-none ${
                  b.tone === "danger"
                    ? "bg-rose-600 text-white"
                    : b.tone === "warning"
                      ? "bg-amber-500 text-amber-950"
                      : "bg-zinc-500/20 text-zinc-600 dark:text-zinc-300"
                }`}
              >
                {b.text}
              </span>
            ))}
          </button>
        );
      })}
    </nav>
  );
}

export default TabBar;
