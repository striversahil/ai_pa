// enquiry-threads/pure.ts — access + state rules (sync, no IO).
//
// Visibility is decided server-side for the requesting desk. The ROW is one
// conversation; `category` decides who else participates (founder decision
// 2026-11-21):
//
//   channel 'sales'    + category 'product_query'    → sales, management AND
//                        procurement (procurement speaks as "Management" to
//                        sales — its name/desk is never shown)
//   channel 'sales'    + category 'rate_negotiation' → sales + management only
//   channel 'sales'    + category NULL (legacy rows) → sales + management only
//   channel 'internal' (management <-> procurement)  → never served to sales
//
// Founder rule 2026-11-20 (amended 2026-11-21): the internal channel is never
// visible to sales; procurement may participate ONLY in a product query, and
// there it is presented to sales as Management. Rate negotiations stay
// Management↔Sales. Guard: scripts/guards/enquiry-threads.test.mjs.
import type { MeResponse } from '../auth/types';
import { canManageRates } from '../enquiries/scopes';
import { isSafeEnquiryFileKey } from '../../shared/enquiry-files';
import {
  THREAD_CATEGORIES,
  MAX_THREAD_ATTACHMENTS, MAX_THREAD_MESSAGES, MAX_THREAD_TEXT, THREAD_DESKS,
  type EnquiryThread, type ThreadActor, type ThreadAttachment, type ThreadCategory, type ThreadChannel, type ThreadDesk, type ThreadMessage, type ThreadResult,
} from './types';

export const DESK_LABEL: Record<ThreadDesk, string> = { sales: 'Sales', procurement: 'Procurement', management: 'Management' };

const SALES_SCOPES = ['enquiry-tracker', 'telecalling', 'sales', 'sales-head'];

export function isDesk(v: unknown): v is ThreadDesk {
  return (THREAD_DESKS as readonly string[]).includes(String(v ?? ''));
}

/** May this login act as `desk`? Management = Management Review access;
 *  procurement = `procurement` scope; sales = the sales enquiry scopes.
 *  Management-access holders may cover any desk. */
export function deskAllowed(me: MeResponse | null, desk: ThreadDesk): boolean {
  if (!me) return false;
  if (canManageRates(me)) return true;
  const scopes = ((me as any).scopes ?? []).map((s: unknown) => String(s).toLowerCase());
  if (desk === 'procurement') return scopes.includes('procurement');
  if (desk === 'sales') return SALES_SCOPES.some((s) => scopes.includes(s));
  return false;
}

/** Thread category chosen by Sales when the query is raised (2026-11-21).
 *  Only sales-channel threads carry one; internal threads are admin-only
 *  conversations and keep `null`. */
export function normalizeCategory(v: unknown): ThreadCategory {
  return v === 'rate_negotiation' ? 'rate_negotiation' : 'product_query';
}

export function isCategory(v: unknown): v is ThreadCategory {
  return (THREAD_CATEGORIES as readonly string[]).includes(String(v ?? ''));
}

/** The channel joining two desks, or null (sales <-> procurement never talk directly). */
export function channelBetween(a: ThreadDesk, b: ThreadDesk): ThreadChannel | null {
  const pair = [a, b].sort().join('|');
  if (pair === 'management|sales') return 'sales';
  if (pair === 'management|procurement') return 'internal';
  return null;
}

export function partiesOf(channel: ThreadChannel): [ThreadDesk, ThreadDesk] {
  return channel === 'sales' ? ['sales', 'management'] : ['procurement', 'management'];
}

export function otherParty(channel: ThreadChannel, desk: ThreadDesk): ThreadDesk {
  const [a, b] = partiesOf(channel);
  return desk === a ? b : a;
}

/** Row-level visibility. `category` only widens the sales channel to
 *  procurement for product queries — it never narrows it (sales/management
 *  always see their own conversation). Mirror in SQL: `store.ts#visibility`. */
export function canSee(thread: Pick<EnquiryThread, 'channel' | 'category' | 'openedBy'>, desk: ThreadDesk): boolean {
  if (thread.channel === 'internal') return desk !== 'sales';
  // Procurement joins ONLY a product query raised by Sales. A question
  // Management asks Sales is private to those two desks (founder rule
  // 2026-11-23) — it must never surface in the procurement inbox, even if a
  // stray row still carries the category.
  if (desk === 'procurement') return thread.category === 'product_query' && thread.openedBy === 'sales';
  return true;
}

/** Desks the thread is waiting on, per viewer. Product queries wait on
 *  management AND procurement (either may answer); every other case waits on
 *  the single next party. Sales is never told procurement is involved. */
export function waitingOnAllFor(thread: EnquiryThread, desk: ThreadDesk): ThreadDesk[] {
  if (thread.status === 'resolved') return [];
  const all: ThreadDesk[] = thread.channel === 'sales' && thread.category === 'product_query'
    ? (thread.waitingOn === 'sales' ? ['sales'] : ['management', 'procurement'])
    : [thread.waitingOn];
  return desk === 'sales' ? all.filter((d) => d !== 'procurement') : all;
}

