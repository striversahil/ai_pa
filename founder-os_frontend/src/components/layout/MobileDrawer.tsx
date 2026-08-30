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

  const itemClass = (isActive: boolean) =>
    `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
      isActive ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white"
    }`;

  const go = (target: NavTarget) => {
    onNavigate(target);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] md:hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 flex w-[290px] flex-col overflow-y-auto bg-[var(--bg-sidebar)] px-4 py-5 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-brand-indigo)] to-[var(--color-brand-violet)] text-white shadow-lg shadow-[var(--color-brand-indigo)]/30">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div className="leading-tight">
              <span className="block font-heading text-sm font-extrabold tracking-tight text-white">Brindavan Udyog</span>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-white/40">Founder OS</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" title="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {visible.map((item) => {
            const Icon = item.icon;
            const isActive = item.view === activeView || (item.view === "enquiries" && activeView === "detail");
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
              <div className="px-3 pb-1.5 text-[10px] font-extrabold uppercase tracking-wider text-white/35">Dashboards</div>
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

        <div className="mt-auto flex flex-col gap-3 border-t border-white/10 pt-4">
          <button
            onClick={onToggleTheme}
            type="button"
            className="flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            🎨 {APP_THEMES.find((t) => t.id === theme)?.label ?? theme}
          </button>
          <button
            onClick={onLogout}
            type="button"
            className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5 text-left transition hover:bg-white/10"
          >
            {me?.picture ? (
              <img src={me.picture} alt="" className="h-9 w-9 flex-shrink-0 rounded-full" />
            ) : (
              <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/20 font-bold text-white">
                {(me?.name || me?.email || "U").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold text-white">{me?.name || "Signed in"}</span>
              <span className="block truncate text-[11px] text-white/45">{me?.email}</span>
            </div>
            <span className="ml-auto text-[11px] text-rose-300/80">Sign out</span>
          </button>
        </div>
      </div>
    </div>
  );
}