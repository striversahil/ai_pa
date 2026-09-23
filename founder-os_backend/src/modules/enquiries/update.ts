// update.ts — enquiryUpdate lifecycles, extracted verbatim from routes.ts.
// One concern per helper; routes.ts orchestrates (flags → helpers → store).
// No behavior change: same branches, same order, same writes.
import {
  parseItemMedia,
  parseItemRates,
  parseFlagThread,
  numOrUndefined,
} from "./parse";
import type {
  FlagThreadBy,
  FlagThreadEntry,
} from "./types";

export interface ItemWriteCtx {
  storedItems: any[];
  privileged: boolean;
  restricted: boolean;
  actingProcurement: boolean;
  surface?: string;
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
      base.selectedRateIdx = stored.selectedRateIdx;
      base.markup = stored.markup;
      base.finalRate = stored.finalRate;
      base.finalDiscountPercent = stored.finalDiscountPercent;
      base.finalizedAt = stored.finalizedAt;
      // Sales-visibility of alternate quotes is Management-only (like the
      // negotiation target above): echoing writers follow the stored flags,
      // matched by vendor+rate identity so reordered rows keep them. A
      // procurement amount correction drops the share — management re-shares
      // the new number explicitly.
      const storedRateByKey = new Map(
        (Array.isArray(stored.rates) ? stored.rates : []).map((r: any) => [
          `${String(r?.vendor ?? '')}|${Number(r?.rate)}`,
          r,
        ]),
      );
      if (Array.isArray(base.rates)) {
        base.rates = base.rates.map((r: any) => {
          const stored = storedRateByKey.get(`${String(r?.vendor ?? '')}|${Number(r?.rate)}`);
          // A per-quote final is meaningless without its share flag — drop
          // both together so sales never shows a stale alternate price.
          if (!stored || (stored as any)?.sharedWithSales !== true) {
            const out = { ...r };
            delete (out as any).sharedWithSales;
            delete (out as any).sharedFinalRate;
            return out;
          }
          const v = Number((stored as any)?.sharedFinalRate);
          return { ...r, sharedWithSales: true, sharedFinalRate: Number.isFinite(v) && v >= 0 ? v : undefined };
        });
      }
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
      // Expected price is sales-owned (client target): procurement sees it
      // as the negotiation target but follows the stored value, like
      // availability above.
      base.expectedRate = numOrUndefined(stored.expectedRate);
      base.expectedNote = stored.expectedNote ? String(stored.expectedNote).slice(0, 500) : undefined;
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
      // A fresh/edited rate (not a pure removal) OR new item media (reference
      // picture) answers sales' merged variation/reference request the same way.
      // Anything else keeps the pending request (and its text+media) exactly as stored.
      const storedVar = String(stored.variationRequest ?? "").trim();
      const storedVarMedia = parseItemMedia((stored as any).variationRequestMedia ?? []);
      const ratesGrew = (base.rates ?? []).length >= (stored.rates ?? []).length;
      const baseMedia = parseItemMedia(base.media ?? []);
      const storedMedia2 = parseItemMedia(stored.media ?? []);
      const storedMediaKeys = new Set(storedMedia2.map((m: any) => `${m.type}:${m.url}`));
      const mediaAdded = baseMedia.some((m: any) => !storedMediaKeys.has(`${m.type}:${m.url}`));
      if (storedVar && ((ratesChanged && ratesGrew) || mediaAdded)) {
        base.variationRequest = undefined;
        base.variationRequestedAt = undefined;
        (base as any).variationRequestMedia = undefined;
      } else {
        base.variationRequest = stored.variationRequest;
        base.variationRequestedAt = stored.variationRequestedAt;
        (base as any).variationRequestMedia = storedVar ? parseItemMedia((stored as any).variationRequestMedia ?? []) : undefined;
        if (!storedVar) (base as any).variationRequestMedia = undefined;
      }
    }
    // Management rate-request lifecycle: only privileged writers may set
    // it. Plain sales writers follow the stored value so a stale edit can
    // never forge or wipe an active request; procurement clears it by
    // changing rates (handled in the restricted branch above).
    // withdrewRequest tracks an explicit privileged withdraw ("") so the
    // loop trail below stamps it correctly (declared here — used below).
    // clearedRound tracks a fresh request round that wiped the previous
    // vendor quotes for a clean re-quote (declared here — trailed below).
    let withdrewRequest = false;
    let clearedRound = false;
    // Drop the previous quoting round for a clean re-quote: old vendor rates
    // go, and the old decision linkage with them (unlink). Trailed below.
    // Only fires when something actually exists to clear (no-op saves stay
    // silent) — and only on FRESH requests, so unrelated edits echoing the
    // stored text can never wipe quotes.
    const clearQuotingRound = () => {
      const hadRates = Array.isArray(base.rates) && base.rates.length > 0;
      const hadDecision = base.selectedVendor !== undefined || base.markup !== undefined
        || base.finalRate !== undefined || base.finalDiscountPercent !== undefined
        || base.finalizedAt !== undefined || (base as any).selectedRateIdx !== undefined;
      if (!hadRates && !hadDecision) return;
      base.rates = [];
      base.selectedVendor = undefined;
      (base as any).selectedRateIdx = undefined;
      base.markup = undefined;
      base.finalRate = undefined;
      base.finalDiscountPercent = undefined;
      base.finalizedAt = undefined;
      clearedRound = true;
    };
    if (!privileged && !restricted) {
      base.ratesRequested = stored.ratesRequested;
      base.ratesRequestedAt = stored.ratesRequestedAt;
      base.internalRates = stored.internalRates === true;
      base.internalRatesAt = stored.internalRatesAt ?? undefined;
    } else {
      // Explicit "" from a privileged writer withdraws an unanswered request
      // (pick() preserves it; absent still means "leave stored"). Remember
      // the withdraw so the loop trail below stamps it as withdrawn, not as
      // answered-by-quotes.
      if (privileged && (base as any).ratesRequested === "") {
        withdrewRequest = true;
        base.ratesRequested = undefined;
        base.ratesRequestedAt = undefined;
      }
      // Submitted value stands (privileged set it, or the restricted
      // branch above already resolved it) — but a concurrent rate change
      // answers the request, so drop it.
      const ratesChanged = JSON.stringify(parseItemRates(base.rates ?? [])) !== JSON.stringify(parseItemRates(stored.rates ?? []));
      if (ratesChanged) {
        base.ratesRequested = undefined;
        base.ratesRequestedAt = undefined;
      }
      // A fresh management request starts a new quoting round on top of the
      // reopen: previous vendor rates are removed so procurement re-quotes
      // clean (the request text says what is wrong / which vendor is needed).
      if (privileged && base.ratesRequested && !stored.ratesRequested) {
        clearQuotingRound();
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
    // Not available: procurement requests (notAvailableRequested), management approves (notAvailable + shared text) → sales sees notAvailable
    if (privileged) {
      const hasNotAvailable = Object.prototype.hasOwnProperty.call(it as any, 'notAvailable');
      if (hasNotAvailable) {
        const want = (base as any).notAvailable === true;
        if (want) {
          (base as any).notAvailable = true;
          const r = typeof (base as any).notAvailableReason === 'string' ? String((base as any).notAvailableReason).trim().slice(0, 500) : '';
          (base as any).notAvailableReason = r || undefined;
          // Approving clears the procurement request
          (base as any).notAvailableRequested = undefined;
          (base as any).notAvailableRequestedAt = undefined;
        } else {
          (base as any).notAvailable = undefined;
          (base as any).notAvailableReason = undefined;
          (base as any).notAvailableAt = undefined;
        }
      } else {
        (base as any).notAvailable = (stored as any).notAvailable === true ? true : undefined;
        (base as any).notAvailableReason = (stored as any).notAvailableReason ? String((stored as any).notAvailableReason).slice(0, 500) : undefined;
        (base as any).notAvailableAt = (stored as any).notAvailableAt;
      }
      const hasRequested = Object.prototype.hasOwnProperty.call(it as any, 'notAvailableRequested');
      if (hasRequested) {
        const req = typeof (it as any).notAvailableRequested === 'string' ? String((it as any).notAvailableRequested).trim().slice(0, 500) : '';
        if (req) {
          (base as any).notAvailableRequested = req;
        } else {
          (base as any).notAvailableRequested = undefined;
          (base as any).notAvailableRequestedAt = undefined;
        }
      } else {
        (base as any).notAvailableRequested = (stored as any).notAvailableRequested ? String((stored as any).notAvailableRequested).slice(0, 500) : undefined;
        (base as any).notAvailableRequestedAt = (stored as any).notAvailableRequestedAt;
      }
    } else if (restricted) {
      // Procurement can only request, never directly approve
      (base as any).notAvailable = (stored as any).notAvailable === true ? true : undefined;
      (base as any).notAvailableReason = (stored as any).notAvailableReason ? String((stored as any).notAvailableReason).slice(0, 500) : undefined;
      (base as any).notAvailableAt = (stored as any).notAvailableAt;
      // If procurement mistakenly sends notAvailable:true (old frontend), treat as requested
      if (Object.prototype.hasOwnProperty.call(it as any, 'notAvailable') && (it as any).notAvailable === true) {
        const r = typeof (it as any).notAvailableReason === 'string' ? String((it as any).notAvailableReason).trim().slice(0, 500) : (typeof (it as any).notAvailableRequested === 'string' ? String((it as any).notAvailableRequested).trim().slice(0, 500) : '');
        if (r || (it as any).notAvailable === true) {
          (base as any).notAvailableRequested = r || String((it as any).notAvailableRequested ?? "Not available").slice(0, 500) || "Not available";
        }
      }
      const hasRequested = Object.prototype.hasOwnProperty.call(it as any, 'notAvailableRequested');
      if (hasRequested) {
        const req = typeof (it as any).notAvailableRequested === 'string' ? String((it as any).notAvailableRequested).trim().slice(0, 500) : '';
        if (req) {
          (base as any).notAvailableRequested = req;
        } else {
          // Only clear if not being set via notAvailable above
          if (!Object.prototype.hasOwnProperty.call(it as any, 'notAvailable') || (it as any).notAvailable !== true) {
            (base as any).notAvailableRequested = undefined;
            (base as any).notAvailableRequestedAt = undefined;
          }
        }
      } else {
        // Preserve stored if not sending, unless we just set via notAvailable above
        if (!(base as any).notAvailableRequested) {
          (base as any).notAvailableRequested = (stored as any).notAvailableRequested ? String((stored as any).notAvailableRequested).slice(0, 500) : undefined;
          (base as any).notAvailableRequestedAt = (stored as any).notAvailableRequestedAt;
        }
      }
    } else {
      // Sales cannot touch either
      (base as any).notAvailable = (stored as any).notAvailable === true ? true : undefined;
      (base as any).notAvailableReason = (stored as any).notAvailableReason ? String((stored as any).notAvailableReason).slice(0, 500) : undefined;
      (base as any).notAvailableAt = (stored as any).notAvailableAt;
      (base as any).notAvailableRequested = (stored as any).notAvailableRequested ? String((stored as any).notAvailableRequested).slice(0, 500) : undefined;
      (base as any).notAvailableRequestedAt = (stored as any).notAvailableRequestedAt;
    }
    // Media merge for sales/management (non-restricted) — same append
    // semantics as procurement but allows explicit deletions: if incoming is
    // a strict non-empty subset of stored (user removed an image), respect
    // it; if incoming is empty while stored has data (stale read wiping a
    // recent reference), preserve stored; otherwise union stored + new.
    if (!restricted) {
      const storedList = parseItemMedia(stored.media ?? []);
      const incomingList = parseItemMedia(base.media ?? []);
      const storedSet = new Set(storedList.map((m: any) => `${m.type}:${m.url}`));
      const isSubset = incomingList.length > 0 && incomingList.length < storedList.length && incomingList.every((m: any) => storedSet.has(`${m.type}:${m.url}`));
      const isStaleEmpty = incomingList.length === 0 && storedList.length > 0;
      if (isSubset) {
        base.media = incomingList;
      } else if (isStaleEmpty) {
        base.media = storedList;
      } else {
        base.media = [...storedList, ...incomingList.filter((m: any) => !storedSet.has(`${m.type}:${m.url}`))];
      }
      if ((base.media as any[]).length === 0) delete (base as any).media;
    }
    // Spec-dispute lifecycle (all writers):
    // - a spec text change clears an open flag from any surface;
    // - fresh reference media clears it ONLY from a non-procurement surface
    //   (the sales-correction reshare path). Procurement attaching photos
    //   (vendor refs, site pics) must never resolve its own flag — the flag
    //   stays until sales fixes the spec;
    // - otherwise an open flag survives even if the write omits it;
    // - finalized items can't be newly flagged.
    // KYP grounding: preserve inferred category/item; completeness is
    // recomputed only by the AI intake (LLM spec-check). Manual edits keep
    // the stored grounding so the checklist stays visible until next intake.
    {
      const hasKyp = Object.prototype.hasOwnProperty.call(it as any, 'kypItem') || Object.prototype.hasOwnProperty.call(it as any, 'kypMissing') || Object.prototype.hasOwnProperty.call(it as any, 'kypComplete');
      if (hasKyp) {
        if ((it as any).kypItem !== undefined) (base as any).kypItem = String((it as any).kypItem).slice(0, 120) || undefined;
        if (Array.isArray((it as any).kypMissing)) (base as any).kypMissing = (it as any).kypMissing.slice(0, 25).map((s: any) => String(s).slice(0, 500));
        if (typeof (it as any).kypComplete === 'boolean') (base as any).kypComplete = (it as any).kypComplete;
        if ((it as any).category !== undefined) (base as any).category = String((it as any).category).slice(0, 120) || undefined;
      } else {
        (base as any).kypItem = (stored as any).kypItem;
        (base as any).kypMissing = (stored as any).kypMissing ? [...(stored as any).kypMissing] : undefined;
        (base as any).kypComplete = (stored as any).kypComplete;
        if ((stored as any).category && !(base as any).category) (base as any).category = (stored as any).category;
        if ((stored as any).kypItem && !(base as any).kypItem) (base as any).kypItem = (stored as any).kypItem;
      }
    }
    const hadFlag = !!stored.specIssue;
    const specChanged = String(base.spec ?? "") !== String(stored.spec ?? "");
    const mediaKey = (m: any): string => `${m?.type === 'video' ? 'video' : m?.type === 'pdf' ? 'pdf' : 'image'}:${String(m?.url ?? '')}`;
    const storedUrls = new Set(parseItemMedia(stored.media ?? []).map(mediaKey));
    const newMedia = parseItemMedia(base.media ?? []).filter((m: any) => !storedUrls.has(mediaKey(m)));
    const mediaAdded = newMedia.length > 0;
    // Sales remark on a flagged item also resolves it (permanent fix for
    // procurement not seeing the fix: sales wrote "Size 8 x 32" as a remark
    // but spec stayed "" so the flag never cleared). A fresh sales remark
    // now clears the hold and, if spec is still empty, promotes the remark
    // text into spec so procurement has the size without a second edit.
    const storedThreadForFix = parseFlagThread((stored as any)?.thread);
    const seenForFix = new Set(storedThreadForFix.map((e) => `${e.at}|${e.kind}|${e.text}`));
    const incomingRemarksForFix = parseFlagThread((it as any)?.thread).filter((e) => e.kind === 'remark');
    const freshSalesRemark = incomingRemarksForFix.find((e) => !seenForFix.has(`${e.at}|${e.kind}|${e.text}`) && (e.by === 'sales' || (!actingProcurement && !privileged)));
    const remarkFix = !!freshSalesRemark && hadFlag;
    if (remarkFix && !String(base.spec ?? "").trim()) {
      base.spec = String(freshSalesRemark.text).slice(0, 2000);
    }
    // Bilateral open thread: either side may flag, any spec/media/remark fix clears
    const fixed = specChanged || mediaAdded || remarkFix;
    if (stored.finalRate !== undefined && stored.finalRate !== null) {
      // Re-flag finalized from either side reopens for re-quote (bilateral)
      if (base.specIssue && !stored.specIssue) {
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
    // even when the writer holds MIS/admin). Surface-aware: a privileged
    // writer using the sales UI (surface=sales) must stamp as sales, not
    // management — fixes "Management Remark" when sales asks.
    const surface = String((ctx as any).surface ?? '').toLowerCase();
    const role: FlagThreadBy = surface === 'procurement' ? 'procurement'
      : surface === 'sales' ? 'sales'
      : surface === 'management' ? 'management'
      : actingProcurement ? 'procurement' : privileged ? 'management' : 'sales';
    const storedThread = parseFlagThread((stored as any)?.thread);
    const seen = new Set(storedThread.map((e) => `${e.at}|${e.kind}|${e.text}|${(e.media ?? []).map((m:any)=>m.url).join(',')}`));
    const trail: FlagThreadEntry[] = [...storedThread];
    for (const e of parseFlagThread((it as any)?.thread)) {
      if (e.kind !== 'remark') continue;
      const key = `${e.at}|${e.kind}|${e.text}|${(e.media ?? []).map((m:any)=>m.url).join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      trail.push({ by: e.by === role ? e.by : role, kind: 'remark', text: e.text, at: e.at, media: e.media?.length ? e.media : undefined });
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
        media: mediaAdded && newMedia.length ? newMedia : undefined,
      } as FlagThreadEntry);
    }
    if (reqSet) trail.push({ by: role, kind: 'request', text: String(base.ratesRequested).slice(0, 500), at: nowIso });
    if (reqCleared) {
      trail.push(withdrewRequest
        ? { by: role, kind: 'remark', text: 'Rate request withdrawn', at: nowIso }
        : { by: role, kind: 'quoted', text: 'New vendor rates added', at: nowIso });
    }
    // Fresh request round wiped the previous quotes above — say so plainly
    // in the trail so every desk sees why the old rates are gone.
    if (clearedRound) {
      trail.push({ by: role, kind: 'remark', text: 'Previous vendor quotes cleared — fresh round for the new request', at: nowIso });
    }
    // Sales merged variation/reference requests (non-blocking, per-item):
    // sales sets text + optional common attachment (example picture); procurement
    // fulfills with a new rate (alternate make) OR new item media (reference
    // picture) — text keeps pending until fulfilled. Merged so one banner covers
    // both "alternate make" and "need reference picture". Procurement reopen only
    // (hasPendingVariationWork), never management — not a price enquiry.
    // Unlike the old alternate path, we keep previous vendor rates/finalRate
    // intact so a reference request on a finalized item doesn't wipe the sales
    // price — procurement just attaches the reference.
    if (!privileged && !restricted) {
      const inVar = (it as any)?.variationRequest;
      const inVarMedia = parseItemMedia((it as any)?.variationRequestMedia ?? []);
      const stVar = String(stored.variationRequest ?? "");
      const stVarMedia = parseItemMedia((stored as any).variationRequestMedia ?? []);
      const text = typeof inVar === "string" ? inVar.trim().slice(0, 500) : "";
      const hasText = !!text;
      const hasMedia = inVarMedia.length > 0;
      const stText = stVar.trim();
      const stMediaKeys = new Set(stVarMedia.map((m: any) => `${m.type}:${m.url}`));
      const inMediaKeys = new Set(inVarMedia.map((m: any) => `${m.type}:${m.url}`));
      const mediaChanged = hasMedia && (inVarMedia.length !== stVarMedia.length || inVarMedia.some((m: any) => !stMediaKeys.has(`${m.type}:${m.url}`)));
      const textChanged = hasText && text !== stText;
      if (hasText) {
        base.variationRequest = text;
        (base as any).variationRequestMedia = inVarMedia.length ? inVarMedia : undefined;
        if (textChanged || mediaChanged) {
          base.variationRequestedAt = nowIso;
          // No quoting-round wipe for merged reference flow — keep rates/finalRate
          // so a "need reference picture" on a finalized item doesn't reset pricing.
          const mediaPart = hasMedia ? ` + ${inVarMedia.length} attachment(s)` : "";
          trail.push({ by: role, kind: 'remark', text: `Info/alternate requested: ${text}${mediaPart}`.slice(0, 500), at: nowIso });
        } else {
          base.variationRequestedAt = stored.variationRequestedAt ?? nowIso;
          if (stVarMedia.length) (base as any).variationRequestMedia = stVarMedia;
        }
      } else if (inVar === "" && stVar) {
        base.variationRequest = undefined;
        base.variationRequestedAt = undefined;
        (base as any).variationRequestMedia = undefined;
        trail.push({ by: role, kind: 'remark', text: 'Info/alternate request withdrawn', at: nowIso });
      } else {
        base.variationRequest = stored.variationRequest;
        base.variationRequestedAt = stored.variationRequestedAt;
        if (stVar) (base as any).variationRequestMedia = stVarMedia.length ? stVarMedia : undefined;
      }
    }
    // Procurement fulfilled the merged request with a fresh rate or new media
    // (reference) — trail it so sales sees the loop close. Sales' own withdraw
    // already trailed above and never takes this branch.
    if (!!String(stored.variationRequest ?? "").trim() && !(base as any).variationRequest && actingProcurement) {
      trail.push({ by: role, kind: 'quoted', text: 'Info/alternate fulfilled', at: nowIso });
    }
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
    // Not available lifecycle (procurement → management approval → sales)
    const notAvailableSet = !(stored as any)?.notAvailable && (base as any)?.notAvailable === true;
    const notAvailableCleared = !!(stored as any)?.notAvailable && !(base as any)?.notAvailable;
    if (notAvailableSet) {
      (base as any).notAvailableAt = nowIso;
      const reason = (base as any).notAvailableReason ? `: ${(base as any).notAvailableReason}` : '';
      trail.push({ by: role, kind: 'remark', text: `Marked as not available${reason}`.slice(0, 500), at: nowIso });
    }
    if (notAvailableCleared) {
      (base as any).notAvailableAt = undefined;
      (base as any).notAvailableReason = undefined;
      trail.push({ by: role, kind: 'remark', text: 'Not available cleared — back to queue', at: nowIso });
    }
    const notAvailableRequestedSet = !String((stored as any)?.notAvailableRequested ?? "").trim() && String((base as any)?.notAvailableRequested ?? "").trim();
    const notAvailableRequestedCleared = !!String((stored as any)?.notAvailableRequested ?? "").trim() && !String((base as any)?.notAvailableRequested ?? "").trim();
    if (notAvailableRequestedSet) {
      (base as any).notAvailableRequestedAt = nowIso;
      trail.push({ by: role, kind: 'request', text: `Not available requested: ${String((base as any).notAvailableRequested).slice(0, 500)}`, at: nowIso });
    }
    if (notAvailableRequestedCleared && !notAvailableSet) {
      (base as any).notAvailableRequestedAt = undefined;
      trail.push({ by: role, kind: 'remark', text: 'Not available request withdrawn/rejected', at: nowIso });
    }
    // Thread resolved lifecycle (either side can resolve/reopen per item) — always open unless resolved.
    const incomingResolved = (it as any)?.threadResolved;
    const storedResolved = !!(stored as any)?.threadResolved;
    if (incomingResolved === true && !storedResolved) {
      (base as any).threadResolved = true;
      (base as any).threadResolvedBy = role;
      (base as any).threadResolvedAt = nowIso;
      trail.push({ by: role, kind: 'remark', text: 'Thread resolved', at: nowIso });
    } else if (incomingResolved === false && storedResolved) {
      (base as any).threadResolved = undefined;
      (base as any).threadResolvedBy = undefined;
      (base as any).threadResolvedAt = undefined;
      trail.push({ by: role, kind: 'remark', text: 'Thread reopened', at: nowIso });
    } else {
      (base as any).threadResolved = (stored as any)?.threadResolved;
      (base as any).threadResolvedBy = (stored as any)?.threadResolvedBy;
      (base as any).threadResolvedAt = (stored as any)?.threadResolvedAt;
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
      kypItem: l?.kypItem ? String(l.kypItem).slice(0, 120) : undefined,
      kypMissing: Array.isArray(l?.kypMissing) ? l.kypMissing.slice(0, 25).map((s: any) => String(s).slice(0, 500)) : undefined,
      kypComplete: typeof l?.kypComplete === 'boolean' ? l.kypComplete : undefined,
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
  // Keep KYP grounding fresh when editing spec/qty on an existing item:
  // if the spec text changed, recompute kypMissing/kypComplete from the
  // stored required_attributes for that kypItem (best-effort, no LLM here;
  // the next AI re-intake will fully re-evaluate).
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
  // Sent/terminal: auto-resolve procurement flags (text stays in thread), conclude procurement
  if ((updates as any).rateStatus === 'sent' && Array.isArray((updates as any).items)) {
    const nowIso = new Date().toISOString();
    (updates as any).items = (updates as any).items.map((it: any) => {
      if (!it?.specIssue) return it;
      const thread = Array.isArray(it.thread) ? [...it.thread] : [];
      // keep flag text in thread (already there), resolve the hold
      thread.push({ by: privileged ? 'management' as const : 'sales' as const, kind: 'fix' as const, text: 'Resolved on sent', at: nowIso });
      const { specIssue, specFlaggedAt, ...rest } = it;
      return { ...rest, thread: thread.slice(-50), threadResolved: true, threadResolvedAt: nowIso, threadResolvedBy: privileged ? 'management' : 'sales' };
    });
    if (!String((updates as any).procurementSubmittedAt ?? '').trim() && !String((storedForItems as any)?.procurementSubmittedAt ?? '').trim()) {
      (updates as any).procurementSubmittedAt = nowIso;
    }
  }
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
  // keeps a pure flagged item blocking; flagged+available / flagged+notAvailable is not blocking.
  // finalizedAt is stamped for items that lack it, mirroring an explicit finalize.
  if ((updates as any).rateStatus === undefined && Array.isArray((updates as any).items)) {
    const merged = (updates as any).items as any[];
    // `rateAvailable` / `notAvailable` are bypasses — a procurement-
    // flagged (`specIssue`) item that is also marked available/notAvailable no longer
    // blocks the loop. Pure flagged items (no bypass) still block.
    const hasBlockingFlag = merged.some((it) => it?.specIssue && !it?.rateAvailable && !(it as any)?.notAvailable);
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
      const loop = merged.filter((it) => !it?.specIssue && !it?.rateAvailable && !(it as any)?.notAvailable && !it?.internalRates);
      const done = loop.filter((it) =>
        it?.finalRate !== undefined && it?.finalRate !== null && Number.isFinite(Number(it?.finalRate)));
      // Empty loop means every item is either rate-available / not-available, internal, or
      // flagged+bypass — nothing left to decide, so the enquiry is
      // considered decided (previous `loop.length > 0` guard blocked this and
      // kept `sent` disabled after a flag→available toggle).
      const loopDone = loop.length === 0 ? merged.length > 0 : done.length === loop.length;
      if (loopDone) {
        if (curStatus === '' || curStatus === 'rate_pending' || curStatus === 'rates_received') {
          const nowIso = new Date().toISOString();
          (updates as any).items = merged.map((it) =>
            (!it?.specIssue && !it?.rateAvailable && !(it as any)?.notAvailable && !it?.internalRates
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
