// directory-parity.test.mjs — Guard: unified employee directory contract.
// View-first: one read endpoint + root-only hidden list; no behavior change to
// existing users/positions endpoints; no Express mirror; Worker-only routes.
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR } from './_bundle.mjs';

const SRC = join(BACKEND_DIR, 'src');
const read = (p) => readFileSync(join(SRC, p), 'utf8');

const pure = read(join('modules', 'auth', 'directory.ts'));
const part = read(join('modules', 'auth', 'routes-parts', 'directory.ts'));
const routes = read(join('modules', 'auth', 'routes.ts'));
const worker = read(join('worker', 'routes', 'auth.ts'));

describe('unified directory contract (view-first)', () => {
  it('single hidden-key constant shared backend-wide', () => {
    assert.ok(pure.includes('hr:hiddenLoginEmails'), 'hidden Setting key must be defined once');
    assert.ok(part.includes('DIRECTORY_HIDDEN_KEY'), 'io must use the shared key, not a literal');
    assert.ok(worker.includes('DIRECTORY_HIDDEN_KEY'), 'worker route must use the shared key');
  });

  it('root is never listed; hidden visible to root only', () => {
    assert.ok(part.includes('isTargetRoot'), 'root exclusion must be enforced');
    assert.ok(part.includes('if (isHidden && !root) continue'), 'hidden rows drop for non-root');
    assert.ok(part.includes('hidden: true'), 'hidden rows flagged for root');
  });

  it('existing users/positions gates untouched (no widening)', () => {
    const io = read(join('modules', 'auth', 'routes-parts', 'io.ts'));
    assert.ok(io.includes('await asUserManager(store, cookieHeader)'), 'users/positions keep the manager gate');
    assert.ok(!io.includes('human-resources'), 'io.ts gains no HR widening');
  });

  it('directory gate: managers + HR scopes read, HR cannot manage', () => {
    assert.ok(pure.includes('human-resources'), 'HR scope must grant the wide read');
    assert.ok(part.includes('canManage'), 'response must carry canManage');
    assert.ok(part.includes('["admin", "user-admin"]'), 'manage stays admin/user-admin only');
  });

  it('hidden list is root-only read/write with validation', () => {
    assert.ok(part.includes('asRoot(store, cookieHeader)'), 'hidden endpoints require root');
    assert.ok(pure.includes('DIRECTORY_HIDDEN_MAX'), 'hidden list must be capped');
    assert.ok(part.includes('normalizeHiddenEmails'), 'hidden input must be normalized');
  });

  it('Worker-only: three routes registered, no Express mirror', () => {
    for (const p of ['/api/auth/directory', '/api/auth/hidden-logins', '/api/auth/core-assignments']) {
      assert.ok(worker.includes(`'${p}'`), `missing worker route ${p}`);
    }
    assert.ok(routes.includes('authDirectory'), 'routes.ts must re-export authDirectory');
    assert.ok(routes.includes('authGetHiddenLogins') && routes.includes('authSetHiddenLogins'), 'routes.ts must re-export hidden fns');
    assert.ok(routes.includes('authCoreAssignments'), 'routes.ts must re-export authCoreAssignments');
  });

  it('email-exact roster links only (no name guessing)', () => {
    assert.ok(pure.includes('normEmail(t.email) === e'), 'roster links must be email-exact');
    assert.ok(!pure.includes('toLowerCase().includes('), 'no fuzzy name matching');
  });

  it('frontend mirror exists for key + shape', () => {
    const fe = readFileSync(join(BACKEND_DIR, '..', 'founder-os_frontend', 'src', 'auth', 'directory.ts'), 'utf8');
    assert.ok(fe.includes('hr:hiddenLoginEmails'), 'frontend must mirror the hidden key doc');
    assert.ok(fe.includes('modules/auth/directory.ts'), 'frontend must name its backend mirror');
  });
});

describe('core assignments contract (read-only)', () => {
  it('same gate + hidden filtering as the directory, root never listed', () => {
    assert.ok(part.includes('authCoreAssignments'), 'assignments reader must exist');
    assert.ok(part.includes('isTargetRoot'), 'root exclusion must be enforced');
    assert.ok(part.includes('DIRECTORY_WIDE_SCOPES'), 'assignments must share the directory gate');
  });

  it('reads locked core tables, never writes them', () => {
    assert.ok(!/INSERT INTO\s+"?core_|UPDATE\s+"?core_|DELETE FROM\s+"?core_/i.test(part), 'assignments reader must not write core_*');
    assert.ok(part.includes('coreUnavailable'), 'core outage must degrade to empty, never 500 the panel');
  });

  it('one primary designation per login (history preserved)', () => {
    assert.ok(part.includes('isPrimary === false'), 'non-primary rows must be skipped');
    assert.ok(part.includes('validTo'), 'retired rows must be skipped');
  });

  it('catalog is department-grouped for the pickers', () => {
    assert.ok(part.includes('departmentId'), 'positions must carry their department');
  });

  it('frontend mirror exists for shape + endpoint', () => {
    const types = readFileSync(join(BACKEND_DIR, '..', 'founder-os_frontend', 'src', 'auth', 'core.ts'), 'utf8');
    const api = readFileSync(join(BACKEND_DIR, '..', 'founder-os_frontend', 'src', 'auth', 'api.ts'), 'utf8');
    assert.ok(types.includes('modules/auth/routes-parts/directory.ts'), 'frontend types must name their backend mirror');
    assert.ok(api.includes('/api/auth/core-assignments'), 'domain api module must call the assignments endpoint');
  });
});
