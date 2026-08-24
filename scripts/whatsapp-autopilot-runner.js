#!/usr/bin/env node

/**
 * whatsapp-autopilot-runner.js — WhatsApp Business Autopilot core loop.
 *
 * Implements whatsapp-business-autopilot-architecture.md on top of the
 * founder-os stack: every inbound message is processed as an event against the
 * system's CURRENT state (per-chat task queue), not independently.
 *
 *   Phase 1 — Association: deterministic reply-link lineage first, LLM
 *             fallback second, human review on low confidence.
 *   Phase 2 — Transition: the LLM picks one of eight transitions
 *             (create/update/complete/reopen/wait/clarify/review/action).
 *   Actions — proposed tools are RECORDED as pending rows, never executed.
 *
 * PHASE 0 — SHADOW MODE: nothing is ever sent to a customer or vendor. The
 * run populates the task queue + audit trail alongside the existing digest
 * pipeline so the transition engine can be evaluated risk-free.
 *
 * Concurrency (§4.10): messages are grouped per chat and processed serially
 * (arrival order); task writes are optimistic (`version`) with one re-read +
 * re-run on conflict; create-dedupe window is enforced server-side too.
 *
 * Env (via runner-lib): WORKER_URL, SHARED_SECRET, OMNIROUTE_BASE_URL,
 * OMNIROUTE_API_KEY, OMNIROUTE_MODEL.
 * Optional thresholds: ASSOC_THRESHOLD (0.85), TRANSITION_CREATE_THRESHOLD
 * (0.8), TRANSITION_COMPLETE_THRESHOLD (0.9), AUTOPILOT_AUTO_CLOSE_DAYS (7),
 * AUTOPILOT_FOLLOW_UP_HOURS (24).
 */

const {
  requireEnv, workerRequest, omnirouteJson,
} = require('./runner-lib');
requireEnv();

const ASSOCIATION_THRESHOLD = Number(process.env.ASSOC_THRESHOLD) || 0.85;
const TRANSITION_CREATE_THRESHOLD = Number(process.env.TRANSITION_CREATE_THRESHOLD) || 0.8;
const TRANSITION_COMPLETE_THRESHOLD = Number(process.env.TRANSITION_COMPLETE_THRESHOLD) || 0.9;
const AUTO_CLOSE_DAYS = Number(process.env.AUTOPILOT_AUTO_CLOSE_DAYS) || 7;
const FOLLOW_UP_HOURS = Number(process.env.AUTOPILOT_FOLLOW_UP_HOURS) || 24;
const WAIT_TIMEOUT_HOURS = Number(process.env.AUTOPILOT_WAIT_TIMEOUT_HOURS) || 4;

// Transitions that commit something external (price/substitution/third party)
// always land in review during shadow mode regardless of confidence.
const REVIEW_ALWAYS = new Set(['action']);

const TRANSITION_SYSTEM = `
You are the state-transition engine of a B2B industrial-manufacturing company's
WhatsApp business autopilot (Brindavan Udyog). You decide WHAT CHANGES in the
business state — never what to say from memory; facts come from tools.

You receive: a NEW MESSAGE from a chat, that chat's OPEN TASK QUEUE, and recent
context. Respond with ONE valid JSON object:

{
  "associated_task_id": string | null,
     // id of the EXISTING open task this message belongs to, or null if new
  "association_confidence": number (0..1),
     // how sure you are about the association decision above
  "is_new_task": boolean,
     // true when this message starts genuinely new business work
  "transition": "create" | "update" | "complete" | "reopen" | "wait" | "clarify" | "review" | "action",
     // create: genuinely new work · update: new info on an open task ·
     // complete: resolved · reopen: completed task got relevant new activity ·
     // wait: blocked externally, paused not stalled · clarify: must ask the
     // customer something before proceeding · review: low confidence or policy ·
     // action: trigger a business tool as part of handling
  "transition_confidence": number (0..1),
  "task_type": string,
     // price_enquiry | order | complaint | support | vendor_follow_up | general
  "item": string | null,
     // the concrete subject, e.g. "Item B, size 6 inch" (short, normalized)
  "note": string | null,
     // one-sentence reason for this decision (stored in history)
  "proposed_actions": [
    { "tool": string, "args": object, "reason": string }
  ],
     // tools: check_inventory(item,size) · broadcast_to_vendors(item) ·
     // forward_message(target_chat_id, context_summary) · send_reply(body) ·
     // schedule_follow_up(notes) · request_clarification(question) ·
     // escalate_to_human(reason)
     // PROPOSALS ONLY — they are logged for human approval, never executed.
  "reply_draft": string | null
     // if a customer reply would eventually be needed, draft it (not sent)
}

RULES:
- Associate before transitioning: link to an open task when the message is
  clearly about it (same item/product/topic). Prefer item-terms over recency
  in group chats — several people may discuss different items there.
- Only set is_new_task=true when no open task matches AND real business work is
  being requested. Small talk / greetings → transition "review", is_new_task=false.
- A completed task referenced again with new activity → "reopen".
- Price/availability questions → propose check_inventory; never answer stock
  from memory. If asked directly, still propose send_reply only as a DRAFT.
- Frustrated/negative sentiment → transition "review".
DO NOT output anything except the raw JSON object.
`;

