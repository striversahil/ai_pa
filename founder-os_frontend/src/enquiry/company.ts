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
]);

export function normalizeCompany(raw: string): string {
  let s = String(raw ?? '').toLowerCase().trim();
  if (!s) return '';
  // Replace punctuation & separators with space
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  // Tokenize, drop stop-words, re-join
  const tokens = s.split(/\s+/).filter(Boolean).filter((t) => !STOP_WORDS.has(t));
  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

export function companiesDiffer(a: string, b: string): boolean {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false; // don't flag when either side is missing
  if (na === nb) return false;
  // Substring containment with meaningful length often means same entity
  // e.g. "Shree Balaji Industries" vs "Shree Balaji" — after stop-word removal
  // both become "shree balaji" → already equal; but "abc trading co" → "abc"
  // vs "abc international" → "abc international" should still flag.
  // Only treat as same if one is a whole-token prefix of the other and the
  // shorter is at least 4 chars (avoid "a" == "a b").
  if (na.length >= 4 && nb.length >= 4) {
    if (nb.startsWith(na) || na.startsWith(nb)) {
      // Check token-boundary: "shree balaji" vs "shree balaji traders" -> after
      // stop-word removal they already equal; this catches residual cases.
      // Require that the longer's next char after the shorter is a space (token boundary)
      const longer = na.length > nb.length ? na : nb;
      const shorter = na.length > nb.length ? nb : na;
      if (longer.length > shorter.length && longer[shorter.length] === ' ') {
        // Check token count: if shorter is 1 token and longer is 2+, don't auto-match
        // "Shree" vs "Shree Balaji" should flag.
        const sTokens = shorter.split(' ').length;
        const lTokens = longer.split(' ').length;
        if (sTokens === 1 && lTokens >= 2) return true; // flag
        return false;
      }
    }
  }
  return true;
}
