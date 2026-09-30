// linkedin-format.js — normalize model output into a finished post.
// The writing/editing prompts describe Hook/Post/Hashtags sections; agnes
// sometimes returns that shape as a JSON OBJECT instead of markdown (seen
// live 30/09: raw JSON stored as postFinal). composeFinal() converts either
// shape into copy-paste-ready markdown: Hook A → post → hashtags. Hook B and
// the data-needed list are preserved for the draft, never dropped.

'use strict';

function asTags(v) {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean).join(' ');
  return String(v ?? '').trim();
}

function pick(o, keys) {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function composeFinal(text) {
  let t = String(text ?? '').trim();
  // Strip code fences and leading prose — the model sometimes wraps the JSON
  // ("Here is the post:" / ```json). Find the first { and last } instead of
  // requiring the whole payload to BE json.
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  const empty = { final: String(text ?? '').trim(), hookB: '', dataNeeded: [] };
  if (start === -1 || end <= start) return empty;
  let o;
  try {
    o = JSON.parse(t.slice(start, end + 1));
  } catch {
    return empty;
  }
  if (!o || typeof o !== 'object') return empty;
  // Key names drift run to run (Hook A / hookA / hook_a, Post / post_body /
  // body_draft …) — accept every variant seen live.
  const hookA = pick(o, ['Hook A', 'hookA', 'hook_a']);
  const hookB = pick(o, ['Hook B', 'hookB', 'hook_b']);
  const post = pick(o, ['Post', 'post', 'body', 'post_draft', 'postDraft', 'body_draft', 'bodyDraft', 'post_body', 'postBody']);
  if (!post) return empty;
  const tagRaw = o.Hashtags ?? o.hashtags ?? o.tags;
  const tags = asTags(tagRaw);
  const dataRaw = o['Data Still Needed'] ?? o.data_still_needed ?? o.dataNeeded ?? o.data_needed ?? o['dataNeeded'];
  const dataNeeded = Array.isArray(dataRaw) ? dataRaw.map(String) : [];
  let final = hookA ? `${hookA}\n\n${post}` : post;
  if (tags) final += `\n\n${tags}`;
  return { final, hookB, dataNeeded };
}

module.exports = { composeFinal };
