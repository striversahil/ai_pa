// enquiry-threads/service.ts — orchestration: desk check → store → pure rules
// → channel/category-filtered response. Every read AND write passes deskAllowed
// + canSee, so a rate negotiation never reaches procurement and the internal
// (management <-> procurement) channel never reaches sales, by id or by list.
//
// 2026-11-21: a product query is ONE conversation shared by all three desks.
// Procurement replies inline and is presented to Sales as Management — the
// reply is scrubbed of vendor names at write time (`salesText`), so nothing
// about suppliers or the procurement desk can leak through free text.
import type { MeResponse } from '../auth/types';
import {
  canSee, createThread, deskAllowed, isDesk, looksLikeEmail, prettifyAuthorName, reopenThread, replyThread,
  resolveThread, serveForDesk, stampSalesCopy, DESK_LABEL,
} from './pure';
import {
  countOpenByEnquiry, getThread, insertThread, listInbox, listThreadsForEnquiry, readItemName, readItemVendors,
  readMemberName, saveThreadState,
} from './store';
import type { EnquiryThread, ThreadActor, ThreadDesk, ThreadResult } from './types';

type D1 = any;
type Res<T> = ThreadResult<T>;

/** Who is writing, as a NAME. The auth profile name is trusted only when it is
 *  not an address; otherwise the HR register supplies the person's real name
 *  (matched on the login email), and the email is humanized as a last resort —
 *  a thread must never be attributed to `someone@company.com`. */
async function actorFor(db: D1, me: MeResponse, desk: ThreadDesk): Promise<ThreadActor> {
  const email = String((me as any)?.user?.email ?? '').trim();
  const raw = String((me as any)?.user?.name ?? '').trim();
  if (raw && !looksLikeEmail(raw)) return { desk, name: raw.slice(0, 120) };
  const member = await readMemberName(db, email);
  const name = member || prettifyAuthorName(raw || email) || DESK_LABEL[desk];
  return { desk, name: name.slice(0, 120) };
}

function gate(me: MeResponse | null, rawDesk: unknown): Res<ThreadDesk> {
  if (!me) return { ok: false, status: 401, error: 'Authentication required' };
  if (!isDesk(rawDesk)) return { ok: false, status: 400, error: 'desk must be sales | procurement | management' };
  if (!deskAllowed(me, rawDesk)) return { ok: false, status: 403, error: `no ${rawDesk} access` };
  return { ok: true, value: rawDesk };
}

const serveAll = (rows: EnquiryThread[], desk: ThreadDesk) =>
  rows.map((t) => serveForDesk(t, desk)).filter((t): t is EnquiryThread => t !== null);

export async function threadsForEnquiry(db: D1, me: MeResponse | null, rawDesk: unknown, enquiryId: string): Promise<Res<EnquiryThread[]>> {
  const g = gate(me, rawDesk);
  if (!g.ok) return g;
  if (!enquiryId) return { ok: false, status: 400, error: 'enquiryId required' };
  return { ok: true, value: serveAll(await listThreadsForEnquiry(db, enquiryId, g.value), g.value) };
}

export async function threadInbox(db: D1, me: MeResponse | null, rawDesk: unknown, rawStatus: unknown): Promise<Res<EnquiryThread[]>> {
  const g = gate(me, rawDesk);
  if (!g.ok) return g;
  const status = rawStatus === 'resolved' ? 'resolved' : 'open';
  return { ok: true, value: serveAll(await listInbox(db, g.value, status), g.value) };
}

export async function threadCounts(db: D1, me: MeResponse | null, rawDesk: unknown) {
  const g = gate(me, rawDesk);
  if (!g.ok) return g;
  return { ok: true as const, value: await countOpenByEnquiry(db, g.value) };
}

export async function startThread(db: D1, me: MeResponse | null, body: any): Promise<Res<EnquiryThread>> {
  const g = gate(me, body?.desk);
  if (!g.ok) return g;
  if (!isDesk(body?.to)) return { ok: false, status: 400, error: 'to must be sales | procurement | management' };
  const enquiryId = String(body?.enquiryId ?? '');
  const itemIndex = Math.max(0, Math.floor(Number(body?.itemIndex) || 0));
  const item = await readItemName(db, enquiryId, itemIndex);
  if (!item.exists) return { ok: false, status: 404, error: 'enquiry not found' };
  const r = createThread({
    enquiryId, itemIndex, itemName: item.name || String(body?.itemName ?? ''),
    actor: await actorFor(db, me as MeResponse, g.value), to: body.to, text: body?.text, now: new Date().toISOString(),
    attachments: body?.attachments, category: body?.category,
  });
  if (r.ok) await insertThread(db, r.value);
  return r;
}

type Op = 'reply' | 'resolve' | 'reopen';

/** Procurement replying inside a sales-channel thread is published as
 *  Management, so the stored message carries a `salesText` copy with every
 *  vendor name replaced. Only the LAST message can be new, so the scrub is
 *  scoped to it (no items-blob reads on any list path). */
async function stampProcurementReply(db: D1, thread: EnquiryThread, next: EnquiryThread): Promise<EnquiryThread> {
  if (thread.channel !== 'sales') return next;
  const vendors = await readItemVendors(db, thread.enquiryId, thread.itemIndex);
  if (vendors.length === 0) return next;
  const lastIdx = next.messages.length - 1;
  const last = next.messages[lastIdx];
  if (!last) return next;
  const stamped = stampSalesCopy(last, vendors);
  if (stamped === last) return next;
  const messages = [...next.messages];
  messages[lastIdx] = stamped;
  return { ...next, messages };
}

export async function actOnThread(db: D1, me: MeResponse | null, id: string, body: any, op: Op): Promise<Res<EnquiryThread>> {
  const g = gate(me, body?.desk);
  if (!g.ok) return g;
  const thread = await getThread(db, id);
  // Invisible threads 404 (never 403) so their existence is not confirmed.
  if (!thread || !canSee(thread, g.value)) return { ok: false, status: 404, error: 'thread not found' };
  const actor = await actorFor(db, me as MeResponse, g.value);
  const now = new Date().toISOString();
  const r = op === 'reply' ? replyThread(thread, actor, body?.text, now, body?.attachments)
    : op === 'resolve' ? resolveThread(thread, actor, now)
    : reopenThread(thread, actor, now);
  if (!r.ok) return r;
  const next = op === 'reply' && g.value === 'procurement'
    ? await stampProcurementReply(db, thread, r.value)
    : r.value;
  if (next !== thread) await saveThreadState(db, next);
  return { ok: true, value: serveForDesk(next, g.value) as EnquiryThread };
}

/** RETIRED 2026-11-21 — a product query is shared with procurement from the
 *  moment it is raised, so there is nothing left to "send over". Rate
 *  negotiations never go to procurement. Kept as a stub so older tabs get a
 *  clean answer instead of a broken button. */
export async function forwardToProcurement(): Promise<Res<EnquiryThread>> {
  return { ok: false, status: 410, error: 'Ask-Procurement forwarding is retired — product queries are visible to Procurement directly.' };
}
