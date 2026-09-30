// linkedin-visual.js — AI explainer-visual safety boundary.
// The fixed prompt template is the enforcement point: no caller input ever
// reaches the depiction clause, and the banned-token assertion guards template
// regressions. Explainer-diagram style ONLY — never machines, sites, people,
// or photographs (BUI brief Section 10).

'use strict';

// Depiction-request phrases only — bare "machine" is legit milling vocabulary
// (half the bank titles contain it) and the fixed template already bans
// depicting one. What must never arrive is a request to SHOW something real.
const BANNED_DEPICT = ['photograph', 'photo of', 'picture of', 'realistic', 'factory', 'worker', 'person', 'people', 'customer site', 'mill photo', 'show a', 'depict', 'camera', 'selfie'];

function imagePromptFor(title, concept) {
  // Scan the CALLER-SUPPLIED parts only (title/concept) — the fixed template
  // below is trusted and deliberately contains negations ("no photographs…")
  // that would trip a whole-prompt scan.
  const low = `${title} ${concept}`.toLowerCase();
  const hit = BANNED_DEPICT.find((t) => low.includes(t));
  if (hit) throw new Error(`image prompt failed safety scan (banned token in input: ${hit})`);
  return `Flat vector explainer diagram for a LinkedIn post about "${title}", Indian agro-processing theme. Clean minimal infographic style, warm earthy palette (amber, green, cream), simple icons and arrows showing ${concept}, large readable numbers, at most 5 short labels. No photographs, no realistic machines, no factories, no people, no text walls. Square 1:1.`;
}

module.exports = { imagePromptFor, BANNED_DEPICT };
