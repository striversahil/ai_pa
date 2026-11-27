// enquiry-agent-resolve.test.mjs — Guard: the enquiry "Lead by" login match.
//
// Two passes share ONE rule (backend `modules/enquiries/agent-match.ts`):
//   1. the sales roster (the Telecaller VIEW) — login email, then name;
//   2. the HR register for sales seats, because the view exposes `email`
//      only while a seat can sign in with a separate `loginEmail` and `email`
//      may list several addresses.
//
// Regression this locks (found 2026-11-27): a team-lead login
// (sales.teamlead1.01@…, HR email = the founder's inbox) matched nothing, so
// every enquiry it created stored `assignedAgentId = ''` and the sales list
// rendered "Unassigned". A shared inbox must still NEVER resolve without a
// name hit (founder rule 2026-11-02), and no match stays unattributed.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/enquiry-agent-resolve.test.mjs`
// Exit: 0 = invariant holds, 1 = regression.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const mod = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'agent-match.ts')));
const { pickCreatorRow, creatorEmails } = mod;

const roster = [
  { id: 'emp-raja', name: 'Raja', email: 'sales.region.1.01@gmail.com' },
  { id: 'emp-samar', name: 'Samarjeet Kaur', email: 'sales.region.1.02@gmail.com, sievecleaners@gmail.com' },
  { id: 'emp-shared-a', name: 'Pooja', email: 'sales7bui@gmail.com' },
  { id: 'emp-shared-b', name: 'Kamal Ladwani', email: 'sales7bui@gmail.com' },
  { id: 'emp-tl', name: 'Anand Sharma', email: 'millingworlddpg@gmail.com', loginEmail: 'sales.teamlead1.01@gmail.com' },
];

describe('enquiry lead: login resolves through roster then register', () => {
  it('roster email match wins', () => {
    assert.equal(pickCreatorRow(roster, 'sales.region.1.01@gmail.com', 'Arjun Singh'), 'emp-raja');
  });

  it('a multi-address roster email still matches its first address', () => {
    assert.equal(pickCreatorRow(roster, 'sales.region.1.02@gmail.com', 'Neha Verma'), 'emp-samar');
    assert.ok(creatorEmails(roster[1]).includes('sievecleaners@gmail.com'));
  });

  it('loginEmail (never exposed by the roster view) resolves', () => {
    assert.equal(pickCreatorRow(roster, 'sales.teamlead1.01@gmail.com', 'Rajiv Kapoor'), 'emp-tl');
  });

  it('a shared inbox needs the name, otherwise stays unattributed', () => {
    assert.equal(pickCreatorRow(roster, 'sales7bui@gmail.com', ''), null);
    assert.equal(pickCreatorRow(roster, 'sales7bui@gmail.com', 'Someone Else'), null);
    assert.equal(pickCreatorRow(roster, 'sales7bui@gmail.com', 'kamal ladwani'), 'emp-shared-b');
  });

  it('name fallback matches case-insensitively', () => {
    assert.equal(pickCreatorRow(roster, 'unknown@x.com', 'RAJA'), 'emp-raja');
  });

  it('no match / no login is null, never a guess', () => {
    assert.equal(pickCreatorRow(roster, 'nobody@x.com', 'Nobody'), null);
    assert.equal(pickCreatorRow(roster, '', ''), null);
    assert.equal(pickCreatorRow([], 'sales.region.1.01@gmail.com', 'Raja'), null);
  });

  it('rows without an id are ignored', () => {
    assert.equal(pickCreatorRow([{ name: 'Raja', email: 'sales.region.1.01@gmail.com' }], 'sales.region.1.01@gmail.com', 'Raja'), null);
  });
});

// The resolver itself, driven through a fake prisma (no DB): the two passes must
// run in order and the register fallback must only accept SALES seats.
const scopes = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiries', 'scopes.ts')));
const { resolveCreatorAgentId } = scopes;

function fakePrisma({ roster = [], members = [], fail = false } = {}) {
  return {
    telecaller: { findMany: async () => (fail ? Promise.reject(new Error('db')) : roster) },
    humanResourcesMember: {
      findMany: async (args) => {
        assert.equal(args?.where?.deleted, false, 'the register pass must skip deleted rows');
        return members;
      },
    },
  };
}
const me = (email, name) => ({ user: { email, name, id: 'auth-session-id' } });

describe('enquiry lead: resolveCreatorAgentId runs roster, then the register', () => {
  it('a roster hit wins and the register is never needed', async () => {
    const p = fakePrisma({ roster: [roster[0]], members: [] });
    assert.equal(await resolveCreatorAgentId(p, me('sales.region.1.01@gmail.com', 'Arjun Singh')), 'emp-raja');
  });

  it('loginEmail on the employee row resolves (the shipped bug)', async () => {
    const tl = { id: 'emp-anand', name: 'Anand Sharma', email: 'millingworlddpg@gmail.com', loginEmail: 'sales.teamlead1.01@gmail.com', salesType: 'team_lead' };
    assert.equal(await resolveCreatorAgentId(fakePrisma({ members: [tl] }), me('sales.teamlead1.01@gmail.com', 'Rajiv Kapoor')), 'emp-anand');
  });

  it('the register pass ignores a non-sales employee', async () => {
    const staff = { id: 'emp-hr', name: 'Rajiv Kapoor', email: 'sales.teamlead1.01@gmail.com', salesType: '' };
    assert.equal(await resolveCreatorAgentId(fakePrisma({ members: [staff] }), me('sales.teamlead1.01@gmail.com', 'Rajiv Kapoor')), null);
  });

  it('no match stays null (the caller stores an empty lead, never the auth id)', async () => {
    assert.equal(await resolveCreatorAgentId(fakePrisma(), me('nobody@x.com', 'Nobody')), null);
  });

  it('a failing roster read degrades to null, never throws', async () => {
    assert.equal(await resolveCreatorAgentId(fakePrisma({ fail: true }), me('a@b.c', 'X')), null);
  });
});
