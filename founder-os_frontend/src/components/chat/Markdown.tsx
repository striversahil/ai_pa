"use client";

import React from "react";

const INLINE_RE = /(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*\n]+)\*)|(~~([^~]+)~~)|(`([^`\n]+)`)|(https?:\/\/[^\s<>"]+)|(\$\$[\s\S]+?\$\$)|(\$[^$\n]+?\$)/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const [full, , bold, , underline, , italic, , strike, , code, link, formulaBlock, formulaInline] = match;
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
    else if (formulaBlock) out.push(
      <span key={k} className="md-formula-block inline-block rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 font-mono text-[0.9em]">{formulaBlock.slice(2,-2)}</span>
    );
    else if (formulaInline) out.push(
      <span key={k} className="md-formula-inline rounded bg-amber-500/10 border border-amber-500/20 px-1 py-0.5 font-mono text-[0.9em]">{formulaInline.slice(1,-1)}</span>
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
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // hr
    if (/^\s*([-*_]\s*){3,}\s*$/.test(line) && line.trim().length >= 3) {
      out.push(<hr key={`${keyPrefix}-hr-${i}`} className="my-2 border-[var(--chat-border)]" />);
      i++;
      continue;
    }
    // blockquote
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(
        <blockquote key={`${keyPrefix}-bq-${i}`} className="my-1 border-l-2 border-amber-500/40 pl-3 italic text-[var(--chat-text)]/90">
          {buf.map((l, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <br />}
              {renderInline(l, `${keyPrefix}-bq-${i}-${idx}`)}
            </React.Fragment>
          ))}
        </blockquote>
      );
      continue;
    }
    // formula block $$
    if (line.trim() === "$$") {
      const buf: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing $$
      out.push(
        <div key={`${keyPrefix}-f-${i}`} className="my-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 font-mono text-[0.9em]">
          {buf.join("\n")}
        </div>
      );
      continue;
    }
    // table simple: if line has | and next is sep
    const isSep = (s: string) => /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(s);
    if (line.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      const header = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(lines[i].trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
        i++;
      }
      out.push(
        <div key={`${keyPrefix}-tbl-${i}`} className="md-table-wrap my-2">
          <table>
            <thead>
              <tr>
                {header.map((c, idx) => (
                  <th key={idx}>{renderInline(c, `${keyPrefix}-th-${idx}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => (
                    <td key={ci}>{renderInline(r[ci] ?? "", `${keyPrefix}-td-${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    out.push(
      <React.Fragment key={`${keyPrefix}-${i}`}>
        {out.length > 0 && <br />}
        {line.length > 0 && renderInline(line, `${keyPrefix}-${i}`)}
      </React.Fragment>
    );
    i++;
  }
  return out;
}