/** The thread shaped for one desk, or null when that desk may not see it.
 *  Sales gets a MANAGED projection: procurement-authored messages arrive as
 *  Management (name, desk and vendor names removed). Management and
 *  procurement get true authorship, flagged `masked` so the UI can say what
 *  sales will see. */
export function serveForDesk(thread: EnquiryThread, desk: ThreadDesk): EnquiryThread | null {
  if (!canSee(thread, desk)) return null;
  const base: EnquiryThread = {
    ...thread,
    parentThreadId: desk === 'management' ? thread.parentThreadId : null,
    waitingOnAll: waitingOnAllFor(thread, desk),
  };
  if (desk !== 'sales') {
    return {
      ...base,
      messages: thread.messages.map((m) =>
        m.by === 'procurement' && thread.channel === 'sales' ? { ...m, masked: true } : m),
    };
  }
  // Sales: procurement does not exist on this conversation.
  return {
    ...base,
    messages: thread.messages.map((m) => {
      if (m.by !== 'procurement') return m;
      return {
        id: m.id, at: m.at, by: 'management' as ThreadDesk, authorName: 'Management',
        text: m.salesText ?? m.text,
        ...(m.system ? { system: true } : {}),
        ...(m.attachments?.length
          ? { attachments: m.attachments.map((a) => ({ ...a, name: a.salesName ?? a.name })) }
          : {}),
      };
    }),
  };
}

export function cleanThreadText(v: unknown): string {
  return String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_THREAD_TEXT);
}

const LOCKER_PREFIX = '/api/enquiries/files/';
const ATTACH_TYPES: ThreadAttachment['type'][] = ['image', 'video', 'pdf'];

/** Keep only enquiry-locker URLs (uploaded first via POST /api/enquiries/files);
 *  data-URIs and outside links are dropped so rows stay small and no
 *  arbitrary URL is ever rendered to another desk. */
export function cleanAttachments(raw: unknown): ThreadAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ThreadAttachment[] = [];
  for (const a of raw) {
    const url = String((a as any)?.url ?? '');
    if (!url.startsWith(LOCKER_PREFIX) || !isSafeEnquiryFileKey(url.slice(LOCKER_PREFIX.length))) continue;
    const t = String((a as any)?.type ?? '');
    const type = (ATTACH_TYPES as string[]).includes(t) ? t as ThreadAttachment['type'] : 'image';
    out.push({ url, name: String((a as any)?.name ?? 'file').slice(0, 200), type });
    if (out.length >= MAX_THREAD_ATTACHMENTS) break;
  }
  return out;
}

const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function message(actor: ThreadActor, text: string, at: string, system = false, attachments: ThreadAttachment[] = []): ThreadMessage {
  return {
    id: newId('tm'), by: actor.desk, authorName: actor.name.slice(0, 120), text, at,
    ...(system ? { system: true } : {}), ...(attachments.length ? { attachments } : {}),
  };
}

/** Text OR at least one attachment is required. */
function body(rawText: unknown, rawFiles: unknown): { text: string; files: ThreadAttachment[] } | null {
  const text = cleanThreadText(rawText);
  const files = cleanAttachments(rawFiles);
  return text || files.length ? { text, files } : null;
}

export function createThread(input: {
  enquiryId: string; itemIndex: number; itemName: string; actor: ThreadActor; to: ThreadDesk;
  text: string; now: string; parentThreadId?: string | null; attachments?: unknown; category?: unknown;
}): ThreadResult<EnquiryThread> {
  const channel = channelBetween(input.actor.desk, input.to);
  if (!channel) return { ok: false, status: 400, error: `${DESK_LABEL[input.actor.desk]} cannot start a thread with ${DESK_LABEL[input.to]}` };
  const b = body(input.text, input.attachments);
  if (!b) return { ok: false, status: 400, error: 'message text or an attachment required' };
  // Category exists only on SALES-raised threads: it decides whether
  // Procurement participates. Internal threads AND questions Management asks
  // Sales stay private to their two desks (null) — a management→sales query
  // is NOT a procurement product query (founder rule 2026-11-23).
  const category: ThreadCategory | null = channel === 'sales' && input.actor.desk === 'sales'
    ? normalizeCategory(input.category)
    : null;
  return {
    ok: true,
    value: {
      id: newId('th'), enquiryId: input.enquiryId,
      itemIndex: Math.max(0, Math.floor(input.itemIndex)), itemName: String(input.itemName ?? '').slice(0, 200),
      channel, category, status: 'open', openedBy: input.actor.desk, waitingOn: input.to,
      parentThreadId: input.parentThreadId ?? null,
      messages: [message(input.actor, b.text, input.now, false, b.files)],
      createdAt: input.now, updatedAt: input.now, resolvedAt: null, resolvedBy: null,
    },
  };
}

/** Who owes the next move. Sales channel: the turn always returns to the
 *  asker (a procurement reply reads as Management, so sales owes the reply). */
