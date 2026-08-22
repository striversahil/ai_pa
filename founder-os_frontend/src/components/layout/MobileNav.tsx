"use client";
import React from "react";
import { MOBILE_NAV_ITEMS, type ViewType } from "./nav";

interface MobileNavProps {
  activeView: ViewType;
  onNavigate: (view: ViewType) => void;
}

export default function MobileNav({ activeView, onNavigate }: MobileNavProps) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-[var(--border-card)] bg-[var(--bg-card)] px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
      {MOBILE_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive =
          item.view === activeView || (item.view === "enquiries" && activeView === "detail");
        return (
          <button
            key={item.view}
            type="button"
            onClick={() => onNavigate(item.view)}
            className={`flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors ${
              isActive ? "text-[var(--color-brand-indigo)]" : "text-[var(--text-tertiary)]"
            }`}
          >
            <Icon className="h-5 w-5" strokeWidth={isActive ? 2.4 : 2} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
