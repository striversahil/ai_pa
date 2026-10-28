"use client";
import React, { useState } from "react";
import {
  NAV_ITEMS,
  type ViewType,
  type NavTarget,
} from "./nav";
import { useDashboardNav } from "@/hooks/useDashboardNav";
import { APP_THEMES, APP_ACCENTS, type AppThemeId } from "@/hooks/useTheme";
import {
  LayoutGrid,
  FileText,
  Tag,
  PhoneCall,
  Radio,
  Factory,
  Megaphone,
  Table2,
  Bot,
  PackageCheck,
  ClipboardList,
  ClipboardCheck,
  Crown,
  Palette,
  Check,
  type LucideIcon,
} from "lucide-react";
export type { ViewType } from "./nav";

const DASH_ICONS: Record<string, LucideIcon> = {
  "zoho-sent-analyzer": FileText,
  "dpp-prices-dashboard": Tag,
  "neodove-telecaller-report": PhoneCall,
  "wa-engine-monitor": Radio,
  "enterprise-operations-analytics": Factory,
  "whatsapp-marketing": Megaphone,
  "whatsapp-autopilot": Bot,
  "sheet-analysis": Table2,
  telecalling: PhoneCall,
  crm: PackageCheck,
  "enquiry-tracker": ClipboardList,
  "enquiry-procurement": ClipboardCheck,
  "enquiry-management": Crown,
  "telecalling-agent-analysis": Table2,
};

interface SidebarProps {
  activeView: ViewType;
  activeSlug: string | null;
  onNavigate: (target: NavTarget) => void;
  theme: AppThemeId;
  onSetTheme: (id: AppThemeId) => void;
  accent: string | null;
  onSetAccent: (value: string | null) => void;
  me: { email: string; name: string; picture: string | null } | null;
  onLogout: () => void;
  canView: (view: string) => boolean;
}

/**
 * Collapsed icon rail that expands to the full sidebar on hover (or when a
 * child receives keyboard focus, so tabbing through the nav still shows the
 * labels it is landing on).
 *
 * Width math: the rail is 76px with `px-4` (32px of padding), leaving a 44px
 * content box. A nav row is `px-3` + a 20px icon, so 12 + 20 + 12 = 44 — the
 * icons sit exactly centred in the rail with no conditional alignment classes.
 * Everything past 44px is clipped by `overflow-hidden`, and the trailing
 * labels fade out via opacity so nothing reflows mid-animation.
 */
