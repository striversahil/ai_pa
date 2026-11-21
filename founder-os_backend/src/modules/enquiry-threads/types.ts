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
export const MAX_THREAD_ATTACHMENTS = 6;

/** A file on a message — ALWAYS a short enquiry-locker URL
 *  (`/api/enquiries/files/enq/<uuid>.<ext>`), never an inline data-URI. */
export interface ThreadAttachment {
  url: string;
  name: string;
  type: 'image' | 'video' | 'pdf';
}

export interface ThreadMessage {
  id: string;
  by: ThreadDesk;
  authorName: string;
  text: string;
  at: string;
  /** System line (resolve / reopen / forwarded) — rendered muted. */
  system?: boolean;
  attachments?: ThreadAttachment[];
  /** Copied verbatim from a Sales query when management transferred it to
   *  Procurement (keeps the source id so a re-forward copies only the delta). */
  transferred?: boolean;
  sourceThreadId?: string;
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
