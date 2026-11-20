"use client";
import React, { useState } from "react";
import { Card, Badge, Button } from "@/components/ui";
import { useEnquiryThreads, useThreadActions } from "@/enquiry-threads/useThreads";
import type { ThreadDesk } from "@/enquiry-threads/types";
import ThreadCard from "./ThreadCard";
import NewThreadForm from "./NewThreadForm";

// Conversations for ONE enquiry, grouped per line item. Same component on the
// Sales, Procurement and Management surfaces — `desk` decides what the server
// serves (Sales never receives Management ↔ Procurement threads).
export default function ItemThreads({ desk, enquiryId, items }: {
  desk: ThreadDesk;
  enquiryId: string;
  items: Array<{ name?: string }>;
}) {
  const { threads, loading, error, refresh } = useEnquiryThreads(desk, enquiryId);
  const act = useThreadActions(desk, refresh);
  const [startOn, setStartOn] = useState<number | null>(null);
  const open = threads.filter((t) => t.status === "open").length;

  return (
    <Card padded={false} className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-card)] px-5 py-4">
        <div>
          <h3 className="font-heading text-card-title text-[var(--text-primary)]">Conversations</h3>
          <p className="text-caption text-[var(--text-secondary)]">
            {desk === "sales" ? "Ask Management about any item — rate negotiation or the client's spec message." : desk === "procurement" ? "Talk to Management about any item. Never visible to Sales." : "Sales threads and private Procurement threads, per item."}
          </p>
        </div>
        <span className="flex gap-1.5">
          <Badge tone={open ? "brand" : "neutral"}>{open} open</Badge>
          <Badge>{threads.length - open} resolved</Badge>
        </span>
      </header>

      {error ? <p className="px-5 py-4 text-caption font-semibold text-[var(--color-danger)]">Couldn&apos;t load conversations — {String((error as any)?.message ?? error)}</p> : null}
      {loading && <p className="px-5 py-4 text-caption text-[var(--text-tertiary)]">Loading conversations…</p>}

      {!loading && (
        <ol className="divide-y divide-[var(--border-card)]">
          {items.map((it, idx) => {
            const mine = threads.filter((t) => t.itemIndex === idx);
            return (
              <li key={idx} className="space-y-2 px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-label font-semibold text-[var(--text-primary)]">
                    Item {idx + 1}{it?.name ? ` — ${it.name}` : ""}
                    {mine.length > 0 && <span className="ml-2 font-normal text-[var(--text-tertiary)]">{mine.length} thread{mine.length === 1 ? "" : "s"}</span>}
                  </p>
                  {startOn !== idx && <Button size="sm" variant="ghost" onClick={() => setStartOn(idx)}>+ Start conversation</Button>}
                </div>
                {startOn === idx && (
                  <NewThreadForm desk={desk} onCancel={() => setStartOn(null)}
                    onStart={(to, text) => act.start({ to, enquiryId, itemIndex: idx, itemName: it?.name ?? "", text })} />
                )}
                {mine.map((t) => (
                  <ThreadCard key={t.id} thread={t} desk={desk} defaultOpen={t.status === "open"} showItem={false}
                    onReply={(x) => act.reply(t.id, x)} onResolve={() => act.resolve(t.id)} onReopen={() => act.reopen(t.id)}
                    onForward={desk === "management" ? (x) => act.forward(t.id, x) : undefined} />
                ))}
              </li>
            );
          })}
          {items.length === 0 && <li className="px-5 py-4 text-caption text-[var(--text-tertiary)]">Add items to this enquiry to start a conversation about them.</li>}
        </ol>
      )}
    </Card>
  );
}