function buildUserPrompt({ chatId, sender, body, timestamp, tasksForChat, recentMessages }) {
  const queue = tasksForChat.length
    ? tasksForChat.map((t) => `- id=${t.id} type=${t.taskType} status=${t.status} item=${t.item ?? '—'}${t.summary ? ` summary=${t.summary}` : ''}`).join('\n')
    : '(no open tasks for this chat)';
  const context = recentMessages.length
    ? recentMessages.map((m) => `[${m.timestamp}] ${m.sender}: ${m.body}`).join('\n')
    : '(no recent history)';
  return [
    `CHAT_ID: ${chatId}`,
    `NEW MESSAGE:`,
    `[${timestamp}] ${sender}: ${body}`,
    ``,
    `OPEN TASK QUEUE (this chat):`,
    queue,
    ``,
    `RECENT CONTEXT (last messages, oldest first):`,
    context,
  ].join('\n');
}

function isoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Transition gate (§8): conservative per-transition thresholds. */
function transitionGate(transition, confidence) {
  const c = typeof confidence === 'number' ? confidence : 0;
  switch (transition) {
    case 'create':
    case 'update':
      return c >= TRANSITION_CREATE_THRESHOLD ? 'ok' : 'review';
    case 'complete':
      return c >= TRANSITION_COMPLETE_THRESHOLD ? 'ok' : 'review';
    case 'wait':
    case 'clarify':
      return 'ok'; // commit nothing — safe at any confidence
    default:
      return c >= TRANSITION_CREATE_THRESHOLD ? 'ok' : 'review';
  }
}

async function transitionTask(payload) {
  try {
    return await workerRequest('/api/runner/autopilot/tasks/transition', { method: 'POST', body: payload });
  } catch (err) {
    const msg = String(err.message);
    if (!msg.includes('409')) throw err;
    // Version conflict (§4.10): the task changed underneath us (e.g. the
    // follow-up scheduler completed it in another lane). Re-read the fresh
    // row returned in the 409 body and re-run Phase 2 against it once.
    let fresh = null;
    try {
      const jsonStart = msg.indexOf('{');
      if (jsonStart !== -1) fresh = JSON.parse(msg.slice(jsonStart)).task;
    } catch { /* fall through to plain retry */ }
    if (!fresh) throw err;
    console.log(`autopilot: version conflict on ${payload.taskId} — re-running against v${fresh.version}`);
    return await workerRequest('/api/runner/autopilot/tasks/transition', {
      method: 'POST',
      body: { ...payload, expectedVersion: fresh.version },
    });
  }
}

async function proposeActions(taskId, actions) {
  if (!Array.isArray(actions) || !actions.length) return 0;
  const rows = actions
    .filter((a) => a && a.tool)
    .slice(0, 5)
    .map((a) => ({
      taskId,
      toolName: String(a.tool),
      input: a.args ?? {},
      reason: a.reason || null,
      requestedBy: 'llm',
      status: 'pending', // SHADOW MODE: recorded, never executed
    }));
  if (!rows.length) return 0;
  await workerRequest('/api/runner/autopilot/actions', { method: 'POST', body: { actions: rows } });
  return rows.length;
}

/**
 * Process one message end-to-end. Returns a summary of what was decided.
 */
