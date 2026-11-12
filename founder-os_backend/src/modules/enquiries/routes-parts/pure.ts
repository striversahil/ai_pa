// Extracted verbatim from routes.ts by scripts/refactor/split-module.mjs.
// routes.ts re-exports everything public here, so existing imports keep working.
import { decodeEnquiryCursor, encodeEnquiryCursor } from "../types";
import type { EnquiryStore } from "../types";
import type { MeResponse } from "../../auth/types";
import { attachZohoStatuses } from "../estimate-link";
import { canManageRates, canSeeProcurementRequests, stripMarginFields, summarizeEnquiry, validateRatesInput, isRestrictedViewer, canConcludeProcurement } from "../scopes";
import { redactEnquiryRows, stripQueueMediaUrls, redactCommentList } from "../redaction";
import { parseItemMedia, pickEnquiryFields, normalizeVisibility } from "../parse";
import { LiveEvent } from "../../../live";
import { isFieldStaffSource, resolveFieldStaff } from "../attribution";
import type { EnquiryResult, RedactOpts, ProcQueueOpts } from "./types";

export const json = (status: number, body: any): EnquiryResult => ({ status, body });

export const err = (message: string, status = 403): EnquiryResult => json(status, { error: message });

export async function enquiryList(store: EnquiryStore, me: MeResponse, opts?: RedactOpts): Promise<EnquiryResult> {
  const page = Math.max(1, Math.floor(Number(opts?.page) || 0));
  const lim = Math.min(50, Math.max(1, Math.floor(Number(opts?.limit) || 0)));
  let enquiries: any[];
  let comments: any[];
  let total: number | null = null;
  let meta: Record<string, unknown> = {};
  const qRaw = typeof (opts as any)?.q === "string" ? (opts as any).q.trim().slice(0, 40) : "";
  if (qRaw) {
    if (qRaw.length < 2) {
      // Cost guard: single-char substrings match everything — refuse without
      // touching the table.
      enquiries = [];
      comments = [];
      meta = { q: qRaw, hasMore: false, limit: 0 };
    } else {
      // D1 caps LIKE/GLOB patterns at 50 bytes — byte-truncate (client names
      // can be multibyte) so the query can never fail on length.
      let fitted = qRaw;
      const enc = new TextEncoder();
      while (enc.encode(fitted).length > 48) fitted = fitted.slice(0, -1);
      const found = await store.searchEnquiries(fitted, 50);
      enquiries = found.rows;
      meta = { q: fitted, hasMore: found.hasMore, limit: 50 };
      comments = await store.listCommentsFor(enquiries.map((e: any) => String(e.id)));
    }
  } else if ((opts as any)?.cursor !== undefined) {
    // Cursor mode: newest-first keyset page. Zoho pre-attach + promotions
    // below run on the page only, so the Estimate lookup stays proportional
    // to the page (targeted chunked IN), never a table scan.
    const clim = Math.min(100, Math.max(1, Math.floor(Number(opts?.limit) || 100)));
    const rawCursor = typeof opts?.cursor === "string" ? opts.cursor : "";
    const decoded = rawCursor ? decodeEnquiryCursor(rawCursor) : null;
    const paged = await store.listEnquiriesCursor(decoded, clim);
    enquiries = paged.rows;
    meta = { hasMore: paged.nextCursor !== null, limit: clim };
    if (paged.nextCursor) meta.nextCursor = paged.nextCursor;
    comments = await store.listCommentsFor(enquiries.map((e: any) => String(e.id)));
  } else if (page > 0 && (opts as any)?.limit !== undefined) {
    const offset = (page - 1) * lim;
    const paged = await store.listEnquiriesPaged(offset, lim);
    enquiries = paged.rows;
    total = paged.total;
    comments = await store.listCommentsFor(enquiries.map((e: any) => String(e.id)));
    meta = { total, page, limit: lim };
  } else {
    // No-paging fallback (older clients): rows first, then comments scoped to
    // those ids — never a full comment-table pull (same rule as every branch).
    enquiries = await store.listEnquiries();
    comments = await store.listCommentsFor(enquiries.map((e: any) => String(e.id)));
  }
  // Live Zoho status (Estimate.status from the 5-min sync) rides the row in
  // BOTH views — see estimate-link.ts attachZohoStatuses (attached here
  // pre-redaction so the procurement payload keeps `zohoStatus`).
  await attachZohoStatuses(enquiries as any[]);
  if (!opts?.redact) {
    // Sales sees final rates but never margin internals (selectedVendor /
    // markup stay Management-only). Management (MIS) gets the full row.
    const privileged = canManageRates(me);
    const hideRequests = !canSeeProcurementRequests(me);
    const out = privileged ? enquiries : enquiries.map((e) => stripMarginFields(e, { hideRequests }));
    return json(200, { enquiries: out, comments, ...meta });
  }
  const red = await redactEnquiryRows(enquiries as any[], comments as any[], opts?.aiConfigured ?? true);
  return json(200, {
    enquiries: red.enquiries,
    comments: red.comments,
    // Route layer kicks a background re-enrichment for these (fire-and-forget).
    redactionPendingIds: red.redactionPendingIds,
    // Explicit AI-down signal: when false, withheld text is an outage, not a
    // fresh enquiry — the queue shows a banner instead of silent blanks.
    aiConfigured: opts?.aiConfigured ?? true,
    ...meta,
  });
}

