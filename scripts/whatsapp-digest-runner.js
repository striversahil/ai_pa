#!/usr/bin/env node

/**
 * whatsapp-digest-runner.js — runs the WhatsApp digest automation ON the GH
 * Actions runner (unlimited CPU), replacing the old worker trigger.
 *
 * Flow: fetch unprocessed messages from the worker → group by chat → LLM
 * summarize each chat (full or incremental via previous digest) → persist
 * digests, tasks and pending items → mark messages processed.
 *
 * Env: WORKER_URL, SHARED_SECRET, OMNIROUTE_BASE_URL, OMNIROUTE_API_KEY,
 * OMNIROUTE_MODEL (all via runner-lib).
 */

const { requireEnv, workerRequest, omnirouteJson } = require('./runner-lib');
requireEnv();

const SUMMARIZE_SYSTEM = `
You are an expert executive assistant for a startup founder.
Analyze the following batch of WhatsApp messages from a single chat/contact.
Your goal is to extract key information, sentiment, priority, suggested actions, and reply.

You MUST respond with a single, valid JSON object matching the following TypeScript schema exactly:
{
  "chatName": string (the name of the contact or group),
  "summary": string (a concise 1-2 sentence summary of what was discussed),
  "priority": "low" | "medium" | "high" | "urgent",
  "category": string (e.g. "Customer" | "Investor" | "Operations" | "Partner" | "Personal" | "Sales"),
  "sentiment": "positive" | "neutral" | "negative",
  "action_items": Array<{
    "task": string,
    "owner": string,
    "deadline": string (ISO date string YYYY-MM-DD, or null)
  }>,
  "requires_founder": boolean,
  "suggested_reply": string (a polite, professional draft of a response the founder could send, or null),
  "pending_from_founder": Array<{
    "description": string (a concrete, specific thing the FOUNDER owes or must do in this conversation),
    "due_date": string (ISO date string YYYY-MM-DD, or null)
  }>
}

CRITICAL for "pending_from_founder": This is the MOST IMPORTANT field. It captures everything the founder is expected to do or respond to in this chat, so nothing slips through. Include EVERY item the founder owes — promises made, questions directed at the founder that are unanswered, requests acknowledged but not fulfilled, follow-ups the founder said they would do. A single chat can have MULTIPLE pending items. If the founder owes nothing, set it to an empty array.

If the prompt includes a "Founder's personal context for this chat" section, treat it as the founder's private instructions: actively watch for and surface anything matching that context in the summary, priority, and/or pending_from_founder. It overrides generic priorities — it is what the founder specifically cares about in this conversation.

DO NOT include any explanation, markdown formatting blocks, or conversational padding. Output only the raw, minified JSON object.
`;

const INCREMENTAL_SYSTEM = `
You are an expert executive assistant for a startup founder.

You have been given:
1. A PREVIOUS SUMMARY of a WhatsApp conversation (from an earlier batch of messages).
2. NEW MESSAGES that have arrived since that summary was generated.

Your job: UPDATE the previous summary with the new information. Merge the old and new content into a single, coherent output.

You MUST respond with a single, valid JSON object matching the following TypeScript schema exactly:
{
  "chatName": string,
  "summary": string (an UPDATED 1-2 sentence summary that merges the old discussion with the new messages),
  "priority": "low" | "medium" | "high" | "urgent",
  "category": string,
  "sentiment": "positive" | "neutral" | "negative",
  "action_items": Array<{ "task": string, "owner": string, "deadline": string (ISO date or null) }> (MERGE previous action items with any new ones. Remove completed. Keep open. Add new. DO NOT duplicate.),
  "requires_founder": boolean,
  "suggested_reply": string (an updated draft response incorporating the full conversation, or null),
  "pending_from_founder": Array<{ "description": string, "due_date": string (ISO date or null) }> (MERGE previous pending items with any new ones. Remove resolved. Keep open. Add new. DO NOT duplicate.)
}

Previous summary: {{previousSummary}}
Previous priority: {{previousPriority}}
Previous action items: {{previousActionItems}}

CRITICAL for "pending_from_founder": This is the MOST IMPORTANT field. It captures everything the founder is expected to do or respond to in this chat, so nothing slips through. Include EVERY item the founder owes — promises made, questions directed at the founder that are unanswered, requests acknowledged but not fulfilled, follow-ups the founder said they would do. A single chat can have MULTIPLE pending items. If the founder owes nothing, set it to an empty array.

If the prompt includes a "Founder's personal context for this chat" section, treat it as the founder's private instructions: actively watch for and surface anything matching that context in the summary, priority, and/or pending_from_founder.

DO NOT include any explanation, markdown formatting blocks, or conversational padding. Output only the raw, minified JSON object.
`;

