// enquiry-threads/types.ts — per-item conversations between the three
// enquiry desks. mirror: founder-os_frontend/src/enquiry-threads/types.ts
// (guard scripts/guards/enquiry-threads.test.mjs).

export type ThreadDesk = 'sales' | 'procurement' | 'management';
/** 'sales' = sales <-> management. 'internal' = management <-> procurement,
 *  never served to the sales desk (founder rule 2026-11-20). */
export type ThreadChannel = 'sales' | 'internal';
export type ThreadStatus = 'open' | 'resolved';

export const THREAD_DESKS: readonly ThreadDesk[] = ['sales', 'procurement', 'management'];
export const MAX_THREAD_TEXT = 2000;
export const MAX_THREAD_MESSAGES = 200;

export interface ThreadMessage {
  id: string;
  by: ThreadDesk;
  authorName: string;
  text: string;
  at: string;
  /** System line (resolve / reopen / forwarded) — rendered muted. */
  system?: boolean;
}

export interface EnquiryThread {
  id: string;
  enquiryId: string;
  itemIndex: number;
  itemName: string;
  channel: ThreadChannel;
  status: ThreadStatus;
  openedBy: ThreadDesk;
  waitingOn: ThreadDesk;
  /** Internal thread forwarded from a sales thread (management/procurement only). */
  parentThreadId: string | null;
  messages: ThreadMessage[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: ThreadDesk | null;
  /** Inbox reads only: "Enquiry No 3 - 19 NOV TL" (joined from Enquiry). */
  enquiryLabel?: string;
}

export interface ThreadActor {
  desk: ThreadDesk;
  name: string;
}

export type ThreadResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
