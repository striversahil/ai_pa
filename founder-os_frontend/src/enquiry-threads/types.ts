// enquiry-threads/types.ts — mirror: founder-os_backend/src/modules/enquiry-threads/types.ts
// (guard scripts/guards/enquiry-threads.test.mjs). The server decides
// visibility per desk; the UI only renders what it is served.

export type ThreadDesk = 'sales' | 'procurement' | 'management';
/** 'sales' = sales <-> management. 'internal' = management <-> procurement
 *  (never served to the sales desk). */
export type ThreadChannel = 'sales' | 'internal';
export type ThreadStatus = 'open' | 'resolved';

/** What the query is about (founder decision 2026-11-21). Product queries are
 *  shared with Procurement (which answers as Management); rate negotiations
 *  stay Management-only. null = legacy thread created before categories. */
export type ThreadCategory = 'product_query' | 'rate_negotiation';
export const THREAD_CATEGORIES: readonly ThreadCategory[] = ['product_query', 'rate_negotiation'];

/** Enquiry-locker URL only (uploaded first via lib/imageFiles uploadMediaFile). */
export interface ThreadAttachment {
  url: string;
  name: string;
  type: 'image' | 'video' | 'pdf';
}
export const MAX_THREAD_ATTACHMENTS = 6;

export interface ThreadMessage {
  id: string;
  by: ThreadDesk;
  authorName: string;
  text: string;
  at: string;
  system?: boolean;
  attachments?: ThreadAttachment[];
  /** Management/procurement only: this reply is shown to Sales as Management.
   *  Never served to the sales desk. */
  masked?: boolean;
}

export interface EnquiryThread {
  id: string;
  enquiryId: string;
  itemIndex: number;
  itemName: string;
  channel: ThreadChannel;
  category: ThreadCategory | null;
  status: ThreadStatus;
  openedBy: ThreadDesk;
  waitingOn: ThreadDesk;
  /** Every desk that owes the next move (product queries wait on management
   *  and procurement). Server-masked: sales never sees 'procurement' here. */
  waitingOnAll?: ThreadDesk[];
  parentThreadId: string | null;
  messages: ThreadMessage[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: ThreadDesk | null;
  enquiryLabel?: string;
}

export const DESK_LABEL: Record<ThreadDesk, string> = { sales: 'Sales', procurement: 'Procurement', management: 'Management' };

export const CATEGORY_LABEL: Record<ThreadCategory, string> = {
  product_query: 'Product query',
  rate_negotiation: 'Rate negotiation',
};

/** Desks this desk may start a thread with (mirror of backend channelBetween). */
export function startTargets(desk: ThreadDesk): ThreadDesk[] {
  if (desk === 'management') return ['sales', 'procurement'];
  return ['management'];
}

/** A category is chosen only when the thread is sales-facing (the internal
 *  management↔procurement thread has none). */
export function needsCategory(desk: ThreadDesk, to: ThreadDesk): boolean {
  return !(desk === 'management' && to === 'procurement') && !(desk === 'procurement');
}

/** The other side of a thread from `desk`'s point of view. Procurement is
 *  never named to Sales — its reply reads as Management. */
export function counterpart(t: Pick<EnquiryThread, 'channel'>, desk: ThreadDesk): ThreadDesk {
  if (t.channel === 'internal') return desk === 'procurement' ? 'management' : 'procurement';
  return desk === 'sales' ? 'management' : 'sales';
}

/** Does this thread owe `desk` a reply? (Falls back to `waitingOn` for rows
 *  served before waitingOnAll existed.) */
export function isMyTurn(t: Pick<EnquiryThread, 'status' | 'waitingOn' | 'waitingOnAll'>, desk: ThreadDesk): boolean {
  if (t.status === 'resolved') return false;
  return (t.waitingOnAll ?? [t.waitingOn]).includes(desk);
}
