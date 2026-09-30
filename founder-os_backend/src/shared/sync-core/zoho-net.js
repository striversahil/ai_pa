// zoho-net.js — Zoho Books HTTP layer (ONE copy of each retry policy).
//
// Moved from scripts/zoho-sync/fetch.js (estimates policy) and
// scripts/crm-runner.js (list policy). The two policies differ on purpose —
// the estimates tick paces list calls and absorbs connection drops + 429s,
// the CRM list scan absorbs 429s AND 5xx but fails fast on connection drops
// (its preservative-heartbeat path owns that case) — so both are preserved
// verbatim here, sharing only the single-attempt primitive. Callers pass
// headers explicitly (no module-level credential state): the runners close
// over their own parsed context as before.

'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Jittered backoff: honors Zoho's retry-after, escalates mildly per attempt,
// and desynchronizes parallel jobs (crm + zoho-sent tick together) so their
// retries don't collide again.
function throttleBackoffMs(attempt, retryAfterMs) {
  const base = Math.min(Math.max(retryAfterMs || 45000, 5000), 90000);
  return Math.round(Math.min(base * (0.8 + Math.random() * 0.4) * attempt, 180000));
}

// One Zoho call, no retry. Throws typed errors the policies switch on:
//   - err.connect = true        → TCP/DNS/abort failure (tarpit included)
//   - err.retryAfterMs (number) → HTTP 429 (Zoho's retry-after, default 45s)
//   - plain Error               → any other non-2xx (message: `Zoho <st> for <url>`)
async function zohoFetchOnce(url, headers, { timeoutMs = 30000 } = {}) {
  let res;
  try {
    // timeoutMs cap per call — a tarpitted connection fails fast into a retry,
    // never hangs the tick.
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = new Error(`Zoho connection failed for ${url}: ${e.message}`);
    err.connect = true;
    err.cause = e;
    throw err;
  }
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '45', 10);
    const err = new Error(`Zoho 429 rate-limited for ${url}`);
    err.retryAfterMs = (isNaN(retryAfter) ? 45 : retryAfter) * 1000;
    throw err;
  }
  if (!res.ok) throw new Error(`Zoho ${res.status} for ${url}`);
  return res.json();
}

// Estimates policy (was fetch.js zohoFetch): retries connection drops with a
// ~10s wait and 429s with throttleBackoffMs. Anything else throws immediately.
// Log lines preserved: `connection failed — retrying…` and `429 — backing off…`.
async function zohoFetchJson(url, headers, { retries = 3, timeoutMs = 30000, log = null } = {}) {
  const say = log || ((m) => console.log(m));
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await zohoFetchOnce(url, headers, { timeoutMs });
    } catch (e) {
      if (e.retryAfterMs == null && !e.connect) throw e;
      if (e.retryAfterMs != null) {
        lastErr = new Error(`Zoho 429 rate-limited for ${url}`);
        if (attempt < retries) {
          const wait = throttleBackoffMs(attempt + 1, e.retryAfterMs);
          say(`zoho-sync/fetch: 429 — backing off ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/${retries + 1})…`);
          await sleep(wait);
          continue;
        }
        throw lastErr;
      }
      lastErr = new Error(`Zoho fetch failed (attempt ${attempt + 1}/${retries + 1}): ${e.cause?.message || e.message}`);
      if (attempt < retries) {
        say(`zoho-sync/fetch: connection failed — retrying in ~10s (attempt ${attempt + 1}/${retries + 1})…`);
        await sleep(10000 + Math.random() * 5000);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

// CRM list policy (was crm-runner zohoFetchList): absorbs 429 + 5xx with
// retry-after + jitter escalated per attempt (worst case ~4 min, fits the
// tick); connection drops and anything else throw immediately — the runner's
// preservative-heartbeat path owns that case. Detail fetches use zohoFetchOnce
// directly with their own one-retry + circuit-breaker policy (stays in the runner).
async function zohoFetchListJson(url, headers, { retries = 3, timeoutMs = 30000, log = null } = {}) {
  const say = log || ((m) => console.log(m));
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await zohoFetchOnce(url, headers, { timeoutMs });
    } catch (e) {
      lastErr = e;
      const waitMs = Math.min(e?.retryAfterMs ?? 15000, 90000);
      if (attempt < retries && (e?.retryAfterMs || /Zoho (429|5\d\d)/.test(e.message))) {
        const wait = Math.round(waitMs * (0.8 + Math.random() * 0.4) * (attempt + 1));
        say(`crm-runner: list throttled — backing off ${Math.round(Math.min(wait, 180000) / 1000)}s (attempt ${attempt + 1}/${retries + 1})…`);
        await sleep(Math.min(wait, 180000));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

module.exports = { sleep, throttleBackoffMs, zohoFetchOnce, zohoFetchJson, zohoFetchListJson };
