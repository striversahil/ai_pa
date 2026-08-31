"use client";
import React from "react";
import { MOBILE_NAV_ITEMS, type ViewType } from "./nav";

interface MobileNavProps {
  activeView: ViewType;
  onNavigate: (view: ViewType) => void;
  canView: (view: string) => boolean;
}

export default function MobileNav({ activeView, onNavigate, canView }: MobileNavProps) {
  const visible = MOBILE_NAV_ITEMS.filter((i) => canView(i.view));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-[var(--border-card)] bg-[var(--bg-card)] px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
      {visible.map((item) => {
        const Icon = item.icon;
        const isActive = item.view === activeView;
        return (
          <button
            key={item.view}
            type="button"
            onClick={() => onNavigate(item.view)}
            className={`flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors ${
              isActive ? "text-[var(--color-brand-indigo)]" : "text-[var(--text-tertiary)]"
            }`}
          >
            <Icon className="h-5 w-5 shrink-0" strokeWidth={isActive ? 2.4 : 2} />
            <span className="max-w-full truncate px-0.5">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
