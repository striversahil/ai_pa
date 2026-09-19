// enquiry/company.ts — loose company-name comparison for Zoho mismatch chip.
// Zoho `customerName` vs Enquiry `clientCompany` should be flagged only when
// they are meaningfully different. Exact string compare is too noisy (case,
// punctuation, "Pvt Ltd" suffixes, extra spaces). This normalizes both sides
// loosely before comparing.

const STOP_WORDS = new Set([
  'pvt', 'p', 'private', 'limited', 'ltd', 'llp', 'llc', 'inc', 'incorporated',
  'corp', 'corporation', 'company', 'co', 'enterprises', 'enterprise',
  'industries', 'industry', 'traders', 'trading', 'solutions', 'solution',
  'services', 'service', 'group', 'associates', 'associate', 'sons',
  // honorifics / prefixes that don't distinguish the legal entity
  'shree', 'shri', 'sree', 'sri', 'm', 's', 'ms', 'mr', 'mrs',
  // generic prefixes that vary between systems
  'new', 'the', 'and',
]);

function tokenEqual(a: string, b: string): boolean {
  if (a === b) return true;
  // Abbreviation prefix: "eng" ≈ "engineering", "engg" ≈ "engineering"
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}

export function normalizeCompany(raw: string): string {
  let s = String(raw ?? '').toLowerCase().trim();
  if (!s) return '';
  // Strip parenthetical locations like "(MP)", "(UP)", "(HP)" — Zoho often
  // appends state codes in brackets that are not part of the legal name.
  s = s.replace(/\([^)]*\)/g, ' ');
  // Replace punctuation & separators with space (keep a-z0-9 and spaces)
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  // Tokenize, drop stop-words, re-join
  const tokens = s.split(/\s+/).filter(Boolean).filter((t) => !STOP_WORDS.has(t));
  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

function toTokens(norm: string): string[] {
  return norm ? norm.split(' ').filter(Boolean) : [];
}

export function companiesDiffer(a: string, b: string): boolean {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false; // don't flag when either side is missing
  if (na === nb) return false;
  const ta = toTokens(na);
  const tb = toTokens(nb);
  if (!ta.length || !tb.length) return false;
  // Token-subset with abbreviation tolerance: if every token of the smaller
  // set has a (prefix) match in the larger set, treat as same entity.
  // Handles "Swastik Mill Stores" vs "Shree Swastik Mill Stores (MP)" and
  // "New Dhiman Engineering Enterprises" vs "Dhiman Eng Enterprises (UP)".
  const small = ta.length <= tb.length ? ta : tb;
  const large = ta.length <= tb.length ? tb : ta;
  const allMatched = small.every((tok) => large.some((lt) => tokenEqual(tok, lt)));
  if (allMatched) {
    // Avoid false-positives for single-token subset: "Shree" vs "Shree Balaji"
    // should still be considered different — need at least 2 tokens to be a
    // meaningful subset, or the single token must be the only token on both sides.
    if (small.length === 1 && large.length >= 2) return true;
    return false;
  }
  // Fallback: whole-string prefix containment at token boundary (legacy)
  if (na.length >= 4 && nb.length >= 4) {
    if (nb.startsWith(na) || na.startsWith(nb)) {
      const longer = na.length > nb.length ? na : nb;
      const shorter = na.length > nb.length ? nb : na;
      if (longer.length > shorter.length && longer[shorter.length] === ' ') {
        const sTokens = shorter.split(' ').length;
        const lTokens = longer.split(' ').length;
        if (sTokens === 1 && lTokens >= 2) return true;
        return false;
      }
    }
  }
  return true;
}
