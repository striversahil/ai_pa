// chat-root.test.mjs — Guard: root is never a chat participant, and chat
// names always come from the HR display-name rule.
//
// Locks the founder decisions:
//   · root is absent from every picker/member list and cannot be DM'd;
//   · root-authored messages/typing/reactions never reach another user;
//   · message and reply sender names are resolved through the shared index.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleToFile, BACKEND_DIR } from './_bundle.mjs';

const display = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src/modules/chat/display.ts'))).href);
const users = [
  { id: 'emp-1', name: 'Login One', email: 'one@x.com', displayName: null, isRoot: 0 },
  { id: 'emp-2', name: 'Google Two', email: 'two@x.com', displayName: 'Chosen Two', isRoot: 0 },
  { id: 'root-1', name: 'Sahil Kumar', email: 'root@x.com', displayName: null, isRoot: 1 },
];
const employees = [
  { name: 'Legal One', characterName: 'Hero One', useCharacterName: 1, loginEmail: 'one@x.com', email: null },
];

describe('chat display and root exclusion', () => {
  it('resolves HR character names, auth display overrides, and root ids', () => {
    const names = display.buildChatNameLookup(users, employees);
    assert.equal(names.byId.get('emp-1'), 'Hero One (Legal One)');
    assert.equal(names.byId.get('emp-2'), 'Chosen Two');
    assert.equal(names.rootIds.has('root-1'), true);
    assert.equal(names.rootIds.has('emp-1'), false);
  });

  it('presents message and reply names from the same lookup', () => {
    const names = display.buildChatNameLookup(users, employees);
    const row = display.presentChatMessage({
      id: 1, senderId: 'emp-1', senderName: 'Login One', body: 'hi',
      replyTo: { id: 0, senderId: 'emp-2', senderName: 'Google Two', body: 'yo' },
    }, names);
    assert.equal(row.senderName, 'Hero One (Legal One)');
    assert.equal(row.replyTo.senderName, 'Chosen Two');
  });

  it('D1 store filters root users/members/DMs and resolves names', () => {
    const io = readFileSync(join(BACKEND_DIR, 'src/modules/chat/store-parts/io.ts'), 'utf8');
    assert.match(io, /Number\(r\.isRoot \?\? 0\) !== 1/);
    assert.match(io, /rootIds\.has/);
    assert.match(io, /loadD1ChatNameLookup/);
    assert.match(io, /presentChatMessage/);
  });

  it('worker routes block root DMs/sends/typing/reactions with a generic 403', () => {
    const route = readFileSync(join(BACKEND_DIR, 'src/worker/routes/chat.ts'), 'utf8');
    assert.match(route, /isRootId\(names, body\.userId\)/);
    assert.match(route, /isRootId\(names, me\.user\.id\)/);
    assert.match(route, /This action is not available/);
    assert.match(route, /rows\.filter\(\(m\) => !isRootId\(names, m\.senderId\)\)/);
    assert.match(route, /app\.get\('\/api\/chat\/me'/);
    assert.doesNotMatch(route, /root is (invisible|hidden)|hidden root/i);
  });

  it('DO reply context carries the sender id and uses the v2 cache key', () => {
    const doSource = readFileSync(join(BACKEND_DIR, 'src/durable/chat-room.ts'), 'utf8');
    assert.match(doSource, /senderId: r\.senderId/);
    assert.match(doSource, /messages:v2/);
  });
});
