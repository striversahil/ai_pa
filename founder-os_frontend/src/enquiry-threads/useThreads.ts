// enquiry-threads/useThreads.ts — data hooks (components never fetch).
// Live: every thread write broadcasts `enquiry-threads` (ids only), which
// refetches the open views; actions also refresh immediately.
import { useCallback } from "react";
import { useLiveQuery } from "@/hooks/useLiveData";
import { actOnThread, fetchEnquiryThreads, fetchThreadInbox, forwardThread, startThread } from "./api";
import type { EnquiryThread, ThreadAttachment, ThreadDesk, ThreadStatus } from "./types";

const EVENTS = ["enquiry-threads"];

export function useEnquiryThreads(desk: ThreadDesk, enquiryId: string) {
  const q = useLiveQuery<EnquiryThread[]>(() => fetchEnquiryThreads(desk, enquiryId), { events: EVENTS, deps: [desk, enquiryId] });
  return { threads: q.data ?? [], loading: q.loading, error: q.error, refresh: q.refresh };
}

export function useThreadInbox(desk: ThreadDesk, status: ThreadStatus) {
  const q = useLiveQuery<EnquiryThread[]>(() => fetchThreadInbox(desk, status), { events: EVENTS, deps: [desk, status] });
  return { threads: q.data ?? [], loading: q.loading, error: q.error, refresh: q.refresh };
}

/** Both inbox tabs for a desk + its write verbs (one owner, pass it down). */
export function useDeskInbox(desk: ThreadDesk) {
  const open = useThreadInbox(desk, "open");
  const resolved = useThreadInbox(desk, "resolved");
  const refresh = useCallback(() => { open.refresh(); resolved.refresh(); }, [open, resolved]);
  // Open: threads waiting on THIS desk first, then the rest (newest activity first).
  const openSorted = [...open.threads].sort((a, b) =>
    Number(b.waitingOn === desk) - Number(a.waitingOn === desk) || b.updatedAt.localeCompare(a.updatedAt));
  return {
    open: openSorted, resolved: resolved.threads,
    waitingOnYou: open.threads.filter((t) => t.waitingOn === desk).length,
    loading: open.loading || resolved.loading, error: open.error || resolved.error,
    act: useThreadActions(desk, refresh),
  };
}
export type DeskInbox = ReturnType<typeof useDeskInbox>;

/** Write verbs for one desk. Each resolves after the server confirms, then refreshes. */
export function useThreadActions(desk: ThreadDesk, refresh: () => void) {
  const done = useCallback(<T,>(p: Promise<T>) => p.then((v) => { refresh(); return v; }), [refresh]);
  return {
    start: (b: { to: ThreadDesk; enquiryId: string; itemIndex: number; itemName: string; text: string; attachments?: ThreadAttachment[] }) => done(startThread({ desk, ...b })),
    reply: (id: string, text: string, attachments?: ThreadAttachment[]) => done(actOnThread(id, "reply", desk, text, attachments)),
    resolve: (id: string) => done(actOnThread(id, "resolve", desk)),
    reopen: (id: string) => done(actOnThread(id, "reopen", desk)),
    forward: (id: string, text: string, attachments?: ThreadAttachment[]) => done(forwardThread(id, text, attachments)),
  };
}
