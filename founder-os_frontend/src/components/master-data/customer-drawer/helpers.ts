// Extracted verbatim from CustomerDrawer.tsx by scripts/refactor/split-module.mjs.
// CustomerDrawer.tsx re-exports everything public here, so existing imports keep working.
import type { MasterCustomerDetail, CustomerPatch } from "@/master-data/types";
import type { Draft } from "./types";

export const DRAFT_KEYS: Array<keyof Draft> = [
  "displayName", "companyName", "customerType", "typeTag", "contactPerson", "designation", "phones", "emails",
  "gstin", "pincode", "cityVerified", "billingAddress", "status", "notes", "region",
  "subArea", "state",
];

export const MANAGER_KEYS = new Set<keyof Draft>(["region", "subArea", "state"]);

export const REGIONS = ["R1", "R2", "R3", "R4"];

export function toDraft(c: MasterCustomerDetail): Draft {
  return {
    displayName: c.name,
    companyName: c.company,
    customerType: c.typeBase,
    typeTag: c.typeTag,
    contactPerson: c.contact,
    designation: c.designation,
    phones: c.phones.join("\n"),
    emails: c.emails.join("\n"),
    gstin: c.gstin,
    pincode: c.pincode,
    cityVerified: c.cityVerified,
    billingAddress: c.billingAddress,
    status: c.status,
    notes: c.notes,
    region: c.region,
    subArea: c.subArea,
    state: c.state,
  };
}

export function draftToPatch(draft: Draft, original: Draft, canManage: boolean): CustomerPatch {
  const patch: Record<string, unknown> = {};
  for (const key of DRAFT_KEYS) {
    if (draft[key] === original[key]) continue;
    if (MANAGER_KEYS.has(key) && !canManage) continue;
    if (key === "phones") {
      const list = draft.phones.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      patch.phones = list;
    } else if (key === "emails") {
      const list = draft.emails.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      patch.emails = list;
    } else {
      patch[key] = draft[key];
    }
  }
  return patch as CustomerPatch;
}