function buildUserPrompt(chatName, messages, founderContext, previousDigest = null) {
  const lines = messages.map((m) => `[${m.timestamp}] ${m.sender}: ${m.body}`);
  if (previousDigest) {
    const actionItems = previousDigest.suggestedReply
      ? JSON.stringify([{ task: (previousDigest.summary || '').substring(0, 100) }])
      : JSON.stringify([]);
    const system = INCREMENTAL_SYSTEM
      .replace('{{previousSummary}}', previousDigest.summary || '')
      .replace('{{previousPriority}}', previousDigest.priority || 'low')
      .replace('{{previousActionItems}}', actionItems);
    const user = `Chat Name: ${chatName}\n${founderContext ? `Founder's personal context for this chat (actively watch for these):\n${founderContext}\n` : ''}\nNew Messages:\n${lines.join('\n')}`;
    return { system, user };
  }
  const user = `Chat Name: ${chatName}\n${founderContext ? `Founder's personal context for this chat (actively watch for these):\n${founderContext}\n` : ''}\nMessages:\n${lines.join('\n')}`;
  return { system: SUMMARIZE_SYSTEM, user };
}

function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  console.log('whatsapp-digest-runner: fetching unprocessed messages');
  const messages = await workerRequest('/api/runner/messages/unprocessed');
  if (!messages.length) {
    console.log('whatsapp-digest-runner: no unprocessed messages found');
    return;
  }
  console.log(`whatsapp-digest-runner: ${messages.length} messages in ${new Set(messages.map((m) => m.chatId)).size} chats`);

  const chatsMap = new Map();
  for (const msg of messages) {
    const list = chatsMap.get(msg.chatId) || [];
    list.push(msg);
    chatsMap.set(msg.chatId, list);
  }

  let processedChats = 0;
  let failedChats = 0;
  let tasksCreated = 0;

  for (const [chatId, chatMessages] of chatsMap.entries()) {
    const chatName = chatMessages[0].sender || chatId;
    try {
      const [latestDigestRes, noteRes] = await Promise.all([
        workerRequest(`/api/runner/digests/latest?chatId=${encodeURIComponent(chatId)}`),
        workerRequest(`/api/runner/chat-notes?chatId=${encodeURIComponent(chatId)}`),
      ]);
      const previousDigest = latestDigestRes.digest || null;
      const founderContext = noteRes.content || '';

      const { system, user } = buildUserPrompt(chatName, chatMessages, founderContext, previousDigest);
      const result = await omnirouteJson(system, user, { temperature: 0.1 });

      const digestRes = await workerRequest('/api/runner/digests', {
        method: 'POST',
        body: {
          chatId,
          chatName: result.chatName || chatName,
          summary: result.summary || '',
          priority: result.priority || 'medium',
          category: result.category || 'General',
          sentiment: result.sentiment || 'neutral',
          requiresFounder: !!result.requires_founder,
          suggestedReply: result.suggested_reply || undefined,
        },
      });

      const digestId = digestRes.id;

      if (Array.isArray(result.pending_from_founder) && result.pending_from_founder.length) {
        for (const item of result.pending_from_founder) {
          if (!item.description) continue;
          await workerRequest('/api/runner/pending-items', {
            method: 'POST',
            body: { chatId, chatName: result.chatName || chatName, description: item.description, dueDate: toDateOrNull(item.due_date) },
          });
        }
      }

      if (Array.isArray(result.action_items) && result.action_items.length) {
        for (const item of result.action_items) {
          if (!item.task) continue;
          await workerRequest('/api/runner/tasks', {
            method: 'POST',
            body: { title: item.task, owner: item.owner || 'Founder', status: 'PENDING', deadline: toDateOrNull(item.deadline), source: 'WHATSAPP', sourceId: digestId },
          });
          tasksCreated++;
        }
      }

      const ids = chatMessages.map((m) => m.id);
      await workerRequest('/api/runner/messages/mark-processed', { method: 'POST', body: { ids } });
      processedChats++;
      console.log(`whatsapp-digest-runner: processed chat ${chatId}`);
    } catch (err) {
      failedChats++;
      console.error(`whatsapp-digest-runner: failed chat ${chatId}: ${err.message}`);
    }
  }

  console.log(`whatsapp-digest-runner: done — chats=${processedChats}, failed=${failedChats}, tasks=${tasksCreated}`);

  if (failedChats > 0) {
    console.error(`whatsapp-digest-runner: ${failedChats} chat(s) failed (omniroute/LLM unreachable). Failing the run.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('whatsapp-digest-runner: fatal error:', err.message);
  process.exit(1);
});
