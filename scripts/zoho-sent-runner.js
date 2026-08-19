#!/usr/bin/env node

/**
 * zoho-sent-runner.js — full Zoho sent-estimate sync + AI analysis ON the GH
 * Actions runner (unlimited CPU), replacing the old worker trigger + the
 * separate zoho-ai-classify.js step.
 *
 * Flow:
 *  1. Fetch active sent estimates from Zoho Books API (runner-side, direct).
 *  2. Fetch current DB state from the worker (estimates + classifications +
 *     max comment id per estimate).
 *  3. Metadata upsert → POST /api/estimates/bulk-upsert.
 *  4. Closed-status sync for estimates no longer "sent" in Zoho.
 *  5. Comment refresh for every active estimate (parallel, small concurrency).
 *  6. Change detection → deterministic classify → LLM fallback → POST results.
 *  7. Advance the last-complete-sync watermark when the pass fully succeeds.
 *
 * Env: WORKER_URL, SHARED_SECRET, OMNIROUTE_BASE_URL, OMNIROUTE_API_KEY,
 * OMNIROUTE_MODEL. Zoho credentials are inferred automatically from the curl
 * export at zoho_sent/sent_estimates.txt (URL + cookies + CSRF headers).
 */

const { requireEnv, workerRequest, omnirouteJson } = require('./runner-lib');
const fs = require('fs');
const path = require('path');

const missing = [];
if (!process.env.WORKER_URL) missing.push('WORKER_URL');
if (!process.env.SHARED_SECRET) missing.push('SHARED_SECRET');
if (!process.env.OMNIROUTE_BASE_URL) missing.push('OMNIROUTE_BASE_URL');
if (!process.env.OMNIROUTE_API_KEY) missing.push('OMNIROUTE_API_KEY');
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

/**
 * Parses the Zoho Books credentials from the curl export file
 * (zoho_sent/sent_estimates.txt). Returns { url, headers, orgId }.
 */
function parseCurlFile() {
  const candidates = [
    path.join(__dirname, '..', 'zoho_sent', 'sent_estimates.txt'),
    path.join(process.cwd(), 'zoho_sent', 'sent_estimates.txt'),
    '/app/zoho_sent/sent_estimates.txt',
  ];
  let curlFile = candidates.find((p) => fs.existsSync(p));
  if (!curlFile) throw new Error(`Zoho credentials file not found (tried: ${candidates.join(', ')})`);

  const content = fs.readFileSync(curlFile, 'utf-8');
  const urlMatch = content.match(/curl\s+'([^']+)'/) || content.match(/curl\s+"([^"]+)"/) || content.match(/curl\s+([^\s\\]+)/);
  if (!urlMatch) throw new Error('Could not extract URL from sent_estimates.txt');
  const url = urlMatch[1];

  const headers = {};
  const headerMatches = content.matchAll(/-H\s+'([^:]+):\s*(.*?)'(?=\s|\\|$)/g);
  for (const m of headerMatches) headers[m[1].trim()] = m[2].trim().replace(/\\$/, '').trim();
  if (Object.keys(headers).length === 0) {
    const double = content.matchAll(/-H\s+"([^:]+):\s*(.*?)"(?=\s|\\|$)/g);
    for (const m of double) headers[m[1].trim()] = m[2].trim().replace(/\\$/, '').trim();
  }

  let orgId = '';
  const orgMatch = url.match(/organization_id=([0-9]+)/);
  if (orgMatch) orgId = orgMatch[1];

  if (headers['Accept-Encoding']) headers['Accept-Encoding'] = 'gzip, deflate';
  return { url, headers, orgId };
}

const zohoCreds = parseCurlFile();
const ZOHO_BOOKS_SENT_URL = zohoCreds.url;
const ZOHO_HEADERS = zohoCreds.headers;
const orgId = zohoCreds.orgId;

