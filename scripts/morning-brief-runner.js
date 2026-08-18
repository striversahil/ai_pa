#!/usr/bin/env node

/**
 * morning-brief-runner.js — generates the AI morning brief ON the GH Actions
 * runner (unlimited CPU), replacing the old worker trigger.
 *
 * Flow: fetch brief context (digests, tasks, pending items, emails, estimates)
 * from the worker → build the same context strings the engines produce →
 * LLM generate the brief → persist as a founder note.
 *
 * Env: WORKER_URL, SHARED_SECRET, OMNIROUTE_BASE_URL, OMNIROUTE_API_KEY,
 * OMNIROUTE_MODEL (all via runner-lib).
 */

const { requireEnv, workerRequest, omniroute } = require('./runner-lib');
requireEnv();

const BRIEF_SYSTEM = `
You are the personal AI Chief of Staff to a startup founder.
Your task is to generate a comprehensive, highly actionable morning briefing.
Structure the briefing beautifully in clean Markdown.

Input data to synthesize:
1. Today's Meetings: {meetings}
2. Urgent/High-Priority WhatsApp Digests: {whatsappDigests}
3. Urgent/Unread Emails: {unreadEmails}
4. Pending Tasks: {pendingTasks}
5. Pending From Me (per chat, what the founder owes): {pendingFromFounder}

The briefing MUST include these sections:
# Morning Briefing - [Date]

## 📅 Today's Schedule & Meetings
- List the meetings (if any) or state no meetings are scheduled.

## 🚨 Urgent Matters (Requires Immediate Attention)
- Group by WhatsApp/Email. Highlight WHY it's urgent and who sent it.

## 💬 High-Priority Conversations
- Summarize important discussions from the last 24 hours that the founder should know.

## ⏳ What I Owe (Pending From Me)
- List every open item the founder owes, grouped per chat, with its due date.
- Items that are OVERDUE (due date passed) MUST be listed first, marked ⚠️ OVERDUE.
- Call out overdue items as the top priority — these are what slips through.

## 📋 Pending Action Items & Tasks
- List key tasks, their status, owner, and deadline.

## 🎯 Suggested Focus Areas for Today
- Give 3 strategic priorities for the founder based on the incoming messages and emails.

Make it professional, concise, and focused on enabling execution. Do not output anything other than the Markdown text.
`;

function isoDay(d) {
  if (!d) return 'None';
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? 'None' : date.toISOString().split('T')[0];
}

function buildWhatsappDigestsContext(digests) {
  if (!digests || !digests.length) return 'No recent chat digests found.';
  return digests
    .map((d) => `- [${String(d.priority).toUpperCase()}] Chat: "${d.chatName}" (Category: ${d.category}) Summary: ${d.summary}`)
    .join('\n');
}

function buildEmailsContext(emails) {
  if (!emails || !emails.length) return 'No new/unread emails.';
  return emails
    .map((e) => `- From: ${e.sender} | Subject: "${e.subject}" | Body Preview: ${e.body.substring(0, 80)}...`)
    .join('\n');
}

function buildZohoContext(estimates) {
  if (!estimates || !estimates.length) return '';
  const getSortGroup = (x) => {
    const c = x.classification || {};
    if (x.total > 80000) return 1;
    if (c.underDiscussion === 'Yes') return 2;
    if (c.movingSlow === 'Yes') return 3;
    return 4;
  };
  const sorted = [...estimates].sort((a, b) => {
    const groupA = getSortGroup(a);
    const groupB = getSortGroup(b);
    if (groupA !== groupB) return groupA - groupB;
    const scoreA = a.classification?.intentScore || 0;
    const scoreB = b.classification?.intentScore || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.total - a.total;
  });
  const lines = sorted.map((e) => {
    const score = e.classification?.intentScore || 0;
    const reasons = e.classification?.reasoning || 'No analysis logs.';
    return `- **${e.customerName}** (Est. No: ${e.estimateNumber} | Total: ₹${Number(e.total).toLocaleString()}) - Intent Score: **${score}/10** | Reason: ${reasons}`;
  });
  return `### Zoho Sent Estimates Calling Priority List\n${lines.join('\n')}`;
}

function buildTasksContext(tasks) {
  const active = (tasks || []).filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
  if (!active.length) return 'No pending tasks in queue.';
  return active
    .map((t) => `- Task: "${t.title}" | Owner: ${t.owner} | Source: ${t.source} | Deadline: ${isoDay(t.deadline)}`)
    .join('\n');
}

function buildPendingContext(pendingItems) {
  const items = (pendingItems || []).slice();
  const now = Date.now();
  items.sort((a, b) => {
    const aOverdue = a.dueDate && new Date(a.dueDate).getTime() < now ? 0 : 1;
    const bOverdue = b.dueDate && new Date(b.dueDate).getTime() < now ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return aDue - bDue;
  });
  if (!items.length) return 'No open items pending from your side. ✅';
  return items
    .map((item) => {
      const overdue = item.dueDate && new Date(item.dueDate).getTime() < now;
      return `- [${item.chatName || item.chatId}] "${item.description}" | Due: ${isoDay(item.dueDate)}${overdue ? ' ⚠️ OVERDUE' : ''}`;
    })
    .join('\n');
}

async function main() {
  console.log('morning-brief-runner: fetching brief context');
  const data = await workerRequest('/api/runner/brief-data');
  const { digests = [], tasks = [], pendingItems = [], emails = [], estimates = [] } = data;

  const meetings = 'No calendar meetings integration configured yet.';
  const whatsappDigests = buildWhatsappDigestsContext(digests);
  const emailsContext = buildEmailsContext(emails);
  const zohoContext = buildZohoContext(estimates);
  const unreadEmails = zohoContext ? `${emailsContext}\n\n${zohoContext}` : emailsContext;
  const pendingTasks = buildTasksContext(tasks);
  const pendingFromFounder = buildPendingContext(pendingItems);

  const system = BRIEF_SYSTEM
    .replace('{meetings}', meetings)
    .replace('{whatsappDigests}', whatsappDigests)
    .replace('{unreadEmails}', unreadEmails)
    .replace('{pendingTasks}', pendingTasks)
    .replace('{pendingFromFounder}', pendingFromFounder);

  console.log('morning-brief-runner: generating brief via omniroute');
  const brief = await omniroute(system, 'Generate briefing now.', { temperature: 0.7 });
  if (!brief || !brief.trim()) throw new Error('Empty brief returned by LLM');

  await workerRequest('/api/runner/founder-notes', { method: 'POST', body: { content: brief } });
  console.log('morning-brief-runner: brief saved');
}

main().catch((err) => {
  console.error('morning-brief-runner: fatal error:', err.message);
  process.exit(1);
});
