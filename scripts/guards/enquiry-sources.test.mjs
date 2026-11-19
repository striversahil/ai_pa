// enquiry-sources.test.mjs — Guard: enquiry source allow-list + Marketing channels.
//
// Founder rule: `AI` is never offered as a source on new enquiries; the
// Marketing group saves the channel itself (`Email` / `WhatsApp` / `Meta`)
// so the label reads `Enquiry No 3 - 19 NOV Meta`. Correct spelling:
// `WhatsApp` (never `Whatsapp`). Backend
// `founder-os_backend/src/modules/enquiries/types.ts` and frontend
// `src/types/index.ts` mirror verbatim — change both together.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/enquiry-sources.test.mjs`
// Exit: 0 = invariant holds, 1 = regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const beTypes = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'types.ts')));
const feTypes = await import(bundleToFile(join(FRONTEND_SRC, 'types', 'index.ts'), { alias: { '@': FRONTEND_SRC } }));

const readBe = (p) => readFileSync(join(BACKEND_DIR, p), 'utf8');
const readFe = (p) => readFileSync(join(FRONTEND_SRC, p), 'utf8');

const listOf = (src) => {
  const m = src.match(/ENQUIRY_SOURCES\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'ENQUIRY_SOURCES array missing');
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};

describe('enquiry sources: no AI, correct channel spelling, mirrors agree', () => {
  it('stored lists match backend ↔ frontend', () => {
    assert.deepStrictEqual([...feTypes.ENQUIRY_SOURCES], [...beTypes.ENQUIRY_SOURCES]);
  });

  it('AI removed, channels present with correct spelling', () => {
    for (const [name, src] of [['backend', readBe('src/modules/enquiries/types.ts')], ['frontend', readFe('types/index.ts')]]) {
      const list = listOf(src);
      assert.ok(!list.includes('AI'), `${name} list must not offer AI`);
      assert.ok(!list.includes('Whatsapp'), `${name} misspelling Whatsapp (want WhatsApp)`);
      for (const s of ['TL', 'Incoming', 'B2B', 'Field Staff', 'Email', 'WhatsApp', 'Meta']) {
        assert.ok(list.includes(s), `${name} list missing ${s}`);
      }
      assert.ok(!list.includes('Marketing'), `${name} stored list must not contain picker-only Marketing`);
    }
  });

  it('labels carry the channel (Meta / WhatsApp)', () => {
    const be = beTypes.enquiryLabelText(3, '2026-11-19T05:30:00.000Z', 'Meta');
    assert.ok(be.includes('Enquiry No 3') && be.includes('19 NOV Meta'), `backend label wrong: ${be}`);
    const fe = feTypes.enquiryLabel({ dailyNo: 3, createdAt: '2026-11-19T05:30:00.000Z', source: 'WhatsApp' });
    assert.ok(fe.includes('Enquiry No 3') && fe.includes('19 NOV WhatsApp'), `frontend label wrong: ${fe}`);
  });

  it('new-enquiry modal gates Marketing behind a channel pick', () => {
    const picker = readFe('components/enquiry-modal/source-picker.tsx');
    assert.ok(picker.includes('MARKETING_CHANNELS'), 'channel list missing');
    assert.ok(picker.includes('"WhatsApp"') || picker.includes("'WhatsApp'"), 'correct WhatsApp spelling required');
    assert.ok(!picker.includes('"Whatsapp"') && !picker.includes("'Whatsapp'"), 'misspelling Whatsapp must not come back');
    assert.ok(picker.includes('Select Email / WhatsApp / Meta'), 'channel pick must be required');
    const src = readFe('components/EnquiryModal.tsx');
    assert.ok(src.includes('Marketing'), 'modal must offer the Marketing group');
    assert.ok(src.includes('SourcePicker'), 'modal must reuse the shared SourcePicker');
    assert.ok(src.includes('Select Email / WhatsApp / Meta'), 'modal must require a channel pick');
  });
});
