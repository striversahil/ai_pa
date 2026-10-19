// intake-grade-rules.ts — founder-editable intake classification variables.
//
// Deterministic grade/word→product rules for lines that carry ONLY a trade
// grade or fabric word ("20 GG", "9xxx", "Sefar Nytal") and no product name —
// these can never match the alias/substring/token tiers, and previously
// classified only when the LLM fallback happened to recognize them.
//
// HOW TO EDIT: change the `terms` list (or `product`) below, then rebuild +
// redeploy the worker. This ONE variable drives BOTH consumers, so they can
// never drift apart:
//   1. the deterministic tier in vision-intake (runs after alias/substring/
//      token, before the LLM fallback — real names always win, no LLM call);
//   2. the LLM fallback's system prompt (gradeRulesPrompt() output is baked
//      into LOOKUP_FALLBACK_SYSTEM from the same variable — prompt surgery
//      is never needed).
// Pure module (no imports, no I/O) — unit-tested in intake-e2e.ts.
export interface IntakeGradeRule {
  /** Exact catalogue product name (matched case-insensitively). */
  product: string;
  /** Plain words/fragments — plain strings only, never regex (safe to edit). */
  terms: string[];
}

export const INTAKE_GRADE_RULES: IntakeGradeRule[] = [
  {
    // Sieve bolting-cloth family: PA-GG grit gauze ("20 GG", "38GG"), PA-XXX
    // heavy-duty ("9xxx", "12 XXX Jalli"), MF milling forte, maker/typo
    // words (sefar/nytal, bolting/boulting/boalting/boating, sifar) — with or
    // without meters/widths. Verified trade terminology; word boundaries keep
    // lookalikes out ("22Gz" pipe, "Egg crate", "MTRB" never fire).
    product: 'Milling Fabric',
    // 'mesh' covers bare "150/250/300 mesh" lines (flour-mill mesh numbers
    // are cloth grades, never wire mesh — real mesh products match the
    // alias/substring/token tiers first, so this only fires on bare grades).
    // 'jali'/'jaali' are DELIBERATELY absent here: "Ms Jali" must keep
    // resolving to Perforated Sheet (see e2e ignore-list). Hindi जाली and
    // grade-examples live in FAMILY_PROMPT below (prompt text is not
    // normalized, so Devanagari survives there).
    terms: ['gg', 'xxx', 'mf', 'mesh', 'sefar', 'nytal', 'bolting', 'boulting', 'boalting', 'boating', 'sifar'],
  },
  {
    // Numbered bearings ("Bearing 6215K", "Maize Conveyor Bearing P209",
    // "Roll Body Bearing 22216") — codes only, never the bare word
    // 'bearing' (that would hijack "Bearing Socket H315", which belongs to
    // Bearing Sleeve). Letter-bearing codes are literal fragments; '6215k'
    // AND '6215' both listed because \b has no boundary inside "6215K".
    // Target product created in migration 0063.
    product: 'Bearing (Numbered)',
    terms: ['6215k', '6215', '8215', '22226', '22216', 'p209', 'p211', 'p208', 'p213', 'f211', 'f210', 'f207'],
  },
];

export interface GradeRuleIndexRow {
  productId: string;
  category: string;
  item: string;
}

const normRuleTok = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const escapeTerm = (t: string): string => String(t ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rulePattern(rule: IntakeGradeRule): RegExp {
  return new RegExp(`\\b\\d*\\s*(?:${rule.terms.map(escapeTerm).join('|')})\\b`, 'i');
}

/**
 * First rule whose terms match the line text wins; the product must exist
 * in the live catalogue index (else fall through to the LLM tier).
 * Returns the index entry or null. Generic so callers keep their row type.
 */
export function matchGradeRule<T extends GradeRuleIndexRow>(
  text: string,
  index: T[],
): T | null {
  const q = normRuleTok(text);
  if (!q) return null;
  for (const r of INTAKE_GRADE_RULES) {
    if (!r || !r.product || !Array.isArray(r.terms) || r.terms.length === 0) continue;
    if (!rulePattern(r).test(q)) continue;
    const want = normRuleTok(r.product);
    const hit = (index ?? []).find((e) => normRuleTok(e?.item) === want) ?? null;
    if (hit) return hit;
  }
  return null;
}

/**
 * System-prompt lines for the LLM fallback tier — generated from the SAME
 * variable above. Edit INTAKE_GRADE_RULES and both the deterministic tier
 * and this prompt text update together on redeploy.
 */
export function gradeRulesPrompt(): string {
  return INTAKE_GRADE_RULES
    .filter((r) => r && r.product && Array.isArray(r.terms) && r.terms.length > 0)
    .map((r) => `HARD RULE — anything mentioning ${r.terms.join('/')} is "${r.product}" (return it with confidence 1.0, never force another item).`)
    .join('\n');
}

/**
 * Family-level HARD RULEs for the LLM fallback tier (baked into
 * LOOKUP_FALLBACK_SYSTEM next to gradeRulesPrompt()). These carry what plain
 * term lists cannot: grade examples (24GG/22GG/12XXX), grade-wins-over-name,
 * the Hindi word, and the bearing 3-way split with never-traps.
 * Product names below are EXACT catalogue names — the model must copy them
 * verbatim into "item" so resolveProduct exact-matches downstream.
 */
export const FAMILY_PROMPT = `HARD RULE — bolting-cloth family (GENERAL: never enumerate, match the shape): a line carrying ONLY a cloth grade — ANY number with GG/XXX/MF/mesh, with or without space ("24GG", "22GG", "12 XXX", "9.5XXX", "52GG", "100GG", "150/250/300 mesh", "जाली" (Hindi for jali), "Sefar Nytal", "xxx ... meter") — is "Milling Fabric" with confidence 1.0, even with meters/widths attached. The grade wins over the name: "Conveyor Belt 11 XXX - 30 meter" is Milling Fabric, NOT a belt. Never file these as Wire Mesh or Perforated Sheet.
HARD RULE — bearing family (GENERAL: never enumerate, match the code SHAPE): any line naming a bearing (or bearing unit/socket for a machine: conveyor, elevator, roll body, pin-cut) with an alphanumeric code files by code shape with confidence 1.0, no matter the digits: a code starting with P or F followed by digits (P209, F211, and ANY others like P305/F208) is a housed unit → "Bearing Block"; a code starting with H followed by digits (H315, H2316, and ANY others) is a sleeve → "Bearing Sleeve"; a code of any other shape — digits with a trailing letter (6215K and ANY others like 6305ZZ/6204), pure digits (8215, 22226, and ANY others), anything unrecognized — is "Bearing (Numbered)". A bearing line is NEVER "Worm Hanger", "Roller Mill Housing", "Tee", or any non-bearing product, whatever the token overlap. "V Belt ..." lines are "V Belt", never a bearing.`;
