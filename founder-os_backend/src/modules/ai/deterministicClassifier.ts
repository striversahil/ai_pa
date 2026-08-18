/**
 * Deterministic rule-based classifier for the LATEST estimate comment.
 *
 * Returns a full classification object when a rule matches (100% repeatable),
 * or null when the comment doesn't match any rule (fall back to the LLM).
 * The object shape matches AIService.classifyLatestEstimateComment output.
 */

export interface DeterministicClassification {
  meaningful_update: boolean;
  not_answering: boolean;
  under_discussion: boolean;
  confirm: boolean;
  confirm_date: string;
  reasoning: string;
}

const YES_COMMIT = /\b(will|going to|will be|shall)\b.{0,40}\b(confirm|finalize|finalise|place( the)? order|send( the)? po|send( the)? p\.o\.?|give( the)? order|share( the)? po|update us|update me|revert)\b/i;
const CONFIRMED = /\b(order (is|has been|was) (final|confirmed|placed)|confirmed( the)? order|order final|po received|po (is )?received|placed( the)? order|order placed|final(iz|is)ed the order)\b/i;
const ACTIVE_ORDER = /\b(is|will be|he is|she is|they are)\s+ordering( for| the)?\b|\border(ing|ed)? (in )?(process|progress)\b|\bin the process of ordering\b/i;
const FIRM_COMMIT = /\b(will|going to)\b.{0,30}\b(confirm|finalize|finalise|place|send (the )?po|give|decide|share|visit|come|reach|check samples)\b/i;
const INTERNAL_HANDOFF = /\b(sir|sir|ma'am|madam|madam)\s+(will|is going to|will be)\s+(deal|handle|take (care|over)|manage)\b/i;
const UNDER_DISCUSSION = /\b(under discussion|negotiat|discuss(ing)? with (his|their|her) (management|partner|team|owner|boss)|price (not )?match(ing)?|match( the|ing)? (the )?price|rates are not matching|will match)\b/i;
const FUTURE_DATE = /(\b\d{1,2}(st|nd|rd|th)?(\s+of)?\s+(aug|sep|sept|oct|nov|dec|jan|feb|mar|apr|may|jun|jul|august|september|october|november|december|january|february|march|april|june|july)\b)|(\b\d{1,2}-\d{1,2}-\d{4}\b)|(\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)|(\b(today|tomorrow)\b)|(\b(after|in|within)\s+\d{1,2}(\s|-)?(days?|weeks?)\b)|(\bnext\s+(week|month)\b)|(\bafter\s+(\d{1,2}(st|nd|rd|th)?\b))/i;
const VAGUE_REVERT = /\b(will|wll|willl|wil|going to|have to)\b.{0,50}\b(check|see|look|let( (me|us))? know|intimate|inform|say|update|revert|confirm|take some time|not (have|has) (checked|seen)|hasn'?t (checked|seen)|get back|come back)\b/i;
const NOT_ANSWERING = /\b(not answering|not answer|couldn'?t?t reach|not connected|not conne+cted|disconnect(ed|ing)?|didn'?t pick|did not pick|busy( on another call)?|on another call|call(ed)? back to later|call back later|couldn'?t reach|no answer|not reachable|incoming service is not available|service is not available)\b/i;
const REJECTION = /\b(not require|not needed|no requirement|doesn'?t need|do not need|declined|decline|price inquiry|price enquiry|just (a )?price)\b/i;
const BARE_ACTION = /\b(called|call(ed)? him|message(ed)? sent|whatsapp sent|whatsapp message sent|left (a )?message|sent (the )?quotation|quotation (was )?sent|quote (was )?sent|email(ed)? sent|shared (the )?quotation)\b/i;
const QUOTATION_ONLY = /\b(enquiry|enq\.?|quote (created|updated)|rates?\s+pending|product (spec|details?)|specifications?)\b/i;
const SPEC_BLOCK = /\b(thickness|width|length|dia|diameter|ply|pc(s)?|meter|metre|feet|inch(es)?|mm|airlock|belt|gear|pulley|bucket|grade|application)\b[\s\S]{0,200}\b(thickness|width|length|dia|diameter|ply|pc(s)?|meter|metre|feet|inch(es)?|mm|airlock|belt|gear|pulley|bucket)\b/i;
const PURCHASED_ELSEWHERE = /\b(purchased? (from|at) (local )?(shop|market)|buy(ing)? from (local )?(shop|market)|already (bought|purchased) (from )?(elsewhere|other))\b/i;
const SYSTEM_AUTO = /\b(quote (marked as sent|created|updated|sent)|amount changed from|converted to sales order|quote emailed to|quote viewed|viewed the quote)\b/i;

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6
};

function parseFutureDate(comment: string, today: Date): Date | null {
  const lower = comment.toLowerCase();
  const dayMatch = /\b(\d{1,2})(st|nd|rd|th)?(\s+of)?\s+(aug|sep|sept|oct|nov|dec|jan|feb|mar|apr|may|jun|jul)/.exec(lower);
  if (dayMatch) {
    const monthNames: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6,
      aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11
    };
    const d = new Date(today.getFullYear(), monthNames[dayMatch[4]], parseInt(dayMatch[1], 10));
    if (d.getMonth() !== monthNames[dayMatch[4]]) return null;
    return d;
  }
  const isoMatch = /(\d{1,2})-(\d{1,2})-(\d{4})/.exec(lower);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[3], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[1], 10));
  }
  const weekdayMatch = /(?:on\s+|this\s+|next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.exec(lower);
  if (weekdayMatch) {
    const target = WEEKDAYS[weekdayMatch[1]];
    const nowDay = today.getDay();
    let diff = (target - nowDay + 7) % 7;
    if (/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.test(lower)) diff += 7;
    if (diff === 0) diff = 7;
    const d = new Date(today);
    d.setDate(d.getDate() + diff);
    return d;
  }
  const relDays = /(?:after|in|within)\s+(\d{1,2})\s*(days?|weeks?)/.exec(lower);
  if (relDays) {
    const n = parseInt(relDays[1], 10);
    const mult = relDays[2].startsWith('week') ? 7 : 1;
    const d = new Date(today);
    d.setDate(d.getDate() + n * mult);
    return d;
  }
  if (/\btoday\b/.test(lower)) return new Date(today);
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }
  return null;
}

