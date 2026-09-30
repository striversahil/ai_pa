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

function composeFinal(text) {
  const t = String(text ?? '').trim();
  if (!t.startsWith('{')) return { final: t, hookB: '', dataNeeded: [] };
  let o;
  try {
    o = JSON.parse(t);
  } catch {
    return { final: t, hookB: '', dataNeeded: [] };
  }
  if (!o || typeof o !== 'object' || !(o.Post || o.post)) return { final: t, hookB: '', dataNeeded: [] };
  const hookA = String(o['Hook A'] || o.hookA || '').trim();
  const hookB = String(o['Hook B'] || o.hookB || '').trim();
  const post = String(o.Post || o.post || '').trim();
  const tags = asTags(o.Hashtags ?? o.hashtags);
  const dataNeeded = Array.isArray(o['Data Still Needed']) ? o['Data Still Needed'].map(String) : [];
  let final = hookA ? `${hookA}\n\n${post}` : post;
  if (tags) final += `\n\n${tags}`;
  return { final, hookB, dataNeeded };
}

module.exports = { composeFinal };
