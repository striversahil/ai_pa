/**
 * webhook-relay.js — zero-dependency WhatsApp webhook sink.
 *
 * Sits between WAHA and the main backend. WAHA POSTs every message event here
 * (instead of hitting the backend directly); this service:
 *
 *   1. Acks WAHA with 200 IMMEDIATELY — WAHA never enters its retry loop.
 *   2. Appends the raw payload to a durable write-ahead log on disk.
 *   3. Drains the log to the backend (POST /api/whatsapp/webhook). If the
 *      backend is down, it simply waits and retries with backoff — the burst is
 *      held on disk, not lost. When the backend comes back, everything drains.
 *
 * Crash-safe: payloads are durable once acked (written to disk). A relay crash
 * loses nothing; on restart it resumes from the last flushed offset. If the
 * offset is slightly behind, already-forwarded lines are re-sent — harmless,
 * because the backend dedupes by wahaMessageId.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.RELAY_PORT || '5099', 10);
const BACKEND = process.env.RELAY_BACKEND || 'http://127.0.0.1:5000';
const FORWARD_PATH = process.env.RELAY_FORWARD_PATH || '/api/whatsapp/webhook';
const LOG_DIR = process.env.RELAY_LOG_DIR || path.join(__dirname, '..', 'founder-os_backend', '.runtime');
const LOG_FILE = path.join(LOG_DIR, 'webhook-relay.log');
const OFFSET_FILE = path.join(LOG_DIR, 'webhook-relay.offset');
const DRAIN_INTERVAL_MS = 2000;
const FORWARD_TIMEOUT_MS = 10000;

let flushedOffset = 0;
let draining = false;
let writeChain = Promise.resolve();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function ensureDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function loadOffset() {
  ensureDir();
  try {
    const raw = fs.readFileSync(OFFSET_FILE, 'utf-8');
    flushedOffset = parseInt(raw, 10) || 0;
  } catch {
    flushedOffset = 0;
  }
  // If the log was truncated/rotated while we were down, restart from 0.
  try {
    const size = fs.statSync(LOG_FILE).size;
    if (flushedOffset > size) flushedOffset = 0;
  } catch {
    // no log file yet
  }
  log('Resuming from flushed offset', flushedOffset);
}

function saveOffset() {
  try {
    fs.writeFileSync(OFFSET_FILE, String(flushedOffset));
  } catch (err) {
    log('WARN offset write failed:', err.message);
  }
}

/** Append one parsed payload (object) to the log as a single JSON line. */
function appendLog(payload) {
  const line = JSON.stringify({ t: Date.now(), body: payload });
  writeChain = writeChain
    .then(() => fs.promises.appendFile(LOG_FILE, line + '\n'))
    .catch((err) => log('WARN append failed:', err.message));
  return writeChain;
}

/** Forward one parsed line's body to the backend. Resolves true on 2xx. */
function forward(body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      BACKEND + FORWARD_PATH,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: FORWARD_TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        if (!ok) log('Forward rejected, backend status', res.statusCode);
        resolve(ok);
      }
    );
    req.on('timeout', () => {
      log('Forward timeout, will retry');
      req.destroy();
      resolve(false);
    });
    req.on('error', (err) => {
      log('Forward error (backend down?):', err.message);
      resolve(false);
    });
    req.write(payload);
    req.end();
  });
}

async function drainOnce() {
  if (draining) return;
  draining = true;
  try {
    let size;
    try {
      size = fs.statSync(LOG_FILE).size;
    } catch {
      return; // nothing logged yet
    }
    if (flushedOffset > size) flushedOffset = 0;
    if (flushedOffset >= size) return;

    const data = fs.readFileSync(LOG_FILE);
    const tail = data.toString('utf8', flushedOffset);
    const lines = tail.split('\n');
    // Last element is either '' or an incomplete line (crash mid-write) — skip it.
    const complete = lines.slice(0, -1).filter((l) => l.trim().length > 0);

    let advanced = flushedOffset;
    for (const line of complete) {
      let body;
      try {
        body = JSON.parse(line).body;
      } catch {
        // Corrupt line — skip it (cannot recover) rather than stall the queue.
        log('WARN skipping unparseable log line');
        advanced += Buffer.byteLength(line) + 1;
        continue;
      }
      const ok = await forward(body);
      if (!ok) return; // backend down — stop, retry next tick
      advanced += Buffer.byteLength(line) + 1;
    }

    if (advanced !== flushedOffset) {
      flushedOffset = advanced;
      saveOffset();
    }

    // Fully drained → truncate the log so it stays small.
    if (flushedOffset >= size && size > 0) {
      try {
        fs.truncateSync(LOG_FILE, 0);
        flushedOffset = 0;
        saveOffset();
      } catch (err) {
        log('WARN truncate failed:', err.message);
      }
    }
  } finally {
    draining = false;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(404);
    res.end();
    return;
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const raw = Buffer.concat(chunks);
    let parsed;
    try {
      parsed = JSON.parse(raw.toString('utf8')); // validate JSON before persisting
    } catch {
      res.writeHead(400);
      res.end('invalid json');
      return;
    }
    await appendLog(parsed); // durable before ack
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"success":true}');
    void drainOnce();
  });
  req.on('error', () => {
    res.writeHead(500);
    res.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  log('webhook-relay listening on', PORT, '-> forwarding to', BACKEND + FORWARD_PATH);
  loadOffset();
  setInterval(drainOnce, DRAIN_INTERVAL_MS);
  void drainOnce();
});
