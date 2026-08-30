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

export default function Sidebar({ activeView, activeSlug, onNavigate, theme, onSetTheme, accent, onSetAccent, me, onLogout, canView }: SidebarProps) {
  const visible = NAV_ITEMS.filter((i) => canView(i.view));
  const dashboards = useDashboardNav();
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  const itemClass = (isActive: boolean) =>
    `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
      isActive ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white"
    }`;

  const activeBar = (isActive: boolean) =>
    isActive && (
      <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[var(--color-brand-indigo)]" />
    );

  return (
    <aside className="sticky top-0 z-40 hidden h-screen w-[260px] shrink-0 self-start flex-col bg-[var(--bg-sidebar)] px-4 py-6 md:flex">
      <div className="mb-8 flex items-center gap-3 px-2">
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

      <nav className="flex flex-col gap-1">
        {visible.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.view === activeView || (item.view === "enquiries" && activeView === "detail");
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => onNavigate({ type: "view", view: item.view })}
              className={itemClass(isActive)}
            >
              {activeBar(isActive)}
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
                  <button
                    key={d.slug}
                    type="button"
                    onClick={() => onNavigate({ type: "dashboard", slug: d.slug })}
                    className={itemClass(isActive)}
                    title={d.name}
                  >
                    {activeBar(isActive)}
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
        <div className="relative">
          <button
            onClick={() => setAppearanceOpen((v) => !v)}
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            <Palette className="h-4 w-4" />
            <span>Appearance</span>
          </button>
          {appearanceOpen && (
            <div className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-xl border border-white/10 bg-[#15181f] p-3 shadow-2xl animate-scale-up">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/50">Theme</p>
              <div className="space-y-1">
                {APP_THEMES.map((t) => {
                  const active = theme === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => onSetTheme(t.id)}
                      type="button"
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs font-semibold transition ${
                        active ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <span className="h-6 w-6 shrink-0 rounded-md border border-white/15" style={{ backgroundColor: t.swatch }} />
                      <span className="min-w-0 flex-1 truncate">{t.label}</span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                    </button>
                  );
                })}
              </div>
              <p className="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-wider text-white/50">Accent</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {APP_ACCENTS.map((a) => {
                  const active = accent?.toLowerCase() === a.value;
                  return (
                    <button
                      key={a.value}
                      onClick={() => onSetAccent(a.value)}
                      title={a.name}
                      type="button"
                      className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${
                        active ? "scale-110 border-white/90" : "border-transparent hover:scale-105"
                      }`}
                      style={{ backgroundColor: a.value }}
                    >
                      {active && <Check className="h-3 w-3 text-white drop-shadow" />}
                    </button>
                  );
                })}
                {accent && (
                  <button
                    onClick={() => onSetAccent(null)}
                    type="button"
                    title="Use theme default accent"
                    className="ml-auto rounded-lg border border-white/15 px-2 py-1 text-[10px] font-bold text-white/70 hover:bg-white/5 hover:text-white"
                  >
                    Auto
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
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
    </aside>
  );
}