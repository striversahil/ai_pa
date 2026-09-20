// analyze.js — LLM classification + lead-details capture (the only AI spender).
// Runs ONLY on work items selected by diff.js (sent + just-transitioned rows);
// drafts never reach here. Writes go through persist.js.

const { groqJson } = require('../runner-lib');
const { latestFirst, oldestFirst, extractSalesComments, cleanHtml, isRealSalesComment } = require('./comments');
const persist = require('./persist');

void cleanHtml;
void isRealSalesComment;

// Quota pacing: Groq on_demand keys cap at ~8k TPM and HIGH-reasoning 120b
// calls burn 1-4k tokens each — 2 workers + a short pause per estimate keeps
// bursts inside quotas; full passes take longer but complete instead of failing.
const AI_CONCURRENCY = 2;
const AI_PACING_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function badgePrompt(agentRoster) {
  const rosterLine = agentRoster.length
    ? `Sales Agent Roster (the company's callers): ${agentRoster.join(', ')}.`
    : `No sales agent roster is available right now.`;
  return `You are a strict manager reviewing the LATEST sales comment on a work estimate.
Today's Date is: ${new Date().toISOString().split('T')[0]} (refer to this to check if the comment is older than 2 days).

You will receive exactly ONE comment, which is the most recent comment on the estimate.
The current status of the estimate is determined SOLELY by this single latest comment.
Do NOT consider any older comments — you do not have access to them.

${rosterLine}
Sales agents are instructed to write their own name next to the comments they leave on an
estimate. Identify which sales agent from the roster wrote THIS comment:
- Match the name even with minor spelling/case variations (e.g. "deepak" → "Deepak").
- Return the name EXACTLY as written in the roster.
- If no roster name appears in the comment (or the roster is unavailable), output "Unassigned".
- Never invent a name that is not in the roster.

Evaluate this single latest comment and output the following keys:
1. meaningful_update: true ONLY if THIS comment records a substantive customer outcome or a CUSTOMER-committed next step — price agreed, order/PO received or confirmed, a decision given, the customer says they will confirm/place the order, or a sample/quote requested by the customer. Anything less is false.
2. Chip Mapping keys (true or false):
   - not_answering: true if THIS comment states the customer did not answer, is not replying, or call was not picked up. Else false.
   - under_discussion: true if THIS comment shows active discussions are ongoing (e.g. price negotiation, technical configuration review, requirement clarification, or visiting plans being finalized). Else false.
   - confirm: true if THIS comment shows the order/estimate has been confirmed, final verbal approval is given, payment details are being shared, or purchase order is expected. Else false.
   - confirm_date: The date (YYYY-MM-DD format) of THIS comment if 'confirm' is true. If 'confirm' is false, output "None".
3. reasoning: A short sentence explaining the assessment, quoting THIS single comment, and why the flags were set.
4. sales_agent: The roster name of the agent who wrote THIS comment, or "Unassigned".

Strict Decision Rules:
- Base EVERY chip decision ONLY on the single latest comment provided. Do not infer anything from earlier history.
- Mark meaningful_update as false if the latest comment is older than 2 days.
- "Shopping around" is NOT progress: when THIS comment only shows the customer comparing vendors / taking rates / "will confirm in N days" with no firm order, PO, decision, or agreed price, meaningful_update MUST be false. under_discussion may still be true while the negotiation is live.
- A bare deferral is NOT progress: when THIS comment only moves the call to another date/day/time ("call on Monday", "call after 2 days", "will follow up") with no customer substance behind it, meaningful_update MUST be false — even when it names a date. A follow-up date/day/time counts toward meaningful_update ONLY when the CUSTOMER asked for or agreed to it (e.g. "customer asked to call back Friday", "he said call after 15th", "customer will revert tomorrow") AND the comment carries a substantive customer response beyond the date itself. A date the AGENT set alone is a retry reminder, not progress.
- meaningful_update MUST be false when THIS comment reports failed contact with no customer response (not answering / not connected / unreachable / switched off / call not picked up / busy) — even if it names a retry date. Set not_answering=true in that case.
- meaningful_update MUST be false when the customer puts the deal on HOLD or tells the agent to stop calling ("hold for now", "do not call again", "stop calling", "call after 1 week" said with annoyance) — a stalled deal with negative sentiment is not progress, even with a timeline. not_answering stays false if the customer was actually reached; under_discussion stays false (a unilateral hold is not an active negotiation).
- If the latest comment only records an action (calling, messaging, sending a quotation) without presenting any outcome, next step, or decision, meaningful_update must be false.
- If meaningful_update is true, then not_answering must be false. If meaningful_update is false, not_answering may be true or false as the comment dictates. under_discussion can be true regardless.

Response Format:
Return only a valid JSON object matching the JSON structure:
{
  "meaningful_update": false,
  "not_answering": false,
  "under_discussion": false,
  "confirm": false,
  "confirm_date": "None",
  "sales_agent": "Unassigned",
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

async function classifyEstimate(custName, total, latestComment, dateVal, commentHistory, agentRoster) {
  let badgeResult;
  try {
    badgeResult = await groqJson(
      badgePrompt(agentRoster || []),
      `Customer Name: ${custName}\nTotal Amount: ${total}\nEstimate Created Date: ${dateVal}\n\nLatest Comment:\n${latestComment}`,
      { temperature: 0, reasoningEffort: 'high' },
    );
  } catch (err) {
    throw new Error(`Groq badge classification failed: ${err.message}`);
  }
  let journeyResult;
  try {
    journeyResult = commentHistory
      ? await groqJson(journeyPrompt(), `Comment History:\n${commentHistory}`, { temperature: 0, reasoningEffort: 'high' })
      : { summary: 'No sales agent comment found.', intent_score: 2 };
  } catch (err) {
    throw new Error(`Groq journey summary failed: ${err.message}`);
  }
  return { badgeResult, journeyResult };
}

function finalConfirm(badgeResult) {
  let result = badgeResult.confirm ? 'Yes' : 'No';
  if (badgeResult.confirm) {
    const confirmDateStr = badgeResult.confirm_date;
    if (confirmDateStr && confirmDateStr !== 'None') {
      try {
        const confirmDate = new Date(confirmDateStr);
        const diffDays = Math.floor((Date.now() - confirmDate.getTime()) / (24 * 60 * 60 * 1000));
        if (diffDays > 2) result = 'No';
      } catch { result = 'No'; }
    } else {
      result = 'No';
    }
  }
  return result;
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
    salesAgent: 'Unassigned',
  };
}

function resolveSalesAgent(badgeResult, agentRoster, commentText = '') {
  if (!agentRoster || !agentRoster.length) return 'Unassigned';
  const lower = (s) => String(s || '').toLowerCase();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // A roster name is only "present" in the text if the text contains the full
  // name (word-bounded) or a unique roster prefix of it. Verifies LLM answers
  // and safety-net scans against hallucinations.
  const presentInText = (name) => {
    if (!commentText) return false;
    if (new RegExp(`\\b${esc(name)}\\b`, 'i').test(commentText)) return true;
    const ln = lower(name);
    for (const w of new Set(lower(commentText).match(/[a-z]{4,}/g) || [])) {
      if (ln !== w && ln.startsWith(w)) {
        const rivals = agentRoster.filter((n) => lower(n).startsWith(w));
        if (rivals.length === 1) return true; // unique short form
      }
    }
    return false;
  };

  // 1. LLM answer → exact roster name, else unambiguous prefix — but only if
  //    some form of that name actually appears in the comment.
  const raw = lower(String(badgeResult.sales_agent || '').trim());
  if (raw && !/^unassigned$/.test(raw)) {
    const exact = agentRoster.find((n) => lower(n) === raw);
    if (exact && presentInText(exact)) return exact;
    const pref = agentRoster.find((n) => lower(n).startsWith(raw) && raw.length >= 4);
    if (pref && presentInText(pref)) return pref;
  }

  // 2. Safety net: scan the raw comment — the LLM sometimes overlooks signatures.
  if (!commentText) return 'Unassigned';
  const full = agentRoster.find((n) => new RegExp(`\\b${esc(n)}\\b`, 'i').test(commentText));
  if (full) return full;
  // Signed short form: a standalone word uniquely prefixing exactly one name
  // (min 4 chars; ambiguous prefixes like "deepa" rejected).
  const words = [...new Set(lower(commentText).match(/[a-z]{4,}/g) || [])];
  for (const w of words) {
    const matches = agentRoster.filter((n) => {
      const ln = lower(n);
      return ln !== w && ln.startsWith(w);
    });
    if (matches.length === 1) return matches[0];
  }
  return 'Unassigned';
}

function buildClassification(badgeResult, journeyResult, dateVal, movingSlowOverride = null, agentRoster = [], latestComment = '') {
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
    salesAgent: resolveSalesAgent(badgeResult, agentRoster, latestComment),
  };
}

// Lead-details extraction: the agent's "Enquiry Number / Source / Location /
// Contact / Lead generated by" block in the first real sales comments.
async function extractLeadDetails(input) {
  const prompt = `You are a B2B industrial-sales data extractor. Sales agents write a lead-details block in the first comments of an estimate. From the text below extract ONLY these fields and return STRICT JSON (no markdown):
{
  "enquiryNumber": "enquiry/inquiry number as written (e.g. 'Inquiry 1 - 7 SEP'), or null",
  "sourceLead": "lead source (e.g. 'company data', 'IndiaMART', 'reference'), or null",
  "location": "customer location/city/state (e.g. 'Haryana'), or null",
  "company": "client company name, or null",
  "contactName": "contact person / POC name, or null",
  "contactPhone": "contact mobile/phone number, or null",
  "contactEmail": "contact email address, or null",
  "leadGeneratedBy": "the SALES AGENT (company employee) who generated/owns this lead — from 'Lead of:', 'Lead generated by:', 'Generated by:', or the agent's name signed at the end of the comment. This is NOT the customer. Return the name as written, or null"
}
Rules:
- Match labels loosely: 'Enquiry Number', 'Inquiry No', 'Source Lead', 'Lead Source', 'Company Name', 'Contact Person', 'POC', 'Mobile Number', 'Email', 'Location'.
- 'Lead of' / 'Lead generated by' is the owning AGENT (company employee) → leadGeneratedBy. The customer's name goes in contactName.
- If company is already provided and correct keep it; otherwise extract.
- NEVER rewrite/summarize the text. Return JSON only.
Company (given): ${input.company || '?'}
Text:
"""${(input.text || '').slice(0, 3000)}"""`;
  const parsed = await groqJson(
    'Extract structured sales-enquiry fields as JSON. Never alter client wording or invent values.',
    prompt,
    { temperature: 0, reasoningEffort: 'high' },
  );
  return {
    enquiryNumber: parsed.enquiryNumber ? String(parsed.enquiryNumber) : null,
    sourceLead: parsed.sourceLead ? String(parsed.sourceLead) : null,
    location: parsed.location ? String(parsed.location) : null,
    contactName: parsed.contactName ? String(parsed.contactName) : null,
    contactPhone: parsed.contactPhone ? String(parsed.contactPhone) : null,
    contactEmail: parsed.contactEmail ? String(parsed.contactEmail) : null,
    leadGeneratedBy: parsed.leadGeneratedBy ? String(parsed.leadGeneratedBy) : null,
  };
}

async function processEstimate(job, agentRoster) {
  const { estId, custName, total, dateVal, fetched, closeOut } = job;
  const comments = fetched.comments || [];
  await persist.postComments(estId, comments);

  const salesComments = extractSalesComments(comments);
  salesComments.sort(latestFirst);
  const historyLines = salesComments.slice(0, 15).map((c) => `[${c.date}] ${c.author}: ${c.text}`);
  const commentHistory = historyLines.join('\n');

  let classification;
  if (!commentHistory) {
    classification = defaultClassification(dateVal, closeOut ? 'No' : null);
  } else {
    const latestComment = historyLines[0] || '';
    const { badgeResult, journeyResult } = await classifyEstimate(custName, total, latestComment, dateVal, commentHistory, agentRoster);
    classification = buildClassification(badgeResult, journeyResult, dateVal, closeOut ? 'No' : null, agentRoster, latestComment);
  }
  await persist.postClassification(estId, classification);
}

// Pooled AI pass over work items with one retry round for failures.
async function runAnalysisPool(workItems, agentRoster) {
  let processed = 0;
  let workerIndex = 0;
  const runPool = async (items) => {
    const innerFailed = [];
    const runner = async () => {
      while (workerIndex < items.length) {
        const job = items[workerIndex++];
        try {
          await processEstimate(job, agentRoster);
          processed++;
        } catch (err) {
          console.error(`zoho-sync/analyze: AI processing error for ${job.estId}: ${err.message}`);
          innerFailed.push(job);
        }
        await sleep(AI_PACING_MS);
      }
    };
    await Promise.all(Array.from({ length: Math.min(AI_CONCURRENCY, items.length) }, () => runner()));
    return innerFailed;
  };

  let stillFailed = await runPool(workItems);
  if (stillFailed.length) {
    console.warn(`zoho-sync/analyze: ${stillFailed.length} failed. Retrying once...`);
    await new Promise((r) => setTimeout(r, 5000));
    workerIndex = 0;
    stillFailed = await runPool(stillFailed);
  }
  return { processed, failed: stillFailed.length };
}

// Lead-details capture loop: every fetched estimate whose detailsCaptured flag
// is still false (agents take ~40 min to post the block). Retry budget (10 AI
// turns) is enforced worker-side; re-admitted only on genuinely new comments.
// A failed AI turn still reports an empty row so it consumes budget instead of
// burning Groq calls forever.
const LEAD_DETAIL_FIELDS = ['enquiryNumber', 'sourceLead', 'location', 'contactName', 'contactPhone', 'contactEmail', 'leadGeneratedBy'];

async function captureLeadDetails({ estimates, existingByEstId, fetchedByEst }) {
  const hasLLM = (process.env.GROQ_API_KEYS || process.env.AGNES_API_KEY || process.env.AGNES_API_KEYS || process.env.AI_KEYS || process.env.REQUESTLY_API_KEY || '').split(',').map((k) => k.trim()).filter(Boolean).length;
  if (!hasLLM) return { rows: 0 };
  const pendingCapture = estimates.filter((est) => {
    if (String(est.status ?? '').toLowerCase() !== 'sent') return false;
    const existing = existingByEstId.get(est.estimate_id);
    if (!existing || !existing.detailsCaptured) {
      if (existing?.detailsFailed) return !!fetchedByEst.get(est.estimate_id)?.hasNew;
      return true;
    }
    return false;
  });
  console.log(`zoho-sync/analyze: ${pendingCapture.length} sent estimates still need lead-details capture`);
  const leadDetailRows = [];
  for (const est of pendingCapture) {
    const fetched = fetchedByEst.get(est.estimate_id);
    if (!fetched) continue;
    const firstRealSales = extractSalesComments(fetched.comments)
      .sort(oldestFirst)
      .slice(0, 5)
      .map((c) => `${c.author}: ${c.text}`)
      .join('\n');
    if (!firstRealSales.trim()) continue;
    const attemptNo = (existingByEstId.get(est.estimate_id)?.detailsAttempts ?? 0) + 1;
    try {
      const extracted = await extractLeadDetails({ text: firstRealSales, company: est.customer_name || '' });
      const fieldCount = extracted ? LEAD_DETAIL_FIELDS.filter((k) => extracted[k]).length : 0;
      leadDetailRows.push({ estimateId: est.estimate_id, ...(extracted || {}) });
      if (fieldCount >= 3) {
        console.log(`zoho-sync/analyze: ${est.estimate_number}: captured ${fieldCount}/7 lead-detail fields`);
      } else {
        console.warn(`zoho-sync/analyze: ${est.estimate_number}: extraction had ${fieldCount}/7 fields (attempt ${attemptNo}/10) — below 3, judged invalid, consuming one retry attempt`);
      }
    } catch (err) {
      leadDetailRows.push({ estimateId: est.estimate_id });
      console.warn(`zoho-sync/analyze: lead-details extraction failed for ${est.estimate_number} (attempt ${attemptNo}/10): ${err.message} — consuming one retry attempt`);
    }
  }
  if (leadDetailRows.length > 0) {
    const res = await persist.postLeadDetails(leadDetailRows);
    console.log(`zoho-sync/analyze: lead-details stored for ${res?.count ?? '?'} estimates, thin attempts ${res?.attempted ?? '?'}, gave up ${res?.failed ?? '?'}`);
  }
  return { rows: leadDetailRows.length };
}

module.exports = {
  classifyEstimate,
  buildClassification,
  defaultClassification,
  resolveSalesAgent,
  extractLeadDetails,
  processEstimate,
  runAnalysisPool,
  captureLeadDetails,
};
