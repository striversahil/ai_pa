// Extracted verbatim from update.ts by scripts/refactor/split-module.mjs.
// update.ts re-exports everything public here, so existing imports keep working.
import { parseItemMedia, numOrUndefined, parseItemRates } from "../parse";
import { enquiryLabelText } from "../types";
import type { LoopParty, LoopRecord } from "../types";
import { applyLoopOps, auditNote, answerOpen, openLoops, migrateItemLoops } from "../loops";
import type { LoopWriter } from "../loops";
import type { ItemWriteCtx, RateWriteCtx } from "./types";

/**
 * Merge client item writes over stored rows by index.
 * - Non-management writers can never set or wipe decisions
 *   (selectedVendor/markup/finalRate/finalizedAt follow stored).
 * - Restricted (procurement) writers own rates + spec flags only: identity
 *   follows stored, media appends, availability pinned.
 * - Privileged rate requests reopen the procurement handoff without
 *   touching quotes or decisions (flagging never deletes); loop trail is
 *   server-authored (client remarks kept once each), capped at 50.
 * - Decided means done: a committed decision auto-resolves flags raised
 *   before the save (open spec/query/rates/ask records carried from stored
 *   are answered, never left stranding the row out of History).
 */
export function normalizeItemWrites(items: any[], ctx: ItemWriteCtx): any[] {
  const { storedItems, privileged, restricted, actingProcurement } = ctx;
  return (items as any[]).map((it: any, idx: number) => {
    const stored = storedItems[idx] ?? {};
    // Markup + discount decisions + finalize (+ its timestamp) are Management-only.
    const { selectedVendor, markup, finalRate, finalDiscountPercent, finalizedAt, ...rest } = it;
    const base: any = privileged ? it : rest;
    // ── Media: explicit removal trail (mirror of `removedRates`) ──────────
    // The stale-empty guard further down cannot tell "the user deleted the
    // last photo" from "a queue payload arrived with media stripped", so an
    // empty incoming list restores stored media — which made deleting the
    // only image on an item a silent no-op. Intentional removal therefore
    // travels in `removedMedia` ["type:url"], one marker per removal (twins
    // keep their sibling). Applied AFTER the merge so a stale echo of the
    // old row can never resurrect a deleted image. Procurement
    // (restricted) can never remove stored media, so its trail is ignored.
    const mediaRemoveQuota = new Map<string, number>();
    for (const raw of Array.isArray((it as any).removedMedia) ? (it as any).removedMedia : []) {
      const k = String(raw ?? '');
      if (k) mediaRemoveQuota.set(k, (mediaRemoveQuota.get(k) ?? 0) + 1);
    }
    delete (base as any).removedMedia;
    const applyMediaRemovals = (list: any[]): any[] => {
      if (mediaRemoveQuota.size === 0) return list;
      const used = new Map<string, number>();
      return list.filter((m: any) => {
        const k = `${m?.type === 'video' ? 'video' : m?.type === 'pdf' ? 'pdf' : 'image'}:${String(m?.url ?? '')}`;
        const quota = mediaRemoveQuota.get(k) ?? 0;
        const n = used.get(k) ?? 0;
        if (quota > n) {
          used.set(k, n + 1);
          return false;
        }
        return true;
      });
    };
    // ── Rates union (all roles, all loops) ─────────────────────────────────
    // Writes ADD, never delete by omission. Vendor quotes are money: a stale
    // snapshot save (old tab, pre-refresh panel, raced PATCH) must not
    // silently drop quotes another writer stored later. Stored-only quotes
    // are reinstated; incoming wins field-level on identity matches.
    // Deliberate removal travels ONLY in `removedRates` ["vendor|rate"]
    // (both rate-delete buttons send it); a filtered array alone removes
    // nothing. Reinstatements/deletions are trailed at the end of this
    // function (stash → lifecycle trail), giving every rescue an audit entry.
    // Identity matches the vendor|rate keys used below (exact, case-sensitive).
    const rateKey = (r: any) => `${String(r?.vendor ?? '')}|${Number(r?.rate)}`;
    if (Array.isArray(base.rates) || Array.isArray(stored.rates)) {
      const incomingRows = Array.isArray(base.rates) ? base.rates : [];
      const storedRows = Array.isArray(stored.rates) ? stored.rates : [];
      // Explicit removals, counted per key: one marker deletes one twin, so
      // deleting one of two identical quotes keeps the other.
      const removeQuota = new Map<string, number>();
      for (const raw of Array.isArray((it as any).removedRates) ? (it as any).removedRates : []) {
        const k = String(raw ?? '');
        if (k) removeQuota.set(k, (removeQuota.get(k) ?? 0) + 1);
      }
      // Greedy twin matching (not a Map — identical vendor|rate twins must
      // NOT collapse into one row and lose their descriptions/notes).
      const consumed = new Array(storedRows.length).fill(false);
      const merged: any[] = [];
      for (const r of incomingRows) {
        const k = rateKey(r);
        if (!k) continue;
        const si = storedRows.findIndex((s, j) => !consumed[j] && rateKey(s) === k);
        if (si >= 0) {
          consumed[si] = true;
          merged.push({ ...storedRows[si], ...r }); // incoming wins field-level
        } else {
          merged.push(r);
        }
      }
      const reinstated: any[] = [];
      let deleted = 0;
      const deletedCount = new Map<string, number>();
      storedRows.forEach((s, j) => {
        if (consumed[j]) return;
        const k = rateKey(s);
        const quota = removeQuota.get(k) ?? 0;
        const used = deletedCount.get(k) ?? 0;
        if (quota > used) {
          deletedCount.set(k, used + 1);
          deleted++;
          return; // explicitly deleted twin — the other twins survive
        }
        merged.push(s);
        reinstated.push(s);
      });
      base.rates = merged;
      delete (base as any).removedRates;
      // Trail note (stashed, stamped into the lifecycle trail at the end of
      // this function — pushing straight into base.thread here would die in
      // the remark-only merge below).
      if (reinstated.length > 0 || deleted > 0) {
        const bits: string[] = [];
        if (reinstated.length > 0) bits.push(`kept ${reinstated.length} stored quote(s) missing from this save (${reinstated.map((r: any) => String(r?.vendor ?? '')).join(', ')})`);
        if (deleted > 0) bits.push(`removed ${deleted} quote(s) by explicit request`);
        (base as any).ratesTrailNote = bits.join('; ').slice(0, 500);
      }
      // Dangling-selection guard: a stale save naming a vendor absent from
      // the unioned quotes keeps the stored selection (recoverable re-point,
      // not loss). An explicit empty selection still clears.
      if ((base as any).selectedVendor) {
        const names = new Set((base.rates as any[]).map((r: any) => String(r?.vendor ?? '')));
        if (!names.has(String((base as any).selectedVendor)) && stored.selectedVendor !== undefined
          && names.has(String(stored.selectedVendor))) {
          base.selectedVendor = stored.selectedVendor;
        }
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
    if (privileged) {
      // Decision-less privileged writes (e.g. any save from the redacted
      // procurement view, which strips decision fields) must never wipe a
      // stored decision by omission — deleting a vendor rate once dropped
      // the whole management decision and threw the item back to pending.
      // Stored fields are always preserved on omission: flagging procurement
      // (ratesRequested) is a pure signal and never clears quotes or
      // decisions, so a flag can never delete prior work.
      //
      // Same rule for reference media: queue payloads strip media BYTES for
      // size (modals fetch the open row whole), so a management-surface save
      // racing the modal's full-row fetch echoes items with empty media —
      // that omission must never wipe stored photos/drawings. Intentional
      // media removal lives only on the sales surface (ItemBoxList), which
      // always echoes full rows, so this branch can't break it. (Restricted
      // procurement writes already merge stored+incoming media above.)
      if ((!Array.isArray((base as any).media) || (base as any).media.length === 0)
        && Array.isArray((stored as any).media) && (stored as any).media.length > 0) {
        base.media = stored.media;
      }
      const incomingDecision = base.selectedVendor !== undefined || base.markup !== undefined
        || base.finalRate !== undefined || base.finalDiscountPercent !== undefined
        || base.finalizedAt !== undefined || (base as any).selectedRateIdx !== undefined;
      const storedDecision = stored.selectedVendor !== undefined || stored.markup !== undefined
        || stored.finalRate !== undefined || stored.finalDiscountPercent !== undefined
        || stored.finalizedAt !== undefined || (stored as any).selectedRateIdx !== undefined;
      if (!incomingDecision && storedDecision) {
        base.selectedVendor = stored.selectedVendor;
        (base as any).selectedRateIdx = (stored as any).selectedRateIdx;
        base.markup = stored.markup;
        base.finalRate = stored.finalRate;
        base.finalDiscountPercent = stored.finalDiscountPercent;
        base.finalizedAt = stored.finalizedAt;
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
      // Loop auto-answers that need the merged-rates diff are applied in the
      // loop pass at the end of this function (answerOpen on rates/query
      // records); this branch only pins non-loop fields.
    }
    if (!privileged && !restricted) {
      base.internalRates = stored.internalRates === true;
      base.internalRatesAt = stored.internalRatesAt ?? undefined;
    } else {
      // A fresh management request is a pure signal: quotes AND decisions
      // stay intact — flagging procurement never deletes prior work (a flag
      // once wiped the item's rates + decision, destroying quoted work).
      // Procurement's next rate edit answers the request in the loop pass.
      // Quotes arriving after a decision keep the committed rate
      // (applyLateQuoteReopen) and never reopen the queue (founder decision
      // 2026-11-12).
      // The handoff reopen lives in applyRateLifecycles below.
      void 0;
    }
    // Not available STATE (procurement requests via loop records, management
    // approves with notAvailable + shared text → sales sees notAvailable).
    // Request text lives in loop records (kind not_available); these branches
    // only pin the approve state per role. Open/answer/withdraw/reject flow
    // through loop intents in the loop pass below.
    // approveNA signals the loop pass to answer open not_available records.
    let approveNA = false;
    if (privileged) {
      const hasNotAvailable = Object.prototype.hasOwnProperty.call(it as any, 'notAvailable');
      if (hasNotAvailable) {
        const want = (base as any).notAvailable === true;
        if (want) {
          (base as any).notAvailable = true;
          const r = typeof (base as any).notAvailableReason === 'string' ? String((base as any).notAvailableReason).trim().slice(0, 500) : '';
          (base as any).notAvailableReason = r || undefined;
          approveNA = true;
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
    } else if (restricted) {
      // Procurement can only request, never directly approve
      (base as any).notAvailable = (stored as any).notAvailable === true ? true : undefined;
      (base as any).notAvailableReason = (stored as any).notAvailableReason ? String((stored as any).notAvailableReason).slice(0, 500) : undefined;
      (base as any).notAvailableAt = (stored as any).notAvailableAt;
    } else {
      // Sales cannot touch either
      (base as any).notAvailable = (stored as any).notAvailable === true ? true : undefined;
      (base as any).notAvailableReason = (stored as any).notAvailableReason ? String((stored as any).notAvailableReason).slice(0, 500) : undefined;
      (base as any).notAvailableAt = (stored as any).notAvailableAt;
    }
    // Media merge for sales/management (non-restricted) — same append
    // semantics as procurement but allows explicit deletions: if incoming is
    // a strict non-empty subset of stored (user removed an image), respect
    // it; if incoming is empty while stored has data (stale read wiping a
    // recent reference), preserve stored; otherwise union stored + new.
    // Explicit removals (`removedMedia`) are applied on top of the merge, so
    // deleting the LAST image (incoming empty, stored non-empty) works too.
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
      base.media = applyMediaRemovals(base.media as any[]);
      if ((base.media as any[]).length === 0) delete (base as any).media;
    }
    // ── Loop pass (deterministic records replace the old thread) ──────────
    // Writer desk (surface-aware, same derivation the old trail role used):
    // a privileged writer using the sales UI stamps as sales.
    const surface = String((ctx as any).surface ?? '').toLowerCase();
    const role: LoopParty = surface === 'procurement' ? 'procurement'
      : surface === 'sales' ? 'sales'
      : surface === 'management' ? 'management'
      : actingProcurement ? 'procurement' : privileged ? 'management' : 'sales';
    const nowIso = new Date().toISOString();
    const writer: LoopWriter = { privileged, restricted, actingProcurement, desk: role };
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
    // Explicit verbs + legacy bridge → records.
    let loops = applyLoopOps(stored, it, writer, nowIso);
    const note = (text: string, internal = false) => {
      loops = [...loops, auditNote(text, role, nowIso, internal)];
    };
    // Auto-answers from field changes.
    const specChanged = String(base.spec ?? "") !== String(stored.spec ?? "");
    const mediaKey = (m: any): string => `${m?.type === 'video' ? 'video' : m?.type === 'pdf' ? 'pdf' : 'image'}:${String(m?.url ?? '')}`;
    const storedUrls = new Set(parseItemMedia(stored.media ?? []).map(mediaKey));
    const newMedia = parseItemMedia(base.media ?? []).filter((m: any) => !storedUrls.has(mediaKey(m)));
    const mediaAdded = newMedia.length > 0;
    if (specChanged) {
      loops = answerOpen(loops, 'spec', 'Spec corrected', role, nowIso);
    } else if (mediaAdded && !actingProcurement) {
      // Fresh reference media from a non-procurement surface answers the
      // spec ask (sales-correction reshare path). Procurement attaching
      // photos (vendor refs, site pics) never resolves its own ask.
      loops = answerOpen(loops, 'spec', 'Reference attachments added', role, nowIso);
    }
    const ratesChanged = JSON.stringify(parseItemRates(base.rates ?? [])) !== JSON.stringify(parseItemRates(stored.rates ?? []));
    const ratesGrew = (base.rates ?? []).length >= (stored.rates ?? []).length;
    if (actingProcurement && ratesChanged && ratesGrew) {
      loops = answerOpen(loops, 'rates', 'New vendor rates added', role, nowIso);
      loops = answerOpen(loops, 'query', 'Info/alternate fulfilled', role, nowIso, 'procurement');
    }
    if (actingProcurement && mediaAdded) {
      loops = answerOpen(loops, 'query', 'Reference shared', role, nowIso, 'procurement');
    }
    // Re-flag on a decided item reopens for re-quote: a newly opened spec
    // record wipes the decision (same as the old re-flag rule).
    {
      const storedOpenSpec = openLoops({ loops: migrateItemLoops(stored) }, 'spec');
      const nowOpenSpec = openLoops({ loops }, 'spec');
      if (stored.finalRate !== undefined && stored.finalRate !== null
        && storedOpenSpec.length === 0 && nowOpenSpec.length > 0) {
        base.selectedVendor = undefined;
        (base as any).selectedRateIdx = undefined;
        base.markup = undefined;
        base.finalRate = undefined;
        base.finalDiscountPercent = undefined;
        base.finalizedAt = undefined;
      }
    }
    // Not-available approve answers the ask.
    if (approveNA) {
      const before = loops;
      loops = answerOpen(loops, 'not_available', `Marked as not available${(base as any).notAvailableReason ? `: ${(base as any).notAvailableReason}` : ''}`.slice(0, 500), 'management', nowIso);
      if (loops !== before) (base as any).notAvailableAt = nowIso;
      else if (!(base as any).notAvailableAt) (base as any).notAvailableAt = stored.notAvailableAt ?? nowIso;
    }
    // Decided means done (founder decision 2026-11-12): a committed decision
    // auto-resolves flags raised BEFORE this save. Open spec / query / rates /
    // not-available records carried over from stored are answered with an
    // audit entry instead of stranding the row out of History. Loops opened
    // IN this save keep fresh ids, so a just-raised flag is never eaten here
    // (and the re-flag rule above already wiped the decision for a fresh
    // spec ask, so this block is skipped for it).
    if (base.finalRate !== undefined && base.finalRate !== null) {
      const storedOpenIds = new Set(
        migrateItemLoops(stored)
          .filter((l) => l?.status === 'open')
          .map((l) => String(l?.id ?? '')),
      );
      if (storedOpenIds.size > 0) {
        const resolved: LoopRecord[] = loops.map((l) => {
          if (!l || l.status !== 'open' || !storedOpenIds.has(String(l?.id ?? ''))) return l;
          return {
            ...l,
            status: 'answered',
            answer: { text: 'Auto-resolved — decided', by: role, at: nowIso },
            closedAt: nowIso,
          };
        });
        if (resolved.some((l, i) => l !== loops[i])) loops = resolved;
      }
    }
    // Server-authored audit notes (visible, same as the old trail remarks).
    if (privileged) {
      const internalSet = !stored.internalRates && base.internalRates;
      const internalCleared = !!stored.internalRates && !base.internalRates;
      if (internalSet) {
        base.internalRatesAt = base.internalRatesAt || nowIso;
        note('Taken up internally by management');
      }
      if (internalCleared) {
        base.internalRatesAt = undefined;
        note('Returned to the procurement queue');
      }
    }
    if (!(stored as any)?.notAvailable && (base as any)?.notAvailable === true && !approveNA) {
      (base as any).notAvailableAt = nowIso;
    }
    if (!!(stored as any)?.notAvailable && !(base as any)?.notAvailable) {
      (base as any).notAvailableAt = undefined;
      (base as any).notAvailableReason = undefined;
      note('Not available cleared — back to queue');
    }
    // Direct final (management decided with no vendor quote — blank vendor):
    // stamp an audit entry so the bypass stays visible.
    if (privileged && base.finalRate !== undefined && base.finalRate !== null
      && !base.selectedVendor && ((base.rates ?? []).length === 0)) {
      const hadFinal = stored.finalRate !== undefined && stored.finalRate !== null;
      if (!hadFinal) {
        note('Direct final set without vendor quote');
      }
    }
    if ((base as any).ratesTrailNote) {
      note(String((base as any).ratesTrailNote).slice(0, 500), true);
      delete (base as any).ratesTrailNote;
    }
    // Persist records; drop every legacy loop field + intent marker (never
    // stored — verbs are validated anew on each save).
    base.loops = loops.slice(-100);
    delete (base as any).specIssue;
    delete (base as any).specFlaggedAt;
    delete (base as any).ratesRequested;
    delete (base as any).ratesRequestedAt;
    delete (base as any).variationRequest;
    delete (base as any).variationRequestMedia;
    delete (base as any).queryWith;
    delete (base as any).queryResolvedAt;
    delete (base as any).queryResolvedBy;
    delete (base as any).queryAnswer;
    delete (base as any).thread;
    delete (base as any).threadResolved;
    delete (base as any).threadResolvedBy;
    delete (base as any).threadResolvedAt;
    delete (base as any).notAvailableRequested;
    delete (base as any).notAvailableRequestedAt;
    delete (base as any).loopOpen;
    delete (base as any).loopAnswer;
    delete (base as any).loopForward;
    delete (base as any).loopWithdraw;
    delete (base as any).loopReject;
    return base;
  }).filter((it: any) => it !== null);
}

export const normIntakeLine = (s: unknown): string =>
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
  ctx: { storedItems: any[]; storedRateStatus: string; actedBy: LoopParty },
): boolean {
  if (ctx.storedRateStatus !== 'finalized') return false;
  if ((updates as any).rateStatus !== undefined) return false;
  const items = (updates as any).items;
  if (!Array.isArray(items)) return false;
  let noted = false;
  const nowIso = new Date().toISOString();
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
    const loops = Array.isArray((it as any)?.loops) ? [...(it as any).loops] : [];
    loops.push(auditNote(
      `Late vendor quote (${added.map((r: any) => String(r.vendor)).join(', ')}) — previous rate kept for sales`,
      ctx.actedBy, nowIso, true,
    ));
    return { ...it, loops: loops.slice(-100) };
  });
  return noted;
}

/**
 * Sent-revision lifecycle (revise flow):
 * - `reviseSent: true` (any authenticated writer — sales included) on a
 *   `sent` row unlocks it for additional scope: rateStatus → `finalized`,
 *   handoff cleared, `sentRevisionAt` stamped. While the marker is set, Zoho
 *   non-draft does NOT auto-promote/conclude, so new items loop procurement
 *   → management → sent again. Sales/additional-requirements on the unlocked
 *   row reopen it further via the normal finalized paths.
 * - Revisable means effectively-sent: stored `sent` OR Zoho non-draft with
 *   stored `finalized`. The worker derives `sent` for display from Zoho and
 *   promotes the DB fire-and-forget — the promotion can lag, so a Zoho-sent
 *   row may still store `finalized` while the UI (correctly) offers Reopen.
 *   Gating on stored `sent` alone rejects those rows ("Only sent enquiries
 *   can be revised"). The Zoho leg covers them.
 * - Safe to open beyond management: reopening grants NO approval power —
 *   every new item still needs procurement quoting + a management decision,
 *   and the completeness gate blocks re-sent until 100% decided.
 * - Any write carrying rateStatus `sent` clears the marker (new sent cycle).
 * - `reviseSent` is a verb, never stored — always deleted from updates.
 * Returns an error string when the request must be rejected, else null.
 */
export function applySentRevision(
  updates: any,
  ctx: { storedRateStatus: string; storedRevision?: string; storedZohoStatus?: string; privileged: boolean },
): string | null {
  if ((updates as any).rateStatus === 'sent') {
    (updates as any).sentRevisionAt = '';
  }
  if ((updates as any).reviseSent !== true) {
    delete (updates as any).reviseSent;
    return null;
  }
  delete (updates as any).reviseSent;
  void ctx.privileged;
  const storedSent = String(ctx.storedRateStatus ?? '') === 'sent';
  const zohoSent = !!String(ctx.storedZohoStatus ?? '').trim() && String(ctx.storedZohoStatus ?? '').trim().toLowerCase() !== 'draft';
  if (!storedSent && !zohoSent) return 'Only sent enquiries can be revised';
  const nowIso = new Date().toISOString();
  (updates as any).rateStatus = 'finalized';
  (updates as any).procurementSubmittedAt = '';
  (updates as any).sentRevisionAt = nowIso;
  return null;
}

/**
 * Submit-to-Management lifecycle (enquiry-level handoff flag):
 * - sales (plain) writers can never touch it — follows stored;
 * - procurement (restricted surface or `procurement` scope) may stamp it
 *   (submit) but never clear it;
 * - management (privileged) may stamp or clear it.
 * Plus: a fresh management rates-request reopens the enquiry for
 * procurement, and a management item save with every loop item decided
 * auto-flips to rates-ready (finalizedAt stamped for items lacking it).
 */
export function applyRateLifecycles(updates: any, ctx: RateWriteCtx): void {
  const { storedForItems, storedItems, privileged, restricted } = ctx;
  const canStamp = privileged || restricted || ctx.canConclude === true;
  // Sent/terminal: auto-answer open spec asks (hold released), conclude procurement
  if ((updates as any).rateStatus === 'sent' && Array.isArray((updates as any).items)) {
    const nowIso = new Date().toISOString();
    (updates as any).items = (updates as any).items.map((it: any) => {
      const loops = Array.isArray(it?.loops) ? it.loops : [];
      if (!loops.some((l: any) => l && l.status === 'open' && l.kind === 'spec')) return it;
      return { ...it, loops: answerOpen(loops, 'spec', 'Resolved on sent', privileged ? 'management' : 'sales', nowIso) };
    });
    if (!String((updates as any).procurementSubmittedAt ?? '').trim() && !String((storedForItems as any)?.procurementSubmittedAt ?? '').trim()) {
      (updates as any).procurementSubmittedAt = nowIso;
    }
  }
  if ((updates as any).procurementSubmittedAt !== undefined) {
    if (!canStamp) {
      if (storedForItems) (updates as any).procurementSubmittedAt = String((storedForItems as any).procurementSubmittedAt ?? '');
      else delete (updates as any).procurementSubmittedAt;
    } else if (!privileged) {
      const v = String((updates as any).procurementSubmittedAt ?? '');
      if (!v && storedForItems) (updates as any).procurementSubmittedAt = String((storedForItems as any).procurementSubmittedAt ?? '');
    }
    // Privileged value stands as sent (stamp or clear).
  }
  // A fresh management rates ask reopens the enquiry for procurement:
  // the handoff clears so both queues gate it back until re-submit.
  if (privileged && Array.isArray((updates as any).items)) {
    const reopens = ((updates as any).items as any[]).some((it: any, idx: number) =>
      openLoops(it, 'rates').length > 0 && openLoops({ loops: migrateItemLoops(storedItems[idx]) }, 'rates').length === 0);
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
    // `rateAvailable` / `notAvailable` are bypasses — an open procurement
    // spec ask on an item that is also marked available/notAvailable no longer
    // blocks the loop. Pure spec-held items still block — UNLESS management
    // already set a direct final on them (override decided, hold stays for
    // the audit trail but must not strand the enquiry).
    const openSpec = (it: any): boolean => openLoops(it, 'spec').length > 0;
    const hasBlockingFlag = merged.some((it) => openSpec(it) && !it?.rateAvailable && !(it as any)?.notAvailable
      && (it?.finalRate === undefined || it?.finalRate === null));
    const curStatus = String((storedForItems as any)?.rateStatus ?? '');
    if (hasBlockingFlag) {
      // Procurement hold persists — do not auto-finalize while a non-
      // available flagged item exists. Toggling `rateAvailable` off again
      // restores this block (open loops persist in normalizeItemWrites).
      // If the enquiry was previously finalized via the available bypass,
      // toggling off must revert so `sent` disables and the procurement
      // queue regains the item.
      if (curStatus === 'finalized') {
        (updates as any).rateStatus = 'rates_received';
      }
    } else {
      const loop = merged.filter((it) => !openSpec(it) && !it?.rateAvailable && !(it as any)?.notAvailable && !it?.internalRates);
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
            (!openSpec(it) && !it?.rateAvailable && !(it as any)?.notAvailable && !it?.internalRates
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

/** Completeness gate (all writers): 'finalized' / 'sent' are enquiry-level
 *  commitments, but decisions are per-item. Refuses to close an enquiry
 *  while any loop item (correct spec, rate not already available) still
 *  lacks a final rate — otherwise a partial finalize/sent looks complete
 *  to Sales and locks the Management panel (locked = finalized || sent)
 *  with undecided items stranded inside it. Returns the refusal message,
 *  or null when the transition is allowed. Moved verbatim from routes.ts
 *  enquiryUpdate (Phase-1 split). */
export function assertFinalizeGate(merged: any[], rateStatus: unknown): string | null {
  if (rateStatus !== 'finalized' && rateStatus !== 'sent') return null;
  // Every non-held item must have a decision — a direct final (finalRate
  // with no vendor quote, blank vendor) counts as decided, so unquoted /
  // flagged items with a final no longer refuse finalize/sent.
  const held = (it: any): boolean => openLoops({ loops: (it as any)?.loops }, 'spec').length > 0;
  const missingRates = merged.filter((it) => !held(it) && !it?.rateAvailable && !(it as any)?.notAvailable && !it?.internalRates && ((it as any)?.rates ?? []).length === 0
    && (it?.finalRate === undefined || it?.finalRate === null));
  if (missingRates.length > 0) {
    const verb = rateStatus === 'sent' ? 'mark as sent' : 'finalize';
    return `${missingRates.length} item${missingRates.length === 1 ? "" : "s"} still need vendor rates (or mark rate available / not available) before you ${verb}`;
  }
  const loop = merged.filter((it) => !held(it) && !it?.rateAvailable && !(it as any)?.notAvailable);
  const done = loop.filter((it) =>
    it?.finalRate !== undefined && it?.finalRate !== null && Number.isFinite(Number(it?.finalRate)));
  if (done.length < loop.length) {
    const verb = rateStatus === 'sent' ? 'mark as sent' : 'finalize';
    return `Only ${done.length} of ${loop.length} items have final rates — decide every item before you ${verb}`;
  }
  return null;
}

/** Source change retitles auto-titles: the title snapshots the label at
 *  creation (`Enquiry No 3 - 24 SEP TL`); when the source flips TL→AI an
 *  untouched auto-title follows it so the number reads AI. Custom titles
 *  (anything differing from the old auto-label) never rewrite. Mutates
 *  `updates` in place. Moved verbatim from routes.ts enquiryUpdate. */
export function retitleOnSourceChange(updates: any, storedForItems: any): void {
  const nextSource = (updates as any).source;
  if (typeof nextSource !== 'string' || !storedForItems) return;
  const oldSource = String((storedForItems as any)?.source ?? 'TL');
  if (nextSource === oldSource) return;
  const storedTitle = String((storedForItems as any)?.title ?? '').trim();
  const autoOld = enquiryLabelText(
    (storedForItems as any)?.dailyNo ?? null,
    String((storedForItems as any)?.createdAt ?? ''),
    oldSource,
  );
  if (!storedTitle || storedTitle === autoOld) {
    (updates as any).title = enquiryLabelText(
      (storedForItems as any)?.dailyNo ?? null,
      String((storedForItems as any)?.createdAt ?? ''),
      nextSource,
    );
  }
}
