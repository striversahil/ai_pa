// Extracted verbatim from vision-intake.ts by scripts/refactor/split-module.mjs.
// vision-intake.ts re-exports everything public here, so existing imports keep working.
import type { MatchProduct } from "../../../automations/product-line/match";

export interface KypKey { productId: string; category: string; item: string; keys: Set<string> }

export interface LiveCatalog {
  products: MatchProduct[];
  cats: string[];
  itemsByCat: Map<string, Set<string>>;
  index: KypKey[];
}
