// management-access.test.mjs — Management Review access is scope-driven.
//
// Rule: whoever Users & Permissions grants the `enquiry-management` scope to
// can open the panel and act on it (queues, finalize/share/answer, full rows).
// No person is named in code — the admin panel (roles or direct grants) is
// the only place access is decided. Locks both sides of the contract:
//   backend  modules/enquiries/scopes.ts        canManageRates()
//   frontend src/auth/permissions.ts            canView('enquiry-management')
// plus the registry rule scope that puts the dashboard in the server lists.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/management-access.test.mjs`
// Exit: 0 = invariant holds, 1 = regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKEND_DIR, FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const { canManageRates } = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'scopes.ts')));
const { canView } = await import(
  bundleToFile(join(FRONTEND_SRC, 'auth', 'permissions.ts'), { alias: { '@': FRONTEND_SRC } })
);

const me = (scopes = [], extra = {}) => ({
  user: { id: 'u', email: 'x@y', name: 'X', picture: null, isRoot: false },
  scopes,
  roles: [],
  isRoot: false,
  isAdmin: false,
  ...extra,
});

describe('management access: scope-driven (no names in code)', () => {
  it('backend: enquiry-management scope holder can manage rates', () => {
    assert.strictEqual(canManageRates(me(['telecalling', 'enquiry-management'])), true);
  });

  it('backend: root/admin still pass', () => {
    assert.strictEqual(canManageRates(me([], { isAdmin: true })), true);
    assert.strictEqual(canManageRates(me([], { isRoot: true })), true);
  });

  it('backend: plain sales / procurement holders cannot', () => {
    assert.strictEqual(canManageRates(me(['sales', 'telecalling'])), false);
    assert.strictEqual(canManageRates(me(['procurement'])), false);
  });

  it('frontend: canView mirrors the backend for the scope holder', () => {
    assert.strictEqual(canView(me(['enquiry-management']), 'enquiry-management'), true);
  });

  it('frontend: sales holder is refused, admins pass', () => {
    assert.strictEqual(canView(me(['sales', 'telecalling']), 'enquiry-management'), false);
    assert.strictEqual(canView(me([], { isAdmin: true }), 'enquiry-management'), true);
  });
});