// Procurement queues off the SAME cached scan as the management queues
// (`queues-cache.ts` — one scan per TTL serves every tab): `pending` returns
// the COMPLETE redacted pending set (no page boundary may hide open work),
// `history` returns the COMPLETE redacted history set with `all=true`
// (cursor paging stays for compat only). Every
// row is redacted through the write-time enrichment cache exactly like the
// list endpoint, so privileged preview and restricted viewers see the same
// bytes. Per render: KV reads only, zero D1 within TTL.
export async function procurementQueueList(
  store: EnquiryStore,
  _me: MeResponse,
  opts: ProcQueueOpts,
): Promise<EnquiryResult> {
  const { getManagementQueues } = await import('../queues-cache');
  const all = await getManagementQueues(store);
  const rows = (opts.queue === 'pending' ? all.procPending : all.procHistory) as any[];
  let page: any[];
  const meta: Record<string, unknown> = {};
  if (opts.queue === 'pending' || opts?.all) {
    page = rows;
  } else {
    const lim = Math.min(100, Math.max(1, Math.floor(Number(opts?.limit) || 50)));
    const rawCursor = typeof opts?.cursor === 'string' ? opts.cursor : '';
    const decoded = rawCursor ? decodeEnquiryCursor(rawCursor) : null;
    let start = 0;
    if (decoded) {
      const idx = rows.findIndex(
        (e) => String(e.createdAt) < decoded.createdAt
          || (String(e.createdAt) === decoded.createdAt && String(e.id) < decoded.id),
      );
      start = idx === -1 ? rows.length : idx;
    }
    page = rows.slice(start, start + lim);
    const last = page[page.length - 1];
    const more = start + lim < rows.length;
    meta.hasMore = more;
    meta.limit = lim;
    if (more && last) meta.nextCursor = encodeEnquiryCursor(String(last.createdAt), String(last.id));
  }
  const comments = await store.listCommentsFor(page.map((e: any) => String(e.id)));
  const red = await redactEnquiryRows(page, comments as any[], opts?.aiConfigured ?? true);
  // Queue payloads ship without media bytes (see stripQueueMediaUrls) —
  // the modal fetches the open row whole on demand.
  const slim = stripQueueMediaUrls(red.enquiries);
  return json(200, {
    enquiries: slim,
    comments: red.comments,
    redactionPendingIds: red.redactionPendingIds,
    aiConfigured: opts?.aiConfigured ?? true,
    ...meta,
  });
}

/** Redacted single-row read for restricted (procurement) viewers: the same
 *  bytes as the queue payload (same redaction, same enrichment cache) but
 *  WITH full media — dashboard modals fetch the open row on demand because
 *  queue payloads strip media for size. Reuses the list path's redaction so
 *  privileged preview and restricted viewers see identical bytes. */
