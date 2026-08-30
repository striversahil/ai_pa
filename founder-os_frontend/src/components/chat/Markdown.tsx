"use client";

import React from "react";

const INLINE_RE = /(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*\n]+)\*)|(~~([^~]+)~~)|(`([^`\n]+)`)|(https?:\/\/[^\s<>"]+)/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const [full, , bold, , underline, , italic, , strike, , code, link] = match;
    const k = `${keyPrefix}-${i++}`;
    if (bold) out.push(<strong key={k} className="font-bold">{renderInline(bold, k)}</strong>);
    else if (underline) out.push(<u key={k}>{renderInline(underline, k)}</u>);
    else if (italic) out.push(<em key={k}>{renderInline(italic, k)}</em>);
    else if (strike) out.push(<s key={k} className="opacity-80">{renderInline(strike, k)}</s>);
    else if (code) out.push(
      <code key={k} className="rounded bg-black/25 px-1 py-0.5 font-mono text-[0.85em] text-[var(--chat-text)]">
        {code}
      </code>
    );
    else if (link) out.push(
      <a key={k} href={link} target="_blank" rel="noopener noreferrer" className="text-[var(--chat-accent)] hover:underline">
        {link}
      </a>
    );
    last = idx + full.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function MarkdownBody({ text }: { text: string }) {
  if (!text) return null;
  const blocks: React.ReactNode[] = [];
  const re = /```(?:[a-zA-Z0-9_-]*)\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    if (idx > last) blocks.push(...renderLines(text.slice(last, idx), `t-${i}`));
    blocks.push(
      <pre
        key={`cb-${i++}`}
        className="my-1 max-w-full overflow-x-auto rounded-md border border-[var(--chat-border)] bg-black/30 p-2.5 font-mono text-[0.85em] leading-relaxed text-[var(--chat-text)]"
      >
        {match[1]?.replace(/\n$/, "")}
      </pre>
    );
    last = idx + match[0].length;
  }
  if (last < text.length) blocks.push(...renderLines(text.slice(last), `t-${i}`));
  return <>{blocks}</>;
}

function renderLines(chunk: string, keyPrefix: string): React.ReactNode[] {
  const lines = chunk.split("\n");
  return lines.map((line, li) => (
    <React.Fragment key={`${keyPrefix}-${li}`}>
      {li > 0 && <br />}
      {line.length > 0 && renderInline(line, `${keyPrefix}-${li}`)}
    </React.Fragment>
  ));
}