async function processMessage(msg, ctx) {
  const out = { msgId: msg.wahaMessageId || msg.id, decision: null };

  // ── Phase 1: association — deterministic lineage first ──────────────────
  let linkedTask = null;
  let associationMethod = null;
  let associationConfidence = null;

  if (msg.quotedMessageId && ctx.lineageById[msg.quotedMessageId]) {
    const parent = ctx.lineageById[msg.quotedMessageId];
    if (parent.taskId) {
      linkedTask = ctx.tasksById.get(parent.taskId) || null;
      associationMethod = 'deterministic';
    } else if (parent.resolutionStatus === 'pending') {
      // Out-of-order delivery: parent not yet resolvable — fall through to the
      // LLM path without blocking (§4.3).
      associationMethod = null;
    }
  }

  // ── LLM: combined association + transition call ─────────────────────────
  const tasksForChat = (ctx.openTasksByChat.get(msg.chatId) || [])
    .filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const prompt = buildUserPrompt({
    chatId: msg.chatId,
    sender: msg.sender || 'customer',
    body: msg.body,
    timestamp: msg.timestamp,
    tasksForChat,
    recentMessages: ctx.recentByChat[msg.chatId] || [],
  });

  let result;
  try {
    result = await omnirouteJson(TRANSITION_SYSTEM, prompt, { temperature: 0 });
  } catch (err) {
    // §7: invalid/unparseable structured output after retries → review path
    console.error(`autopilot: LLM failed for ${out.msgId}: ${err.message}`);
    result = {
      associated_task_id: null, association_confidence: 0, is_new_task: false,
      transition: 'review', transition_confidence: 0, task_type: 'general',
      item: null, note: `LLM failure: ${err.message}`.slice(0, 200),
      proposed_actions: [{ tool: 'escalate_to_human', args: { reason: 'LLM unavailable' }, reason: 'engine failure' }],
    };
  }

  out.decision = result;

  // Deterministic link wins over the LLM's association guess.
  const llmTask = result.associated_task_id ? ctx.tasksById.get(result.associated_task_id) : null;
  if (!linkedTask && llmTask && (result.association_confidence ?? 0) >= ASSOCIATION_THRESHOLD) {
    linkedTask = llmTask;
    associationMethod = 'llm';
    associationConfidence = result.association_confidence;
  }

  // Low-confidence association with no deterministic anchor → don't guess.
  if (!linkedTask && !result.is_new_task && (result.association_confidence ?? 0) < ASSOCIATION_THRESHOLD) {
    console.log(`autopilot: low assoc confidence (${result.association_confidence}) for ${out.msgId} — routing to review`);
  }

  // ── Phase 2: apply the transition ────────────────────────────────────────
  let taskId = linkedTask?.id || null;
  const gate = transitionGate(result.transition, result.transition_confidence);
  const forceReview = REVIEW_ALWAYS.has(result.transition);
  const needsReview = result.transition === 'review' || gate === 'review' || forceReview;

  if (result.is_new_task && result.transition === 'create' && !needsReview && !taskId) {
    const created = await workerRequest('/api/runner/autopilot/tasks/create', {
      method: 'POST',
      body: {
        chatId: msg.chatId,
        chatName: msg.chatName || msg.chatId,
        taskType: result.task_type || 'general',
        item: result.item || msg.body.slice(0, 120),
        rootWaMessageId: out.msgId,
        notes: result.note,
        confidence: result.transition_confidence,
        wahaMessageId: out.msgId,
        triggeredBy: 'llm',
      },
    });
    taskId = created.task.id;
    ctx.tasksById.set(taskId, created.task);
    console.log(`autopilot: created task ${taskId} (${created.deduped ? 'dedupe-hit' : 'new'}) type=${result.task_type}`);
  } else if (needsReview && !taskId) {
    // Unroutable message → open a review task so nothing silently drops.
    const created = await workerRequest('/api/runner/autopilot/tasks/create', {
      method: 'POST',
      body: {
        chatId: msg.chatId,
        chatName: msg.chatName || msg.chatId,
        taskType: result.task_type || 'general',
        item: result.item || msg.body.slice(0, 120),
        rootWaMessageId: out.msgId,
        notes: `[auto→review] ${result.note || 'low confidence'}`,
        wahaMessageId: out.msgId,
      },
    });
    taskId = created.task.id;
    await workerRequest('/api/runner/autopilot/tasks/transition', {
      method: 'POST',
      body: {
        taskId, expectedVersion: created.task.version, transition: 'review', status: 'needs_review',
        notes: result.note || 'low confidence', confidence: result.transition_confidence,
        wahaMessageId: out.msgId,
      },
    });
    ctx.tasksById.set(taskId, { ...created.task, status: 'needs_review' });
  } else if (taskId) {
    const statusMap = {
      update: linkedTask ? undefined : 'open',
      reopen: 'open',
      wait: 'waiting',
      clarify: 'needs_clarification',
      review: 'needs_review',
      complete: gate === 'ok' ? 'completed' : 'needs_review',
    };
    const nextStatus = needsReview ? 'needs_review' : statusMap[result.transition];
    const patch = {
      taskId,
      expectedVersion: ctx.tasksById.get(taskId)?.version ?? 1,
      transition: result.transition,
      triggeredBy: 'llm',
      wahaMessageId: out.msgId,
      notes: result.note,
      confidence: result.transition_confidence,
      item: result.item || undefined,
      summary: result.reply_draft ? `draft: ${String(result.reply_draft).slice(0, 300)}` : undefined,
    };
    if (nextStatus) patch.status = nextStatus;
    if (nextStatus === 'waiting') {
      const now = Date.now();
      patch.waitingSince = new Date(now).toISOString();
      patch.waitTimeoutAt = new Date(now + WAIT_TIMEOUT_HOURS * 3600_000).toISOString();
      patch.followUpDueAt = new Date(now + WAIT_TIMEOUT_HOURS * 3600_000).toISOString();
    } else if (nextStatus === 'open' && ['create', 'update', 'reopen'].includes(result.transition)) {
      patch.followUpDueAt = new Date(Date.now() + FOLLOW_UP_HOURS * 3600_000).toISOString();
    } else if (nextStatus === 'completed') {
      patch.clearFollowUp = true;
    }
    if (patch.expectedVersion == null) delete patch.expectedVersion;
    const res = await transitionTask(patch);
    if (res.task) ctx.tasksById.set(taskId, res.task);
  }

  // ── Lineage record ────────────────────────────────────────────────────────
  const lineageRows = [{
    waMessageId: out.msgId,
    parentWaMessageId: msg.quotedMessageId || null,
    rootWaMessageId: linkedTask?.rootMessageId || msg.quotedMessageId || out.msgId,
    taskId,
    associationMethod: associationMethod || 'llm',
    confidence: associationConfidence ?? result.association_confidence ?? null,
    resolutionStatus: msg.quotedMessageId && !ctx.lineageById[msg.quotedMessageId] ? 'pending' : 'resolved',
  }];
  await workerRequest('/api/runner/autopilot/lineage', { method: 'POST', body: { rows: lineageRows } });

  // ── Actions: proposals only (shadow mode) ────────────────────────────────
  const proposed = await proposeActions(taskId, result.proposed_actions);
  if (proposed) console.log(`autopilot: ${proposed} action(s) proposed (pending) for task ${taskId}`);

  return { ...out, taskId };
}

