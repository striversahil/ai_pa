// live-transport.test.mjs — the wire that makes the whole app live.
//
// Every dashboard refetch in this app hangs off ONE WebSocket: browser →
// `GET /api/events` (Pages Function proxy) → Worker route → EventHub Durable
// Object → `/broadcast`. Each link is one line of code and each one can be
// broken silently — a broken link does not error, it just stops delivering
// events, so every view quietly becomes fetch-once and users learn to reload
// (exactly how enquiry Queries behaved: the only surface with no local echo,
// so the only place the rot was visible).
//
// 2026-11-24: the Pages proxy rebuilt EVERY response as
// `new Response(res.body, { status: res.status })`. A WebSocket upgrade is a
// 101 carrying `webSocket`; the Response constructor rejects non-2xx-5xx
// statuses, so each handshake threw and the whole app was offline for live
// updates. These assertions pin the 101 passthrough and its position (before
// the streamed-body branch), plus the rest of the chain.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, FRONTEND_SRC } from './_bundle.mjs';

const FRONTEND_DIR = join(FRONTEND_SRC, '..');
const read = (...p) => readFileSync(join(...p), 'utf8');

const proxy = read(FRONTEND_DIR, 'functions', 'api', '[[path]].ts');
const route = read(BACKEND_DIR, 'src', 'worker', 'routes', 'events.ts');
const hub = read(BACKEND_DIR, 'src', 'durable', 'event-hub.ts');
const live = read(BACKEND_DIR, 'src', 'live.ts');
const hook = read(FRONTEND_SRC, 'hooks', 'useLiveData.ts');

describe('live transport — Pages proxy must forward the WebSocket upgrade', () => {
  it('hands the socket back instead of rebuilding the 101', () => {
    assert.match(proxy, /if \(res\.webSocket\)/, 'proxy must branch on an upgraded response');
    assert.match(
      proxy,
      /return new Response\(null, \{ status: 101, webSocket: res\.webSocket \}\)/,
      'the upgrade must be returned as a 101 with the socket attached',
    );
  });

  it('the upgrade branch runs BEFORE the streamed-body response', () => {
    // `new Response(res.body, { status: 101 })` throws RangeError — rebuilding a
    // 101 is impossible, so this branch can never be reached "later".
    const upgradeAt = proxy.indexOf('res.webSocket');
    const streamAt = proxy.indexOf('res.body');
    assert.ok(upgradeAt > 0, 'proxy must mention res.webSocket');
    assert.ok(streamAt > upgradeAt, 'streamed response must come after the upgrade branch');
  });

  it('still streams SSE verbatim (no buffering) for non-upgrade responses', () => {
    assert.match(proxy, /X-Accel-Buffering/, 'SSE must not be buffered by the proxy');
  });
});

describe('live transport — worker → EventHub → client', () => {
  it('the worker route forwards the upgrade to the DO stream', () => {
    assert.match(route, /EVENT_HUB/, 'route must use the EVENT_HUB binding');
    assert.match(route, /idFromName\('global'\)/, 'one global hub instance');
    assert.match(route, /stub\.fetch\(new Request\('https:\/\/hub\/stream', c\.req\.raw\)\)/,
      'the ORIGINAL request must be forwarded (it carries the Upgrade headers)');
    assert.doesNotMatch(route, /new Response\(res\.body/, 'the route must return the DO response untouched');
  });

  it('the DO accepts the socket and answers 101 with webSocket', () => {
    assert.match(hub, /url\.pathname === '\/stream'/, 'DO serves /stream');
    assert.match(hub, /acceptWebSocket/, 'hibernation API accepts the socket');
    assert.match(hub, /status: 101, webSocket: pair\[0\]/, 'DO must complete the handshake');
    assert.match(hub, /pathname === '\/broadcast'/, 'DO exposes /broadcast');
  });

  it('broadcastLive posts to /broadcast fire-and-forget', () => {
    assert.match(live, /https:\/\/hub\/broadcast/, 'broadcast URL');
    assert.match(live, /c\.executionCtx\.waitUntil/, 'broadcast must never block the write path');
  });

  it('the client connects once to /api/events and feeds the shared bus', () => {
    assert.match(hook, /new WebSocket\(`\$\{proto\}\/\/\$\{window\.location\.host\}\/api\/events`\)/,
      'one module-level socket to the same origin (the Pages proxy)');
    assert.match(hook, /data\.type !== "hello"/, 'the hub hello frame is not an event');
    assert.match(hook, /bus\.addEventListener\("live"/, 'events fan out on the shared bus');
  });
});

describe('live transport — a broken socket may not require a manual reload', () => {
  it('desk inboxes poll as a safety net (cross-desk data has no local echo)', () => {
    const threads = read(FRONTEND_SRC, 'enquiry-threads', 'useThreads.ts');
    assert.match(threads, /pollMs: POLL_MS/, 'thread queries need a slow poll');
    assert.match(threads, /const POLL_MS = 60_000/, 'safety net stays slow (1/min)');
    const polls = threads.split('pollMs: POLL_MS').length - 1;
    assert.equal(polls, 2, 'both hooks poll: the per-enquiry list and the desk inbox (open + resolved)');
  });
});
