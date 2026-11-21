// enquiry-threads/types.ts — mirror: founder-os_backend/src/modules/enquiry-threads/types.ts
// (guard scripts/guards/enquiry-threads.test.mjs). The server decides
// visibility per desk; the UI only renders what it is served.

export type ThreadDesk = 'sales' | 'procurement' | 'management';
/** 'sales' = sales <-> management. 'internal' = management <-> procurement
 *  (never served to the sales desk). */
export type ThreadChannel = 'sales' | 'internal';
export type ThreadStatus = 'open' | 'resolved';

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
  /** Copied verbatim from a Sales query when management transferred it to
   *  Procurement (mirror: backend enquiry-threads/types.ts). */
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
  parentThreadId: string | null;
  messages: ThreadMessage[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: ThreadDesk | null;
  enquiryLabel?: string;
}

export const DESK_LABEL: Record<ThreadDesk, string> = { sales: 'Sales', procurement: 'Procurement', management: 'Management' };

/** Desks this desk may start a thread with (mirror of backend channelBetween). */
export function startTargets(desk: ThreadDesk): ThreadDesk[] {
  if (desk === 'management') return ['sales', 'procurement'];
  return ['management'];
}

/** The other side of a thread from `desk`'s point of view. */
export function counterpart(t: Pick<EnquiryThread, 'channel'>, desk: ThreadDesk): ThreadDesk {
  if (t.channel === 'internal') return desk === 'procurement' ? 'management' : 'procurement';
  return desk === 'sales' ? 'management' : 'sales';
}
