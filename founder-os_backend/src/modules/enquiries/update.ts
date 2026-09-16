// update.ts — enquiryUpdate lifecycles, extracted verbatim from routes.ts.
// One concern per helper; routes.ts orchestrates (flags → helpers → store).
// No behavior change: same branches, same order, same writes.
import {
  parseItemMedia,
  parseItemRates,
  parseFlagThread,
  type FlagThreadBy,
  type FlagThreadEntry,
} from "./store";

export interface ItemWriteCtx {
  storedItems: any[];
  privileged: boolean;
  restricted: boolean;
  actingProcurement: boolean;
}

/**
 * Merge client item writes over stored rows by index.
 * - Non-management writers can never set or wipe decisions
 *   (selectedVendor/markup/finalRate/finalizedAt follow stored).
 * - Restricted (procurement) writers own rates + spec flags only: identity
 *   follows stored, media appends, availability pinned.
 * - Privileged rate requests reopen finalized decisions; loop trail is
 *   server-authored (client remarks kept once each), capped at 50.
 */
export function normalizeItemWrites(items: any[], ctx: ItemWriteCtx): any[] {
  const { storedItems, privileged, restricted, actingProcurement } = ctx;
  return (items as any[]).map((it: any, idx: number) => {
    const stored = storedItems[idx] ?? {};
    // Markup + discount decisions + finalize (+ its timestamp) are Management-only.
    const { selectedVendor, markup, finalRate, finalDiscountPercent, finalizedAt, ...rest } = it;
    const base: any = privileged ? it : rest;
    // Preserve vendor quotes when only the availability flag flips: a
    // sales/management toggle of `rateAvailable` must never silently wipe
    // management-collected `rates` (bug: available→true hid rates, off again
    // showed empty because the toggle write omitted the array).
    if (Array.isArray(stored.rates) && stored.rates.length > 0) {
      const incomingRatesEmpty = !Array.isArray(base.rates) || base.rates.length === 0;
      const availabilityFlipped = (base.rateAvailable === true) !== (stored.rateAvailable === true);
      if (incomingRatesEmpty && availabilityFlipped) {
        base.rates = stored.rates;
      }
    }
    if (!privileged) {
      // Non-management writers can never decide — but they must never WIPE
      // a decision either (e.g. a sales EST-No. edit echoing items back
      // silently cleared final rates). Stored decision fields always
      // survive their writes; only the privileged surface below may set
      // or clear them.
      base.selectedVendor = stored.selectedVendor;
      base.markup = stored.markup;
      base.finalRate = stored.finalRate;
      base.finalDiscountPercent = stored.finalDiscountPercent;
      base.finalizedAt = stored.finalizedAt;
    }
    if (restricted) {
      // Procurement owns rates + spec flags only: identity (name/qty/spec/
      // media) always follows the stored row, so specs can't be edited or
      // items appended from this surface. Rate availability is sales-owned
      // too (procurement sees the state, never flips it). Markup fields
      // stripped above.
      if (idx >= storedItems.length) return null;
      base.name = stored.name ?? "";
      base.qty = stored.qty ?? "";
      base.spec = stored.spec ?? "";
      // Procurement may APPEND vendor reference media (photos/drawings)
      // but never edit or remove stored media — identity still follows
      // the stored row. Vendor refs never resolve the spec flag (see the
      // mediaAdded rule below — only non-procurement surfaces clear it).
      const storedMedia = parseItemMedia(stored.media ?? []);
      const incomingMedia = parseItemMedia(base.media ?? []);
      const seenMedia = new Set(storedMedia.map((m: any) => `${m.type}:${m.url}`));
      base.media = [...storedMedia, ...incomingMedia.filter((m: any) => !seenMedia.has(`${m.type}:${m.url}`))];
      base.rateAvailable = stored.rateAvailable === true;
      // Internal handling is Management-only: procurement and sales writes
      // follow the stored flag so neither surface can claim or drop it.
      if (!privileged) {
        base.internalRates = stored.internalRates === true;
        base.internalRatesAt = stored.internalRatesAt ?? undefined;
      }
      // A fresh/edited rate answers Management's request — clear it.
      // Untouched rates keep a pending request alive.
      const ratesChanged = JSON.stringify(base.rates ?? []) !== JSON.stringify(stored.rates ?? []);
      base.ratesRequested = ratesChanged ? undefined : stored.ratesRequested;
      base.ratesRequestedAt = ratesChanged ? undefined : stored.ratesRequestedAt;
    }
    // Management rate-request lifecycle: only privileged writers may set
    // it. Plain sales writers follow the stored value so a stale edit can
    // never forge or wipe an active request; procurement clears it by
    // changing rates (handled in the restricted branch above).
    if (!privileged && !restricted) {
      base.ratesRequested = stored.ratesRequested;
      base.ratesRequestedAt = stored.ratesRequestedAt;
      base.internalRates = stored.internalRates === true;
      base.internalRatesAt = stored.internalRatesAt ?? undefined;
    } else {
      // Submitted value stands (privileged set it, or the restricted
      // branch above already resolved it) — but a concurrent rate change
      // answers the request, so drop it.
      const ratesChanged = JSON.stringify(parseItemRates(base.rates ?? [])) !== JSON.stringify(parseItemRates(stored.rates ?? []));
      if (ratesChanged) {
        base.ratesRequested = undefined;
        base.ratesRequestedAt = undefined;
      }
      // A fresh management request on a finalized item reopens it — the
      // previous decision clears so the new quotes flow back to review.
      if (privileged && base.ratesRequested && !stored.ratesRequested
        && stored.finalRate !== undefined && stored.finalRate !== null) {
        base.selectedVendor = undefined;
        base.markup = undefined;
        base.finalRate = undefined;
        base.finalDiscountPercent = undefined;
        base.finalizedAt = undefined;
      }
    }
    // Spec-dispute lifecycle (all writers):
    // - a spec text change clears an open flag from any surface;
    // - fresh reference media clears it ONLY from a non-procurement surface
    //   (the sales-correction reshare path). Procurement attaching photos
    //   (vendor refs, site pics) must never resolve its own flag — the flag
    //   stays until sales fixes the spec;
    // - otherwise an open flag survives even if the write omits it;
    // - finalized items can't be newly flagged.
    const hadFlag = !!stored.specIssue;
    const specChanged = String(base.spec ?? "") !== String(stored.spec ?? "");
    const mediaKey = (m: any): string => `${m?.type === 'video' ? 'video' : m?.type === 'pdf' ? 'pdf' : 'image'}:${String(m?.url ?? '')}`;
    const storedUrls = new Set(parseItemMedia(stored.media ?? []).map(mediaKey));
    const mediaAdded = parseItemMedia(base.media ?? []).map(mediaKey).some((u) => !storedUrls.has(u));
    const fixed = specChanged || (mediaAdded && !actingProcurement);
    if (stored.finalRate !== undefined && stored.finalRate !== null) {
      // Privileged re-flag (incorrect rates / need other vendors): reopen
      // the item — the flag attaches and the previous decision clears, so
      // procurement picks it back up. Otherwise finalized items are frozen.
      if (privileged && base.specIssue && !stored.specIssue) {
        base.selectedVendor = undefined;
        base.markup = undefined;
        base.finalRate = undefined;
        base.finalDiscountPercent = undefined;
        base.finalizedAt = undefined;
      } else {
        base.specIssue = stored.specIssue;
        base.specFlaggedAt = stored.specFlaggedAt;
      }
    } else if (fixed) {
      delete base.specIssue;
      delete base.specFlaggedAt;
    } else if (hadFlag && base.specIssue === undefined) {
      base.specIssue = stored.specIssue;
      base.specFlaggedAt = stored.specFlaggedAt;
    }
    // Loop trail (server-authored, forge-proof): stored history + this
    // write's transitions. Client-sent flag/fix/request/quoted entries are
    // ignored — only client remarks are kept (once each). Rendered in
    // procurement so multi-round back-and-forth stays visible. The stamp
    // follows the acting surface (procurement queue work reads Procurement
    // even when the writer holds MIS/admin).
    const role: FlagThreadBy = actingProcurement ? 'procurement' : privileged ? 'management' : 'sales';
    const storedThread = parseFlagThread((stored as any)?.thread);
    const seen = new Set(storedThread.map((e) => `${e.at}|${e.kind}|${e.text}`));
    const trail: FlagThreadEntry[] = [...storedThread];
    for (const e of parseFlagThread((it as any)?.thread)) {
      if (e.kind !== 'remark') continue;
      const key = `${e.at}|${e.kind}|${e.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      trail.push({ by: e.by === role ? e.by : role, kind: 'remark', text: e.text, at: e.at });
    }
    const nowIso = new Date().toISOString();
    const flagSet = !stored.specIssue && base.specIssue;
    const flagCleared = !!stored.specIssue && !base.specIssue;
    const reqSet = !stored.ratesRequested && base.ratesRequested;
    const reqCleared = !!stored.ratesRequested && !base.ratesRequested;
    if (flagSet) trail.push({ by: role, kind: 'flag', text: String(base.specIssue).slice(0, 2000), at: nowIso });
    if (flagCleared) {
      trail.push({
        by: role,
        kind: 'fix',
        text: specChanged && mediaAdded ? 'Spec corrected with new references'
          : mediaAdded ? 'Reference attachments added' : 'Spec corrected',
        at: nowIso,
      });
    }
    if (reqSet) trail.push({ by: role, kind: 'request', text: String(base.ratesRequested).slice(0, 500), at: nowIso });
    if (reqCleared) trail.push({ by: role, kind: 'quoted', text: 'New vendor rates added', at: nowIso });
    // Internal-handling lifecycle (privileged only — other roles are
    // pinned to stored above): stamp the handoff, trail the transition.
    if (privileged) {
      const internalSet = !stored.internalRates && base.internalRates;
      const internalCleared = !!stored.internalRates && !base.internalRates;
      if (internalSet) {
        base.internalRatesAt = base.internalRatesAt || nowIso;
        trail.push({ by: role, kind: 'remark', text: 'Taken up internally by management', at: nowIso });
      }
      if (internalCleared) {
        base.internalRatesAt = undefined;
        trail.push({ by: role, kind: 'remark', text: 'Returned to the procurement queue', at: nowIso });
      }
    }
    base.thread = trail.slice(-50);
    return base;
  }).filter((it: any) => it !== null);
}

const normIntakeLine = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

/**
 * Intake bulk-add merge (GH intake action result → stored items):
 * - returns null when no item carries `aiPending` (nothing to do — the
 *   caller keeps its empty-fill-only behaviour);
 * - when the router returned split lines: replaces the `aiPending` block
 *   with the split items (deduped against existing real items so a
 *   re-run never duplicates), carrying the pending photos onto the first
 *   split item instead of duplicating data-URIs across every row;
 * - when the router returned zero lines: keeps the raw items but clears
 *   the flags so the UI stops showing "processing".
 * Pure (no I/O) — unit-tested via ts-node.
 */
export function applyIntakeBulkResult(existingItems: any[], incomingItems: any[]): any[] | null {
  const list = Array.isArray(existingItems) ? existingItems : [];
  const pendingIdx: number[] = [];
  list.forEach((it: any, i: number) => { if (it?.aiPending === true) pendingIdx.push(i); });
  if (pendingIdx.length === 0) return null;
  const pendingSet = new Set(pendingIdx);
  const clearFlags = () =>
    list.map((it: any) => {
      if (it?.aiPending !== true) return it;
      const { aiPending, ...rest } = it;
      void aiPending;
      return rest;
    });
  const incoming = (Array.isArray(incomingItems) ? incomingItems : [])
    .map((l: any) => ({
      name: String(l?.name ?? '').slice(0, 300),
      qty: String(l?.qty ?? '').slice(0, 120),
      spec: String(l?.spec ?? '').slice(0, 2000),
      category: l?.category ? String(l.category).slice(0, 120) : undefined,
      verbatim: l?.verbatim ? String(l.verbatim).slice(0, 500) : undefined,
    }))
    .filter((l) => l.name || l.qty || l.spec);
  if (incoming.length === 0) return clearFlags();
  // Dedup: skip router lines already present as real (non-pending) items.
  const seen = new Set(
    list
      .filter((_, i) => !pendingSet.has(i))
      .map((it: any) => normIntakeLine(`${it?.verbatim ?? ''} | ${it?.name ?? ''} | ${it?.spec ?? ''}`))
      .filter(Boolean),
  );
  const fresh = incoming.filter((l) => {
    const key = normIntakeLine(`${l.verbatim ?? ''} | ${l.name} | ${l.spec}`);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (fresh.length === 0) return clearFlags();
  // Pending photos belong to the whole chunk — carry them on the first split
  // item (duplicating data-URIs across every item would bloat the row).
  const pendingMedia: any[] = [];
  for (const i of pendingIdx) {
    for (const m of (list[i]?.media ?? [])) {
      if (!m?.url) continue;
      const k = `${m?.type}:${m?.url}`;
      if (!pendingMedia.some((p) => `${p?.type}:${p?.url}` === k)) pendingMedia.push(m);
    }
  }
  const split = fresh.map((l, k) => ({ ...l, media: k === 0 ? pendingMedia : [], rates: [] }));
  const out: any[] = [];
  let inserted = false;
  list.forEach((it: any, i: number) => {
    if (pendingSet.has(i)) {
      if (!inserted) { out.push(...split); inserted = true; }
      return;
    }
    out.push(it);
  });
  return out.slice(0, 100);
}

export interface RateWriteCtx {
  storedForItems: any | null;
  storedItems: any[];
  privileged: boolean;
  restricted: boolean;
}

/**
 * Late-quote note (any writer): a NEW vendor quote appended to an item
 * whose decision is committed (finalRate set) KEEPS that item's decision
 * (selectedVendor/markup/finalRate/finalizedAt) so sales keeps seeing the
 * previous quoted rate — only a founder override changes it. Stamps a
 * quoted trail entry so management can review the new quote and revise.
 * Only fires when:
 * - the enquiry is currently `finalized` (sent rows never reopen), AND
 * - the write carries no explicit rateStatus (a same-save finalize wins), AND
 * - at least one genuinely new vendor+amount pair arrived (edits/removals
 *   don't notify).
 * Returns true when any late quote was noted (caller keeps rateStatus
 * `finalized` — no auto-reopen).
 */
export function applyLateQuoteReopen(
  updates: any,
  ctx: { storedItems: any[]; storedRateStatus: string; actedBy: FlagThreadBy },
): boolean {
  if (ctx.storedRateStatus !== 'finalized') return false;
  if ((updates as any).rateStatus !== undefined) return false;
  const items = (updates as any).items;
  if (!Array.isArray(items)) return false;
  let noted = false;
  (updates as any).items = items.map((it: any, idx: number) => {
    const stored = ctx.storedItems[idx] ?? {};
    if (stored.finalRate === undefined || stored.finalRate === null) return it;
    const oldRates = Array.isArray(stored.rates) ? stored.rates : [];
    const newRates = Array.isArray(it?.rates) ? it.rates : [];
    const added = newRates.filter(
      (r: any) =>
        r &&
        String(r.vendor ?? '').trim() &&
        !oldRates.some((o: any) => String(o.vendor) === String(r.vendor) && Number(o.rate) === Number(r.rate)),
    );
    if (added.length === 0) return it;
    noted = true;
    const thread = Array.isArray((it as any).thread) ? [...(it as any).thread] : [];
    thread.push({
      by: ctx.actedBy,
      kind: 'quoted',
      text: `Late vendor quote (${added.map((r: any) => String(r.vendor)).join(', ')}) — previous rate kept for sales`,
      at: new Date().toISOString(),
    });
    return { ...it, thread: thread.slice(-50) };
  });
  return noted;
}

/**
 * Submit-to-Management lifecycle (enquiry-level handoff flag):
 * - sales (plain) writers can never touch it — follows stored;
 * - procurement (restricted) may stamp it (submit) but never clear it;
 * - management (privileged) may stamp or clear it.
 * Plus: a fresh management rates-request reopens the enquiry for
 * procurement, and a management item save with every loop item decided
 * auto-flips to rates-ready (finalizedAt stamped for items lacking it).
 */
export function applyRateLifecycles(updates: any, ctx: RateWriteCtx): void {
  const { storedForItems, storedItems, privileged, restricted } = ctx;
  if ((updates as any).procurementSubmittedAt !== undefined) {
    if (!privileged && !restricted) {
      if (storedForItems) (updates as any).procurementSubmittedAt = String((storedForItems as any).procurementSubmittedAt ?? '');
      else delete (updates as any).procurementSubmittedAt;
    } else if (restricted) {
      const v = String((updates as any).procurementSubmittedAt ?? '');
      if (!v && storedForItems) (updates as any).procurementSubmittedAt = String((storedForItems as any).procurementSubmittedAt ?? '');
    }
    // Privileged value stands as sent (stamp or clear).
  }
  // A fresh management rates-request reopens the enquiry for procurement:
  // the handoff clears so both queues gate it back until re-submit.
  if (privileged && Array.isArray((updates as any).items)) {
    const reopens = ((updates as any).items as any[]).some((it: any, idx: number) =>
      it?.ratesRequested && !(storedItems[idx]?.ratesRequested));
    if (reopens) (updates as any).procurementSubmittedAt = '';
  }
  // Auto-advance: an item save that leaves every loop item with a final
  // rate flips the enquiry to rates-ready on its own — no manual Finalize
  // press needed. Previously privileged-only, but a sales `rateAvailable`
  // toggle that clears the last actionable item must also advance so
  // `Mark as sent` enables immediately (flag→available case). `hasBlockingFlag`
  // keeps a pure flagged item blocking; flagged+available is not blocking.
  // finalizedAt is stamped for items that lack it, mirroring an explicit finalize.
  if ((updates as any).rateStatus === undefined && Array.isArray((updates as any).items)) {
    const merged = (updates as any).items as any[];
    // `rateAvailable` is a sales-owned availability bypass — a procurement-
    // flagged (`specIssue`) item that is also marked available no longer
    // blocks the loop. Pure flagged items (no availability) still block.
    const hasBlockingFlag = merged.some((it) => it?.specIssue && !it?.rateAvailable);
    const curStatus = String((storedForItems as any)?.rateStatus ?? '');
    if (hasBlockingFlag) {
      // Procurement hold persists — do not auto-finalize while a non-
      // available flagged item exists. Toggling `rateAvailable` off again
      // restores this block (specIssue is restored in normalizeItemWrites).
      // If the enquiry was previously finalized via the available bypass,
      // toggling off must revert so `sent` disables and the procurement
      // queue regains the item.
      if (curStatus === 'finalized') {
        (updates as any).rateStatus = 'rates_received';
      }
    } else {
      const loop = merged.filter((it) => !it?.specIssue && !it?.rateAvailable && !it?.internalRates);
      const done = loop.filter((it) =>
        it?.finalRate !== undefined && it?.finalRate !== null && Number.isFinite(Number(it?.finalRate)));
      // Empty loop means every item is either rate-available, internal, or
      // flagged+available — nothing left to decide, so the enquiry is
      // considered decided (previous `loop.length > 0` guard blocked this and
      // kept `sent` disabled after a flag→available toggle).
      const loopDone = loop.length === 0 ? merged.length > 0 : done.length === loop.length;
      if (loopDone) {
        if (curStatus === '' || curStatus === 'rate_pending' || curStatus === 'rates_received') {
          const nowIso = new Date().toISOString();
          (updates as any).items = merged.map((it) =>
            (!it?.specIssue && !it?.rateAvailable && !it?.internalRates
              && it?.finalRate !== undefined && it?.finalRate !== null && !it?.finalizedAt)
              ? { ...it, finalizedAt: nowIso }
              : it);
          (updates as any).rateStatus = 'finalized';
        }
      } else if (curStatus === 'finalized') {
        // Loop now has undecided actionable items (e.g. available→unavailable
        // toggle) — revert so management must decide again and `sent` disables.
        (updates as any).rateStatus = 'rates_received';
      }
    }
  }
}
