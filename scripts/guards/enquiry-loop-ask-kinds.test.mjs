// enquiry-loop-ask-kinds.test.mjs — the Note loop composer stays retired.
//
// Founder decision 2026-11-13: the "+ Note" / "Add note" ask button was pure
// noise on all three loop surfaces (sales / procurement / management). `note`
// remains a valid LoopKind — the backend still accepts it and renders it —
// but only as an AUDIT-ONLY record kind: server audit notes, the
// expected-price trail, late-quote / union stamps, the legacy thread bridge.
// No surface may offer it in a LoopCards askKinds composer again.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/enquiry-loop-ask-kinds.test.mjs`
// Exit: 0 = invariant holds, 1 = regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRONTEND_SRC, BACKEND_DIR } from './_bundle.mjs';

const readFe = (p) => readFileSync(join(FRONTEND_SRC, p), 'utf8');

describe('note composer stays retired', () => {
  it('no surface offers note in a LoopCards askKinds', () => {
    for (const f of [
      'components/SpecificationsSection.tsx',
      'components/ProcurementItemCard.tsx',
      'components/ManagementRatesPanel.tsx',
    ]) {
      const src = readFe(f);
      for (const m of src.matchAll(/askKinds=\{([^}]*)\}/g)) {
        assert.ok(!/'note'|"note"/.test(m[1]), `${f} re-adds note to askKinds: ${m[0]}`);
      }
    }
  });

  it('bypassed items hide the whole composer (no notes-only exception)', () => {
    const src = readFe('components/LoopCards.tsx');
    assert.ok(!src.includes("filter((k) => k === 'note')"), 'notes-only bypass exception is back');
    assert.ok(src.includes('const askable = bypassed ? [] : askKinds;'), 'bypassed items must hide all asks');
  });

  it('note still renders as a record kind (audit trail intact)', () => {
    const src = readFe('components/LoopCards.tsx');
    assert.ok(src.includes('note: "Note"'), 'KIND_LABEL must still render stored note records');
  });

  it('sales flag is Fix-spec only (no Answer on spec)', () => {
    // A procurement spec flag is held by sales, but sales clears it by
    // fixing the spec / attaching a reference (auto-answer on specChanged /
    // mediaAdded) — never by typing an Answer. So the sales surface hides
    // the open spec card entirely (no "With you — answer below", no Answer
    // button); the banner's single Fix-spec button is the only action.
    // Query asks keep the normal Answer path.
    const loop = readFe('components/LoopCards.tsx');
    assert.ok(loop.includes('mode === "sales"') && loop.includes('l.kind === "spec"') && loop.includes('l.status === "open"'), 'sales must hide open spec cards in LoopCards');
    const src = readFe('components/SpecificationsSection.tsx');
    assert.ok(!src.includes('onAnswer={() => {}}'), 'sales onAnswer must not be a no-op');
    assert.ok(src.includes('loopAnswer: { id, text, media }'), 'sales query answer must still ride the loopAnswer intent');
    assert.ok(src.includes('Fix spec'), 'flagged banner must offer the one-click fix-spec path');
    assert.ok(src.includes('Spec Flagged'), 'flagged banner must read simply Spec Flagged');
    assert.ok(!src.includes('Spec flagged by Procurement'), 'old flagged-by-Procurement label must not come back');
  });

  it('sales item asks moved to Conversations (no loop query composer)', () => {
    // Founder decision 2026-11-20 retires the 2026-11-19 post-rate gate:
    // sales may ask anytime, but through enquiry-threads (Conversations),
    // where Management <-> Procurement talk is never served to sales. The
    // old "Request info / alternate" loop composer must not come back;
    // existing query cards still render as history.
    const src = readFe('components/SpecificationsSection.tsx');
    const m = src.match(/askKinds=\{([^}]*)\}/);
    assert.ok(m, 'sales LoopCards askKinds missing');
    assert.ok(!/"query"|'query'/.test(m[1]), 'sales loop query composer must stay retired (use Conversations)');
    assert.ok(readFe('components/EnquiryDetail.tsx').includes('<EnquiryThreadsProvider desk="sales"'), 'sales detail must provide item queries');
    assert.ok(src.includes('<ItemQueries itemIndex={idx}'), 'each sales item card must offer Ask a query');
    // Founder ask 2026-11-21: sales may ask only after management gave the
    // item's rate, and never on rate-available items.
    const gate = src.match(/<ItemQueries itemIndex=\{idx\}[^>]*canAsk=\{([^}]*)\}/);
    assert.ok(gate, 'sales Ask a query must be gated (canAsk)');
    assert.ok(gate[1].includes('finalRate') && gate[1].includes('!it.rateAvailable'), 'sales gate = rate given AND not rate-available');
    // ...or the estimate is marked as sent (any item may be asked about then).
    assert.ok(gate[1].includes('salesSent') && src.includes('enquiryRateState(selectedEnquiry).sent'), 'sent estimates must open Ask a query on every item');
  });

  it('management can flag incorrect spec like procurement', () => {
    // Management Review needs the same incorrect-spec flag as procurement:
    // privileged management opens `spec`, holder stays sales so the single
    // sales Fix-spec path clears both identically.
    const be = readFileSync(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'loops-parts', 'pure.ts'), 'utf8');
    assert.ok(be.includes("kind === 'spec'") && be.includes("w.privileged && w.desk === 'management'"), 'backend canOpen must allow privileged management spec');
    const mgmt = readFe('components/ManagementRatesPanel.tsx');
    assert.ok(mgmt.includes('"spec"') && mgmt.includes('Flag incorrect spec'), 'management composer must offer spec');
    assert.ok(mgmt.includes('Spec Flagged'), 'management banner must read generic Spec Flagged');
    assert.ok(!mgmt.includes('Procurement flagged incorrect spec'), 'opener-specific management banner must not come back');
  });
});