/** Silence bookkeeping pass (§4.9): nudges, Wait timeouts, auto-closes. */
async function followupsPass() {
  const fu = await workerRequest('/api/runner/autopilot/followups?autoCloseDays=' + AUTO_CLOSE_DAYS);
  let acted = 0;

  for (const task of fu.waitTimeouts || []) {
    // Internal Wait timeout (e.g. vendor silent 4h) → escalate to review.
    await transitionTask({
      taskId: task.id, expectedVersion: task.version, transition: 'review',
      status: 'needs_review', triggeredBy: 'system',
      notes: `Wait timeout (${WAIT_TIMEOUT_HOURS}h) — manual follow-up needed`,
    });
    acted++;
  }

  for (const task of fu.autoCloses || []) {
    await transitionTask({
      taskId: task.id, expectedVersion: task.version, transition: 'complete',
      status: 'completed', triggeredBy: 'system', clearFollowUp: true,
      notes: `Auto-closed after ${AUTO_CLOSE_DAYS} days of silence`,
    });
    acted++;
  }

  for (const task of fu.dueFollowUps || []) {
    // Shadow mode: propose the nudge, never send it. Skip if a pending
    // follow-up proposal already exists for this task (idempotence per cycle).
    const alreadyPending = (fu.pendingGuard || []).some(
      (a) => a.taskId === task.id && a.toolName === 'schedule_follow_up' && a.status === 'pending',
    );
    if (alreadyPending) continue;
    await workerRequest('/api/runner/autopilot/actions', {
      method: 'POST',
      body: {
        actions: [{
          taskId: task.id,
          toolName: 'schedule_follow_up',
          input: { notes: `Customer silent since ${task.lastInboundAt || task.createdAt} — nudge #${(task.followUpCount || 0) + 1}` },
          reason: 'follow-up policy (silence)',
          requestedBy: 'system',
        }],
      },
    });
    acted++;
  }

  return acted;
}