export async function enquiryGetRedacted(
  store: EnquiryStore,
  id: string,
  aiConfigured: boolean,
): Promise<EnquiryResult> {
  const row: any = await (store as any).getEnquiry(String(id)).catch(() => null);
  if (!row) return json(404, { error: 'not found' });
  const comments = await (store as any).listCommentsFor([String(row.id)]).catch(() => []);
  const red = await redactEnquiryRows([row], comments as any[], aiConfigured);
  return json(200, {
    enquiry: red.enquiries[0] ?? null,
    comments: red.comments,
    redactionPendingIds: red.redactionPendingIds,
    aiConfigured,
  });
}

export async function enquiryAddRequirement(store: EnquiryStore, me: MeResponse, id: string, body: any): Promise<EnquiryResult> {
  const text = String(body?.text || "").trim();
  const imageUrl = body?.imageUrl ? String(body.imageUrl) : undefined;
  // Multi-photo detail flow sends `imageUrls[]`; single-photo callers send `imageUrl`.
  const imageUrls = Array.isArray(body?.imageUrls)
    ? body.imageUrls.map((u: any) => String(u ?? '')).filter(Boolean).slice(0, 8)
    : [];
  if (!text && !imageUrl && imageUrls.length === 0) return json(400, { error: "text required" });
  const existing = await store.getEnquiry(id);
  if (!existing) return json(404, { error: "not found" });
  // Single-flight: an unprocessed aiPending row means the intake split is
  // still working (or a previous click already queued it). A second append
  // would split twice and duplicate every line — refuse with 409 so the UI
  // can point at the in-progress row instead of creating twins.
  if (Array.isArray((existing as any).items) && (existing as any).items.some((it: any) => it?.aiPending === true)) {
    return json(409, { error: "AI split already in progress for this enquiry — wait for the pending item to resolve before adding again." });
  }
  // An additional requirement is simply a NEW LINE ITEM: appended to the
  // previous items with no vendor rates, so it shows up as rate-pending in
  // Procurement and then flows to Management Review like any other item.
  // (Legacy `additionalRequirements` rows stay readable; new adds go to items.)
  const mediaSrc = imageUrl ? [{ type: "image", url: imageUrl }] : imageUrls.map((url: string) => ({ type: "image", url }));
  const newItem = {
    name: "",
    qty: "",
    spec: text.slice(0, 2000),
    media: parseItemMedia(mediaSrc),
    rates: [],
    // Flagged aiPending so the Worker-native vision intake (kickAgnesIntake,
    // relay lanes) splits this text into catalogue lines exactly like the
    // detail-view "Add via AI" flow (see applyIntakeBulkResult).
    aiPending: true,
  };
  const patch: any = { items: [...((existing as any).items || []), newItem] };
  // A finalized enquiry with a new item has pending work again — reopen it so
  // the procurement queue (and, after rating, management review) picks it up.
  if ((existing as any).rateStatus === "finalized") patch.rateStatus = "rate_pending";
  const enquiry = await store.updateEnquiry(id, patch);
  if (!enquiry) return json(404, { error: "not found" });
  return {
    status: 201,
    body: { requirement: { text, imageUrl }, enquiry },
    live: { type: LiveEvent.Enquiries, extra: { action: "requirement", id, summary: summarizeEnquiry(enquiry) } },
  };
}

