// enquiry-threads/types.ts — per-item conversations between the three
// enquiry desks. mirror: founder-os_frontend/src/enquiry-threads/types.ts
// (guard scripts/guards/enquiry-threads.test.mjs).

export type ThreadDesk = 'sales' | 'procurement' | 'management';
/** 'sales' = sales <-> management. 'internal' = management <-> procurement,
 *  never served to the sales desk (founder rule 2026-11-20). */
export type ThreadChannel = 'sales' | 'internal';
export type ThreadStatus = 'open' | 'resolved';

/** What the query is about (founder decision 2026-11-21). A product query is
 *  answered by management AND procurement in the same thread; a rate
 *  negotiation stays management-only. NULL = legacy row (pre-category). */
export type ThreadCategory = 'product_query' | 'rate_negotiation';
export const THREAD_CATEGORIES: readonly ThreadCategory[] = ['product_query', 'rate_negotiation'];

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
  /** Scrubbed filename for the sales projection (vendor names removed).
   *  Never served as its own field — the projection swaps it into `name`. */
  salesName?: string;
}

export interface ThreadMessage {
  id: string;
  by: ThreadDesk;
  authorName: string;
  text: string;
  at: string;
  /** System line (resolve / reopen) — rendered muted. */
  system?: boolean;
  attachments?: ThreadAttachment[];
  /** Sales-facing rewrite of `text` (vendor names → "our supplier"). Written
   *  by the service; management/procurement keep the original. */
  salesText?: string;
  /** Served only to management/procurement: this message is shown to Sales
   *  as Management (procurement-authored, sales-channel). Never sent to sales. */
  masked?: boolean;
}

export interface EnquiryThread {
  id: string;
  enquiryId: string;
  itemIndex: number;
  itemName: string;
  channel: ThreadChannel;
  /** What the query is about; null on internal threads and legacy rows. */
  category: ThreadCategory | null;
  status: ThreadStatus;
  openedBy: ThreadDesk;
  waitingOn: ThreadDesk;
  /** Served (computed per desk): every desk that owes the next move. Sales
   *  never sees 'procurement' here. */
  waitingOnAll?: ThreadDesk[];
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
