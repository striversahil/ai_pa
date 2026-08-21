#!/usr/bin/env node
/**
 * One-off: re-classify CLOSED estimates (accepted/declined) that were last
 * processed before sales-agent attribution existed. Mirrors the runner's
 * closed-sync path but driven from D1 state instead of Zoho.
 */
const { requireEnv, workerRequest, omnirouteJson } = require('./runner-lib');
const { classifyEstimate, buildClassification, defaultClassification, fetchAgentRoster } = require('./zoho-sent-runner.js');

const SYSTEM_PHRASES = ['estimate has been created','estimate has been sent','estimate sent','email sent to','mail sent to','status changed from','quote created','quote sent','quote updated','quote marked as','quote emailed to','quote converted','quote viewed','viewed the quote','amount changed from','sent status','created by','updated by','viewed in mail','client viewed','accepted by','declined by','payment received','has been printed','marked as sent','marked as declined','created for'];
const clean = (h) => (h || '').replace(/<\/p>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n\s*\n/g, '\n').trim();
const isSystem = (d, by) => (by || '').toLowerCase().includes('system') || SYSTEM_PHRASES.some((p) => d.toLowerCase().includes(p));

async function main() {
  requireEnv(['WORKER_URL', 'SHARED_SECRET', 'OMNIROUTE_BASE_URL', 'OMNIROUTE_API_KEY']);
  const roster = await fetchAgentRoster();
  console.log(`roster (${roster.length}): ${roster.join(', ')}`);

  const state = await workerRequest('/api/runner/zoho/state');
  const closedIds = new Set((state.estimates || []).filter((e) => e.status !== 'sent').map((e) => e.estimateId));
  console.log(`closed estimates to reclassify: ${closedIds.size}`);

  const all = await workerRequest('/api/estimates');
  const closed = (all.estimates || []).filter((e) => closedIds.has(e.estimateId));

  // Comments come pre-filtered (system-generated removed) and sorted by id desc.
  let done = 0;
  for (const est of closed) {
    try {
      const comments = (est.comments || []).map((c) => ({ id: String(c.commentId), text: clean(c.description) }))
        .filter((c) => c.text);
      const historyLines = comments.slice(0, 15).map((c) => `[date] Agent: ${c.text}`);
      const commentHistory = historyLines.join('\n');

      let classification;
      if (!commentHistory) {
        classification = defaultClassification(est.date, 'No');
      } else {
        const { badgeResult, journeyResult } = await classifyEstimate(
          est.customerName, est.total, historyLines[0], est.date, commentHistory, roster);
        classification = buildClassification(badgeResult, journeyResult, est.date, 'No', roster);
      }
      await workerRequest('/api/runner/zoho/classification', {
        method: 'POST',
        body: { estimateId: est.estimateId, classification },
      });
      done++;
      if (done % 10 === 0) console.log(`${done}/${closed.length} done`);
    } catch (err) {
      console.error(`${est.estimateNumber}: ${err.message}`);
    }
  }
  console.log(`complete: ${done}/${closed.length}`);
}

main().catch((err) => { console.error('fatal:', err.message); process.exit(1); });
