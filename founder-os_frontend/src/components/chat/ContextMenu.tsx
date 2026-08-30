"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  onSelect: () => void;
}

const MARGIN = 8;

export default function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({
    position: "fixed",
    left: x,
    top: y,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 0;
    let left = x;
    let top = y;
    if (left + w > window.innerWidth - MARGIN) left = x - w;
    if (top + h > window.innerHeight - MARGIN) top = y - h;
    left = Math.max(MARGIN, left);
    top = Math.max(MARGIN, top);
    setPos({ position: "fixed", left, top, visibility: "visible" });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-[130]"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        ref={ref}
        className="z-[131] overflow-y-auto rounded-lg border border-white/[0.06] bg-[var(--chat-float)] py-[6px] shadow-[0_8px_16px_rgba(0,0,0,0.24)]"
        style={{ ...pos, minWidth: 200, maxWidth: 260, maxHeight: `min(60vh, calc(100vh - ${MARGIN * 2}px))` }}
      >
        {items.map((item, i) => (
          <React.Fragment key={`${item.label}-${i}`}>
            {item.divider && <div className="mx-2 my-[5px] h-px bg-white/[0.07]" />}
            <button
              disabled={item.disabled}
              onClick={() => { onClose(); item.onSelect(); }}
              onContextMenu={(e) => { e.preventDefault(); onClose(); item.onSelect(); }}
              className={`mx-[6px] block w-[calc(100%-12px)] truncate rounded-[4px] px-2.5 py-[6px] text-left text-[13px] font-medium leading-[18px] transition disabled:cursor-default disabled:opacity-40 ${
                item.danger ? "text-[#f23f43] hover:bg-[#f23f43] hover:text-white" : "text-[var(--chat-muted)] hover:bg-[var(--chat-accent)] hover:text-white"
              }`}
            >
              {item.label}
            </button>
          </React.Fragment>
        ))}
      </div>
    </>
  );
}
