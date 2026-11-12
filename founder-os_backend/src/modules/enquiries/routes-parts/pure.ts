// Extracted verbatim from routes.ts by scripts/refactor/split-module.mjs.
// routes.ts re-exports everything public here, so existing imports keep working.
import type { EnquiryResult } from "./types";

export const json = (status: number, body: any): EnquiryResult => ({ status, body });

export const err = (message: string, status = 403): EnquiryResult => json(status, { error: message });
