"use client";

import React, { useEffect, useState } from "react";

const STEPS = ["Reading text & photos", "Splitting into items", "Checking price memory"];

function useElapsed(): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return secs;
}

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function SpinRing({ size = "w-4 h-4" }: { size?: string }) {
  return (
    <svg className={`${size} animate-spin flex-shrink-0`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Aesthetic AI-working indicator: animated gradient border, shimmer
 *  skeleton bars, cycling step text + live timer. Two shapes:
 *  - full block (new-enquiry intake, empty items list)
 *  - compact inline row (an `aiPending` item awaiting the vision split) */
export default function AiProcessingLoader({
  title = "AI is processing",
  subtitle = "Items appear automatically — no need to refresh",
  compact = false,
}: {
  title?: string;
  subtitle?: string;
  compact?: boolean;
}) {
  const secs = useElapsed();
  const step = STEPS[Math.min(Math.floor(secs / 15), STEPS.length - 1)];

  if (compact) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mt-1.5 flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-2.5 py-1.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-300"
      >
        <SpinRing size="w-3.5 h-3.5" />
        <span className="min-w-0 flex-1 truncate">✨ {step}…</span>
        <span className="flex-shrink-0 font-mono text-[10px] opacity-70">{fmt(secs)}</span>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite">
      <style>{`
        @keyframes ai-loader-border { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        @keyframes ai-loader-shimmer { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
        .ai-loader-border { background: linear-gradient(110deg, #6366f1, #a855f7, #22d3ee, #6366f1); background-size: 220% 220%; animation: ai-loader-border 3s ease infinite; }
        .ai-loader-shimmer { animation: ai-loader-shimmer 1.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ai-loader-border, .ai-loader-shimmer { animation: none !important; } }
      `}</style>
      <div className="ai-loader-border rounded-2xl p-[1.5px] shadow-lg shadow-indigo-600/20">
        <div className="rounded-2xl bg-[var(--bg-card)] p-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="text-indigo-500 dark:text-indigo-300">
              <SpinRing />
            </span>
            <p className="flex-1 text-sm font-extrabold text-[var(--text-primary)]">
              ✨ {title}
            </p>
            <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-600 dark:text-indigo-300 text-[10px] font-mono font-bold">
              {fmt(secs)}
            </span>
          </div>
          <p className="text-xs font-semibold text-[var(--text-secondary)]">
            {step}…
          </p>
          <div className="space-y-2" aria-hidden="true">
            {[92, 78, 85].map((w, i) => (
              <div
                key={i}
                className="relative h-2.5 overflow-hidden rounded-full bg-[var(--bg-input)]"
              >
                <span
                  className="ai-loader-shimmer absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-indigo-400/40 to-transparent"
                  style={{ width: `${w / 3}%` }}
                />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)]">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}
