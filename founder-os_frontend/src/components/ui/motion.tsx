"use client";

// components/ui/motion.tsx — the shared animation kit for position dashboards.
// One home for tab transitions, skeletons and progress rings so every
// position feels the same. Respects prefers-reduced-motion.
import React from "react";

/** Mount once per app (gallery + tile grid include it): keyframes + a11y guard. */
export function MotionStyle() {
  return (
    <style>{`
      @keyframes pwFadeSlide { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      @keyframes pwShimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
      .pw-tab-enter { animation: pwFadeSlide .18s ease; }
      .pw-shimmer {
        background: linear-gradient(90deg, rgba(148,163,184,.12) 25%, rgba(148,163,184,.28) 50%, rgba(148,163,184,.12) 75%);
        background-size: 800px 100%;
        animation: pwShimmer 1.4s infinite linear;
      }
      .pw-ring { transition: stroke-dashoffset .5s ease; }
      @media (prefers-reduced-motion: reduce) {
        .pw-tab-enter, .pw-shimmer, .pw-ring, .animate-pulse, .animate-ping { animation: none !important; transition: none !important; }
      }
    `}</style>
  );
}

/** Wrapper that re-runs the enter transition whenever tabKey changes. */
export function TabPanel({ tabKey, children }: { tabKey: string; children: React.ReactNode }) {
  return <div key={tabKey} className="pw-tab-enter">{children}</div>;
}

/**
 * LazySection — mount-on-scroll for heavy dashboard sections. Below-fold
 * sections render a shimmer placeholder until ~200px from the viewport, so a
 * one-page dashboard with every panel still paints fast. Above-fold sections
 * pass `eager` to mount immediately.
 */
export function LazySection({ children, eager, minHeight = 240, label }: {
  children: React.ReactNode;
  eager?: boolean;
  minHeight?: number;
  label: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(!!eager);
  React.useEffect(() => {
    if (eager || visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager, visible]);
  return (
    <div ref={ref} style={visible ? undefined : { minHeight }} aria-label={label}>
      {visible ? <div className="pw-tab-enter">{children}</div> : <Skeleton lines={3} />}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2 py-2" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="pw-shimmer h-9 rounded-lg" />
      ))}
    </div>
  );
}

/** Small SVG progress ring (reward/completion affordance). */
export function ProgressRing({ value, size = 40 }: { value: number; size?: number }) {
  const clamped = Math.max(0, Math.min(1, value));
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${Math.round(clamped * 100)}% complete`}>
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={5} fill="none" className="stroke-zinc-200 dark:stroke-zinc-800" />
      <circle
        cx={size / 2} cy={size / 2} r={r} strokeWidth={5} fill="none" strokeLinecap="round"
        className="pw-ring stroke-emerald-500"
        strokeDasharray={c} strokeDashoffset={c * (1 - clamped)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
