/**
 * local-runner.js — AI processing queue for WhatsApp messages.
 *
 * Polls the Cloudflare D1 queue (via the waba-worker), classifies each pending
 * message with the deterministic rules, falls back to your local omniroute
 * (OpenAI-compatible), and writes the result back. Runs forever, one message
 * at a time, and naturally drains any backlog that accumulated while your PC
 * was off.
 *
 * Env:
 *   WORKER_URL          — https://waba-worker.<subdomain>.workers.dev
 *   CRON_SECRET         — must match the worker's SHARED_SECRET
 *   OMNIROUTE_BASE_URL  — e.g. http://localhost:20128/v1  (append /chat/completions)
 *   OMNIROUTE_MODEL     — model name passed to omniroute (default: backend LLM_MODEL)
 *   OMNIROUTE_API_KEY   — API key for omniroute (same as backend LLM_API_KEY)
 *   WA_ENGINE_API_KEY   — waengine.pro API key (used to fetch outbound message text)
 *   WA_ENGINE_BASE_URL  — waengine.pro base URL (default: https://waengine.pro/api/v1)
 *   POLL_INTERVAL_MS    — how often to poll (default 5000)
 */
const WORKER_URL = process.env.WORKER_URL;
const CRON_SECRET = process.env.CRON_SECRET;
const OMNIROUTE_BASE_URL = (process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128/v1').replace(/\/$/, '');
const OMNIROUTE_MODEL = process.env.OMNIROUTE_MODEL || 'groq/openai/gpt-oss-120b';
const OMNIROUTE_API_KEY = process.env.OMNIROUTE_API_KEY;
const WA_ENGINE_API_KEY = process.env.WA_ENGINE_API_KEY;
const WA_ENGINE_BASE_URL = (process.env.WA_ENGINE_BASE_URL || 'https://waengine.pro/api/v1').replace(/\/$/, '');
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);

if (!WORKER_URL || !CRON_SECRET) {
  console.error('Missing WORKER_URL or CRON_SECRET');
  process.exit(1);
}

