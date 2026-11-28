// parse helpers for HR-owned lookup lists (document types, expense
// categories, asset types). Controller writes only; no DB imports.
import { HrError } from "./errors";

export const LOOKUP_KINDS = ["document-types", "expense-categories", "asset-types"] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];

export function isLookupKind(value: unknown): value is LookupKind {
  return LOOKUP_KINDS.includes(String(value) as LookupKind);
}

export function lookupNameKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

export function lookupName(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = text(value, max);
  return s || null;
}

function integer(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(9999, Math.round(n))) : fallback;
}

function boolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === true || value === "true" || value === 1 || value === "1";
}

export interface LookupCreate {
  name: string;
  nameKey: string;
  order: number;
  active: boolean;
  description?: string | null;
  required?: boolean;
  defaultSpecs?: string | null;
}

export function cleanLookupCreate(kind: LookupKind, input: Record<string, any>): LookupCreate {
  const name = lookupName(input.name);
  if (!name) throw new HrError("name is required");
  const out: LookupCreate = {
    name,
    nameKey: lookupNameKey(name),
    order: integer(input.order, 0),
    active: boolean(input.active, true),
  };
  if (kind === "document-types") {
    out.description = optionalText(input.description, 300);
    out.required = boolean(input.required, false);
  } else if (kind === "asset-types") {
    out.defaultSpecs = optionalText(input.defaultSpecs, 300);
  }
  return out;
}

/**
 * DELETE semantics for one controller list item. A document requirement is
 * deleted for real (HR retires the checklist item), but never while an
 * employee file is filed under it — remove the file first (founder rule
 * 2026-11-28). Expense categories and asset types keep archiving so expenses
 * and issued assets retain their history.
 */
export function lookupDeletionPlan(kind: LookupKind, filedCount: number): { archival: boolean } {
  if (kind !== "document-types") return { archival: true };
  const filed = Math.max(0, Math.round(Number(filedCount) || 0));
  if (filed) {
    throw new HrError(
      filed === 1
        ? "1 employee document is filed under this type — remove it before deleting the requirement"
        : `${filed} employee documents are filed under this type — remove them before deleting the requirement`,
      409,
    );
  }
  return { archival: false };
}

export function cleanLookupPatch(kind: LookupKind, input: Record<string, any>): Partial<LookupCreate> {
  const out: Partial<LookupCreate> = {};
  if (input.name !== undefined) {
    const name = lookupName(input.name);
    if (!name) throw new HrError("name cannot be empty");
    out.name = name;
    out.nameKey = lookupNameKey(name);
  }
  if (input.order !== undefined) out.order = integer(input.order, 0);
  if (input.active !== undefined) out.active = boolean(input.active, true);
  if (kind === "document-types") {
    if (input.description !== undefined) out.description = optionalText(input.description, 300);
    if (input.required !== undefined) out.required = boolean(input.required, false);
  } else if (kind === "asset-types" && input.defaultSpecs !== undefined) {
    out.defaultSpecs = optionalText(input.defaultSpecs, 300);
  }
  if (Object.keys(out).length === 0) throw new HrError("nothing to update");
  return out;
}
