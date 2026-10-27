"use client";

import React from "react";
import {
  NAV_ITEMS,
  type ViewType,
  type NavTarget,
} from "./nav";
import { useDashboardNav } from "@/hooks/useDashboardNav";
import { APP_THEMES, type AppThemeId } from "@/hooks/useTheme";
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
  X,
  type LucideIcon,
} from "lucide-react";

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

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  activeView: ViewType;
  activeSlug: string | null;
  onNavigate: (target: NavTarget) => void;
  theme: AppThemeId;
  onToggleTheme: () => void;
  me: { email: string; name: string; picture: string | null } | null;
  onLogout: () => void;
  canView: (view: string) => boolean;
}

export default function MobileDrawer({
  open,
  onClose,
  activeView,
  activeSlug,
  onNavigate,
  theme,
  onToggleTheme,
  me,
  onLogout,
  canView,
}: MobileDrawerProps) {
  const visible = NAV_ITEMS.filter((i) => canView(i.view));
  const dashboards = useDashboardNav();

  /* Tokens, not hardcoded whites — the drawer must read correctly on the warm
     Sage canvas as well as on the dark presets (mirrors Sidebar.tsx). */
  const itemClass = (isActive: boolean) =>
    `group relative flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-left text-label font-semibold transition-colors duration-150 ${
      isActive
        ? "bg-[var(--surface-soft)] text-[var(--color-brand-indigo)]"
        : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
    }`;

  const go = (target: NavTarget) => {
    onNavigate(target);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] md:hidden">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 flex w-[290px] flex-col overflow-y-auto border-r border-[var(--border-card)] bg-[var(--bg-sidebar)] px-4 py-5 shadow-[var(--shadow-float)]">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-gradient-to-br from-[var(--color-brand-indigo)] to-[var(--color-indigo-500)] text-white shadow-[var(--shadow-soft)]">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div className="leading-tight">
              <span className="block font-heading text-sm font-bold tracking-tight text-[var(--text-primary)]">Brindavan Udyog India</span>
              <span className="block text-[11px] font-medium tracking-wide text-[var(--text-tertiary)]">Founder OS</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
            title="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {visible.map((item) => {
            const Icon = item.icon;
            const isActive = item.view === activeView;
            return (
              <button key={item.view} type="button" onClick={() => go({ type: "view", view: item.view })} className={itemClass(isActive)}>
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[var(--color-brand-indigo)]" />
                )}
                <Icon className="h-5 w-5" strokeWidth={2} />
                <span>{item.label}</span>
              </button>
            );
          })}

          {dashboards.length > 0 && (
            <div className="mt-3">
              <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Dashboards</div>
              <div className="flex flex-col gap-1">
                {dashboards.map((d) => {
                  const Icon = DASH_ICONS[d.slug] ?? LayoutGrid;
                  const isActive = d.slug === activeSlug;
                  return (
                    <button key={d.slug} type="button" onClick={() => go({ type: "dashboard", slug: d.slug })} className={itemClass(isActive)} title={d.name}>
                      {isActive && (
                        <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[var(--color-brand-indigo)]" />
                      )}
                      <Icon className="h-5 w-5" strokeWidth={2} />
                      <span className="truncate">{d.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </nav>

        <div className="mt-auto flex flex-col gap-3 border-t border-[var(--border-card)] pt-4">
          <button
            onClick={onToggleTheme}
            type="button"
            className="flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2.5 text-label font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
          >
            🎨 {APP_THEMES.find((t) => t.id === theme)?.label ?? theme}
          </button>
          <button
            onClick={onLogout}
            type="button"
            className="flex items-center gap-3 rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-soft)]"
          >
            {me?.picture ? (
              <img src={me.picture} alt="" className="h-9 w-9 flex-shrink-0 rounded-full" />
            ) : (
              <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--surface-soft)] font-bold text-[var(--color-brand-indigo)]">
                {(me?.name || me?.email || "U").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 leading-tight">
              <span className="block truncate text-label font-semibold text-[var(--text-primary)]">{me?.name || "Signed in"}</span>
              <span className="block truncate text-caption text-[var(--text-tertiary)]">{me?.email}</span>
            </div>
            <span className="ml-auto shrink-0 whitespace-nowrap text-caption font-medium text-[var(--color-danger)]">Sign out</span>
          </button>
        </div>
      </div>
    </div>
  );
}