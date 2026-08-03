"use client";
import React from 'react';
import type { ViewType } from './Sidebar';

interface MobileNavProps {
  activeView: ViewType;
  onNavigate: (view: ViewType) => void;
}

const items: { view: ViewType; label: string; icon: React.ReactNode }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: <svg className="w-6 h-6 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg> },
  { view: 'enquiries', label: 'Enquiries', icon: <svg className="w-6 h-6 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg> },
  { view: 'briefing', label: 'AI Asst.', icon: <svg className="w-6 h-6 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> },
  { view: 'whatsapp', label: 'WA', icon: <span className="text-xl mb-0.5">💬</span> },
  { view: 'automations', label: 'Auto', icon: <span className="text-xl mb-0.5">⚙️</span> },
];

export default function MobileNav({ activeView, onNavigate }: MobileNavProps) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[var(--bg-card)] border-t border-[var(--border-card)] flex justify-around items-center z-40 px-2">
      {items.map(item => {
        const isActive = item.view === activeView || (item.view === 'enquiries' && activeView === 'detail');
        return (
          <button key={item.view}
            onClick={() => onNavigate(item.view)}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-semibold border-0 bg-transparent cursor-pointer ${isActive ? 'text-brand-indigo' : 'text-[var(--text-secondary)]'}`}
            type="button"
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
