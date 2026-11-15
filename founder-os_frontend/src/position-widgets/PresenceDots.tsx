"use client";

// position-widgets/PresenceDots — live presence (phase 1: local-only).
//
// Root previews with cursor dots per the founder's ask. Server fan-out over
// /api/events is the follow-up — the EventHub DO currently only relays server
// broadcasts (ping/pong), so cross-user cursors need a DO presence path first.
// Until then this tracks the root's own cursor inside the preview + shows each
// listed person's last-login recency (server data), never fake remote cursors.
import { useEffect, useRef, useState } from "react";
import { relActive } from "@/lib/format";

export interface PresencePerson {
  id: string;
  name: string;
  lastLoginAt: string | null;
}

export default function PresenceDots({ people }: { people: PresencePerson[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const move = (e: MouseEvent) => {
      const r = box.getBoundingClientRect();
      setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    };
    const leave = () => setCursor(null);
    box.addEventListener("mousemove", move);
    box.addEventListener("mouseleave", leave);
    return () => {
      box.removeEventListener("mousemove", move);
      box.removeEventListener("mouseleave", leave);
    };
  }, []);

  return (
    <div ref={boxRef} className="relative rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
      <div className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-zinc-400">
        Live view · local cursor (server fan-out follows)
      </div>
      <div className="flex flex-wrap gap-1.5">
        {people.slice(0, 12).map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] dark:border-zinc-800">
            <span className={`h-1.5 w-1.5 rounded-full ${p.lastLoginAt ? "bg-emerald-500" : "bg-zinc-400"}`} />
            <span className="font-semibold text-zinc-700 dark:text-zinc-200">{p.name}</span>
            <span className="text-zinc-400">{relActive(p.lastLoginAt)}</span>
          </span>
        ))}
        {people.length === 0 && <span className="text-[11px] text-zinc-500">Nobody seated in this position.</span>}
      </div>
      {cursor && (
        <div
          className="pointer-events-none absolute z-10 flex items-center gap-1"
          style={{ left: cursor.x + 8, top: cursor.y + 8 }}
        >
          <span className="h-2.5 w-2.5 rounded-full border-2 border-white bg-indigo-500 shadow" />
          <span className="rounded bg-indigo-600 px-1 py-px text-[9px] font-bold text-white">root preview</span>
        </div>
      )}
    </div>
  );
}