function hasPassedDueDate(comment: string, estimateDate: string, today: Date): boolean {
  const created = new Date(estimateDate);
  const estOlderThan3Days = today.getTime() - created.getTime() > 3 * 24 * 60 * 60 * 1000;
  const parsed = parseFutureDate(comment, today);
  // A follow-up due TODAY is still actionable — only dates strictly before
  // the start of today count as passed (e.g. "Call him after 20th July" read
  // in August).
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  if (parsed && parsed.getTime() < startOfToday.getTime()) {
    return true; // mentioned date already passed
  }
  if (!FUTURE_DATE.test(comment) && estOlderThan3Days) {
    return true; // no future date + old estimate
  }
  return false;
}

export function classifyDeterministic(
  latestComment: string,
  estimateDate: string
): DeterministicClassification | null {
  const comment = (latestComment || '').trim();
  const today = new Date();

  if (!comment) return null;

  // RULE 0: System auto-generated comments → not meaningful (defensive; usually filtered upstream)
  if (SYSTEM_AUTO.test(comment)) {
    return {
      meaningful_update: false,
      not_answering: false,
      under_discussion: false,
      confirm: false,
      confirm_date: 'None',
      reasoning: 'Deterministic rule: system-generated comment (not a sales agent note).'
    };
  }

  // RULE 1: Confirmed / PO received / order placed → meaningful + confirm
  if (CONFIRMED.test(comment)) {
    return {
      meaningful_update: true,
      not_answering: false,
      under_discussion: false,
      confirm: true,
      confirm_date: today.toISOString().split('T')[0],
      reasoning: `Deterministic rule: comment indicates order confirmation ("${comment.slice(0, 80)}").`
    };
  }

  // RULE 2: Firm customer commitment (confirm / finalize / place order) → meaningful
  // Checked BEFORE not-answering so "busy, will connect Monday" / "not connected, will
  // confirm in 2 days" are treated as meaningful (the commitment is the signal).
  if (YES_COMMIT.test(comment) || FIRM_COMMIT.test(comment) || ACTIVE_ORDER.test(comment)) {
    const isUnderDiscussion = UNDER_DISCUSSION.test(comment);
    return {
      meaningful_update: true,
      not_answering: false,
      under_discussion: isUnderDiscussion,
      confirm: false,
      confirm_date: 'None',
      reasoning: `Deterministic rule: customer made a firm commitment ("${comment.slice(0, 80)}").`
    };
  }

  // RULE 2b: Explicit future follow-up date → meaningful (before not-answering)
  if (FUTURE_DATE.test(comment)) {
    const passed = hasPassedDueDate(comment, estimateDate, today);
    if (!passed) {
      return {
        meaningful_update: true,
        not_answering: false,
        under_discussion: UNDER_DISCUSSION.test(comment),
        confirm: false,
        confirm_date: 'None',
        reasoning: `Deterministic rule: comment sets a specific future follow-up date ("${comment.slice(0, 80)}").`
      };
    }
    // Date mentioned but already passed → stale instruction, not meaningful
    return {
      meaningful_update: false,
      not_answering: false,
      under_discussion: false,
      confirm: false,
      confirm_date: 'None',
      reasoning: `Deterministic rule: follow-up date mentioned has already passed ("${comment.slice(0, 80)}").`
    };
  }

  // RULE 3: Call not answering / busy / disconnected / not connected → not meaningful
  if (NOT_ANSWERING.test(comment)) {
    return {
      meaningful_update: false,
      not_answering: true,
      under_discussion: false,
      confirm: false,
      confirm_date: 'None',
      reasoning: `Deterministic rule: comment shows the customer did not answer / was unreachable ("${comment.slice(0, 80)}").`
    };
  }

  // RULE 4: Definite rejection / not required → not meaningful
  if (REJECTION.test(comment)) {
    return {
      meaningful_update: false,
      not_answering: false,
      under_discussion: false,
      confirm: false,
      confirm_date: 'None',
      reasoning: `Deterministic rule: customer declined or stated no requirement ("${comment.slice(0, 80)}").`
    };
  }

  // RULE 5: Internal handoff (sir will deal with him) → not meaningful
  if (INTERNAL_HANDOFF.test(comment)) {
    return {
      meaningful_update: false,
      not_answering: false,
      under_discussion: false,
      confirm: false,
      confirm_date: 'None',
      reasoning: `Deterministic rule: internal handoff note ("${comment.slice(0, 80)}").`
    };
  }

  // RULE 6: Vague promise to revert / check later with NO date → not meaningful
  if (VAGUE_REVERT.test(comment) && !FUTURE_DATE.test(comment)) {
    return {
      meaningful_update: false,
      not_answering: false,
      under_discussion: false,
      confirm: false,
      confirm_date: 'None',
      reasoning: `Deterministic rule: vague promise to revert with no follow-up date ("${comment.slice(0, 80)}").`
    };
  }

  // RULE 7: Bare action only (called / messaged / sent quotation), no outcome → not meaningful
  if (BARE_ACTION.test(comment)) {
    return {
      meaningful_update: false,
      not_answering: false,
      under_discussion: false,
      confirm: false,
      confirm_date: 'None',
      reasoning: `Deterministic rule: comment records an action with no outcome or next step ("${comment.slice(0, 80)}").`
    };
  }

  // RULE 8: Quotation-only / product spec / enquiry note → not meaningful
  if (QUOTATION_ONLY.test(comment) || SPEC_BLOCK.test(comment)) {
    return {
      meaningful_update: false,
      not_answering: false,
      under_discussion: false,
      confirm: false,
      confirm_date: 'None',
      reasoning: `Deterministic rule: quotation-only / spec / enquiry entry ("${comment.slice(0, 80)}").`
    };
  }

  // RULE 9: Customer purchased elsewhere → closed, not meaningful
  if (PURCHASED_ELSEWHERE.test(comment)) {
    return {
      meaningful_update: false,
      not_answering: false,
      under_discussion: false,
      confirm: false,
      confirm_date: 'None',
      reasoning: `Deterministic rule: customer purchased from another source ("${comment.slice(0, 80)}").`
    };
  }

  // No rule matched → fall back to LLM
  return null;
}