function nextWaitingOn(thread: EnquiryThread, actor: ThreadActor): ThreadDesk {
  if (thread.channel === 'internal') return otherParty(thread.channel, actor.desk);
  return actor.desk === 'sales' ? 'management' : 'sales';
}

function push(thread: EnquiryThread, m: ThreadMessage): ThreadMessage[] {
  return [...thread.messages, m].slice(-MAX_THREAD_MESSAGES);
}

/** Reply: reopens a resolved thread; the other side now owes the answer.
 *  Who may reply is exactly who may SEE the thread (a product query is
 *  answerable by sales, management and procurement; a rate negotiation never
 *  reaches procurement). */
export function replyThread(thread: EnquiryThread, actor: ThreadActor, rawText: string, now: string, attachments?: unknown): ThreadResult<EnquiryThread> {
  if (!canSee(thread, actor.desk)) return { ok: false, status: 403, error: 'not a party to this thread' };
  const b = body(rawText, attachments);
  if (!b) return { ok: false, status: 400, error: 'message text or an attachment required' };
  return {
    ok: true,
    value: {
      ...thread, status: 'open', resolvedAt: null, resolvedBy: null,
      waitingOn: nextWaitingOn(thread, actor),
      messages: push(thread, message(actor, b.text, now, false, b.files)), updatedAt: now,
    },
  };
}

/** Either side of the thread may resolve (founder choice 2026-11-20). */
export function resolveThread(thread: EnquiryThread, actor: ThreadActor, now: string): ThreadResult<EnquiryThread> {
  if (!canSee(thread, actor.desk)) return { ok: false, status: 403, error: 'not a party to this thread' };
  if (thread.status === 'resolved') return { ok: true, value: thread };
  return {
    ok: true,
    value: {
      ...thread, status: 'resolved', resolvedAt: now, resolvedBy: actor.desk, updatedAt: now,
      messages: push(thread, message(actor, `Marked resolved by ${DESK_LABEL[actor.desk]}`, now, true)),
    },
  };
}

export function reopenThread(thread: EnquiryThread, actor: ThreadActor, now: string): ThreadResult<EnquiryThread> {
  if (!canSee(thread, actor.desk)) return { ok: false, status: 403, error: 'not a party to this thread' };
  if (thread.status === 'open') return { ok: true, value: thread };
  return {
    ok: true,
    value: {
      ...thread, status: 'open', resolvedAt: null, resolvedBy: null, updatedAt: now,
      waitingOn: nextWaitingOn(thread, actor),
      messages: push(thread, message(actor, `Reopened by ${DESK_LABEL[actor.desk]}`, now, true)),
    },
  };
}

/** Label used when a vendor name must not reach Sales (founder rule: sales
 *  never sees vendor information). */
export const SUPPLIER_LABEL = 'our supplier';

/** Deterministic vendor scrub for anything Procurement writes into a
 *  sales-facing thread. Case-insensitive, longest names first so
 *  "Shree Steel" is replaced before "Shree". */
export function scrubVendors(text: string, vendors: readonly string[]): string {
  let out = String(text ?? '');
  const names = cleanVendors(vendors);
  for (const name of names) {
    const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, SUPPLIER_LABEL);
  }
  return out;
}

/** Normalize a vendor list into replacement-ordered names (≥3 chars, deduped,
 *  longest first). */
export function cleanVendors(vendors: readonly unknown[]): string[] {
  const names = Array.from(new Set((vendors ?? []).map((v) => String(v ?? '').trim()).filter((v) => v.length >= 3)));
  return names.sort((a, b) => b.length - a.length).slice(0, 50);
}

/** Stamp the sales-facing copy on a Procurement-authored message (called at
 *  write time, so management keeps the original text for audit and no read
 *  path has to touch the items blob). */
export function stampSalesCopy<T extends ThreadMessage>(msg: T, vendors: readonly string[]): T {
  const names = cleanVendors(vendors);
  if (names.length === 0) return msg;
  const salesText = scrubVendors(msg.text, names);
  const attachments = msg.attachments?.map((a) => {
    const salesName = scrubVendors(String(a.name ?? ''), names);
    return salesName !== a.name ? { ...a, salesName } : a;
  });
  const next: T = { ...msg };
  if (salesText !== msg.text) next.salesText = salesText;
  if (attachments && attachments.some((a, i) => a !== msg.attachments?.[i])) next.attachments = attachments;
  return next;
}

/** Counts for a desk's Open / Resolved tabs (+ how many wait on that desk).
 *  "Waiting on you" follows the per-desk waiting set — a product query waits
 *  on management AND procurement, so it counts for both until answered. */
export function summarizeForDesk(threads: EnquiryThread[], desk: ThreadDesk): { open: number; resolved: number; waitingOnYou: number } {
  let open = 0, resolved = 0, waitingOnYou = 0;
  for (const t of threads) {
    if (!canSee(t, desk)) continue;
    if (t.status === 'resolved') { resolved += 1; continue; }
    open += 1;
    if (waitingOnAllFor(t, desk).includes(desk)) waitingOnYou += 1;
  }
  return { open, resolved, waitingOnYou };
}
