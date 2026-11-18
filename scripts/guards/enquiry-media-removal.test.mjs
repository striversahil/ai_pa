// enquiry-media-removal.test.mjs — Guard: sales can delete item attachments.
//
// The Nov-2026 incident: deleting an item photo/video on the sales surface
// kept coming back. Root cause was the field whitelist — pickEnquiryFields
// passed `removedRates` through but dropped `removedMedia`, so the explicit
// delete marker never reached normalizeItemWrites. The stale-empty guard
// (empty incoming + non-empty stored = preserve stored) then resurrected
// every last-image delete at the merge.
//
// Invariant (mirrors the rates union rule):
//   1. `removedMedia` ["type:url"] survives the pickEnquiryFields whitelist,
//   2. last-attachment delete (incoming empty + marker) yields empty media,
//   3. the marker never persists on the stored row,
//   4. without a marker, the stale-empty guard still protects (stale stripped
//      payloads can't wipe stored photos),
//   5. deleting 1-of-N still works through the subset branch.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/enquiry-media-removal.test.mjs`
// Exit: 0 = invariant holds, 1 = regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const { normalizeItemWrites } = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'update.ts')));
const { pickEnquiryFields } = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'parse.ts')));

const PHOTO_A = { type: 'image', url: 'https://locker.example/a.jpg', name: 'a.jpg' };
const PHOTO_B = { type: 'image', url: 'https://locker.example/b.jpg', name: 'b.jpg' };
const CLIP = { type: 'video', url: 'https://locker.example/c.mp4', name: 'c.mp4' };

const storedItem = (media) => ({
  name: 'Bearing 6205', qty: '2 PCS', spec: 'SKF',
  media: media.map((m) => ({ ...m })),
  rates: [],
});

const CTX = {
  sales: { storedItems: [], privileged: false, restricted: false, actingProcurement: false },
  management: { storedItems: [], privileged: true, restricted: false, actingProcurement: false },
};
const withStored = (role, item) => ({ ...CTX[role], storedItems: [item] });
const mediaKey = (m) => `${m?.type === 'video' ? 'video' : m?.type === 'pdf' ? 'pdf' : 'image'}:${String(m?.url ?? '')}`;

describe('media removal: explicit marker deletes, omission never wipes', () => {
  it('removedMedia survives the pickEnquiryFields whitelist (the Nov-2026 drop)', () => {
    const body = {
      items: [{
        name: 'Bearing 6205', qty: '2 PCS', spec: 'SKF',
        media: [],
        removedMedia: [mediaKey(PHOTO_A)],
      }],
    };
    const picked = pickEnquiryFields(body);
    assert.ok(picked && Array.isArray(picked.items) && picked.items.length === 1);
    assert.deepStrictEqual(picked.items[0].removedMedia, [mediaKey(PHOTO_A)]);
  });

  it('[sales] deleting the last photo (empty incoming + marker) yields empty media', () => {
    const incoming = { ...storedItem([PHOTO_A]), media: [], removedMedia: [mediaKey(PHOTO_A)] };
    const out = normalizeItemWrites([incoming], withStored('sales', storedItem([PHOTO_A])))[0];
    assert.strictEqual((out.media ?? []).length, 0);
    assert.strictEqual(out.removedMedia, undefined);
  });

  it('[sales] deleting the last video works too (type-prefixed key)', () => {
    const incoming = { ...storedItem([CLIP]), media: [], removedMedia: [mediaKey(CLIP)] };
    const out = normalizeItemWrites([incoming], withStored('sales', storedItem([CLIP])))[0];
    assert.strictEqual((out.media ?? []).length, 0);
  });

  it('[sales] deleting 1-of-3 keeps the other two (subset branch + marker agree)', () => {
    const incoming = {
      ...storedItem([PHOTO_A, PHOTO_B, CLIP]),
      media: [{ ...PHOTO_B }, { ...CLIP }],
      removedMedia: [mediaKey(PHOTO_A)],
    };
    const out = normalizeItemWrites([incoming], withStored('sales', storedItem([PHOTO_A, PHOTO_B, CLIP])))[0];
    assert.deepStrictEqual((out.media ?? []).map(mediaKey).sort(), [mediaKey(PHOTO_B), mediaKey(CLIP)].sort());
  });

  it('without a marker, empty incoming still preserves stored media (stale-empty guard stands)', () => {
    // A queue payload arriving media-stripped must never wipe stored photos.
    const incoming = { ...storedItem([PHOTO_A]), media: [] };
    const out = normalizeItemWrites([incoming], withStored('sales', storedItem([PHOTO_A])))[0];
    assert.deepStrictEqual((out.media ?? []).map(mediaKey), [mediaKey(PHOTO_A)]);
  });

  it('restricted procurement still cannot remove stored media (trail ignored)', () => {
    const incoming = {
      ...storedItem([PHOTO_A]), media: [],
      removedMedia: [mediaKey(PHOTO_A)],
    };
    const out = normalizeItemWrites([incoming], {
      storedItems: [storedItem([PHOTO_A])],
      privileged: false, restricted: true, actingProcurement: true,
    })[0];
    assert.deepStrictEqual((out.media ?? []).map(mediaKey), [mediaKey(PHOTO_A)]);
  });
});
