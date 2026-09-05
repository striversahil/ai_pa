"use client";

import React, { useEffect, useRef, useState } from "react";

/**
 * Reusable popover: trigger element + floating panel. Click-outside and
 * Escape close it. Use controlled (`open` + `onOpenChange`) or uncontrolled.
 * The panel always renders above page content (z-50).
 */
export default function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = "left",
  widthClass = "w-72",
  panelClass = "",
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "left" | "right";
  widthClass?: string;
  panelClass?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined && !!onOpenChange;
  const isOpen = isControlled ? open! : internalOpen;
  const setOpen = (o: boolean) => (isControlled ? onOpenChange!(o) : setInternalOpen(o));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <div className="relative inline-block" ref={ref}>
      <div onClick={() => setOpen(!isOpen)} className="inline-block">
        {trigger}
      </div>
      {isOpen && (
        <div
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-2 ${widthClass} z-50 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl ${panelClass}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}