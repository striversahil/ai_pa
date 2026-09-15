// comments.js — pure Zoho-comment helpers (no I/O, no env).
// Shared by diff.js (fingerprint / newcomer detection) and analyze.js
// (sales-comment extraction / ordering).

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

// ── Timestamp ordering ─────────────────────────────────────────────────────
// Zoho comment_ids are NOT chronological, so "latest" must come from the
// timestamp, never id order. date_formatted ("DD/MM/YYYY hh:mm AM", IST)
// carries time-of-day; plain `date` is date-only. Id is final tiebreak.
function commentTsMs(c) {
  const fmt = c.date_formatted ?? c.dateFormatted ?? c.dateFmt ?? null;
  if (fmt) {
    const m = String(fmt).match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (m) {
      let h = parseInt(m[4], 10);
      if (m[6].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[6].toUpperCase() === 'AM' && h === 12) h = 0;
      const t = Date.parse(`${m[3]}-${m[2]}-${m[1]}T${String(h).padStart(2, '0')}:${m[5]}:00+05:30`);
      if (!Number.isNaN(t)) return t;
    }
  }
  if (c.date) {
    const t = Date.parse(String(c.date));
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

function commentIdStr(c) {
  return String(c.id ?? c.comment_id ?? '');
}

// Newest first (badge "latest" + journey history order).
function latestFirst(a, b) {
  const ta = commentTsMs(a);
  const tb = commentTsMs(b);
  if (ta !== null && tb !== null && ta !== tb) return tb - ta;
  if (ta !== null && tb === null) return -1;
  if (ta === null && tb !== null) return 1;
  return commentIdStr(b).localeCompare(commentIdStr(a));
}

// Oldest first (lead-details capture reads the FIRST real comments).
function oldestFirst(a, b) {
  const ta = commentTsMs(a);
  const tb = commentTsMs(b);
  if (ta !== null && tb !== null && ta !== tb) return ta - tb;
  if (ta !== null && tb === null) return -1;
  if (ta === null && tb !== null) return 1;
  return commentIdStr(a).localeCompare(commentIdStr(b));
}

// Normalized sales-comment list from a raw Zoho comment array.
function extractSalesComments(comments) {
  const out = [];
  for (const c of comments || []) {
    const text = cleanHtml(c.description || '');
    if (!isRealSalesComment(text, c.commented_by, c.comment_type)) continue;
    out.push({
      id: c.comment_id,
      date: c.date || '',
      dateFormatted: c.date_formatted || null,
      author: c.commented_by || 'Unknown',
      text,
    });
  }
  return out;
}

module.exports = {
  cleanHtml,
  isSystemGeneratedComment,
  isRealSalesComment,
  commentTsMs,
  latestFirst,
  oldestFirst,
  extractSalesComments,
};
