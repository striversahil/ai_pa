"use client";
import React from 'react';
import type { Agent } from '../../types';

export type ViewType = 'dashboard' | 'enquiries' | 'detail' | 'briefing' | 'whatsapp' | 'automations';

interface SidebarProps {
  activeView: ViewType;
  onNavigate: (view: ViewType) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  currentAgent: Agent;
}

const navItems: { view: ViewType; label: string; icon: React.ReactNode }[] = [
  {
    view: 'automations', label: 'Automations',
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
  },
  {
    view: 'dashboard', label: 'Dashboard',
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
  },
  {
    view: 'enquiries', label: 'Enquiries',
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
  },
  {
    view: 'briefing', label: 'Founder AI Assistant',
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
  },
  {
    view: 'whatsapp', label: 'WhatsApp Automation',
    icon: <span className="text-lg">💬</span>
  },
];

export default function Sidebar({ activeView, onNavigate, theme, onToggleTheme, currentAgent }: SidebarProps) {
  return (
    <aside className="hidden md:flex flex-col h-screen sticky top-0 bg-[var(--bg-sidebar)] text-[var(--text-secondary)] p-6 border-r border-[var(--border-card)] z-40">
      <div className="flex items-center gap-3 text-[var(--text-primary)] font-extrabold text-xl mb-10">
        <svg className="w-8 h-8 text-brand-indigo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span className="font-heading tracking-tight text-[var(--text-primary)]">Brindavan Udyog</span>
      </div>

      <nav className="flex flex-col gap-2 flex-grow">
        {navItems.map(item => {
          const isActive = item.view === activeView || (item.view === 'enquiries' && (activeView === 'enquiries' || activeView === 'detail'));
          return (
            <button key={item.view}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg font-semibold text-sm transition-all duration-200 text-left cursor-pointer border-0 w-full ${isActive ? 'bg-brand-indigo text-white shadow-lg shadow-indigo-600/25' : 'hover:bg-black/5 dark:hover:bg-white/5 hover:text-[var(--text-primary)] bg-transparent'}`}
              onClick={() => onNavigate(item.view)}
              type="button"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex flex-col gap-4 pt-6 border-t border-[var(--border-card)] mt-auto">
        <button onClick={onToggleTheme}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-[var(--text-primary)] font-medium text-sm transition-all duration-200 cursor-pointer border-0">
          {theme === 'dark' ? (
            <><svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z" /></svg><span>Light Mode</span></>
          ) : (
            <><svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg><span>Dark Mode</span></>
          )}
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white relative flex-shrink-0" style={{ backgroundColor: currentAgent.color }}>
            {currentAgent.initials}
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-brand-emerald border-2 border-[var(--bg-sidebar)]"></span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-[var(--text-primary)] text-sm truncate">{currentAgent.name}</span>
            <span className="text-xs text-[var(--text-tertiary)]">B2B Agent</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