// ── Deterministic classifier (ported from founder-os deterministicClassifier.ts) ──
const CONFIRMED = /\b(order (is|has been|was) (final|confirmed|placed)|confirmed( the)? order|order final|po received|po (is )?received|placed( the)? order|order placed|final(iz|is)ed the order)\b/i;
const FIRM_COMMIT = /\b(will|going to)\b.{0,30}\b(confirm|finalize|finalise|place|send (the )?po|give|decide|share|visit|come|reach|check samples)\b/i;
const ACTIVE_ORDER = /\b(is|will be|he is|she is|they are)\s+ordering( for| the)?\b|\border(ing|ed)? (in )?(process|progress)\b|\bin the process of ordering\b/i;
const FUTURE_DATE = /(\b\d{1,2}(st|nd|rd|th)?(\s+of)?\s+(aug|sep|sept|oct|nov|dec|jan|feb|mar|apr|may|jun|jul)\b)|(\b\d{1,2}-\d{1,2}-\d{4}\b)|(\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)|(\b(today|tomorrow)\b)|(\b(after|in|within)\s+\d{1,2}(\s|-)?(days?|weeks?)\b)|(\bnext\s+(week|month)\b)/i;
const NOT_ANSWERING = /\b(not answering|not answer|couldn'?t reach|not connected|disconnect(ed|ing)?|didn'?t pick|did not pick|busy( on another call)?|on another call|call(ed)? back to later|call back later|no answer|not reachable)\b/i;
const VAGUE_REVERT = /\b(will|wll|wil|going to|have to)\b.{0,50}\b(check|see|look|let( (me|us))? know|intimate|inform|say|update|revert|confirm|take some time|get back|come back)\b/i;
const BARE_ACTION = /\b(called|call(ed)? him|message(ed)? sent|whatsapp sent|whatsapp message sent|left (a )?message|sent (the )?quotation|quotation (was )?sent|quote (was )?sent|email(ed)? sent|shared (the )?quotation)\b/i;
const REJECTION = /\b(not require|not needed|no requirement|doesn'?t need|do not need|declined|decline|price inquiry|price enquiry|just (a )?price)\b/i;
const INTERNAL_HANDOFF = /\b(sir|ma'am|madam)\s+(will|is going to|will be)\s+(deal|handle|take (care|over)|manage)\b/i;

function classifyDeterministic(text) {
  const c = (text || '').trim();
  if (!c) return null;
  if (CONFIRMED.test(c)) return { label: 'CONFIRMED', reasoning: 'Order confirmation / PO received' };
  if (FIRM_COMMIT.test(c) || ACTIVE_ORDER.test(c)) return { label: 'MEANINGFUL', reasoning: 'Firm customer commitment' };
  if (FUTURE_DATE.test(c)) return { label: 'MEANINGFUL', reasoning: 'Specific future follow-up date set' };
  if (NOT_ANSWERING.test(c)) return { label: 'NOT_MEANINGFUL', reasoning: 'Customer did not answer / unreachable' };
  if (REJECTION.test(c)) return { label: 'NOT_MEANINGFUL', reasoning: 'Customer declined / no requirement' };
  if (INTERNAL_HANDOFF.test(c)) return { label: 'NOT_MEANINGFUL', reasoning: 'Internal handoff note' };
  if (VAGUE_REVERT.test(c) && !FUTURE_DATE.test(c)) return { label: 'NOT_MEANINGFUL', reasoning: 'Vague promise, no date' };
  if (BARE_ACTION.test(c)) return { label: 'NOT_MEANINGFUL', reasoning: 'Action recorded, no outcome' };
  return null;
}

const CLASSIFY_PROMPT = `You are an executive assistant triaging WhatsApp messages for a startup founder.
Classify the message below. Decide if it is PENDING (needs follow-up: a question, request, complaint, action item, lead needing a quote, support issue) or NOT PENDING (informational, resolved, spam, acknowledgement).

Respond with a single valid JSON object:
{
  "is_pending": boolean,
  "confidence": "high" | "medium" | "low",
  "reason": "1 sentence",
  "suggested_action": "string or null",
  "priority": "low" | "medium" | "high" | "urgent",
  "category": "Customer | Investor | Operations | Partner | Support | Spam | Informational"
}
Only output the raw JSON. No markdown.`;

async function omnirouteClassify(payload) {
  if (!OMNIROUTE_API_KEY) {
    throw new Error('OMNIROUTE_API_KEY not set');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000); // big models can be slow locally
  try {
    const res = await fetch(`${OMNIROUTE_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${OMNIROUTE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OMNIROUTE_MODEL,
        messages: [
          { role: 'system', content: CLASSIFY_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        temperature: 0,
        stream: false,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`omniroute ${res.status}: ${err}`);
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in omniroute response');
    return JSON.parse(match[0]);
  } finally {
    clearTimeout(timeout);
  }
}

function extractMessage(payload) {
  try {
    const obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (obj.event === 'message.received') {
      const d = obj.data || {};
      // waengine.pro shape: { event, timestamp, data: { conversation_id, contact_id, phone, type, text } }
      if (d.text || d.type) {
        return {
          message: { text: { body: d.text || '' }, type: d.type || 'text', id: d.message_id || obj.timestamp },
          contact: { phone_number: d.phone || '' },
        };
      }
      return { message: d.message, contact: d.contact };
    }
    return { message: obj.message || obj.payload, contact: obj.contact };
  } catch {
    return { message: null, contact: null };
  }
}

function messageText(message) {
  return message?.text?.body || message?.body || message?.text ||
    message?.caption || message?.message || '';
}

// waengine.pro message.status payload: { event, timestamp, data: { wa_message_id, status, recipient } }
function extractStatus(payload) {
  try {
    const obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const d = obj.data || {};
    return { waMessageId: d.wa_message_id, status: d.status, recipient: d.phone || d.recipient };
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// For outbound rows, fetch the actual message text from waengine.pro:
// find the conversation for the recipient, then the message with the given wa_message_id.
async function fetchOutboundText(recipient, waMessageId) {
  if (!WA_ENGINE_API_KEY) return null;
  const auth = { Authorization: `Bearer ${WA_ENGINE_API_KEY}` };

  // 1. find conversation by recipient phone
  const convRes = await fetch(`${WA_ENGINE_BASE_URL}/conversations?limit=100`, { headers: auth });
  if (!convRes.ok) return null;
  const convData = await convRes.json();
  const conv = (convData.data || []).find(c => String(c.contact?.phone) === String(recipient));
  if (!conv?._id) return null;

  // 2. fetch messages in that conversation, match wa_message_id
  const msgRes = await fetch(`${WA_ENGINE_BASE_URL}/messages?conversation_id=${conv._id}&limit=100`, { headers: auth });
  if (!msgRes.ok) return null;
  const msgData = await msgRes.json();
  const hit = (msgData.data || []).find(m => m.waMessageId === waMessageId || m._id === waMessageId);
  if (hit?.text) return hit.text;
  if (hit?.media?.caption) return `[${hit.type}] ${hit.media.caption}`;
  if (hit?.type === 'image' || hit?.type === 'video' || hit?.type === 'document') return `[${hit.type}]`;
  return null;
}

async function processRecord(record) {
  const { message, contact } = extractMessage(record.payload);
  const text = messageText(message) || JSON.stringify(message || record.payload);
  const from = contact?.phone_number || message?.phone || message?.from || 'unknown';

  // Outbound rows: enrich with real text + status, store directly (no AI triage needed).
  if (record.direction === 'outbound') {
    const st = extractStatus(record.payload);
    const outboundText = await fetchOutboundText(st?.recipient, st?.waMessageId);
    const aiResult = JSON.stringify({
      label: 'OUTBOUND',
      status: st?.status || null,
      direction: 'outbound',
      wa_message_id: st?.waMessageId || null,
      recipient: st?.recipient || null,
      text: outboundText || null,
      raw: text.slice(0, 500),
    });
    const upd = await fetch(`${WORKER_URL}/api/update`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CRON_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: record.id, ai_result: aiResult }),
    });
    if (!upd.ok) throw new Error(`Update failed: HTTP ${upd.status}`);
    console.log(`[${new Date().toISOString()}] Record ${record.id}: OUTBOUND ${st?.status || ''} → ${outboundText || '(no text found)'}`);
    return;
  }

  // Deterministic first (instant, free). Fall back to omniroute.
  let result = classifyDeterministic(text);
  if (!result) {
    try {
      const ai = await omnirouteClassify({
        from,
        body: text,
        timestamp: message?.timestamp || null,
      });
      result = {
        label: ai?.is_pending ? 'PENDING' : 'NOT_MEANINGFUL',
        reasoning: ai?.reason || 'omniroute classification',
        llm: {
          confidence: ai?.confidence,
          priority: ai?.priority,
          category: ai?.category,
          suggested_action: ai?.suggested_action,
        },
      };
    } catch (e) {
      console.error(`[${new Date().toISOString()}] omniroute unavailable for record ${record.id}: ${e.message}`);
      return; // leave record pending; retried on next poll
    }
  }

  const aiResult = JSON.stringify({ ...result, raw: text.slice(0, 500) });
  const upd = await fetch(`${WORKER_URL}/api/update`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CRON_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: record.id, ai_result: aiResult }),
  });
  if (!upd.ok) throw new Error(`Update failed: HTTP ${upd.status}`);
  console.log(`[${new Date().toISOString()}] Record ${record.id}: ${result.label} — ${result.reasoning}`);
}

async function run() {
  console.log(`[${new Date().toISOString()}] local-runner started (omniroute: ${OMNIROUTE_BASE_URL}, model: ${OMNIROUTE_MODEL})`);
  while (true) {
    try {
      const res = await fetch(`${WORKER_URL}/api/logs?mode=cron`, {
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      });
      if (!res.ok) throw new Error(`fetch logs: HTTP ${res.status}`);
      const records = await res.json();
      if (records.length) {
        console.log(`[${new Date().toISOString()}] ${records.length} message(s) queued, processing one by one...`);
      }
      for (const record of records) {
        try {
          await processRecord(record);
        } catch (e) {
          console.error(`[${new Date().toISOString()}] Error on record ${record.id}: ${e.message}`);
        }
        await sleep(500); // one at a time, gentle on the local model
      }
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Poll error: ${e.message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

run();