export async function enquiryUpdate(store: EnquiryStore, me: MeResponse, id: string, body: any): Promise<EnquiryResult> {
  const picked = pickEnquiryFields(body || {});
  const updates: any = picked ?? {};
  // Revise verb (privileged only, enforced in applySentRevision): reopen a
  // `sent` enquiry for additional scope. Read off `body` — never stored.
  if ((body as any)?.reviseSent === true) updates.reviseSent = true;
  if (!Object.keys(updates).length) return json(400, { error: "no valid fields" });
  // Reject junk quote amounts with a message instead of dropping them.
  if (Array.isArray((body as any)?.items)) {
    const rateError = validateRatesInput((body as any).items);
    if (rateError) return json(400, { error: rateError });
  }
  // Items derive from manual entry — except `aiPending` raw items from the
  // detail-view "Add via AI" flow (and additional-requirements), which the
  // Worker-native vision intake replaces with split lines (see
  // applyIntakeBulkResult): a description edit preserves them; explicit
  // item saves carry `items`.
  const privileged = canManageRates(me);
  const restricted = isRestrictedViewer(me);
  // Acting surface: privileged writers (MIS/admin) working inside the
  // procurement queue declare `surface: 'procurement'` so their trail stamps
  // read Procurement instead of Management. One-way only — a non-privileged
  // writer can never claim a higher role than their scopes allow.
  const declaredSurface = String((body as any)?.surface ?? '').trim().toLowerCase();
  const actingProcurement = restricted || (privileged && declaredSurface === 'procurement');
  const storedForItems = await store.getEnquiry(id).catch(() => null);
  // Field Staff attribution: revalidate only when the SOURCE changes or a
  // different field staff is picked. Partial updates (status/rates/comments)
  // never touch attribution, so historical rows stay editable even after the
  // staff member is deleted/absent.
  {
    const incomingSource = (updates as any).source;
    const storedSource = String((storedForItems as any)?.source ?? '');
    const storedFieldStaffId = String((storedForItems as any)?.fieldStaffId ?? '');
    const incomingFieldStaffId = String((updates as any).fieldStaffId ?? '');
    const sourceChanged = incomingSource !== undefined && String(incomingSource) !== storedSource;
    const staffChanged = !!incomingFieldStaffId && incomingFieldStaffId !== storedFieldStaffId;
    if (sourceChanged || staffChanged) {
      if (isFieldStaffSource(incomingSource ?? storedSource)) {
        const resolved = await resolveFieldStaff(store, incomingFieldStaffId || storedFieldStaffId);
        if (!resolved.ok) return json(400, { error: resolved.error });
        (updates as any).fieldStaffId = resolved.row.id;
        (updates as any).assignedAgentId = resolved.row.id;
        if (!isFieldStaffSource(storedSource)) {
          const logger = String((storedForItems as any)?.loggedByAgentId ?? (storedForItems as any)?.assignedAgentId ?? '');
          if (logger && logger !== resolved.row.id) (updates as any).loggedByAgentId = logger;
        }
      } else if (sourceChanged) {
        (updates as any).fieldStaffId = '';
      }
    }
  }
  const storedItems: any[] = Array.isArray((storedForItems as any)?.items) ? (storedForItems as any).items : [];
  if (Array.isArray((updates as any).items)) {
    // Item lifecycles (rates/spec/thread per role) — see update.ts.
    const { normalizeItemWrites } = await import('../update');
    (updates as any).items = normalizeItemWrites((updates as any).items, {
      storedItems, privileged, restricted, actingProcurement, surface: declaredSurface,
    } as any);
  }
  // Source change retitles auto-titles — see update.ts retitleOnSourceChange.
  const { retitleOnSourceChange } = await import('../update');
  retitleOnSourceChange(updates, storedForItems);
  // Submit-to-Management lifecycle + reopen + auto-finalize — see update.ts.
  {
    const { applyRateLifecycles, applySentRevision } = await import('../update');
    const reviseErr = applySentRevision(updates, {
      storedRateStatus: String((storedForItems as any)?.rateStatus ?? ''),
      storedRevision: String((storedForItems as any)?.sentRevisionAt ?? ''),
      storedZohoStatus: String((storedForItems as any)?.zohoStatus ?? ''),
      privileged,
    });
    if (reviseErr) return json(403, { error: reviseErr });
    applyRateLifecycles(updates, { storedForItems, storedItems, privileged, restricted, canConclude: canConcludeProcurement(me) });
  }
  // Completeness gate (all writers) — see update.ts assertFinalizeGate.
  if ((updates as any).rateStatus === 'finalized' || (updates as any).rateStatus === 'sent') {
    const merged: any[] = Array.isArray((updates as any).items)
      ? (updates as any).items
      : (Array.isArray((storedForItems as any)?.items) ? (storedForItems as any).items : []);
    const { assertFinalizeGate } = await import('../update');
    const gateErr = assertFinalizeGate(merged, (updates as any).rateStatus);
    if (gateErr) return json(400, { error: gateErr });
  }
  if (!privileged) {
    // Sales "Mark as sent": finalized → sent, and only with an EST No. on
    // the row. Anything else rateStatus-wise stays Management-only.
    if ((updates as any).rateStatus === 'sent') {
      const current = await store.getEnquiry(id).catch(() => null);
      if (!current) return json(404, { error: 'not found' });
      if (String((current as any).rateStatus ?? '') !== 'finalized') {
        return json(400, { error: 'Only finalized enquiries can be marked as sent' });
      }
      if (!String((current as any).estNumber ?? '').trim()) {
        return json(400, { error: 'Add EST No. before marking as sent', needEstNumber: true });
      }
    } else {
      delete (updates as any).rateStatus;
    }
  }
  // Auto-advance the workflow: first vendor rate moves Rate Pending → Received.
  // Finalized is set explicitly by Management (guarded above) — except the
  // all-available case below, which no role can produce by hand.
  if ((updates as any).rateStatus === undefined) {
    const current = await store.getEnquiry(id).catch(() => null);
    const mergedItems = Array.isArray((updates as any).items)
      ? (updates as any).items
      : ((current as any)?.items ?? []);
    const cur = String((current as any)?.rateStatus ?? '');
    if ((cur === '' || cur === 'rate_pending') && mergedItems.some((it: any) => ((it as any).rates ?? []).length > 0)) {
      (updates as any).rateStatus = 'rates_received';
    }
    // All-quoted shortcut (any writer): every item rate-available with no
    // open spec flag means nothing left to decide — no procurement queue,
    // no management decision. Flip straight to finalized so Mark as Sent
    // enables in realtime on the same save. Empty rows and flagged rows
    // never flip (flags must resolve first).
    if ((cur === '' || cur === 'rate_pending' || cur === 'rates_received')
      && mergedItems.length > 0
      && mergedItems.every((it: any) => it?.rateAvailable === true)
      && !mergedItems.some((it: any) => it?.specIssue)) {
      (updates as any).rateStatus = 'finalized';
    }
    // Late-quote note (any writer): a new vendor quote on a finalized row
    // KEEPS the committed decision so sales keeps the previous rate (see
    // update.ts) — rateStatus stays `finalized`. Management is notified via
    // live event + thread entry and revises only if needed. Sent rows never
    // reopen implicitly (explicit `reviseSent` by management is the only way).
    if (cur === 'finalized') {
      const { applyLateQuoteReopen } = await import('../update');
      applyLateQuoteReopen(updates, {
        storedItems,
        storedRateStatus: cur,
        actedBy: actingProcurement ? 'procurement' : privileged ? 'management' : 'sales',
      });
    }
  }
  const enquiry = await store.updateEnquiry(id, updates);
  if (!enquiry) return json(404, { error: "not found" });
  // Keep the linked Zoho estimate's creator in sync: enquiry agent always wins.
  // When the EST No. itself changed (or was cleared), reconcile the OLD
  // number too — otherwise its By goes stale with no mapping behind it.
  try {
    const { syncEstimateCreatorFromEnquiry, reconcileEstimateCreator } = await import('../estimate-link');
    const finalEst = String((enquiry as any)?.estNumber ?? '').trim();
    const prevEst = String((storedForItems as any)?.estNumber ?? '').trim();
    const nextAgent = (updates as any)?.assignedAgentId !== undefined
      ? String((updates as any).assignedAgentId ?? '')
      : String((enquiry as any)?.assignedAgentId ?? '');
    if (finalEst && nextAgent.trim()) {
      // Org-pinned like create (cross-org clash safety).
      await syncEstimateCreatorFromEnquiry(finalEst, nextAgent, String((enquiry as any)?.organizationId ?? ''));
    }
    if (prevEst && prevEst !== finalEst) await reconcileEstimateCreator(prevEst, String((enquiry as any)?.organizationId ?? ''));
  } catch { /* fail-open */ }
  const canSeeMargins = canManageRates(me);
  return {
    status: 200,
    body: canSeeMargins ? enquiry : stripMarginFields(enquiry as any, { hideRequests: !canSeeProcurementRequests(me) }),
    live: { type: LiveEvent.Enquiries, extra: { action: "updated", id, summary: summarizeEnquiry(enquiry) } },
  };
}