async function main() {
  // Watermark-based ingestion (independent of the digest pipeline): read the
  // last processed timestamp from the worker, fetch everything newer.
  const wm = await workerRequest('/api/runner/autopilot/watermark');
  const since = wm.watermark || null;
  console.log(`whatsapp-autopilot-runner: fetching inbox since=${since || 'beginning'}`);
  const inbox = await workerRequest(
    `/api/runner/autopilot/inbox?context=15${since ? `&since=${encodeURIComponent(since)}` : ''}`,
  );

  // Follow-up bookkeeping first — cheap, no LLM, keeps timers honest even on
  // runs where no new messages arrived.
  const fuActed = await followupsPass();
  if (fuActed) console.log(`whatsapp-autopilot-runner: followup pass — ${fuActed} task(s) updated`);

  const messages = inbox.messages || [];
  if (!messages.length) {
    console.log('whatsapp-autopilot-runner: no new messages');
    return;
  }
  console.log(`whatsapp-autopilot-runner: ${messages.length} message(s) across ${new Set(messages.map((m) => m.chatId)).size} chat(s)`);

  // Resolve deterministic lineage anchors for every quoted reference.
  const quotedIds = [...new Set(messages.map((m) => m.quotedMessageId).filter(Boolean))];
  let lineageById = {};
  if (quotedIds.length) {
    const lookup = await workerRequest(`/api/runner/autopilot/lineage-lookup?ids=${encodeURIComponent(quotedIds.join(','))}`);
    lineageById = lookup.byId || {};
  }

  const ctx = {
    lineageById,
    recentByChat: inbox.recentByChat || {},
    openTasksByChat: new Map(),
    tasksById: new Map((inbox.tasks || []).map((t) => [t.id, t])),
  };
  for (const t of inbox.tasks || []) {
    const list = ctx.openTasksByChat.get(t.chatId) || [];
    list.push(t);
    ctx.openTasksByChat.set(t.chatId, list);
  }

  // Per-chat serialization (§4.10): chats processed sequentially, arrival order.
  const byChat = new Map();
  for (const m of messages) {
    const list = byChat.get(m.chatId) || [];
    list.push(m);
    byChat.set(m.chatId, list);
  }

  let processed = 0;
  let failed = 0;
  const handledIds = new Set();
  for (const [chatId, chatMsgs] of byChat.entries()) {
    for (const m of chatMsgs) {
      try {
        await processMessage(m, ctx);
        processed++;
        handledIds.add(m.id);
      } catch (err) {
        failed++;
        console.error(`whatsapp-autopilot-runner: failed message ${m.wahaMessageId || m.id}: ${err.message}`);
      }
    }
    console.log(`whatsapp-autopilot-runner: chat ${chatId} done`);
  }

  if (messages.length > 0) {
    // Advance the watermark past the longest successfully-handled PREFIX
    // (messages are fetched in ascending timestamp order) so nothing under
    // the watermark is ever skipped, while successes aren't re-run either.
    const sorted = [...messages].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    let prefixEnd = null;
    for (const m of sorted) {
      if (!handledIds.has(m.id)) break;
      prefixEnd = m;
    }
    const t = prefixEnd ? new Date(prefixEnd.timestamp).getTime() : NaN;
    if (Number.isFinite(t)) {
      await workerRequest('/api/runner/autopilot/watermark', {
        method: 'POST',
        body: { watermark: new Date(t).toISOString() },
      });
    }
    if (failed > 0) {
      console.log(`whatsapp-autopilot-runner: ${failed} failure(s) — watermark advanced to last clean prefix; failed messages will re-run`);
    }
  }

  console.log(`whatsapp-autopilot-runner: done — processed=${processed}, failed=${failed}, shadow mode (nothing sent)`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('whatsapp-autopilot-runner: fatal error:', err.message);
  process.exit(1);
});
