// modules/org/io.ts — compat re-export (extract, never rewrite).
//
// Split into ./types.ts (shapes) · ./read.ts (the people read) · ./write.ts
// (the person save + backfill). Existing imports keep working.
export * from "./types";
export * from "./read";
export * from "./write";
