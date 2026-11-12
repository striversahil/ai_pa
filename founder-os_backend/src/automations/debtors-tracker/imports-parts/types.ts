// Extracted verbatim from imports.ts by scripts/refactor/split-module.mjs.
// imports.ts re-exports everything public here, so existing imports keep working.
import { INVOICE_EDITABLE_FIELDS } from "./pure";

export type UnmatchedIndex = Map<string, any[]>;

export type InvoiceEditableField = typeof INVOICE_EDITABLE_FIELDS[number];
