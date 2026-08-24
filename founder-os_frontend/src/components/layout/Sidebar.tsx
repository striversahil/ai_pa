"use client";
import React from "react";
import { NAV_ITEMS, type ViewType } from "./nav";
export type { ViewType } from "./nav";

interface SidebarProps {
  activeView: ViewType;
  onNavigate: (view: ViewType) => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  me: { email: string; name: string; picture: string | null } | null;
  onLogout: () => void;
  canView: (view: string) => boolean;
}

export default function Sidebar({ activeView, onNavigate, theme, onToggleTheme, me, onLogout, canView }: SidebarProps) {
  const visible = NAV_ITEMS.filter((i) => canView(i.view));
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
              onClick={() => onNavigate(item.view)}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
                isActive
                  ? "bg-white/10 text-white"
                  : "text-white/55 hover:bg-white/5 hover:text-white"
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[var(--color-brand-indigo)]" />
              )}
              <Icon className="h-5 w-5" strokeWidth={2} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3 border-t border-white/10 pt-4">
        <button
          onClick={onToggleTheme}
          type="button"
          className="flex items-center justify-center gap-2 rounded-xl bg-white/5 px-3 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/10"
        >
          {theme === "dark" ? (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
              </svg>
              <span>Light Mode</span>
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              <span>Dark Mode</span>
            </>
          )}
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
    </aside>
  );
}
