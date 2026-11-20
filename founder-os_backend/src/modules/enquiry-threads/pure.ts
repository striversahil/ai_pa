// enquiry-threads/pure.ts — access + state rules (sync, no IO).
//
// Visibility is by CHANNEL, decided server-side for the requesting desk:
//   sales desk       → 'sales' channel only (never 'internal')
//   procurement desk → 'internal' channel only
//   management desk  → both
// Founder rule 2026-11-20: anything between procurement and management is
// never visible to the sales team. Guard: scripts/guards/enquiry-threads.test.mjs.
import type { MeResponse } from '../auth/types';
import { canManageRates } from '../enquiries/scopes';
import {
  MAX_THREAD_MESSAGES, MAX_THREAD_TEXT, THREAD_DESKS,
  type EnquiryThread, type ThreadActor, type ThreadChannel, type ThreadDesk, type ThreadMessage, type ThreadResult,
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

export function channelsFor(desk: ThreadDesk): ThreadChannel[] {
  if (desk === 'management') return ['sales', 'internal'];
  return desk === 'sales' ? ['sales'] : ['internal'];
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

export function canSee(thread: Pick<EnquiryThread, 'channel'>, desk: ThreadDesk): boolean {
  return channelsFor(desk).includes(thread.channel);
}

/** The thread shaped for one desk, or null when that desk may not see it. */
export function serveForDesk(thread: EnquiryThread, desk: ThreadDesk): EnquiryThread | null {
  if (!canSee(thread, desk)) return null;
  return desk === 'management' ? thread : { ...thread, parentThreadId: null };
}

export function cleanThreadText(v: unknown): string {
  return String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_THREAD_TEXT);
}

const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function message(actor: ThreadActor, text: string, at: string, system = false): ThreadMessage {
  return { id: newId('tm'), by: actor.desk, authorName: actor.name.slice(0, 120), text, at, ...(system ? { system: true } : {}) };
}

export function createThread(input: {
  enquiryId: string; itemIndex: number; itemName: string; actor: ThreadActor; to: ThreadDesk;
  text: string; now: string; parentThreadId?: string | null;
}): ThreadResult<EnquiryThread> {
  const channel = channelBetween(input.actor.desk, input.to);
  if (!channel) return { ok: false, status: 400, error: `${DESK_LABEL[input.actor.desk]} cannot start a thread with ${DESK_LABEL[input.to]}` };
  const text = cleanThreadText(input.text);
  if (!text) return { ok: false, status: 400, error: 'message text required' };
  return {
    ok: true,
    value: {
      id: newId('th'), enquiryId: input.enquiryId,
      itemIndex: Math.max(0, Math.floor(input.itemIndex)), itemName: String(input.itemName ?? '').slice(0, 200),
      channel, status: 'open', openedBy: input.actor.desk, waitingOn: input.to,
      parentThreadId: input.parentThreadId ?? null,
      messages: [message(input.actor, text, input.now)],
      createdAt: input.now, updatedAt: input.now, resolvedAt: null, resolvedBy: null,
    },
  };
}

function isParty(thread: EnquiryThread, desk: ThreadDesk): boolean {
  return partiesOf(thread.channel).includes(desk);
}

function push(thread: EnquiryThread, m: ThreadMessage): ThreadMessage[] {
  return [...thread.messages, m].slice(-MAX_THREAD_MESSAGES);
}

/** Reply: reopens a resolved thread; the other side now owes the answer. */
export function replyThread(thread: EnquiryThread, actor: ThreadActor, rawText: string, now: string): ThreadResult<EnquiryThread> {
  if (!isParty(thread, actor.desk)) return { ok: false, status: 403, error: 'not a party to this thread' };
  const text = cleanThreadText(rawText);
  if (!text) return { ok: false, status: 400, error: 'message text required' };
  return {
    ok: true,
    value: {
      ...thread, status: 'open', resolvedAt: null, resolvedBy: null,
      waitingOn: otherParty(thread.channel, actor.desk),
      messages: push(thread, message(actor, text, now)), updatedAt: now,
    },
  };
}

/** Either side of the thread may resolve (founder choice 2026-11-20). */
export function resolveThread(thread: EnquiryThread, actor: ThreadActor, now: string): ThreadResult<EnquiryThread> {
  if (!isParty(thread, actor.desk)) return { ok: false, status: 403, error: 'not a party to this thread' };
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
  if (!isParty(thread, actor.desk)) return { ok: false, status: 403, error: 'not a party to this thread' };
  if (thread.status === 'open') return { ok: true, value: thread };
  return {
    ok: true,
    value: {
      ...thread, status: 'open', resolvedAt: null, resolvedBy: null, updatedAt: now,
      waitingOn: otherParty(thread.channel, actor.desk),
      messages: push(thread, message(actor, `Reopened by ${DESK_LABEL[actor.desk]}`, now, true)),
    },
  };
}

/** Counts for a desk's Open / Resolved tabs (+ how many wait on that desk). */
export function summarizeForDesk(threads: EnquiryThread[], desk: ThreadDesk): { open: number; resolved: number; waitingOnYou: number } {
  let open = 0, resolved = 0, waitingOnYou = 0;
  for (const t of threads) {
    if (!canSee(t, desk)) continue;
    if (t.status === 'resolved') { resolved += 1; continue; }
    open += 1;
    if (t.waitingOn === desk) waitingOnYou += 1;
  }
  return { open, resolved, waitingOnYou };
}