export default function Sidebar({ activeView, activeSlug, onNavigate, theme, onSetTheme, accent, onSetAccent, me, onLogout, canView }: SidebarProps) {
  const visible = NAV_ITEMS.filter((i) => canView(i.view));
  const dashboards = useDashboardNav();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  // A saved accent outside the preset swatches → the custom chip is active.
  const custom = !!accent && !APP_ACCENTS.some((a) => a.value.toLowerCase() === accent.toLowerCase());
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const expanded = hovered || focusWithin;

  /* All colours route through theme tokens so the shell renders correctly on
     the warm Sage canvas and on every dark preset alike. */
  const itemClass = (isActive: boolean) =>
    `group relative flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-left text-label font-semibold transition-colors duration-150 ${
      isActive
        ? "bg-[var(--surface-soft)] text-[var(--color-brand-indigo)]"
        : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
    }`;

  const activeBar = (isActive: boolean) =>
    isActive && (
      <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[var(--color-brand-indigo)]" />
    );

  /* Labels fade in slightly after the rail starts growing so the text is not
     mid-squeeze while the width animates. */
  const labelClass = expanded
    ? "opacity-100 transition-opacity duration-200 delay-75"
    : "opacity-0 transition-opacity duration-100";

  const collapse = () => {
    setHovered(false);
    setFocusWithin(false);
    // The popover is wider than the rail, so it can't outlive the expansion.
    setAppearanceOpen(false);
  };

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={collapse}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocusWithin(false);
          setAppearanceOpen(false);
        }
      }}
      aria-label="Main navigation"
      className={`sticky top-0 z-40 hidden h-screen shrink-0 self-start flex-col overflow-hidden border-r border-[var(--border-card)] bg-[var(--bg-sidebar)] px-4 py-6 transition-[width] duration-300 ease-out motion-reduce:transition-none md:flex ${
        expanded ? "w-[260px]" : "w-[76px]"
      }`}
    >
      <div className="mb-8 flex items-center gap-3 px-1.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-gradient-to-br from-[var(--color-brand-indigo)] to-[var(--color-indigo-500)] text-white shadow-[var(--shadow-soft)]">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <div className={`min-w-0 leading-tight ${labelClass}`}>
          <span className="block truncate font-heading text-sm font-bold tracking-tight text-[var(--text-primary)]">Brindavan Udyog India</span>
          <span className="block truncate text-[11px] font-medium tracking-wide text-[var(--text-tertiary)]">Founder OS</span>
        </div>
      </div>

      <nav className="scrollbar-thin -mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto px-1">
        {visible.map((item) => {
          const Icon = item.icon;
          const isActive = item.view === activeView;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => onNavigate({ type: "view", view: item.view })}
              className={itemClass(isActive)}
              title={expanded ? undefined : item.label}
              aria-label={expanded ? undefined : item.label}
              aria-current={isActive ? "page" : undefined}
            >
              {activeBar(isActive)}
              <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
              <span className={`truncate whitespace-nowrap ${labelClass}`}>{item.label}</span>
            </button>
          );
        })}

        {dashboards.length > 0 && (
          <div className="mt-4">
            <div className={`px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] ${labelClass}`}>
              Dashboards
            </div>
            <div className="flex flex-col gap-1">
              {dashboards.map((d) => {
                const Icon = DASH_ICONS[d.slug] ?? LayoutGrid;
                const isActive = d.slug === activeSlug;
                return (
                  <button
                    key={d.slug}
                    type="button"
                    onClick={() => onNavigate({ type: "dashboard", slug: d.slug })}
                    className={itemClass(isActive)}
                    title={d.name}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {activeBar(isActive)}
                    <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
                    <span className={`truncate whitespace-nowrap ${labelClass}`}>{d.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-3 border-t border-[var(--border-card)] pt-4">
        <div className="relative">
          <button
            onClick={() => setAppearanceOpen((v) => !v)}
            type="button"
            className="flex w-full items-center gap-3 rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2.5 text-label font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
            title={expanded ? undefined : "Appearance"}
            aria-label={expanded ? undefined : "Appearance"}
            aria-expanded={appearanceOpen}
          >
            <Palette className="h-5 w-5 shrink-0" />
            <span className={`truncate whitespace-nowrap ${labelClass}`}>Appearance</span>
          </button>
          {appearanceOpen && (
            <div className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-[var(--radius-control)] border border-[var(--border-card)] bg-[var(--surface-raised)] p-3 shadow-[var(--shadow-float)] animate-scale-up">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Theme</p>
              <div className="space-y-1">
                {APP_THEMES.map((t) => {
                  const active = theme === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => onSetTheme(t.id)}
                      type="button"
                      className={`flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-caption font-medium transition-colors ${
                        active
                          ? "bg-[var(--surface-soft)] text-[var(--color-brand-indigo)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <span className="h-6 w-6 shrink-0 rounded-md border border-[var(--border-card)]" style={{ backgroundColor: t.swatch }} />
                      <span className="min-w-0 flex-1 truncate">{t.label}</span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-brand-indigo)]" />}
                    </button>
                  );
                })}
              </div>
              <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Accent</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {APP_ACCENTS.map((a) => {
                  const active = accent?.toLowerCase() === a.value;
                  return (
                    <button
                      key={a.value}
                      onClick={() => onSetAccent(a.value)}
                      title={a.name}
                      type="button"
                      className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-transform ${
                        active ? "scale-110 border-[var(--text-primary)]" : "border-transparent hover:scale-105"
                      }`}
                      style={{ backgroundColor: a.value }}
                    >
                      {active && <Check className="h-3 w-3 text-white drop-shadow" />}
                    </button>
                  );
                })}
                {/* Any hex is valid — the ramp is generated from it in the
                    direction the active preset needs (see accentCssVars). */}
                <label
                  title={custom ? `Custom accent — ${accent}` : "Custom accent colour"}
                  className={`relative flex h-6 w-6 items-center justify-center rounded-full border-2 transition-transform ${
                    custom ? "scale-110 border-[var(--text-primary)]" : "border-[var(--border-card)] hover:scale-105"
                  }`}
                  style={{ background: "conic-gradient(from 0deg, #f43f5e, #f59e0b, #10b981, #0ea5e9, #8b5cf6, #f43f5e)" }}
                >
                  <input
                    type="color"
                    value={custom ? accent! : "#5b5ef0"}
                    onChange={(e) => onSetAccent(e.target.value)}
                    aria-label="Custom accent colour"
                    className="absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0"
                  />
                  {custom && <Check className="h-3 w-3 text-white drop-shadow" />}
                </label>
                {accent && (
                  <button
                    onClick={() => onSetAccent(null)}
                    type="button"
                    title="Use theme default accent"
                    className="ml-auto rounded-[var(--radius-sm)] border border-[var(--border-card)] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                  >
                    Auto
                  </button>
                )}
              </div>
              {custom && (
                <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{accent}</p>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onLogout}
          type="button"
          className={`flex items-center gap-3 rounded-[var(--radius-control)] bg-[var(--surface-sunken)] py-2.5 text-left transition-colors hover:bg-[var(--surface-soft)] ${
            expanded ? "px-3" : "px-1"
          }`}
          title={expanded ? undefined : "Sign out"}
          aria-label={me?.name ? `Sign out ${me.name}` : "Sign out"}
        >
          {me?.picture ? (
            <img src={me.picture} alt="" className="h-9 w-9 flex-shrink-0 rounded-full" />
          ) : (
            <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--surface-soft)] font-bold text-[var(--color-brand-indigo)]">
              {(me?.name || me?.email || "U").charAt(0).toUpperCase()}
            </div>
          )}
          <div className={`min-w-0 leading-tight ${labelClass}`}>
            <span className="block truncate text-label font-semibold text-[var(--text-primary)]">{me?.name || "Signed in"}</span>
            <span className="block truncate text-caption text-[var(--text-tertiary)]">{me?.email}</span>
          </div>
          <span className={`ml-auto shrink-0 whitespace-nowrap text-caption font-medium text-[var(--color-danger)] ${labelClass}`}>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
