"use client";

// useCountUp — animate a number to its new value (presentational only).
//
// Used by the podium metric tiles so a live refetch glides instead of snapping.
// Deliberately tiny (no dependency): one rAF loop, easeOutCubic, and it honours
// `prefers-reduced-motion` by showing the final value immediately. The FIRST
// render always shows the final value too — no count-up from zero on mount,
// which would read as a fake "we just made ₹X" flash.

import { useEffect, useRef, useState } from "react";

function reducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useCountUp(value: number, durationMs = 500): number {
  const [display, setDisplay] = useState(Number.isFinite(value) ? value : 0);
  const fromRef = useRef(Number.isFinite(value) ? value : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    if (reducedMotion() || target === fromRef.current) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      setDisplay(from + (target - from) * ease(p));
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      fromRef.current = target;
    };
  }, [value, durationMs]);

  return display;
}

export default useCountUp;
