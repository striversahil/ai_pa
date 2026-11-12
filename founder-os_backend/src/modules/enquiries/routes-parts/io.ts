// Extracted verbatim from routes.ts by scripts/refactor/split-module.mjs.
// routes.ts re-exports everything public here, so existing imports keep working.
import { normalizeEnquirySource, nextDailyNo, enquiryLabelText } from "../types";
import type { EnquiryStore } from "../types";
import type { MeResponse } from "../../auth/types";
import { validateRatesInput, summarizeEnquiry, canManageRates, stripMarginFields, canSeeProcurementRequests, isRestrictedViewer } from "../scopes";
import { isFieldStaffSource, resolveFieldStaff } from "../attribution";
import { normalizeQty, parseItemMedia, parseItemRates } from "../parse";
import { linkEnquiryEstimate } from "../../../automations/telecalling/service";
import { LiveEvent } from "../../../live";
import { cacheGet } from "../../../shared/cache";
import type { EnquiryResult } from "./types";
import { json } from "./pure";

export async function enquiryCreate(store: EnquiryStore, me: MeResponse, body: any): Promise<EnquiryResult> {
  // EST No. is OPTIONAL (enter now or later) — only the row itself is created;
  // LLM auto-fill covers the structured fields, so everything is optional.
  const estNumber = String(body?.estNumber ?? "").trim();
  // Vendor quotes with junk amounts are rejected with a message — never
  // silently dropped (the old filter made quotes "save" then vanish).
  const rateError = validateRatesInput(body?.items);
  if (rateError) return json(400, { error: rateError });
  // Lead of = the agent who created the enquiry (no AI guessing). The
  // worker/express route pre-resolves the creator's roster row (login email,
  // then display name); a provided agent still wins (e.g. root assigning).
  // No roster match = unassigned ("") — never the auth-session id, which
  // belongs to a different id space and could resolve to the wrong person.
  const creatorAgentId = String(body.assignedAgentId || "");
  const source = normalizeEnquirySource(body.source);
  // Field Staff referral (attribution.ts): the enquiry belongs to the picked
  // FIELD STAFF — Lead By, 20% generator credit and Estimate.region all derive
  // from them. The sales agent who typed it is kept as loggedByAgentId (audit).
  let assignedAgentId = creatorAgentId;
  let fieldStaffId = "";
  let loggedByAgentId = "";
  if (isFieldStaffSource(source)) {
    const resolved = await resolveFieldStaff(store, body.fieldStaffId);
    if (!resolved.ok) return json(400, { error: resolved.error });
    fieldStaffId = resolved.row.id;
    assignedAgentId = resolved.row.id;
    loggedByAgentId = creatorAgentId;
  }
  // Daily enquiry number: atomic Setting counter, resets every IST day
  // (concurrent creates can never share a number — the old max+1 scan raced).
  // Root test enquiries skip the sequence (founder rule): Enquiry No is for
  // sales staff only, and root never takes the By. Null renders as "–" in
  // the shared label, so test rows stay visibly distinct. Sales numbering
  // is untouched — the counter only advances on sales creates.
  const now = new Date();
  const dailyNo = me.isRoot
    ? null
    : await store.allocateDailyNo(now).catch(() => nextDailyNo([], now));
  // No Title field in the form: a blank title becomes the enquiry number text.
  const title = String(body?.title ?? "").trim()
    || enquiryLabelText(dailyNo, now.toISOString(), source);
  const enquiry = await store.createEnquiry({
    estNumber,
    dailyNo,
    source,
    enquiryNumber: String(body?.enquiryNumber ?? ""),
    sourceLead: String(body?.sourceLead ?? ""),
    location: String(body?.location ?? ""),
    clientCompany: String(body?.clientCompany ?? ""),
    contactName: String(body?.contactName ?? ""),
    contactEmail: String(body?.contactEmail ?? ""),
    contactPhone: String(body?.contactPhone ?? ""),
    title,
    description: String(body?.description ?? ""),
    priority: String(body?.priority ?? "medium"),
    status: String(body?.status ?? "new"),
    assignedAgentId,
    fieldStaffId,
    loggedByAgentId,
    rateStatus: 'rate_pending',
    procurementSubmittedAt: "",
    sentRevisionAt: "",
    organizationId: "",
    imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls : [],
    activities: Array.isArray(body.activities) ? body.activities : [],
    additionalRequirements: (Array.isArray(body.additionalRequirements) ? body.additionalRequirements : [])
      .map((r: any) => (typeof r === "string" ? { text: r } : { text: String(r?.text ?? ""), imageUrl: r?.imageUrl || undefined }))
      .filter((r: any) => r.text.trim().length > 0),
    items: (Array.isArray(body.items) ? body.items : [])
      .map((r: any) => ({
        name: String(r?.name ?? '').slice(0, 300),
        qty: normalizeQty(r?.qty).slice(0, 120),
        spec: String(r?.spec ?? '').slice(0, 2000),
        media: parseItemMedia(r?.media),
        rates: parseItemRates(r?.rates),
        rateAvailable: r?.rateAvailable === true,
      }))
      .filter((r: any) => String(r.name ?? '').trim() || String(r.qty ?? '').trim() || String(r.spec ?? '').trim() || r.media.length > 0 || (r.rates ?? []).length > 0)
      .slice(0, 100),
    });
  const created = enquiry as any;
  if ((created.items ?? []).some((it: any) => (it.rates ?? []).length > 0)) {
    await store.updateEnquiry(created.id, { rateStatus: 'rates_received' } as any);
    created.rateStatus = 'rates_received';
  }
  // Org tagging (server-resolved, never client-writable): a unique Zoho match
  // auto-tags the enquiry; ambiguous/not-yet-synced numbers stay '' and
  // resolve at Check & Assign time (agent picks the org).
  let createdOrg = '';
  if (estNumber) {
    try {
      const { resolveEnquiryOrg } = await import('../estimate-link');
      createdOrg = await resolveEnquiryOrg(estNumber);
      if (createdOrg) {
        await store.updateEnquiry(created.id, { organizationId: createdOrg } as any).catch(() => null);
        created.organizationId = createdOrg;
      }
    } catch { /* fail-open */ }
  }
  // Enquiry-linked estimate attribution: a Zoho estimate number on the row
  // assigns that estimate to this enquiry's agent when it is free (never
  // steals, never fails the save — a not-yet-synced estimate is picked up by
  // the daily sweep in runLeadConversion).
  if (estNumber && assignedAgentId) {
    await linkEnquiryEstimate({
      estimateNumber: estNumber,
      agentId: assignedAgentId,
      label: `enquiry ${String(created.enquiryNumber ?? created.id)}`,
      organizationId: createdOrg,
    }).catch(() => undefined);
  }
  // Scope-safe broadcast: a summary only (counts + label parts) — never the
  // full row, which carries client PII to every connected screen.
  const summary = summarizeEnquiry(created);
  // Enquiry → Estimate creator sync: Lead of (Estimate.createdBy) is mapped
  // ENTIRELY from the enquiry agent (Enquiry.estNumber = Estimate.estimateNumber).
  // Overwrites always; fail-open so an enquiry save never fails on it.
  if (estNumber && assignedAgentId) {
    try {
      const { syncEstimateCreatorFromEnquiry } = await import('../estimate-link');
      // Pin the org: on a BUI/DPG number clash the creator must land on the
      // enquiry's own org row, never the other org's duplicate.
      await syncEstimateCreatorFromEnquiry(estNumber, assignedAgentId, createdOrg);
    } catch { /* fail-open */ }
  }
  const body_ = canManageRates(me) ? enquiry : stripMarginFields(enquiry as any, { hideRequests: !canSeeProcurementRequests(me) });
  return {
    status: 201,
    body: body_,
    live: { type: LiveEvent.Enquiries, extra: { action: "created", id: created.id, summary } },
  };
}

