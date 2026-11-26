// ── Auto dialer: shared types + compiled defaults ───────────────────────────
// The Controller (sales head / root) owns every value here; phones pull the
// config on each sync. mirror: android/Auto-Dialer/.../remote/DialerConfig.kt

export interface Disposition {
  /** Stable key stored on DeviceCall.disposition (UPPER_SNAKE). */
  key: string;
  label: string;
  /** Counts as "reached the customer" in reports. */
  connected: boolean;
  /** Busy / not answered style: re-queued automatically. */
  retry: boolean;
  /** Asks for a callback date + time (timer pauses while picking). */
  callback: boolean;
}

export interface BreakReason {
  key: string;
  label: string;
  /** 0 = no limit. Overruns are flagged in the report and live board. */
  maxMin: number;
  /** "Other"-style reasons ask for a short note. */
  needsNote: boolean;
}

/**
 * A break the sales head schedules (IST, HH:MM). Inside the window the phone
 * locks the dialer. `agents` = telecaller ids it applies to; empty = everyone.
 */
export interface ScheduledBreak {
  id: string;
  label: string;
  start: string;
  end: string;
  agents: string[];
}

export interface DialerConfig {
  /** Seconds the disposition window stays open before auto-saving. */
  dispositionSec: number;
  /** Countdown before the next queued call dials. */
  nextCallSec: number;
  /** Shift window (IST, HH:MM). Dialing is locked outside it. */
  shiftStart: string;
  shiftEnd: string;
  /**
   * Retry dispositions come back after this gap. After retryMax attempts the
   * lead stops re-queuing and is marked unreachable (queue status).
   */
  retryGapMin: number;
  retryMax: number;
  /**
   * A call with at least this much talk time connected: it is never re-dialed,
   * even when the agent picks a retry disposition (Not Answered/Busy/…). 0 = off.
   */
  connectedMinSec: number;
  /**
   * "Lead time": after a call the agent can pause auto-dialing for this many
   * minutes (once per call) to work the lead; the disposition window resumes
   * when it ends. Logged as a LEAD_TIME break. 0 = the button is hidden.
   */
  leadTimeMin: number;
  /** Follow-ups / callbacks can be set at most this many days ahead. */
  followUpMaxDays: number;
  dispositions: Disposition[];
  breakReasons: BreakReason[];
  scheduledBreaks: ScheduledBreak[];
  /** Also report calls made/received in the phone's own dialer (call log). */
  trackPhoneCalls: boolean;
  updatedAt: string;
  updatedBy: string;
}

/** System disposition written when the timer runs out on a call with talk time. */
export const NOT_DISPOSED = 'NOT_DISPOSED';
/** System disposition written when the timer runs out on a 0-second call. */
export const AUTO_NOT_ANSWERED = 'NOT_ANSWERED';

export const DEFAULT_DISPOSITIONS: Disposition[] = [
  { key: 'CONNECTED', label: 'Connected', connected: true, retry: false, callback: false },
  { key: 'INTERESTED', label: 'Interested', connected: true, retry: false, callback: false },
  { key: 'NOT_INTERESTED', label: 'Not Interested', connected: true, retry: false, callback: false },
  { key: 'CALLBACK', label: 'Callback Required', connected: true, retry: false, callback: true },
  { key: 'FOLLOW_UP', label: 'Follow-up Required', connected: true, retry: false, callback: true },
  { key: 'BUSY', label: 'Busy', connected: false, retry: true, callback: false },
  { key: 'NOT_ANSWERED', label: 'Not Answered', connected: false, retry: true, callback: false },
  { key: 'REJECTED', label: 'Rejected', connected: false, retry: true, callback: false },
  { key: 'WRONG_NUMBER', label: 'Wrong Number', connected: false, retry: false, callback: false },
  { key: 'FAILED', label: 'Call Failed', connected: false, retry: true, callback: false },
];

export const DEFAULT_BREAK_REASONS: BreakReason[] = [
  { key: 'LUNCH', label: 'Lunch', maxMin: 30, needsNote: false },
  { key: 'TEA', label: 'Tea', maxMin: 15, needsNote: false },
  { key: 'MEETING', label: 'Meeting', maxMin: 0, needsNote: false },
  { key: 'TRAINING', label: 'Training', maxMin: 0, needsNote: false },
  { key: 'WASHROOM', label: 'Washroom', maxMin: 10, needsNote: false },
  { key: 'SYSTEM', label: 'System issue', maxMin: 0, needsNote: true },
  { key: 'OTHER', label: 'Other', maxMin: 0, needsNote: true },
];

export const DEFAULT_CONFIG: DialerConfig = {
  dispositionSec: 20,
  nextCallSec: 3,
  shiftStart: '09:00',
  shiftEnd: '21:00',
  retryGapMin: 120,
  retryMax: 3,
  connectedMinSec: 15,
  leadTimeMin: 10,
  followUpMaxDays: 30,
  dispositions: DEFAULT_DISPOSITIONS,
  breakReasons: DEFAULT_BREAK_REASONS,
  scheduledBreaks: [],
  trackPhoneCalls: true,
  updatedAt: '',
  updatedBy: '',
};

export const CONFIG_KEY = 'dialer:config';

/** Live agent states the phone reports (DeviceRegistration.liveState). */
export const LIVE_STATES = new Set(['idle', 'dialing', 'on_call', 'disposition', 'lead_time', 'break', 'manual', 'paused', 'off_shift']);

/** Break reason the phone logs for an agent's "Lead time" pause (not a Controller break reason). */
export const LEAD_TIME_REASON = 'LEAD_TIME';

/** One push batch as the Controller sees it in the dialer (backend: queue.ts listBatches). */
export interface DialerBatchView {
  batchId: string;
  createdAt: string;
  region: string;
  state: string;
  requestedByName: string;
  agents: number;
  total: number;
  waiting: number;
  worked: number;
  removed: number;
}

export interface QueueItemView {
  id: string;
  customerId: string;
  mobile: string;
  name: string;
  company: string;
  region: string;
  state: string;
  district: string;
  clientType: string;
  source: string;
  attempts: number;
  dueAt: string;
  lastDisposition: string;
}
