#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════════
// scripts/schema-guard.mjs  ·  🔒 LOCKED
// Enforces the core / automation boundary. Runs in pre-commit and CI.
//
//   node scripts/schema-guard.mjs                 verify (local / pre-commit)
//   node scripts/schema-guard.mjs --base <ref>    verify + check migrations changed since <ref> (CI)
//   node scripts/schema-guard.mjs --sign          re-sign prisma/core.lock (HUMAN ONLY, after review)
//
// Checks
//   1. Every locked file matches its hash in prisma/core.lock.
//   2. automation.prisma: every model/enum is @@schema("automation"); no field
//      typed as a core or legacy model (no relations into core).
//   3. core.prisma never references automation or legacy models.
//   4. Hand-written SQL in prisma/sql/automation never writes to core/public.
//   5. With --base: a new/changed migration may touch "core"/"public" only if
//      the core lock changed in the same diff (i.e. a reviewed core change).
// ═════════════════════════════════════════════════════════════════════════════
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const LOCK_FILE = "prisma/core.lock";
const CORE = "prisma/schema/core.prisma";
const AUTOMATION = "prisma/schema/automation.prisma";
const LEGACY = "prisma/schema/legacy.prisma";
const AUTOMATION_SQL_DIR = "prisma/sql/automation";
const MIGRATIONS_DIR = "prisma/migrations";

// Everything an AI agent must not change — including the guard itself and the
// agent permission files, so the lock cannot be loosened from inside.
const LOCKED_PATHS = [
  CORE,
  LEGACY,
  "prisma/sql/core",
  "scripts/schema-guard.mjs",
  "AGENTS.md",
  "CLAUDE.md",
  "opencode.json",
  ".claude/settings.json",
  ".github/CODEOWNERS",
  ".github/workflows/schema-guard.yml",
  ".githooks/pre-commit",
];

const args = process.argv.slice(2);
const errors = [];
const notes = [];

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const sha256 = (p) => createHash("sha256").update(readFileSync(join(ROOT, p))).digest("hex");

function expand(paths) {
  const out = [];
  for (const p of paths) {
    const abs = join(ROOT, p);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) {
      const walk = (d) => readdirSync(d).sort().forEach((f) => {
        const full = join(d, f);
        statSync(full).isDirectory() ? walk(full) : out.push(relative(ROOT, full));
      });
      walk(abs);
    } else out.push(p);
  }
  return out;
}

// Minimal Prisma block parser: name, kind, body lines.
function blocks(src) {
  const out = [];
  const re = /^(model|enum|view|type)\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(src))) out.push({ kind: m[1], name: m[2], body: m[3] });
  return out;
}
const modelNames = (src) => new Set(blocks(src).filter((b) => b.kind === "model").map((b) => b.name));
const fieldTypes = (body) =>
  body.split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => l && !l.startsWith("@@"))
    .map((l) => ({ field: l.split(/\s+/)[0], type: (l.split(/\s+/)[1] || "").replace(/[?\[\]]/g, "") }));

// ── --sign ───────────────────────────────────────────────────────────────────
if (args.includes("--sign")) {
  let who = "unknown";
  try { who = execSync("git config user.email", { encoding: "utf8" }).trim(); } catch {}
  const files = Object.fromEntries(expand(LOCKED_PATHS).map((f) => [f, sha256(f)]));
  writeFileSync(join(ROOT, LOCK_FILE), JSON.stringify({ signedBy: who, signedAt: new Date().toISOString(), files }, null, 2) + "\n");
  console.log(`🔏 ${LOCK_FILE} signed by ${who} (${Object.keys(files).length} files).`);
  console.log("   Commit it in the same PR; CODEOWNERS review is required to merge.");
  process.exit(0);
}

