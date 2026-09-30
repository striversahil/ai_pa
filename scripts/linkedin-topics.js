// linkedin-topics.js — the idea bank for the daily LinkedIn pipeline.
// 40 topics across BUI pillars (A power-cost, B yield-fixes, C shopfloor,
// D maintenance, E founder story, F buyer education/finance). The runner picks
// 5/day with pillar spread and skips recently used slugs (via worker state).
// angleSeed steers the web-research queries; visualScene picks the explainer
// visual style (diagrams only — never machines, sites, or people).

'use strict';

const TOPICS = [
  // Pillar A — power cost / unit economics
  { slug: 'power-cost-per-tonne', title: 'What power really costs per tonne of atta', pillar: 'A', format: 'text', angleSeed: 'flour mill power consumption per tonne kW atta chakki electricity cost India', visualScene: 'diagram' },
  { slug: 'setup-cost-x-tph-mill', title: 'What it costs to set up an X TPH mill', pillar: 'A', format: 'carousel', angleSeed: 'flour mill plant setup cost India TPH project cost breakdown', visualScene: 'diagram' },
  { slug: 'small-mill-vs-large-mill', title: 'Small mill vs large mill: the honest math', pillar: 'A', format: 'text', angleSeed: 'small vs large flour mill profitability comparison India', visualScene: 'diagram' },
  { slug: 'payback-period-mill', title: 'How long until a new mill pays for itself', pillar: 'A', format: 'text', angleSeed: 'flour mill payback period ROI India agro processing', visualScene: 'diagram' },
  { slug: 'single-phase-vs-three-phase', title: 'Single-phase vs three-phase: what mill buyers get wrong', pillar: 'A', format: 'text', angleSeed: 'single phase vs three phase motor flour mill power requirement', visualScene: 'diagram' },
  { slug: 'diesel-vs-electric-mill', title: 'Diesel vs electric drive: running-cost truth', pillar: 'A', format: 'text', angleSeed: 'diesel vs electric flour mill operating cost comparison', visualScene: 'diagram' },
  // Pillar B — yield fixes
  { slug: 'five-reasons-yield-dropping', title: '5 reasons your yield is dropping', pillar: 'B', format: 'carousel', angleSeed: 'flour mill low extraction rate causes roller sieve moisture', visualScene: 'diagram' },
  { slug: 'roller-gap-yield', title: 'Roller gap: the 2-minute check that saves quintals', pillar: 'B', format: 'text', angleSeed: 'roller mill gap setting flour extraction rate adjustment', visualScene: 'diagram' },
  { slug: 'moisture-before-milling', title: 'Moisture before milling: the invisible yield thief', pillar: 'B', format: 'text', angleSeed: 'wheat moisture content milling yield tempering time', visualScene: 'diagram' },
  { slug: 'sieve-maintenance-yield', title: 'Worn sieves silently eat 2-3% of your output', pillar: 'B', format: 'text', angleSeed: 'flour mill sieve maintenance replacement frequency plansifter', visualScene: 'diagram' },
  { slug: 'tempering-explained', title: 'Tempering: what it is and why your miller skips it', pillar: 'B', format: 'carousel', angleSeed: 'wheat tempering process time water absorption milling', visualScene: 'diagram' },
  { slug: 'bran-separation', title: 'Bran separation done right pays for the machine', pillar: 'B', format: 'text', angleSeed: 'bran separator finisher flour mill byproduct value', visualScene: 'diagram' },
  // Pillar C — shopfloor / making
  { slug: 'from-steel-plate-to-machine', title: 'From steel plate to machine: how a mill is born', pillar: 'C', format: 'carousel', angleSeed: 'flour mill manufacturing process fabrication India', visualScene: 'diagram' },
  { slug: 'what-we-test-before-dispatch', title: 'What we test before a machine leaves our floor', pillar: 'C', format: 'text', angleSeed: 'flour mill machine quality testing trial run checklist', visualScene: 'diagram' },
  { slug: 'welding-quality-machines', title: 'Why weld quality decides machine life', pillar: 'C', format: 'text', angleSeed: 'welding quality industrial machinery lifespan fabrication standards', visualScene: 'diagram' },
  { slug: 'casting-vs-fabrication', title: 'Casting vs fabrication in mill bodies', pillar: 'C', format: 'text', angleSeed: 'casting vs fabricated steel body flour mill machine durability', visualScene: 'diagram' },
  { slug: 'dispatch-day', title: 'Dispatch day: what happens before the truck leaves', pillar: 'C', format: 'text', angleSeed: 'industrial machinery packing dispatch process India', visualScene: 'diagram' },
  // Pillar D — maintenance / operations
  { slug: 'daily-10-minute-machine-check', title: 'The daily 10-minute machine check', pillar: 'D', format: 'carousel', angleSeed: 'flour mill daily maintenance checklist preventive', visualScene: 'diagram' },
  { slug: 'belt-tension-guide', title: 'Belt tension: too tight costs bearings, too loose costs output', pillar: 'D', format: 'text', angleSeed: 'v-belt tension maintenance bearing failure industrial', visualScene: 'diagram' },
  { slug: 'bearing-failure-signs', title: '3 sounds that mean your bearing is dying', pillar: 'D', format: 'text', angleSeed: 'bearing failure symptoms noise vibration motor maintenance', visualScene: 'diagram' },
  { slug: 'monsoon-mill-care', title: 'Monsoon care for your mill: moisture, rust, storage', pillar: 'D', format: 'text', angleSeed: 'monsoon machinery maintenance rust prevention grain storage moisture', visualScene: 'diagram' },
  { slug: 'spare-parts-stock', title: 'The 5 spares every mill should stock', pillar: 'D', format: 'carousel', angleSeed: 'flour mill essential spare parts belts bearings sieves', visualScene: 'diagram' },
  { slug: 'dust-control', title: 'Dust is not dirt — it is lost product and a fire risk', pillar: 'D', format: 'text', angleSeed: 'flour mill dust control cyclone explosion risk collection', visualScene: 'diagram' },
  // Pillar E — founder story
  { slug: 'why-i-started-bui', title: 'Why I started BUI', pillar: 'E', format: 'text', angleSeed: null, visualScene: 'quote' },
  { slug: 'biggest-mistake-first-year', title: 'My biggest mistake in the first year', pillar: 'E', format: 'text', angleSeed: null, visualScene: 'quote' },
  { slug: 'lesson-from-customer-visit', title: 'What 500 customer visits taught me about selling machines', pillar: 'E', format: 'text', angleSeed: null, visualScene: 'quote' },
  { slug: 'why-we-say-no', title: 'Why we sometimes say no to a customer', pillar: 'E', format: 'text', angleSeed: null, visualScene: 'quote' },
  { slug: 'hiring-first-technician', title: 'Hiring our first technician changed everything', pillar: 'E', format: 'text', angleSeed: null, visualScene: 'quote' },
  // Pillar F — buyer education / finance
  { slug: 'subsidy-loan-basics', title: 'Subsidy and loan basics for first-time mill owners', pillar: 'F', format: 'carousel', angleSeed: 'PMFME subsidy flour mill Mudra loan agro processing India 2026', visualScene: 'diagram' },
  { slug: 'how-to-choose-tph', title: 'How to choose the right TPH (most buyers oversize)', pillar: 'F', format: 'text', angleSeed: 'how to select flour mill capacity TPH demand assessment', visualScene: 'diagram' },
  { slug: 'questions-before-buying-mill', title: '7 questions to ask before buying any mill', pillar: 'F', format: 'carousel', angleSeed: 'flour mill buying guide what to check before purchase', visualScene: 'diagram' },
  { slug: 'atta-vs-maida-vs-suji', title: 'Atta vs maida vs suji: what the machine decides', pillar: 'F', format: 'text', angleSeed: 'atta maida suji difference milling process extraction', visualScene: 'diagram' },
  { slug: 'dal-mill-basics', title: 'Dal milling basics for atta-mill owners expanding', pillar: 'F', format: 'text', angleSeed: 'dal mill plant process pigeon pea milling basics India', visualScene: 'diagram' },
  { slug: 'spice-grinding-margins', title: 'Spice grinding: the margin business next to your mill', pillar: 'F', format: 'text', angleSeed: 'spice grinding business margin pulverizer India', visualScene: 'diagram' },
  { slug: 'oil-expeller-add-on', title: 'Adding an oil expeller next to the flour line', pillar: 'F', format: 'text', angleSeed: 'mini oil expeller mustard oil business cost margin India', visualScene: 'diagram' },
  { slug: 'rice-mill-vs-flour-mill', title: 'Rice mill vs flour mill: different beasts', pillar: 'F', format: 'text', angleSeed: 'rice mill vs flour mill process difference machinery', visualScene: 'diagram' },
  { slug: 'fssai-license-mill', title: 'FSSAI license for your mill: the short version', pillar: 'F', format: 'carousel', angleSeed: 'FSSAI license flour mill registration process India', visualScene: 'diagram' },
  { slug: 'mandi-vs-direct-wheat', title: 'Mandi vs direct-from-farmer wheat: cost and quality', pillar: 'F', format: 'text', angleSeed: 'wheat procurement mandi vs direct farmer price quality India', visualScene: 'diagram' },
  { slug: 'packaging-atta-brand', title: 'From loose atta to your own brand: packaging basics', pillar: 'F', format: 'text', angleSeed: 'atta packaging machine branding small mill India cost', visualScene: 'diagram' },
  { slug: 'electricity-load-sanction', title: 'How much electricity load to sanction for your mill', pillar: 'F', format: 'text', angleSeed: 'electricity load sanction flour mill kW connection commercial tariff India', visualScene: 'diagram' },
];

module.exports = { TOPICS };
