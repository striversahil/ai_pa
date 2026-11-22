// enquiry-threads/useThreads.ts — data hooks (components never fetch).
// Live: every thread write broadcasts `enquiry-threads` (ids only), which
// refetches the open views; actions also refresh immediately.
// Writes are optimistic (sales-enquiry standard): the echo paints instantly
// into the visible lists, the server confirms in the background, and refresh
// reconciles (failure resyncs, so the UI never sits on a lie).
import { useCallback } from "react";
import { useLiveQuery } from "@/hooks/useLiveData";
import { actOnThread, fetchEnquiryThreads, fetchThreadInbox, startThread } from "./api";
import { counterpart, type EnquiryThread, type ThreadAttachment, type ThreadCategory, type ThreadDesk, type ThreadStatus } from "./types";

const EVENTS = ["enquiry-threads"];

export function useEnquiryThreads(desk: ThreadDesk, enquiryId: string) {
  const q = useLiveQuery<EnquiryThread[]>(() => fetchEnquiryThreads(desk, enquiryId), { events: EVENTS, deps: [desk, enquiryId] });
  const patch = useCallback((fn: (ts: EnquiryThread[]) => EnquiryThread[]) => {
    q.setData((prev) => fn(prev ?? []));
  }, [q.setData]);
  return { threads: q.data ?? [], loading: q.loading, error: q.error, refresh: q.refresh, patch };
}

export function useThreadInbox(desk: ThreadDesk, status: ThreadStatus) {
  const q = useLiveQuery<EnquiryThread[]>(() => fetchThreadInbox(desk, status), { events: EVENTS, deps: [desk, status] });
  const patch = useCallback((fn: (ts: EnquiryThread[]) => EnquiryThread[]) => {
    q.setData((prev) => fn(prev ?? []));
  }, [q.setData]);
  return { threads: q.data ?? [], loading: q.loading, error: q.error, refresh: q.refresh, patch };
}

/** Both inbox tabs for a desk + its write verbs (one owner, pass it down). */
export function useDeskInbox(desk: ThreadDesk) {
  const open = useThreadInbox(desk, "open");
  const resolved = useThreadInbox(desk, "resolved");
  const refresh = useCallback(() => { open.refresh(); resolved.refresh(); }, [open, resolved]);
  // One optimistic patch across both tabs (id-keyed, so it is a no-op in the
  // list that doesn't hold the thread).
  const patch = useCallback((fn: (ts: EnquiryThread[]) => EnquiryThread[]) => {
    open.patch(fn); resolved.patch(fn);
  }, [open.patch, resolved.patch]);
  // Open: threads waiting on THIS desk first, then the rest (newest activity first).
  const openSorted = [...open.threads].sort((a, b) =>
    Number(b.waitingOn === desk) - Number(a.waitingOn === desk) || b.updatedAt.localeCompare(a.updatedAt));
  return {
    open: openSorted, resolved: resolved.threads,
    waitingOnYou: open.threads.filter((t) => t.waitingOn === desk).length,
    loading: open.loading || resolved.loading, error: open.error || resolved.error,
    act: useThreadActions(desk, refresh, patch),
  };
}
export type DeskInbox = ReturnType<typeof useDeskInbox>;

const tmpId = (p: string) => `${p}-tmp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Write verbs for one desk. Optimistic: the echo paints instantly into every
 *  list rendering these threads (`patch`), the request runs in the
 *  background, then `refresh` reconciles with server truth (temp echoes are
 *  stripped first so they never double-list). Failure resyncs via refresh and
 *  rethrows, so the composer keeps its existing error display. */
export function useThreadActions(
  desk: ThreadDesk,
  refresh: () => void,
  patch: (fn: (ts: EnquiryThread[]) => EnquiryThread[]) => void = () => {},
) {
  const send = useCallback(async (
    optimistic: (ts: EnquiryThread[]) => EnquiryThread[],
    request: () => Promise<unknown>,
    strip?: (ts: EnquiryThread[]) => EnquiryThread[],
  ) => {
    patch(optimistic);
    try {
      const v = await request();
      if (strip) patch(strip);
      refresh();
      return v;
    } catch (e) {
      refresh();
      throw e;
    }
  }, [patch, refresh]);

  const echoThread = (
    to: ThreadDesk, enquiryId: string, itemIndex: number, itemName: string, text: string,
    attachments?: ThreadAttachment[], category?: ThreadCategory,
  ): EnquiryThread => {
    const now = new Date().toISOString();
    const channel = (desk === "procurement" || to === "procurement") ? "internal" : "sales";
    return {
      id: tmpId("th"), enquiryId, itemIndex, itemName, channel,
      category: channel === "sales" ? (category ?? "product_query") : null,
      status: "open", openedBy: desk, waitingOn: to, parentThreadId: null,
      waitingOnAll: [to],
      messages: [{ id: tmpId("tm"), by: desk, authorName: "", text, at: now, ...(attachments?.length ? { attachments } : {}) }],
      createdAt: now, updatedAt: now, resolvedAt: null, resolvedBy: null,
    };
  };

  return {
    start: (b: { to: ThreadDesk; enquiryId: string; itemIndex: number; itemName: string; text: string; attachments?: ThreadAttachment[]; category?: ThreadCategory }) => {
      const echo = echoThread(b.to, b.enquiryId, b.itemIndex, b.itemName, b.text, b.attachments, b.category);
      return send(
        (ts) => [...ts, echo],
        () => startThread({ desk, ...b }),
        (ts) => ts.filter((t) => t.id !== echo.id),
      );
    },
    reply: (id: string, text: string, attachments?: ThreadAttachment[]) => {
      const mid = tmpId("tm");
      const now = new Date().toISOString();
      const files = attachments?.length ? { attachments } : {};
      return send(
        (ts) => ts.map((t) => t.id === id
          ? { ...t, status: "open" as const, resolvedAt: null, resolvedBy: null, waitingOn: counterpart(t, desk), waitingOnAll: [counterpart(t, desk)], messages: [...t.messages, { id: mid, by: desk, authorName: "", text, at: now, ...files }], updatedAt: now }
          : t),
        () => actOnThread(id, "reply", desk, text, attachments),
        (ts) => ts.map((t) => t.id === id ? { ...t, messages: t.messages.filter((m) => m.id !== mid) } : t),
      );
    },
    resolve: (id: string) => {
      const now = new Date().toISOString();
      return send(
        (ts) => ts.map((t) => t.id === id ? { ...t, status: "resolved" as const, resolvedAt: now, resolvedBy: desk, updatedAt: now } : t),
        () => actOnThread(id, "resolve", desk),
      );
    },
    reopen: (id: string) => {
      const now = new Date().toISOString();
      return send(
        (ts) => ts.map((t) => t.id === id
          ? { ...t, status: "open" as const, resolvedAt: null, resolvedBy: null, waitingOn: counterpart(t, desk), updatedAt: now }
          : t),
        () => actOnThread(id, "reopen", desk),
      );
    },
  };
}
