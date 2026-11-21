// enquiry-threads/service.ts — orchestration: desk check → store → pure rules
// → channel-filtered response. Every read AND write passes deskAllowed +
// canSee, so an internal (management <-> procurement) thread can never reach
// the sales desk, by id or by list.
import type { MeResponse } from '../auth/types';
import {
  canSee, channelsFor, createThread, deskAllowed, isDesk, reopenThread, replyThread, resolveThread, serveForDesk,
  transferTranscript,
} from './pure';
import {
  countOpenByEnquiry, findChildThread, getThread, insertThread, listInbox, listThreadsForEnquiry, readItemName, saveThreadState,
} from './store';
import type { EnquiryThread, ThreadActor, ThreadDesk, ThreadResult } from './types';

type D1 = any;
type Res<T> = ThreadResult<T>;

function actorFor(me: MeResponse, desk: ThreadDesk): ThreadActor {
  return { desk, name: String((me as any)?.user?.name || (me as any)?.user?.email || '').trim() };
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
  return { ok: true, value: serveAll(await listThreadsForEnquiry(db, enquiryId, channelsFor(g.value)), g.value) };
}

export async function threadInbox(db: D1, me: MeResponse | null, rawDesk: unknown, rawStatus: unknown): Promise<Res<EnquiryThread[]>> {
  const g = gate(me, rawDesk);
  if (!g.ok) return g;
  const status = rawStatus === 'resolved' ? 'resolved' : 'open';
  return { ok: true, value: serveAll(await listInbox(db, channelsFor(g.value), status), g.value) };
}

export async function threadCounts(db: D1, me: MeResponse | null, rawDesk: unknown) {
  const g = gate(me, rawDesk);
  if (!g.ok) return g;
  return { ok: true as const, value: await countOpenByEnquiry(db, channelsFor(g.value)) };
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
    actor: actorFor(me as MeResponse, g.value), to: body.to, text: body?.text, now: new Date().toISOString(),
    attachments: body?.attachments,
  });
  if (r.ok) await insertThread(db, r.value);
  return r;
}

type Op = 'reply' | 'resolve' | 'reopen';

export async function actOnThread(db: D1, me: MeResponse | null, id: string, body: any, op: Op): Promise<Res<EnquiryThread>> {
  const g = gate(me, body?.desk);
  if (!g.ok) return g;
  const thread = await getThread(db, id);
  // Invisible threads 404 (never 403) so their existence is not confirmed.
  if (!thread || !canSee(thread, g.value)) return { ok: false, status: 404, error: 'thread not found' };
  const actor = actorFor(me as MeResponse, g.value);
  const now = new Date().toISOString();
  const r = op === 'reply' ? replyThread(thread, actor, body?.text, now, body?.attachments)
    : op === 'resolve' ? resolveThread(thread, actor, now)
    : reopenThread(thread, actor, now);
  if (!r.ok) return r;
  if (r.value !== thread) await saveThreadState(db, r.value);
  return { ok: true, value: serveForDesk(r.value, g.value) as EnquiryThread };
}

/** Management sends a sales thread's question on to procurement: the WHOLE
 *  conversation (messages + attachments) is transferred into a SEPARATE
 *  internal thread (parent link kept for management only). The sales thread
 *  is untouched — sales never learns procurement was asked. Re-forwarding the
 *  same sales thread appends only the new messages to the one child thread. */
export async function forwardToProcurement(db: D1, me: MeResponse | null, id: string, body: any): Promise<Res<EnquiryThread>> {
  const g = gate(me, 'management');
  if (!g.ok) return g;
  const src = await getThread(db, id);
  if (!src || src.channel !== 'sales') return { ok: false, status: 404, error: 'sales thread not found' };
  const existing = await findChildThread(db, src.id);
  const r = transferTranscript({
    src, actor: actorFor(me as MeResponse, 'management'),
    note: String(body?.text ?? ''), attachments: body?.attachments,
    now: new Date().toISOString(), existing,
  });
  if (!r.ok) return r;
  if (existing) await saveThreadState(db, r.value.thread);
  else await insertThread(db, r.value.thread);
  return { ok: true, value: serveForDesk(r.value.thread, g.value) as EnquiryThread };
}
