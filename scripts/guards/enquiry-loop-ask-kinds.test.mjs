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
import { FRONTEND_SRC } from './_bundle.mjs';

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
});