/** Intake panel (unstructured intake → items + price-memory suggestions).
 *  Stored by the GH intake runner at `enquiry:intake:<id>` (7d TTL).
 *  Restricted (procurement) viewers get names/routes/missing only — final
 *  rates stay out of their payload, same margin policy as stripMarginFields. */
export async function enquiryIntake(me: MeResponse, enquiryId: string): Promise<EnquiryResult> {
  let raw: unknown = null;
  try {
    raw = await cacheGet<Record<string, any>>(`enquiry:intake:${enquiryId}`, 7 * 24 * 60 * 60 * 1000);
  } catch { raw = null; }
  if (!raw || typeof raw !== 'object') return json(200, { ready: false });
  const restricted = isRestrictedViewer(me);
  const suggestions = (Array.isArray((raw as any).suggestions) ? (raw as any).suggestions : []).map((s: any) => {
    const base: Record<string, unknown> = {
      itemIndex: s?.itemIndex, memoryId: s?.memoryId, score: s?.score, name: s?.name, route: s?.route,
    };
    if (!restricted && s?.finalRate !== undefined) base.finalRate = s.finalRate;
    return base;
  });
  return json(200, {
    ready: true,
    at: (raw as any).at ?? null,
    suggestions,
    missing: Array.isArray((raw as any).missing) ? (raw as any).missing : [],
    candidates: restricted ? [] : (Array.isArray((raw as any).candidates) ? (raw as any).candidates : []),
  });
}