export async function enquiryDelete(store: EnquiryStore, me: MeResponse, id: string): Promise<EnquiryResult> {
  const doomed = await store.getEnquiry(id).catch(() => null);
  await store.deleteEnquiry(id);
  // Unlink: the deleted row's EST No. must not keep a stale By behind.
  try {
    const num = String((doomed as any)?.estNumber ?? '').trim();
    if (num) {
      const { reconcileEstimateCreator } = await import('../estimate-link');
      await reconcileEstimateCreator(num);
    }
  } catch { /* fail-open */ }
  return { status: 200, body: { ok: true }, live: { type: LiveEvent.Enquiries, extra: { action: "deleted", id } } };
}

/**
 * Scoped single-row read for live merge: the broadcast carries ids only, so
 * each view fetches the one changed row (server-scoped) instead of the full
 * list. Restricted (procurement) viewers get 403 here — their redacted
 * payload only comes from the list endpoint; the frontend keeps the
 * debounced list refetch for that view.
 */
export async function enquiryGet(store: EnquiryStore, me: MeResponse, id: string): Promise<EnquiryResult> {
  if (isRestrictedViewer(me)) return json(403, { error: "restricted", restricted: true });
  const enquiry = await store.getEnquiry(id).catch(() => null);
  if (!enquiry) return json(404, { error: "not found" });
  const comments = await store.listComments(id).catch(() => []);
  const body = canManageRates(me) ? enquiry : stripMarginFields(enquiry as any, { hideRequests: !canSeeProcurementRequests(me) });
  return json(200, { enquiry: body, comments });
}

