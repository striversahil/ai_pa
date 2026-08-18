#!/usr/bin/env node

/**
 * eod-summary-runner.js — generates the AI end-of-day summary ON the GH Actions
 * runner (unlimited CPU), replacing the old worker trigger.
 *
 * Flow: fetch brief context from the worker → build the same context strings
 * the engines produce → LLM generate the EOD summary → persist as a founder
 * note. IST-aware for the "created today" task boundary.
 *
 * Env: WORKER_URL, SHARED_SECRET, OMNIROUTE_BASE_URL, OMNIROUTE_API_KEY,
 * OMNIROUTE_MODEL (all via runner-lib).
 */

const { requireEnv, workerRequest, omniroute } = require('./runner-lib');
requireEnv();

const EOD_SYSTEM = `
You are the personal AI Chief of Staff to a startup founder.
Your task is to generate a professional End-of-Day Summary in Markdown.

Input data to synthesize:
1. WhatsApp Messages/Conversations processed: {messagesCount}
2. Important conversations of the day: {importantConversations}
3. Tasks created today: {tasksCreated}
4. Pending approvals or follow-ups: {pendingApprovals}

The summary MUST include these sections:
# End of Day Summary - [Date]

## 📊 Daily Activity Metrics
- Summarize volume of incoming communications and status.

## 🔑 Key Conversations & Updates
- Synthesize the most critical updates of the day.

## 🛠 Tasks Captured Today
- List all new action items that were extracted and stored in the system.

## ⚠️ Risks & Pending Action Items
- Highlight items requiring approval or items that are at risk of missing deadlines.

## 🌅 Tomorrow's Priorities
- Suggest follow-ups for tomorrow based on today's logs.

Write in a clear, brief, executive-summary style. Output only the Markdown text.
`;

const KOLKATA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function kolkataDayStartUtc(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day'), 0, 0, 0) - KOLKATA_OFFSET_MS);
}

function buildWhatsappEodContext(digests) {
  const unprocessedCount = (digests || []).filter((d) => d.processed === false).length;
  const digestsList = (digests || []).slice(0, 10);
  const messagesCount = digestsList.length * 5 + unprocessedCount;
  const important = digestsList.filter((d) => d.priority === 'high' || d.priority === 'urgent');
  const importantConversations = important.length
    ? important.map((d) => `- [${String(d.priority).toUpperCase()}] "${d.chatName}": ${d.summary}`).join('\n')
    : 'No high-priority chats processed today.';
  return `WhatsApp Messages processed: ${messagesCount}\nKey conversations:\n${importantConversations}`;
}

function buildEmailEodContext(emails) {
  return `Email sync status: ${(emails || []).length} unread emails currently in inbox.`;
}

function buildZohoEodContext(estimates) {
  return `- Sent Estimates monitored today: ${(estimates || []).length}`;
}

async function main() {
  console.log('eod-summary-runner: fetching brief context');
  const data = await workerRequest('/api/runner/brief-data');
  const { digests = [], tasks = [], emails = [], estimates = [] } = data;

  const whatsappContext = buildWhatsappEodContext(digests);
  const emailContext = buildEmailEodContext(emails);
  const zohoContext = buildZohoEodContext(estimates);

  const unprocessedCount = 0; // handled inside buildWhatsappEodContext
  const importantConversations = [whatsappContext, emailContext, zohoContext].filter(Boolean).join('\n\n');
  const messagesCount = 0; // overridden by whatsappContext; kept for the LLM input below

  const today = kolkataDayStartUtc(new Date());
  const todayTasks = (tasks || []).filter((t) => new Date(t.createdAt).getTime() >= today.getTime());
  const tasksCreated = todayTasks.length
    ? todayTasks.map((t) => `- "${t.title}" (Assigned: ${t.owner})`).join('\n')
    : 'No new tasks created today.';

  const pendingTasks = (tasks || []).filter((t) => t.status === 'PENDING');
  const pendingApprovals = pendingTasks.length
    ? pendingTasks.map((t) => `- "${t.title}" from source: ${t.source}`).join('\n')
    : 'No pending items.';

  // Recompute a real messages count from the digest list (same as the engine).
  const digestList = (digests || []).slice(0, 10);
  const realMessagesCount = digestList.length * 5 + (digests || []).filter((d) => d.processed === false).length;

  const system = EOD_SYSTEM
    .replace('{messagesCount}', String(realMessagesCount))
    .replace('{importantConversations}', importantConversations)
    .replace('{tasksCreated}', tasksCreated)
    .replace('{pendingApprovals}', pendingApprovals);

  console.log('eod-summary-runner: generating EOD summary via omniroute');
  const summary = await omniroute(system, 'Generate EOD summary now.', { temperature: 0.5 });
  if (!summary || !summary.trim()) throw new Error('Empty EOD summary returned by LLM');

  await workerRequest('/api/runner/founder-notes', { method: 'POST', body: { content: summary } });
  console.log('eod-summary-runner: EOD summary saved');
  void unprocessedCount; void messagesCount;
}

main().catch((err) => {
  console.error('eod-summary-runner: fatal error:', err.message);
  process.exit(1);
});
