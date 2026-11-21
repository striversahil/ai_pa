"use client";
import React, { useState } from "react";
import { Button } from "@/components/ui";
import { DESK_LABEL, startTargets } from "@/enquiry-threads/types";
import { useItemThreadsCtx } from "./EnquiryThreadsProvider";
import ThreadCard from "./ThreadCard";
import NewThreadForm from "./NewThreadForm";

const ChatIcon = () => (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5M21 12a8 8 0 01-11.6 7.1L4 20l1-4.4A8 8 0 1121 12z" />
  </svg>
);

// Per-item queries inside an item card: "Ask a query" + this item's threads
// (open ones shown, resolved behind a toggle). Renders nothing outside an
// EnquiryThreadsProvider, so item cards stay usable anywhere.
export default function ItemQueries({ itemIndex, itemName = "", canAsk = true }: {
  itemIndex: number;
  itemName?: string;
  /** false hides the "Ask a query" button (existing threads still show).
   *  Sales passes "rate given, not rate-available" (founder ask 2026-11-21). */
  canAsk?: boolean;
}) {
  const ctx = useItemThreadsCtx();
  const [asking, setAsking] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  if (!ctx) return null;
  const { desk, enquiryId, threads, act } = ctx;
  const mine = threads.filter((t) => t.itemIndex === itemIndex);
  if (!canAsk && mine.length === 0) return null;
  const open = mine.filter((t) => t.status === "open");
  const resolved = mine.filter((t) => t.status === "resolved");
  const targets = startTargets(desk);
  const askLabel = targets.length === 1 ? `Ask ${DESK_LABEL[targets[0]]} a query` : "Ask a query";

  const card = (t: (typeof mine)[number]) => (
    <ThreadCard key={t.id} thread={t} desk={desk} showItem={false}
      defaultOpen={t.status === "open" && t.waitingOn === desk}
      onReply={(x, a) => act.reply(t.id, x, a)} onResolve={() => act.resolve(t.id)} onReopen={() => act.reopen(t.id)}
      onForward={desk === "management" ? (x, a) => act.forward(t.id, x, a) : undefined} />
  );

  return (
    <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-2">
        {canAsk && !asking && <Button size="sm" variant="secondary" icon={<ChatIcon />} onClick={() => setAsking(true)}>{askLabel}</Button>}
        {open.length > 0 && <span className="text-caption font-semibold text-[var(--color-brand-indigo)]">{open.length} open quer{open.length === 1 ? "y" : "ies"}</span>}
        {resolved.length > 0 && (
          <button type="button" onClick={() => setShowResolved(!showResolved)}
            className="cursor-pointer border-0 bg-transparent p-0 text-caption font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {showResolved ? "Hide" : "Show"} {resolved.length} resolved
          </button>
        )}
      </div>
      {canAsk && asking && (
        <NewThreadForm desk={desk} onCancel={() => setAsking(false)}
          onStart={(to, text, attachments) => act.start({ to, enquiryId, itemIndex, itemName, text, attachments })} />
      )}
      {open.map(card)}
      {showResolved && resolved.map(card)}
    </div>
  );
}
