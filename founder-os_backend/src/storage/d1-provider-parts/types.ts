// Extracted verbatim from d1-provider.ts by scripts/refactor/split-module.mjs.
// d1-provider.ts re-exports everything public here, so existing imports keep working.


export interface Row {
  [k: string]: unknown;
}
