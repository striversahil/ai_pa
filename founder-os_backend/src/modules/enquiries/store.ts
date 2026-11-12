// ── Enquiries store: persistence-agnostic sales pipeline storage ────────────
// Two implementations: D1 (Cloudflare Worker) and Prisma (Express/Postgres).
// The Worker build imports ONLY this file; the Prisma implementation lives in
// store-prisma.ts so the Prisma client never enters the Worker bundle.
//
// Slim orchestrator: domain types live in types.ts, pure parsers in parse.ts,
// queue predicates in queues.ts, authz in scopes.ts, redaction in
// redaction.ts. This file keeps ONLY row mapping + sanitize + the Memory/D1
// stores. Re-exports below preserve existing import paths (no caller changes).
import {
  ENQUIRY_SOURCES,
  normalizeEnquirySource,
  istDayKey,
  nextDailyNo,
  enquiryLabelText,
} from "./types";
import type {
  Enquiry,
  EnquiryActivity,
  EnquiryComment,
  EnquiryItem,
  EnquiryMedia,
  EnquiryItemRate,
  EnquiryRequirement,
  CommentVisibility,
  EnquiryStore,
} from "./types";
import { normalizeVisibility, isoOrUndefined, rateIdxOrUndefined, normalizeQty, parseItemMedia, parseItemRates, parseDiscountPercent, strictNum, numOrUndefined, parseItems, parseRequirements } from "./parse";
import { MemoryEnquiryStore } from "./store-parts/pure";
import { D1EnquiryStore } from "./store-parts/io";

// Pieces split into ./store-parts/ (importable on their own); re-exported for compat.
export { mapEnquiry, mapComment, sanitize } from "./store-parts/pure";

export {
  ENQUIRY_SOURCES,
  normalizeEnquirySource,
  istDayKey,
  nextDailyNo,
  enquiryLabelText,
  normalizeVisibility,
  isoOrUndefined,
  rateIdxOrUndefined,
  normalizeQty,
  parseItemMedia,
  parseItemRates,
  parseDiscountPercent,
  strictNum,
  numOrUndefined,
  parseItems,
  parseRequirements,
};

export type {
  Enquiry,
  EnquiryActivity,
  EnquiryComment,
  EnquiryItem,
  EnquiryMedia,
  EnquiryItemRate,
  EnquiryRequirement,
  CommentVisibility,
  EnquiryStore,
};

export { MAX_ITEM_MEDIA_URL_CHARS, MAX_ITEM_MEDIA_COUNT } from "./parse";

let cachedMemory: MemoryEnquiryStore | null = null;

export function createEnquiryStore(env: any): EnquiryStore {
  if (env && env.DB && typeof env.DB.prepare === "function") return new D1EnquiryStore(env.DB);
  if (env && env.__prismaEnquiryStore) return env.__prismaEnquiryStore as EnquiryStore;
  if (!cachedMemory) cachedMemory = new MemoryEnquiryStore();
  return cachedMemory;
}
