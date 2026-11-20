"use client";
import React, { useState } from "react";
import { EmptyState, TabBar, Skeleton } from "@/components/ui";
import type { DeskInbox } from "@/enquiry-threads/useThreads";
import type { ThreadDesk } from "@/enquiry-threads/types";
import ThreadCard from "./ThreadCard";

const OPEN_HINT: Record<ThreadDesk, string> = {
  sales: "Your questions to Management that are still open. Resolved ones move to Resolved automatically.",
  procurement: "Private threads with Management that are still open. Sales never sees these.",
  management: "Threads from Sales and Procurement — the ones waiting on your reply are on top.",
};

// One desk's conversations across all enquiries: Open | Resolved. The caller
// owns the data (useDeskInbox) so a tab label can show the same counts.
export default function ThreadInbox({ desk, inbox, onOpenEnquiry }: {
  desk: ThreadDesk;
  inbox: DeskInbox;
  onOpenEnquiry?: (enquiryId: string) => void;
}) {
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const list = tab === "open" ? inbox.open : inbox.resolved;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabBar
          variant="segmented"
          size="sm"
          ariaLabel="Conversation status"
          items={[
            { key: "open", label: "Open", count: inbox.open.length, tone: inbox.waitingOnYou > 0 ? "danger" : undefined },
            { key: "resolved", label: "Resolved", count: inbox.resolved.length },
          ]}
          active={tab}
          onChange={setTab}
        />
        <p className="text-caption text-[var(--text-secondary)]">
          {tab === "open" ? OPEN_HINT[desk] : "Resolved conversations (most recent first). Reply to reopen one."}
          {tab === "open" && inbox.waitingOnYou > 0 && <b className="ml-1 text-[var(--text-primary)]">{inbox.waitingOnYou} waiting on you.</b>}
        </p>
      </div>

      {inbox.error ? <p className="text-caption font-semibold text-[var(--color-danger)]">Couldn&apos;t load conversations — {String((inbox.error as any)?.message ?? inbox.error)}</p> : null}
      {inbox.loading ? (
        <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
      ) : list.length === 0 ? (
        <EmptyState
          title={tab === "open" ? "No open conversations" : "Nothing resolved yet"}
          description={tab === "open" ? "Start one from an enquiry's item (Conversations section)." : "Resolved conversations will appear here."}
        />
      ) : (
        <div className="space-y-2">
          {list.map((t) => (
            <ThreadCard key={t.id} thread={t} desk={desk} defaultOpen={tab === "open" && t.waitingOn === desk}
              onReply={(x) => inbox.act.reply(t.id, x)} onResolve={() => inbox.act.resolve(t.id)} onReopen={() => inbox.act.reopen(t.id)}
              onForward={desk === "management" ? (x) => inbox.act.forward(t.id, x) : undefined}
              onOpenEnquiry={onOpenEnquiry ? () => onOpenEnquiry(t.enquiryId) : undefined} />
          ))}
        </div>
      )}
    </section>
  );
}
