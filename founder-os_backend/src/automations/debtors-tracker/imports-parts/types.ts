// Extracted verbatim from imports.ts by scripts/refactor/split-module.mjs.
// imports.ts re-exports everything public here, so existing imports keep working.
import { INVOICE_EDITABLE_FIELDS } from "./pure";

export type UnmatchedIndex = Map<string, any[]>;

/**
 * A paste apply can run in bounded slices: the client sends the same text with
 * the returned `cursor` until `done`. Keeps MAX work per Worker invocation
 * constant no matter how many rows the sheet has (a 1,000-row paste used to be
 * one ~2,000-query invocation and got killed at the edge with a bare 503).
 */
export interface ImportOptions {
  /** 0-based row offset to start at. */
  cursor?: number;
  /** Rows to apply in this call (capped by IMPORT_ROWS_PER_CALL). */
  limit?: number;
}

/** Hard ceiling for one invocation; the route caps at the same value. */
export const IMPORT_ROWS_PER_CALL = 1500;

export type InvoiceEditableField = typeof INVOICE_EDITABLE_FIELDS[number];