export async function enquiryComments(store: EnquiryStore, me: MeResponse, enquiryId: string, opts?: RedactOpts): Promise<EnquiryResult> {
  const all = await store.listComments(enquiryId);
  // Procurement sees only the shared ops thread; sales/management see both.
  const list = opts?.redact
    ? (all as any[]).filter((cm) => normalizeVisibility((cm as any)?.visibility) === 'procurement')
    : all;
  if (!opts?.redact) return json(200, list);
  // AI-only: serve cached rewrites whose hashes match; withhold the rest.
  const red = await redactCommentList(enquiryId, list as any[], opts?.aiConfigured ?? true);
  return json(200, { comments: red.comments, redactionPendingIds: red.redactionPendingIds, aiConfigured: opts?.aiConfigured ?? true });
}

export async function enquiryAddComment(store: EnquiryStore, me: MeResponse, enquiryId: string, body: any): Promise<EnquiryResult> {
  const content = String(body?.content || "").trim();
  if (!content) return json(400, { error: "content required" });
  // Scope: restricted (procurement) writers can only post to the shared ops
  // thread; sales/management choose, defaulting to their private thread.
  // Replies inherit the parent's scope — cross-scope replies are rejected.
  let visibility = isRestrictedViewer(me) ? 'procurement' : normalizeVisibility(body?.visibility);
  const parentId = body?.parentId ? String(body.parentId) : null;
  if (parentId) {
    const siblings = await store.listComments(enquiryId).catch(() => []);
    const parent = (siblings as any[]).find((cm) => String(cm?.id) === parentId);
    if (!parent) return json(400, { error: "parent comment not found" });
    visibility = normalizeVisibility((parent as any)?.visibility);
  }
  const comment = await store.addComment({
    enquiryId,
    agentId: Number(body?.agentId) || 0,
    content,
    parentId,
    imageUrl: body?.imageUrl ? String(body.imageUrl) : undefined,
    visibility,
  } as any);
  // Scope-safe: comment content is free text (never broadcast); receivers
  // refetch the scoped thread instead.
  const updated = await store.getEnquiry(enquiryId).catch(() => null);
  return {
    status: 201,
    body: comment,
    live: {
      type: LiveEvent.Enquiries,
      extra: { action: "comment", id: (comment as any).id, enquiryId, visibility, summary: updated ? summarizeEnquiry(updated) : undefined },
    },
  };
}
