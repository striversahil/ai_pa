import fs from 'fs';
import path from 'path';
import { logger } from '../../shared/logger';

/**
 * Persistent storage for the WhatsApp outbound rate-limiter.
 *
 * The send counters (per-chat per-minute and per-account per-hour) live in
 * memory for speed, but a backend restart used to reset them to zero — a
 * post-restart burst at 8 AM would then fire unthrottled and risk a WhatsApp
 * ban. This store writes the counters to a small JSON file (write-behind,
 * debounced) so restarts keep throttling from where the previous process
 * stopped. Redis is deliberately NOT used: the limiter must keep working even
 * when Redis (the queue backend) is down.
 */

export interface RateLimitState {
  accountTimestamps: number[];
  hourLimit: number;
  chatTimestamps: Record<string, number[]>;
}

const STATE_FILE = path.join(process.cwd(), '.runtime', 'rate-limit-state.json');
const WRITE_DEBOUNCE_MS = 3000;

let cachedState: RateLimitState | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let saveInFlight = false;

function defaultState(): RateLimitState {
  // hourLimit: 0 signals "never persisted a real value" — the outbound service
  // recomputes the daily randomized limit (40-60/hr) and persists it.
  return { accountTimestamps: [], hourLimit: 0, chatTimestamps: {} };
}

function readState(): RateLimitState {
  if (cachedState) return cachedState;
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<RateLimitState>;
      cachedState = {
        accountTimestamps: Array.isArray(parsed.accountTimestamps) ? parsed.accountTimestamps : [],
        hourLimit: typeof parsed.hourLimit === 'number' && parsed.hourLimit > 0 ? parsed.hourLimit : 0,
        chatTimestamps: parsed.chatTimestamps && typeof parsed.chatTimestamps === 'object' ? parsed.chatTimestamps : {},
      };
    } else {
      cachedState = defaultState();
    }
  } catch (err: any) {
    logger.warn({ error: err.message }, 'Rate-limit store: could not read state file, starting fresh');
    cachedState = defaultState();
  }
  return cachedState;
}

export function getRateLimitState(): RateLimitState {
  return readState();
}

function writeState(): void {
  if (!cachedState) return;
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(cachedState));
  } catch (err: any) {
    logger.warn({ error: err.message }, 'Rate-limit store: could not write state file');
  }
}

/** Marks the in-memory state dirty and schedules a debounced flush to disk. */
export function persistRateLimitState(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!saveInFlight) {
      saveInFlight = true;
      try {
        writeState();
      } finally {
        saveInFlight = false;
      }
    }
  }, WRITE_DEBOUNCE_MS);
}

function flushNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    writeState();
  } catch {
    // best-effort; nothing actionable at exit time
  }
}

process.on('exit', flushNow);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, flushNow);
}
