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
    // Markup decisions + finalize (+ its timestamp) are Management-only.
    const { selectedVendor, markup, finalRate, finalizedAt, ...rest } = it;
    const base: any = privileged ? it : rest;
    if (!privileged) {
      // Non-management writers can never decide — but they must never WIPE
      // a decision either (e.g. a sales EST-No. edit echoing items back
      // silently cleared final rates). Stored decision fields always
      // survive their writes; only the privileged surface below may set
      // or clear them.
      base.selectedVendor = stored.selectedVendor;
      base.markup = stored.markup;
      base.finalRate = stored.finalRate;
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

export interface RateWriteCtx {
  storedForItems: any | null;
  storedItems: any[];
  privileged: boolean;
  restricted: boolean;
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
  // Auto-advance: a management item save that leaves every loop item
  // with a final rate flips the enquiry to rates-ready on its own — no
  // manual Finalize press needed. Only privileged (management) item writes
  // trigger this; other roles never carry decision fields. finalizedAt is
  // stamped for items that lack it, mirroring an explicit finalize.
  if (privileged && (updates as any).rateStatus === undefined && Array.isArray((updates as any).items)) {
    const merged = (updates as any).items as any[];
    const loop = merged.filter((it) => !it?.specIssue && !it?.rateAvailable);
    const done = loop.filter((it) =>
      it?.finalRate !== undefined && it?.finalRate !== null && Number.isFinite(Number(it?.finalRate)));
    if (loop.length > 0 && done.length === loop.length) {
      const cur = String((storedForItems as any)?.rateStatus ?? '');
      if (cur === '' || cur === 'rate_pending' || cur === 'rates_received') {
        const nowIso = new Date().toISOString();
        (updates as any).items = merged.map((it) =>
          (!it?.specIssue && !it?.rateAvailable
            && it?.finalRate !== undefined && it?.finalRate !== null && !it?.finalizedAt)
            ? { ...it, finalizedAt: nowIso }
            : it);
        (updates as any).rateStatus = 'finalized';
      }
    }
  }
}
