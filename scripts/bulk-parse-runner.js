#!/usr/bin/env node

/**
 * bulk-parse-runner.js — vendor price-list file → staged BulkRows.
 *
 * Runs on GH Actions (unlimited CPU, poppler-utils for PDFs). Picks up
 * BulkBatches with status=parsing (POSTed by /api/bulk-import/upload):
 *   xlsx  — zero-dep parser: manual ZIP central-directory walk +
 *           zlib.inflateRawSync + sharedStrings/sheet XML scan. No npm deps.
 *   csv   — quote-aware split, cells joined to one line per row.
 *   pdf   — `pdftotext -layout` (apt poppler-utils in workflow); scanned
 *           PDFs (no embedded text) fall back to vision page-by-page.
 *   image — vision extract (OpenRouter; noReasoning — mechanical chunking).
 * Pushes lines in 200-row chunks to POST /api/runner/bulk-import/rows
 * (worker runs Step 0 regex + Step 1 deterministic match, zero AI).
 * Final chunk sets done=true → batch status=review.
 *
 * Env: WORKER_URL, SHARED_SECRET, OPENROUTER_API_KEYS / OPENROUTER_API_KEY
 *   (vision for image/scanned-pdf sources only).
 * Flags: --batch=<id> (parse one batch), --limit=N (cap batches per run).
 */

const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { workerRequest } = require('./runner-lib');
const { getGateway, buildVisionUserContent } = require('./ai-gateway');

const batchArg = (process.argv.find((a) => a.startsWith('--batch=')) || '').slice(8);
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const CAP = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10)) : 5;

function requireRunnerEnv() {
  const missing = [];
  if (!process.env.WORKER_URL) missing.push('WORKER_URL');
  if (!process.env.SHARED_SECRET) missing.push('SHARED_SECRET');
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// ── zero-dep XLSX reader ─────────────────────────────────────────────
// Reads the ZIP central directory, inflates xl/sharedStrings.xml +
// xl/worksheets/sheet1.xml, maps shared-string indexes + inline strings to
// cell values, returns rows as string arrays (first sheet only).
function readZipEntries(buf) {
  // Find End-Of-Central-Directory (scan last 64k for PK\x05\x06).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (EOCD missing)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({ name, method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function inflateEntry(buf, entry) {
  const lo = entry.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('bad local header');
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const comp = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return Buffer.from(comp);
  if (entry.method === 8) return zlib.inflateRawSync(comp);
  throw new Error(`unsupported zip method ${entry.method}`);
}

function parseSharedStrings(xml) {
  // <t>text</t> runs in document order — index = occurrence order of <si>.
  const strings = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    let s = '';
    while ((tm = tRe.exec(m[1])) !== null) s += tm[1];
    strings.push(s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
  }
  return strings;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const cells = [];
    const cRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    while ((cm = cRe.exec(rm[1])) !== null) {
      const tMatch = /t="([^"]*)"/.exec(cm[1] || '');
      const t = tMatch ? tMatch[1] : '';
      const inner = cm[2] || '';
      const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
      const v = vMatch ? vMatch[1] : '';
      if (t === 's') {
        const idx = parseInt(v, 10);
        cells.push(Number.isFinite(idx) && shared[idx] !== undefined ? shared[idx] : '');
      } else if (t === 'inlineStr') {
        const tm = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        cells.push(tm ? tm[1] : '');
      } else {
        cells.push(v);
      }
    }
    rows.push(cells.map((c) => String(c).trim()));
  }
  return rows;
}

/** First worksheet → joined non-empty lines (header row skipped when digit-free). */
function xlsxToLines(buf) {
  const entries = readZipEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  let shared = [];
  const ssEntry = byName.get('xl/sharedStrings.xml');
  if (ssEntry) shared = parseSharedStrings(inflateEntry(buf, ssEntry).toString('utf8'));
  // First sheet*N* (sheet1 normally; fall back to any worksheet).
  const sheetNames = [...byName.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  if (!sheetNames.length) throw new Error('no worksheets found');
  const rows = parseSheet(inflateEntry(buf, byName.get(sheetNames[0])).toString('utf8'), shared);
  const lines = [];
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].filter(Boolean).join(' | ').replace(/\s+/g, ' ').trim();
    if (line.length < 2) continue;
    if (i === 0 && !/\d/.test(line)) continue; // header row
    lines.push(line.slice(0, 1000));
  }
  return lines;
}

