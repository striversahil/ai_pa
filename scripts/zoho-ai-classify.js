#!/usr/bin/env node

/**
 * Zoho Estimate AI Classification - runs in GitHub Actions
 * Reads pending estimates from worker, classifies via omniroute, posts back.
 * All secrets passed via env vars.
 */

const https = require('https');
const { URL } = require('url');

const WORKER_URL = process.env.WORKER_URL;
const SHARED_SECRET = process.env.SHARED_SECRET;
const OMNIROUTE_BASE_URL = process.env.OMNIROUTE_BASE_URL;
const OMNIROUTE_API_KEY = process.env.OMNIROUTE_API_KEY;
const OMNIROUTE_MODEL = process.env.OMNIROUTE_MODEL || 'groq/openai/gpt-oss-120b';

if (!WORKER_URL || !SHARED_SECRET || !OMNIROUTE_BASE_URL || !OMNIROUTE_API_KEY) {
  console.error('Missing required env vars');
  process.exit(1);
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function fetchPending() {
  const res = await httpRequest(`${WORKER_URL}/api/estimates/pending-ai`, {
    headers: { Authorization: `Bearer ${SHARED_SECRET}` },
  });
  if (res.status !== 200) throw new Error(`Pending fetch failed: ${res.status}`);
  return JSON.parse(res.data).estimates || [];
}

async function callOmniroute(systemPrompt, userPrompt) {
  const body = JSON.stringify({
    model: OMNIROUTE_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0,
    stream: false,
  });

  const res = await httpRequest(`${OMNIROUTE_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OMNIROUTE_API_KEY}`,
    },
    body,
  });
  if (res.status !== 200) throw new Error(`Omniroute failed: ${res.status} ${res.data}`);
  const content = JSON.parse(res.data).choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');
  return JSON.parse(match[0]);
}

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

async function main() {
  console.log('Fetching pending estimates...');
  const estimates = await fetchPending();
  
  if (!estimates.length) {
    console.log('No estimates pending AI classification');
    return;
  }

  console.log(`Found ${estimates.length} estimates to classify`);

  for (const est of estimates) {
    const estId = est.estimateId;
    const latestComment = est.latestComment;
    const commentHistory = est.commentHistory;
    const customerName = est.customerName;
    const total = est.total;
    const dateVal = est.date;

    if (!latestComment || latestComment === 'null') {
      console.log(`Skipping ${estId}: no latest comment`);
      continue;
    }

    console.log(`Classifying ${estId} (${est.estimateNumber})...`);

    try {
      // Badge classification
      const badgeResult = await callOmniroute(
        badgePrompt(),
        `Customer Name: ${customerName}\nTotal Amount: ${total}\nEstimate Created Date: ${dateVal}\n\nLatest Comment:\n${latestComment}`
      );

      // Journey summary
      const journeyResult = await callOmniroute(
        journeyPrompt(),
        `Comment History:\n${commentHistory}`
      );

      // Post results back to worker
      const classifyPayload = JSON.stringify({
        estimateId: est.estimateId,
        badgeResult,
        journeyResult,
      });

      const classifyUrl = `${WORKER_URL}/api/estimates/classify`;
      const classifyRes = await httpRequest(`${WORKER_URL}/api/estimates/classify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SHARED_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          estimateId: est.estimateId,
          badgeResult,
          journeyResult,
        }),
      });

      if (classifyRes.status !== 200) {
        console.error(`Failed to post result for ${estId}: ${classifyRes.status} ${classifyRes.data}`);
      } else {
        console.log(`Classified ${estId} successfully`);
      }
    } catch (err) {
      console.error(`Error classifying ${estId}:`, err.message);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('AI classification complete');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});