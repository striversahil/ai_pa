"use client";

import React, { useMemo } from "react";

/** Tiny zero-dep markdown renderer for AI replies: headings, bold, italic,
 *  inline code, fences, bullets, numbered lists, links, paragraphs.
 *  HTML in source is escaped (no dangerouslySetInnerHTML on raw input). */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return out;
}

function render(src: string): string {
  const lines = String(src ?? "").split("\n");
  const html: string[] = [];
  let i = 0;
  let inList: string | null = null;
  const closeList = () => {
    if (inList) {
      html.push(`</${inList}>`);
      inList = null;
    }
  };
  const isTableSep = (s: string) => /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(s);
  const splitRow = (s: string) => {
    let t = s.trim();
    if (t.startsWith("|")) t = t.slice(1);
    if (t.endsWith("|")) t = t.slice(0, -1);
    return t.split("|").map((c) => c.trim());
  };
  while (i < lines.length) {
    const line = lines[i];
    // table: header | sep | rows
    if (line.trim().includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      closeList();
      const header = splitRow(line);
      const alignRaw = splitRow(lines[i + 1]);
      const aligns = header.map((_, idx) => {
        const c = (alignRaw[idx] ?? "").trim();
        if (c.startsWith(":") && c.endsWith(":")) return "center";
        if (c.endsWith(":")) return "right";
        return "left";
      });
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim() !== "") {
        // stop if not table-like (no pipe)
        if (!lines[i].includes("|")) break;
        rows.push(splitRow(lines[i]));
        i++;
      }
      html.push('<div class="md-table-wrap"><table><thead><tr>');
      header.forEach((c, idx) => html.push(`<th style="text-align:${aligns[idx]}">${inline(c)}</th>`));
      html.push("</tr></thead><tbody>");
      rows.forEach((r) => {
        html.push("<tr>");
        header.forEach((_, idx) => html.push(`<td style="text-align:${aligns[idx]}">${inline(r[idx] ?? "")}</td>`));
        html.push("</tr>");
      });
      html.push("</tbody></table></div>");
      continue;
    }
    const fence = line.trim().startsWith("```");
    if (fence) {
      closeList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      html.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (inList !== "ul") {
        closeList();
        html.push("<ul>");
        inList = "ul";
      }
      html.push(`<li>${inline(bullet[1])}</li>`);
      i++;
      continue;
    }
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (num) {
      if (inList !== "ol") {
        closeList();
        html.push("<ol>");
        inList = "ol";
      }
      html.push(`<li>${inline(num[1])}</li>`);
      i++;
      continue;
    }
    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }
    closeList();
    html.push(`<p>${inline(line)}</p>`);
    i++;
  }
  closeList();
  return html.join("");
}

export default function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => render(text), [text]);
  return (
    <div
      className={className ?? "md-text"}
      // Safe: render() escapes all source HTML before adding its own tags.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