// ── CSV (quote-aware) ────────────────────────────────────────────────
function csvToLines(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '"') {
        if (quoted && raw[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cells.push(cur.trim());
    const line = cells.map((c) => c.replace(/^"|"$/g, '').trim()).filter(Boolean).join(' | ').replace(/\s+/g, ' ').trim();
    if (line.length < 2) continue;
    if (lines.length === 0 && !/\d/.test(line)) continue; // header row
    lines.push(line.slice(0, 1000));
  }
  return lines;
}

// ── vision extract (images + scanned PDFs) ───────────────────────────
async function visionToLines(gateway, imageBuffers, label) {
  const dataUrls = imageBuffers.slice(0, 10).map((b, i) => `data:image/png;base64,${b.toString('base64')}#${i}`);
  const content = buildVisionUserContent(
    `This is a vendor price list (${label}). Transcribe EVERY price row as one line: item words + price + unit exactly as printed (e.g. "V belt B-type 1250/kg"). One row per line, no bullets, no commentary, no header. Return JSON {"lines": ["..."]}.`,
    dataUrls,
    10,
  );
  const out = await gateway.completeJson({
    messages: [{ role: 'user', content }],
    temperature: 0, json: true, maxTokens: 8000, noReasoning: true,
    provider: 'openrouter',
  });
  return (Array.isArray(out.lines) ? out.lines : [])
    .map((l) => String(l).replace(/\s+/g, ' ').trim().slice(0, 1000))
    .filter((l) => l.length >= 2)
    .slice(0, 1000);
}

async function processBatch(gateway, b) {
  console.log(`- ${b.id} (${b.sourceKind}) ${b.sourceName}`);
  const file = await workerRequest(`/api/runner/bulk-import/file/${b.id}`, { timeoutMs: 120000 });
  const buf = Buffer.from(file.base64 || '', 'base64');
  if (!buf.length) throw new Error('empty source file');
  let lines = [];
  if (b.sourceKind === 'xlsx') {
    lines = xlsxToLines(buf);
  } else if (b.sourceKind === 'csv') {
    lines = csvToLines(buf.toString('utf8'));
  } else if (b.sourceKind === 'pdf') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-'));
    try {
      const pdfPath = path.join(tmp, 'src.pdf');
      fs.writeFileSync(pdfPath, buf);
      let text = '';
      try {
        text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
      } catch (e) {
        console.log(`  pdftotext failed (${String(e.message).slice(0, 100)}), trying page render + vision`);
      }
      const textLines = String(text).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length >= 2);
      if (textLines.length >= 3) {
        lines = textLines.map((l) => l.slice(0, 1000));
      } else {
        // Scanned PDF: render pages → vision.
        execFileSync('pdftoppm', ['-png', '-r', '150', pdfPath, path.join(tmp, 'p')]);
        const pages = fs.readdirSync(tmp).filter((f) => f.endsWith('.png')).sort()
          .map((f) => fs.readFileSync(path.join(tmp, f)));
        if (!pages.length) throw new Error('no text and no renderable pages');
        lines = await visionToLines(gateway, pages, b.sourceName);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } else if (b.sourceKind === 'image') {
    lines = await visionToLines(gateway, [buf], b.sourceName);
  } else {
    throw new Error(`unknown sourceKind ${b.sourceKind}`);
  }
  console.log(`  ${lines.length} lines`);
  for (let i = 0; i < lines.length; i += 200) {
    const chunk = lines.slice(i, i + 200);
    const done = i + 200 >= lines.length;
    const res = await workerRequest('/api/runner/bulk-import/rows', {
      method: 'POST',
      body: { batchId: b.id, lines: chunk.map((rawText) => ({ rawText })), done },
      timeoutMs: 120000,
    });
    console.log(`  chunk ${i / 200 + 1}: +${res.inserted}${done ? ' done' : ''}`);
  }
  return lines.length;
}

async function main() {
  requireRunnerEnv();
  const gateway = getGateway(process.env);
  let pending;
  if (batchArg) {
    pending = { batches: [{ id: batchArg, sourceKind: 'xlsx', sourceName: batchArg, sourceFileKey: 'x', quotedAt: new Date().toISOString(), vendorId: null }] };
    // Single-batch mode still needs metadata: fetch via pending sweep.
    const all = await workerRequest('/api/runner/bulk-import/pending');
    const hit = (all.batches || []).find((x) => x.id === batchArg);
    if (!hit) { console.log(`batch ${batchArg} not in parsing state — nothing to do`); return; }
    pending = { batches: [hit] };
  } else {
    pending = await workerRequest('/api/runner/bulk-import/pending');
  }
  const batches = (pending.batches || []).slice(0, CAP);
  if (!batches.length) { console.log('no parsing batches'); return; }
  for (const b of batches) {
    try {
      await processBatch(gateway, b);
    } catch (e) {
      console.error(`- ${b.id}: FAILED ${String(e.message).slice(0, 200)}`);
    }
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { xlsxToLines, csvToLines, readZipEntries };