// ── 1. lock integrity ────────────────────────────────────────────────────────
if (!existsSync(join(ROOT, LOCK_FILE))) {
  errors.push(`${LOCK_FILE} missing — a human must run: node scripts/schema-guard.mjs --sign`);
} else {
  const lock = JSON.parse(read(LOCK_FILE));
  const current = expand(LOCKED_PATHS);
  for (const f of current) {
    if (!(f in lock.files)) errors.push(`locked file added without re-signing: ${f}`);
    else if (lock.files[f] !== sha256(f)) errors.push(`locked file modified: ${f}`);
  }
  for (const f of Object.keys(lock.files)) if (!current.includes(f)) errors.push(`locked file deleted: ${f}`);
}

// ── 2 & 3. schema boundaries ─────────────────────────────────────────────────
if (existsSync(join(ROOT, CORE)) && existsSync(join(ROOT, AUTOMATION))) {
  const coreSrc = read(CORE);
  const autoSrc = read(AUTOMATION);
  const legacySrc = existsSync(join(ROOT, LEGACY)) ? read(LEGACY) : "";
  const coreModels = modelNames(coreSrc);
  const legacyModels = modelNames(legacySrc);
  const autoModels = modelNames(autoSrc);

  if (/^\s*(datasource|generator)\s/m.test(autoSrc)) errors.push("automation.prisma must not declare datasource/generator");
  for (const b of blocks(autoSrc)) {
    if (!/@@schema\("automation"\)/.test(b.body)) errors.push(`automation: ${b.kind} ${b.name} must use @@schema("automation")`);
    if (b.kind !== "model") continue;
    for (const { field, type } of fieldTypes(b.body)) {
      if (coreModels.has(type)) errors.push(`automation: ${b.name}.${field} is a relation to core model ${type} — store ${field}Id String @db.Uuid instead`);
      if (legacyModels.has(type)) errors.push(`automation: ${b.name}.${field} is a relation to legacy model ${type}`);
    }
  }
  for (const b of blocks(coreSrc).filter((x) => x.kind === "model")) {
    for (const { field, type } of fieldTypes(b.body)) {
      if (autoModels.has(type) || legacyModels.has(type)) errors.push(`core: ${b.name}.${field} references non-core model ${type}`);
    }
  }
}

// ── 4. hand-written automation SQL ───────────────────────────────────────────
const WRITES_CORE = /\b(insert\s+into|update|delete\s+from|alter\s+table|drop\s+\w+|truncate|create\s+(or\s+replace\s+)?(trigger|function|view|index)[^;]*?\bon)\s+"?(core|public)"?\./i;
for (const f of expand([AUTOMATION_SQL_DIR]).filter((x) => x.endsWith(".sql"))) {
  if (WRITES_CORE.test(read(f))) errors.push(`${f} writes to or alters the core/public schema — automation SQL may only SELECT from core`);
}

// ── 5. migrations in this change (CI) ────────────────────────────────────────
const baseIdx = args.indexOf("--base");
if (baseIdx !== -1) {
  const base = args[baseIdx + 1];
  const changed = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" }).split("\n").filter(Boolean);
  const coreChanged = changed.some((f) => f === LOCK_FILE || LOCKED_PATHS.some((p) => f === p || f.startsWith(p + "/")));
  if (coreChanged) notes.push("CORE CHANGE in this diff — merge requires CODEOWNERS approval.");
  for (const f of changed.filter((x) => x.startsWith(MIGRATIONS_DIR + "/") && x.endsWith(".sql") && existsSync(join(ROOT, x)))) {
    if (/"(core|public)"\./.test(read(f)) && !coreChanged) {
      errors.push(`${f} touches the core/public schema, but no reviewed core change accompanies it`);
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────
notes.forEach((n) => console.log(`ℹ️  ${n}`));
if (errors.length) {
  console.error("❌ schema-guard failed:\n" + errors.map((e) => "   • " + e).join("\n"));
  console.error("\n   Core is locked. AI agents: revert these changes and work only in");
  console.error("   prisma/schema/automation.prisma and prisma/sql/automation/.");
  process.exit(1);
}
console.log("✅ schema-guard: core lock intact, automation boundaries respected.");
