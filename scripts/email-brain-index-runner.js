#!/usr/bin/env node

/**
 * email-brain-index-runner.js — runs the email sync + company-brain re-index ON
 * the GH Actions runner (unlimited CPU), replacing the old worker trigger.
 *
 * Flow:
 *  1. Sync emails: replicate the backend mock email provider (same 2 mock
 *     emails it always stored) via the worker's instant store endpoint.
 *  2. Re-index the company brain: fetch all source rows (messages, emails,
 *     digests, estimates + comments, tasks) from the worker, build the same
 *     normalized BrainContext text entries as BrainIndexer.indexAll(), and
 *     upsert them via the worker. Vector embeddings are not stored on D1.
 *
 * Env: WORKER_URL, SHARED_SECRET (all via runner-lib).
 */

const { workerRequest } = require('./runner-lib');

const missing = [];
if (!process.env.WORKER_URL) missing.push('WORKER_URL');
if (!process.env.SHARED_SECRET) missing.push('SHARED_SECRET');
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const MOCK_EMAILS = [
  {
    subject: 'Urgent: Feedback on Q3 slide deck',
    sender: 'investor-rahul@vcpartner.com',
    body: 'Hi Sahil, could you please review the Q3 slide deck and send over the revised valuations by tonight? Thanks!',
  },
  {
    subject: 'Weekly Team Update & Standup',
    sender: 'operations@startup.com',
    body: 'Hey team, here is the agenda for tomorrow morning\'s sync. Let me know if you want to add anything.',
  },
];

function isoDay(d) {
  if (!d) return 'None';
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? 'None' : date.toISOString().split('T')[0];
}

async function main() {
  console.log('email-brain-index-runner: syncing emails');
  const emailRes = await workerRequest('/api/runner/emails', { method: 'POST', body: { emails: MOCK_EMAILS } });
  console.log(`email-brain-index-runner: ${emailRes.count} emails stored`);

  console.log('email-brain-index-runner: fetching brain source data');
  const sources = await workerRequest('/api/runner/brain/sources');
  const { messages = [], emails = [], digests = [], estimates = [], tasks = [] } = sources;
  const rows = [];
  let indexed = 0;

  for (const msg of messages) {
    rows.push({
      source: 'WHATSAPP',
      sourceId: msg.id,
      entityName: msg.sender,
      content: `[WhatsApp] From: ${msg.sender}\nMessage: ${msg.body}`,
      metadata: JSON.stringify({ chatId: msg.chatId }),
      eventDate: msg.timestamp,
    });
    indexed++;
  }

  for (const email of emails) {
    rows.push({
      source: 'EMAIL',
      sourceId: email.id,
      entityName: email.sender,
      content: `[Email] From: ${email.sender}\nSubject: ${email.subject}\nBody: ${email.body}`,
      metadata: JSON.stringify({ subject: email.subject }),
      eventDate: email.createdAt,
    });
    indexed++;
  }

  for (const digest of digests) {
    rows.push({
      source: 'DIGEST',
      sourceId: digest.id,
      entityName: digest.chatName,
      content: `[WhatsApp Digest] Chat: ${digest.chatName}\nPriority: ${digest.priority} | Category: ${digest.category}\nSummary: ${digest.summary}${digest.suggestedReply ? `\nSuggested Reply: ${digest.suggestedReply}` : ''}`,
      metadata: JSON.stringify({ priority: digest.priority, category: digest.category, requiresFounder: digest.requiresFounder }),
      eventDate: digest.createdAt,
    });
    indexed++;
  }

  for (const est of estimates) {
    const intentScore = est.classification?.intentScore ?? 'N/A';
    const reasoning = est.classification?.reasoning ?? 'No AI analysis yet';
    rows.push({
      source: 'ESTIMATE',
      sourceId: est.estimateId,
      entityName: est.customerName,
      content: `[Estimate] Customer: ${est.customerName}\nEstimate No: ${est.estimateNumber} | Status: ${est.status} | Total: ₹${Number(est.total).toLocaleString()} | Date: ${est.date}\nAI Intent Score: ${intentScore}/10\nReasoning: ${reasoning}`,
      metadata: JSON.stringify({ estimateNumber: est.estimateNumber, status: est.status, total: est.total, intentScore }),
      eventDate: est.lastSyncTime,
    });
    indexed++;
    for (const comment of est.comments || []) {
      if (!comment.description?.trim()) continue;
      rows.push({
        source: 'COMMENT',
        sourceId: comment.commentId,
        entityName: est.customerName,
        content: `[Sales Comment] Customer: ${est.customerName} (${est.estimateNumber})\nBy: ${comment.commentedBy} on ${comment.date}\nComment: ${comment.description}`,
        metadata: JSON.stringify({ estimateNumber: est.estimateNumber, commentedBy: comment.commentedBy }),
        eventDate: comment.date || est.date,
      });
      indexed++;
    }
  }

  for (const task of tasks) {
    rows.push({
      source: 'TASK',
      sourceId: task.id,
      entityName: task.owner,
      content: `[Task] ${task.title}\nOwner: ${task.owner} | Status: ${task.status} | Source: ${task.source}${task.deadline ? ` | Deadline: ${isoDay(task.deadline)}` : ''}`,
      metadata: JSON.stringify({ status: task.status, source: task.source }),
      eventDate: task.createdAt,
    });
    indexed++;
  }

  console.log(`email-brain-index-runner: ${indexed} context entries to upsert`);
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const res = await workerRequest('/api/runner/brain/context', { method: 'POST', body: { rows: batch } });
    console.log(`email-brain-index-runner: batch ${i / 100 + 1} upserted (${res.count})`);
  }
  console.log(`email-brain-index-runner: done — ${indexed} entries indexed`);
}

main().catch((err) => {
  console.error('email-brain-index-runner: fatal error:', err.message);
  process.exit(1);
});