// ── Deterministic classifier (ported from deterministicClassifier.ts) ────────
const YES_COMMIT = /\b(will|going to|will be|shall)\b.{0,40}\b(confirm|finalize|finalise|place( the)? order|send( the)? po|send( the)? p\.o\.?|give( the)? order|share( the)? po|update us|update me|revert)\b/i;
const CONFIRMED = /\b(order (is|has been|was) (final|confirmed|placed)|confirmed( the)? order|order final|po received|po (is )?received|placed( the)? order|order placed|final(iz|is)ed the order)\b/i;
const ACTIVE_ORDER = /\b(is|will be|he is|she is|they are)\s+ordering( for| the)?\b|\border(ing|ed)? (in )?(process|progress)\b|\bin the process of ordering\b/i;
const FIRM_COMMIT = /\b(will|going to)\b.{0,30}\b(confirm|finalize|finalise|place|send (the )?po|give|decide|share|visit|come|reach|check samples)\b/i;
const INTERNAL_HANDOFF = /\b(sir|ma'am|madam)\s+(will|is going to|will be)\s+(deal|handle|take (care|over)|manage)\b/i;
const UNDER_DISCUSSION = /\b(under discussion|negotiat|discuss(ing)? with (his|their|her) (management|partner|team|owner|boss)|price (not )?match(ing)?|match( the|ing)? (the )?price|rates are not matching|will match)\b/i;
const FUTURE_DATE = /(\b\d{1,2}(st|nd|rd|th)?(\s+of)?\s+(aug|sep|sept|oct|nov|dec|jan|feb|mar|apr|may|jun|jul|august|september|october|november|december|january|february|march|april|june|july)\b)|(\b\d{1,2}-\d{1,2}-\d{4}\b)|(\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)|(\b(today|tomorrow)\b)|(\b(after|in|within)\s+\d{1,2}(\s|-)?(days?|weeks?)\b)|(\bnext\s+(week|month)\b)|(\bafter\s+(\d{1,2}(st|nd|rd|th)?\b))/i;
const VAGUE_REVERT = /\b(will|wll|willl|wil|going to|have to)\b.{0,50}\b(check|see|look|let( (me|us))? know|intimate|inform|say|update|revert|confirm|take some time|not (have|has) (checked|seen)|hasn'?t (checked|seen)|get back|come back)\b/i;
const NOT_ANSWERING = /\b(not answering|not answer|couldn'?t reach|not connected|not conne+cted|disconnect(ed|ing)?|didn'?t pick|did not pick|busy( on another call)?|on another call|call(ed)? back to later|call back later|no answer|not reachable|incoming service is not available|service is not available)\b/i;
const REJECTION = /\b(not require|not needed|no requirement|doesn'?t need|do not need|declined|decline|price inquiry|price enquiry|just (a )?price)\b/i;
const BARE_ACTION = /\b(called|call(ed)? him|message(ed)? sent|whatsapp sent|whatsapp message sent|left (a )?message|sent (the )?quotation|quotation (was )?sent|quote (was )?sent|email(ed)? sent|shared (the )?quotation)\b/i;
const QUOTATION_ONLY = /\b(enquiry|enq\.?|quote (created|updated)|rates?\s+pending|product (spec|details?)|specifications?)\b/i;
const SPEC_BLOCK = /\b(thickness|width|length|dia|diameter|ply|pc(s)?|meter|metre|feet|inch(es)?|mm|airlock|belt|gear|pulley|bucket|grade|application)\b[\s\S]{0,200}\b(thickness|width|length|dia|diameter|ply|pc(s)?|meter|metre|feet|inch(es)?|mm|airlock|belt|gear|pulley|bucket)\b/i;
const PURCHASED_ELSEWHERE = /\b(purchased? (from|at) (local )?(shop|market)|buy(ing)? from (local )?(shop|market)|already (bought|purchased) (from )?(elsewhere|other))\b/i;
const SYSTEM_AUTO = /\b(quote (marked as sent|created|updated|sent)|amount changed from|converted to sales order|quote emailed to|quote viewed|viewed the quote)\b/i;

const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function parseFutureDate(comment, today) {
  const lower = comment.toLowerCase();
  const dayMatch = /\b(\d{1,2})(st|nd|rd|th)?(\s+of)?\s+(aug|sep|sept|oct|nov|dec|jan|feb|mar|apr|may|jun|jul)/.exec(lower);
  if (dayMatch) {
    const monthNames = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
    const d = new Date(today.getFullYear(), monthNames[dayMatch[4]], parseInt(dayMatch[1], 10));
    if (d.getMonth() !== monthNames[dayMatch[4]]) return null;
    return d;
  }
  const isoMatch = /(\d{1,2})-(\d{1,2})-(\d{4})/.exec(lower);
  if (isoMatch) return new Date(parseInt(isoMatch[3], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[1], 10));
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
  if (/\btomorrow\b/.test(lower)) { const d = new Date(today); d.setDate(d.getDate() + 1); return d; }
  return null;
}

function hasPassedDueDate(comment, estimateDate, today) {
  const created = new Date(estimateDate);
  const estOlderThan3Days = today.getTime() - created.getTime() > 3 * 24 * 60 * 60 * 1000;
  const parsed = parseFutureDate(comment, today);
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  if (parsed && parsed.getTime() < startOfToday.getTime()) return true;
  if (!FUTURE_DATE.test(comment) && estOlderThan3Days) return true;
  return false;
}

function classifyDeterministic(latestComment, estimateDate) {
  const comment = (latestComment || '').trim();
  const today = new Date();
  if (!comment) return null;
  if (SYSTEM_AUTO.test(comment)) {
    return { meaningful_update: false, not_answering: false, under_discussion: false, confirm: false, confirm_date: 'None', reasoning: `Deterministic rule: system-generated comment (not a sales agent note).` };
  }
  if (CONFIRMED.test(comment)) {
    return { meaningful_update: true, not_answering: false, under_discussion: false, confirm: true, confirm_date: today.toISOString().split('T')[0], reasoning: `Deterministic rule: comment indicates order confirmation ("${comment.slice(0, 80)}").` };
  }
  if (YES_COMMIT.test(comment) || FIRM_COMMIT.test(comment) || ACTIVE_ORDER.test(comment)) {
    return { meaningful_update: true, not_answering: false, under_discussion: UNDER_DISCUSSION.test(comment), confirm: false, confirm_date: 'None', reasoning: `Deterministic rule: customer made a firm commitment ("${comment.slice(0, 80)}").` };
  }
  if (FUTURE_DATE.test(comment)) {
    const passed = hasPassedDueDate(comment, estimateDate, today);
    if (!passed) return { meaningful_update: true, not_answering: false, under_discussion: UNDER_DISCUSSION.test(comment), confirm: false, confirm_date: 'None', reasoning: `Deterministic rule: comment sets a specific future follow-up date ("${comment.slice(0, 80)}").` };
    return { meaningful_update: false, not_answering: false, under_discussion: false, confirm: false, confirm_date: 'None', reasoning: `Deterministic rule: follow-up date mentioned has already passed ("${comment.slice(0, 80)}").` };
  }
  if (NOT_ANSWERING.test(comment)) return { meaningful_update: false, not_answering: true, under_discussion: false, confirm: false, confirm_date: 'None', reasoning: `Deterministic rule: comment shows the customer did not answer / was unreachable ("${comment.slice(0, 80)}").` };
  if (REJECTION.test(comment)) return { meaningful_update: false, not_answering: false, under_discussion: false, confirm: false, confirm_date: 'None', reasoning: `Deterministic rule: customer declined or stated no requirement ("${comment.slice(0, 80)}").` };
  if (INTERNAL_HANDOFF.test(comment)) return { meaningful_update: false, not_answering: false, under_discussion: false, confirm: false, confirm_date: 'None', reasoning: `Deterministic rule: internal handoff note ("${comment.slice(0, 80)}").` };
  if (VAGUE_REVERT.test(comment) && !FUTURE_DATE.test(comment)) return { meaningful_update: false, not_answering: false, under_discussion: false, confirm: false, confirm_date: 'None', reasoning: `Deterministic rule: vague promise to revert with no follow-up date ("${comment.slice(0, 80)}").` };
  if (BARE_ACTION.test(comment)) return { meaningful_update: false, not_answering: false, under_discussion: false, confirm: false, confirm_date: 'None', reasoning: `Deterministic rule: comment records an action with no outcome or next step ("${comment.slice(0, 80)}").` };
  if (QUOTATION_ONLY.test(comment) || SPEC_BLOCK.test(comment)) return { meaningful_update: false, not_answering: false, under_discussion: false, confirm: false, confirm_date: 'None', reasoning: `Deterministic rule: quotation-only / spec / enquiry entry ("${comment.slice(0, 80)}").` };
  if (PURCHASED_ELSEWHERE.test(comment)) return { meaningful_update: false, not_answering: false, under_discussion: false, confirm: false, confirm_date: 'None', reasoning: `Deterministic rule: customer purchased from another source ("${comment.slice(0, 80)}").` };
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function cleanHtml(rawHtml) {
  if (!rawHtml) return '';
  let text = rawHtml.replace(/<\/p>|<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/\n\s*\n/g, '\n');
  return text.trim();
}

const SYSTEM_PHRASES = [
  'estimate has been created', 'estimate has been sent', 'estimate sent', 'email sent to',
  'mail sent to', 'status changed from', 'quote created', 'quote sent', 'quote updated',
  'quote marked as', 'quote emailed to', 'quote converted', 'quote viewed', 'viewed the quote',
  'amount changed from', 'sent status', 'created by', 'updated by', 'viewed in mail',
  'client viewed', 'accepted by', 'declined by', 'payment received', 'has been printed',
  'marked as sent', 'marked as declined', 'created for',
];

function isSystemGeneratedComment(description, commentedBy) {
  if ((commentedBy || '').toLowerCase().includes('system')) return true;
  const desc = (description || '').toLowerCase();
  for (const phrase of SYSTEM_PHRASES) if (desc.includes(phrase)) return true;
  return false;
}

function isRealSalesComment(desc, commentedBy, commentType) {
  if (!desc) return false;
  if (commentType !== 'internal') return false;
  if (isSystemGeneratedComment(desc, commentedBy)) return false;
  return true;
}

async function zohoFetch(url) {
  const res = await fetch(url, { headers: ZOHO_HEADERS });
  if (!res.ok) throw new Error(`Zoho ${res.status} for ${url}`);
  return res.json();
}

// ── Prompts (ported from zoho-ai-classify.js) ────────────────────────────────
function badgePrompt() {
  return `You are a strict manager reviewing the LATEST sales comment on a work estimate.
Today's Date is: ${new Date().toISOString().split('T')[0]} (refer to this to check if the comment is older than 2 days).

You will receive exactly ONE comment, which is the most recent comment on the estimate.
The current status of the estimate is determined SOLELY by this single latest comment.
Do NOT consider any older comments — you do not have access to them.

Evaluate this single latest comment and output the following keys:
1. meaningful_update: Mark as true if THIS comment contains a meaningful work update. Mark as false if it does not.
2. Chip Mapping keys (true or false):
   - not_answering: true if THIS comment states the customer did not answer, is not replying, or call was not picked up. Else false.
   - under_discussion: true if THIS comment shows active discussions are ongoing (e.g. price negotiation, technical configuration review, requirement clarification, or visiting plans being finalized). Else false.
   - confirm: true if THIS comment shows the order/estimate has been confirmed, final verbal approval is given, payment details are being shared, or purchase order is expected. Else false.
   - confirm_date: The date (YYYY-MM-DD format) of THIS comment if 'confirm' is true. If 'confirm' is false, output "None".
3. reasoning: A short sentence explaining the assessment, quoting THIS single comment, and why the flags were set.

Strict Decision Rules:
- Base EVERY chip decision ONLY on the single latest comment provided. Do not infer anything from earlier history.
- Mark meaningful_update as false if the latest comment is older than 2 days.
- meaningful_update MUST be true if THIS comment clearly mentions a specific follow-up date, day, or time (e.g. "call after 15 August", "he said call after 15th", "will follow up on Monday", "call after 2 days"). A customer-stated or committed follow-up date is a meaningful next step.
- meaningful_update MUST also be true if THIS comment records a substantive customer response or commitment that advances the deal — e.g. the customer says they will confirm, will discuss with management/partners and revert, will place the order, accepted the price, or gave a decision/pending decision ("He will confirm after discussing it with his management", "customer will revert tomorrow", "waiting for customer confirmation"). These are meaningful updates about deal status.
- If the latest comment only records an action (calling, messaging, sending a quotation) without presenting any outcome, next step, or decision, meaningful_update must be false.
- If meaningful_update is true, then not_answering must be false. If meaningful_update is false, not_answering may be true or false as the comment dictates. under_discussion can be true regardless. confirm should typically be true when meaningful_update is true.

Response Format:
Return only a valid JSON object matching the JSON structure:
{
  "meaningful_update": false,
  "not_answering": false,
  "under_discussion": false,
  "confirm": false,
  "confirm_date": "None",
  "reasoning": ""
}
Do not include explanations or markdown outside the JSON object.`;
}

function journeyPrompt() {
  return `You are a sales operations analyst summarizing the full comment history (timeline) of a work estimate.
Today's Date is: ${new Date().toISOString().split('T')[0]}.

You will receive the complete chronological history of sales comments, ordered from NEWEST (top) to OLDEST (bottom).
Use the ENTIRE history to understand the conversation journey.

Your ONLY job is to produce:
1. summary: A concise summary of the estimate's journey — the main crux only, in at most 2 short sentences, maximum 250 characters total. Capture the current stage and where things stand (e.g., what was quoted, key customer response, latest follow-up date, whether it is confirmed/pending/negotiating). Do NOT list every touchpoint or comment; do NOT include critical judgments like "follow-up is missing", "what was not done", or "deadline passed". Keep it tight and to the point.
2. intent_score: An integer between 1 and 10 measuring the TOTAL amount of effort the sales team has invested in converting the enquiry across the entire timeline.
   Consider these guidelines:
   - 1–2: Minimal effort; little or no follow-up.
   - 3–4: Basic engagement; initial communication only.
   - 5–6: Moderate effort; regular follow-ups and quotation shared.
   - 7–8: High effort; multiple touchpoints, active negotiation, and strong customer engagement.
   - 9–10: Exceptional effort; persistent follow-ups, proactive problem-solving, decision-maker engagement, and every reasonable action taken.

Response Format:
Return only a valid JSON object matching the JSON structure:
{
  "summary": "",
  "intent_score": 0
}
Do not include explanations or markdown outside the JSON object.`;
}

async function classifyEstimate(custName, total, latestComment, dateVal, commentHistory) {
  const rule = classifyDeterministic(latestComment, dateVal);
  let badgeResult;
  if (rule) {
    badgeResult = rule;
  } else {
    try {
      badgeResult = await omnirouteJson(
        badgePrompt(),
        `Customer Name: ${custName}\nTotal Amount: ${total}\nEstimate Created Date: ${dateVal}\n\nLatest Comment:\n${latestComment}`,
        { temperature: 0 },
      );
    } catch (err) {
      badgeResult = {
        meaningful_update: false,
        not_answering: false,
        under_discussion: false,
        confirm: false,
        confirm_date: 'None',
        reasoning: `LLM unavailable (${err.message.slice(0, 80)}). Conservative default applied.`,
      };
    }
  }
  let journeyResult;
  try {
    journeyResult = commentHistory
      ? await omnirouteJson(journeyPrompt(), `Comment History:\n${commentHistory}`, { temperature: 0 })
      : { summary: 'No sales agent comment found.', intent_score: 2 };
  } catch (err) {
    journeyResult = { summary: `LLM unavailable (${err.message.slice(0, 80)}).`, intent_score: 2 };
  }
  return { badgeResult, journeyResult };
}

function finalConfirm(badgeResult) {
  let finalConfirm = badgeResult.confirm ? 'Yes' : 'No';
  if (badgeResult.confirm) {
    const confirmDateStr = badgeResult.confirm_date;
    if (confirmDateStr && confirmDateStr !== 'None') {
      try {
        const confirmDate = new Date(confirmDateStr);
        const diffDays = Math.floor((Date.now() - confirmDate.getTime()) / (24 * 60 * 60 * 1000));
        if (diffDays > 2) finalConfirm = 'No';
      } catch { finalConfirm = 'No'; }
    } else {
      finalConfirm = 'No';
    }
  }
  return finalConfirm;
}

function defaultClassification(dateVal, movingSlowOverride = null) {
  const createdDate = new Date(dateVal);
  const diffDays = Math.floor((Date.now() - createdDate.getTime()) / (24 * 60 * 60 * 1000));
  const isOlderThan5Days = diffDays > 5;
  return {
    meaningfulUpdate: false,
    notAnswering: 'No',
    movingSlow: movingSlowOverride ?? (isOlderThan5Days ? 'Yes' : 'No'),
    underDiscussion: 'No',
    confirm: 'No',
    intentScore: 2,
    reasoning: 'No sales agent comment found.',
    summary: 'No sales agent comment found.',
  };
}

function buildClassification(badgeResult, journeyResult, dateVal, movingSlowOverride = null) {
  const createdDate = new Date(dateVal);
  const isOlderThan5Days = Math.floor((Date.now() - createdDate.getTime()) / (24 * 60 * 60 * 1000)) > 5;
  return {
    meaningfulUpdate: !!badgeResult.meaningful_update,
    notAnswering: badgeResult.not_answering ? 'Yes' : 'No',
    movingSlow: movingSlowOverride ?? (isOlderThan5Days ? 'Yes' : 'No'),
    underDiscussion: badgeResult.under_discussion ? 'Yes' : 'No',
    confirm: finalConfirm(badgeResult),
    intentScore: journeyResult.intent_score ?? 2,
    reasoning: badgeResult.reasoning || '',
    summary: journeyResult.summary || '',
  };
}

async function saveCommentsAndExtract(estId, comments, existingEstimate, doSave) {
  const salesComments = [];
  if (doSave) {
    const toUpsert = comments.map((c) => ({
      commentId: c.comment_id,
      estimateId: estId,
      description: cleanHtml(c.description || ''),
      commentedBy: c.commented_by,
      date: c.date,
      dateDescription: c.date_description,
      dateFormatted: c.date_formatted || null,
    }));
    // Save in batches to keep each worker request small.
    for (let i = 0; i < toUpsert.length; i += 50) {
      await workerRequest('/api/runner/zoho/comments', { method: 'POST', body: { comments: toUpsert.slice(i, i + 50) } });
    }
  }
  for (const c of comments) {
    const descClean = cleanHtml(c.description || '');
    if (isRealSalesComment(descClean, c.commented_by, c.comment_type)) {
      salesComments.push({ id: c.comment_id, date: c.date || '', author: c.commented_by || 'Unknown', text: descClean });
    }
  }
  void existingEstimate;
  return salesComments;
}

async function processEstimate(job) {
  const { estId, custName, total, dateVal, estStatus, fetched } = job;
  const comments = fetched.comments || [];
  const salesComments = await saveCommentsAndExtract(estId, comments, null, true);

  salesComments.sort((a, b) => String(b.id).localeCompare(String(a.id)));
  const historyLines = salesComments.slice(0, 15).map((c) => `[${c.date}] ${c.author}: ${c.text}`);
  const commentHistory = historyLines.join('\n');

  let classification;
  if (!commentHistory) {
    classification = defaultClassification(dateVal);
  } else {
    const latestComment = historyLines[0] || '';
    const { badgeResult, journeyResult } = await classifyEstimate(custName, total, latestComment, dateVal, commentHistory);
    classification = buildClassification(badgeResult, journeyResult, dateVal);
  }
  void estStatus;

  await workerRequest('/api/runner/zoho/classification', {
    method: 'POST',
    body: { estimateId: estId, classification },
  });
}

async function main() {
  console.log('zoho-sent-runner: fetching active sent estimates from Zoho');
  const responseJson = await zohoFetch(ZOHO_BOOKS_SENT_URL);
  const estimates = responseJson.estimates || [];
  console.log(`zoho-sent-runner: fetched ${estimates.length} active sent estimates`);

  console.log('zoho-sent-runner: fetching current DB state from worker');
  const state = await workerRequest('/api/runner/zoho/state');
  const existingByEstId = new Map();
  for (const row of state.estimates || []) existingByEstId.set(row.estimateId, row);
  const maxCommentIdByEst = state.maxCommentIdByEstimate || {};

  const activeEstIds = new Set(estimates.map((e) => e.estimate_id));

  // 3. Metadata sync
  const metadataUpserts = [];
  for (const est of estimates) {
    const existing = existingByEstId.get(est.estimate_id);
    const metadata = {
      estimateId: est.estimate_id,
      estimateNumber: est.estimate_number,
      customerName: est.customer_name,
      total: parseFloat(est.total),
      date: est.date,
      status: est.status,
    };
    const unchanged = !!existing &&
      existing.estimateNumber === metadata.estimateNumber &&
      existing.customerName === metadata.customerName &&
      existing.total === metadata.total &&
      existing.date === metadata.date &&
      existing.status === metadata.status;
    if (unchanged) continue;
    metadataUpserts.push(metadata);
  }
  if (metadataUpserts.length) {
    await workerRequest('/api/estimates/bulk-upsert', { method: 'POST', body: { estimates: metadataUpserts } });
    console.log(`zoho-sent-runner: metadata upserted ${metadataUpserts.length}`);
  } else {
    console.log('zoho-sent-runner: metadata unchanged');
  }

  // 4. Closed status sync
  const localSent = state.estimates.filter((e) => e.status === 'sent');
  const closedStatusUpdates = [];
  for (const est of localSent) {
    if (activeEstIds.has(est.estimateId)) continue;
    console.log(`zoho-sent-runner: checking closed status for ${est.estimateNumber}`);
    try {
      const detailUrl = `https://books.zoho.com/api/v3/estimates/${est.estimateId}?organization_id=${orgId}`;
      const detailJson = await zohoFetch(detailUrl);
      const currentStatus = detailJson.estimate?.status;
      if (currentStatus && currentStatus !== 'sent') {
        closedStatusUpdates.push({ estimateId: est.estimateId, status: currentStatus });

        let comments = [];
        try {
          const cj = await zohoFetch(`https://books.zoho.com/api/v3/estimates/${est.estimateId}/comments?organization_id=${orgId}`);
          comments = cj.comments || [];
        } catch (err) { console.warn(`zoho-sent-runner: comment fetch failed for closed ${est.estimateNumber}: ${err.message}`); }

        const salesComments = await saveCommentsAndExtract(est.estimateId, comments, null, true);
        salesComments.sort((a, b) => String(b.id).localeCompare(String(a.id)));
        const historyLines = salesComments.slice(0, 15).map((c) => `[${c.date}] ${c.author}: ${c.text}`);
        const commentHistory = historyLines.join('\n');

        if (commentHistory) {
          try {
            const latestComment = historyLines[0] || '';
            const { badgeResult, journeyResult } = await classifyEstimate(est.customerName, est.total, latestComment, est.date, commentHistory);
            const classification = buildClassification(badgeResult, journeyResult, est.date, 'No');
            await workerRequest('/api/runner/zoho/classification', {
              method: 'POST',
              body: { estimateId: est.estimateId, classification },
            });
          } catch (err) { console.error(`zoho-sent-runner: AI classification error for closed estimate ${est.estimateNumber}: ${err.message}`); }
        } else {
          const classification = defaultClassification(est.date, 'No');
          await workerRequest('/api/runner/zoho/classification', {
            method: 'POST',
            body: { estimateId: est.estimateId, classification },
          });
        }
      }
    } catch (err) { console.warn(`zoho-sent-runner: closed status check failed for ${est.estimateNumber}: ${err.message}`); }
  }
  if (closedStatusUpdates.length) {
    await workerRequest('/api/runner/zoho/status', { method: 'POST', body: { updates: closedStatusUpdates } });
    console.log(`zoho-sent-runner: ${closedStatusUpdates.length} closed statuses synced`);
  }

  // 5. Comment refresh + 6. change detection
  const COMMENT_CONCURRENCY = 6;
  const fetchedByEst = new Map();
  for (let i = 0; i < estimates.length; i += COMMENT_CONCURRENCY) {
    const batch = estimates.slice(i, i + COMMENT_CONCURRENCY);
    await Promise.all(batch.map(async (est) => {
      const estId = est.estimate_id;
      try {
        const cj = await zohoFetch(`https://books.zoho.com/api/v3/estimates/${estId}/comments?organization_id=${orgId}`);
        const comments = cj.comments || [];
        let maxZohoId = '';
        for (const c of comments) {
          if (!isRealSalesComment(cleanHtml(c.description || ''), c.commented_by, c.comment_type)) continue;
          if (c.comment_id > maxZohoId) maxZohoId = c.comment_id;
        }
        const hasNew = maxZohoId > (maxCommentIdByEst[estId] || '');
        fetchedByEst.set(estId, { comments, hasNew });
      } catch (err) {
        console.warn(`zoho-sent-runner: comment fetch failed for ${est.estimate_number}: ${err.message}`);
      }
    }));
  }

  const AI_CONCURRENCY = 6;
  const workItems = [];
  let skipped = 0;
  let failed = 0;

  for (const est of estimates) {
    const estId = est.estimate_id;
    const custName = est.customer_name;
    const total = parseFloat(est.total);
    const dateVal = est.date;
    const estStatus = est.status;

    const lastModified = est.last_modified_time ? new Date(est.last_modified_time) : null;
    const existingEstimate = existingByEstId.get(estId);

    const statusChanged = !existingEstimate || existingEstimate.status !== estStatus;
    const neverAnalyzed = !existingEstimate?.classification;
    const modifiedSinceLastSync = !!lastModified && !!existingEstimate &&
      new Date(lastModified).getTime() > new Date(existingEstimate.lastSyncTime).getTime();

    const fetched = fetchedByEst.get(estId);
    if (!fetched) { failed++; continue; }
    const hasNewComments = fetched.hasNew;
    const needsProcessing = statusChanged || neverAnalyzed || modifiedSinceLastSync || hasNewComments;
    if (!needsProcessing) { skipped++; continue; }
    workItems.push({ estId, custName, total, dateVal, estStatus, existingEstimate, fetched });
  }

  console.log(`zoho-sent-runner: ${workItems.length} estimates need AI processing, ${skipped} skipped, ${failed} comment-fetch failures`);

  let processed = 0;
  let workerIndex = 0;
  const failedItems = [];
  const runPool = async (items) => {
    const innerFailed = [];
    const runner = async () => {
      while (workerIndex < items.length) {
        const job = items[workerIndex++];
        try {
          await processEstimate(job);
          processed++;
        } catch (err) {
          console.error(`zoho-sent-runner: AI processing error for ${job.estId}: ${err.message}`);
          innerFailed.push(job);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(AI_CONCURRENCY, items.length) }, () => runner()));
    return innerFailed;
  };

  let stillFailed = await runPool(workItems);
  if (stillFailed.length) {
    console.warn(`zoho-sent-runner: ${stillFailed.length} failed. Retrying once...`);
    await new Promise((r) => setTimeout(r, 5000));
    workerIndex = 0;
    stillFailed = await runPool(stillFailed);
  }
  failed += stillFailed.length;

  // 7. Watermark only on a fully-complete pass.
  const neededCount = workItems.length;
  const complete = neededCount > 0 && failed === 0;
  if (complete) {
    await workerRequest('/api/estimates/bulk-upsert', {
      method: 'POST',
      body: { estimates: [], lastSyncAt: new Date().toISOString() },
    });
    console.log(`zoho-sent-runner: complete pass finished, watermark advanced (needed ${neededCount}, failed ${failed})`);
  } else {
    console.log(`zoho-sent-runner: incomplete — needed ${neededCount}, failed ${failed}. Watermark not advanced.`);
  }

  console.log(`zoho-sent-runner: done — processed ${processed}, skipped ${skipped}, failed ${failed}`);
}

main().catch((err) => {
  console.error('zoho-sent-runner: fatal error:', err.message);
  process.exit(1);
});
