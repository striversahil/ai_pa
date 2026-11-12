#!/usr/bin/env node
// split-module.mjs — extract-and-re-export refactor for oversized TS/TSX files.
//
//   node scripts/refactor/split-module.mjs <file> [--mode=frontend|backend] [--dry]
//
// Moves top-level declarations VERBATIM (comments included) out of <file> into
// a sibling folder, and leaves <file> importing/re-exporting them, so every
// existing import of <file> keeps working and runtime behavior is unchanged.
//
// Grouping
//   frontend: each React component → <Folder>/<Name>.tsx · types → types.ts ·
//             other helpers/constants → helpers.ts(x)
//   backend:  types → types.ts · declarations that (transitively) touch the DB
//             or worker deps → store.ts · everything else → pure.ts
//             (pure.ts never imports store.ts: reusable without a database)
//
// Safety rules (a declaration stays in <file> when any applies)
//   • the default export, side-effect statements, re-exports
//   • module-level `let`/`var` (mutable bindings can't be reassigned across modules)
//   • anything that (transitively) depends on a declaration that stays
//   • anything that would create an import cycle between generated files
// Requires TypeScript (resolved from founder-os_frontend/node_modules).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, basename, join, extname, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ts = createRequire(join(ROOT, 'founder-os_frontend', 'package.json'))('typescript');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const mode = (args.find((a) => a.startsWith('--mode=')) ?? '--mode=frontend').slice(7);
const dry = args.includes('--dry');
if (!file) { console.error('usage: split-module.mjs <file> [--mode=frontend|backend] [--dry]'); process.exit(2); }

const text = readFileSync(file, 'utf8');
const isTsx = file.endsWith('.tsx');
const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const K = ts.SyntaxKind;

// ── imports ────────────────────────────────────────────────────────────────
const importsByLocal = new Map(); // local → { spec, kind: default|named|ns, imported, typeOnly }
const importStmts = [];
for (const st of sf.statements) {
  if (!ts.isImportDeclaration(st)) continue;
  importStmts.push(st);
  const spec = st.moduleSpecifier.text;
  const cl = st.importClause;
  if (!cl) continue;
  const declType = !!cl.isTypeOnly;
  if (cl.name) importsByLocal.set(cl.name.text, { spec, kind: 'default', typeOnly: declType });
  if (cl.namedBindings) {
    if (ts.isNamespaceImport(cl.namedBindings)) importsByLocal.set(cl.namedBindings.name.text, { spec, kind: 'ns', typeOnly: declType });
    else for (const el of cl.namedBindings.elements) {
      importsByLocal.set(el.name.text, { spec, kind: 'named', imported: (el.propertyName ?? el.name).text, typeOnly: declType || !!el.isTypeOnly });
    }
  }
}

// ── units (top-level declarations) ───────────────────────────────────────────
const hasMod = (n, k) => !!n.modifiers?.some((m) => m.kind === k);
function declaredNames(st) {
  if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) return st.name ? [st.name.text] : [];
  if (ts.isVariableStatement(st)) {
    const out = [];
    const walkB = (b) => { if (ts.isIdentifier(b)) out.push(b.text); else for (const e of b.elements ?? []) if (!ts.isOmittedExpression(e)) walkB(e.name); };
    for (const d of st.declarationList.declarations) walkB(d.name);
    return out;
  }
  return [];
}
const units = []; // { names, stmts, exported, isType, mutable, keep, hasJsx }
const unitByName = new Map();
let usesClient = false;
const keptStmts = new Set();
for (const st of sf.statements) {
  if (ts.isImportDeclaration(st)) continue;
  if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression) && st.expression.text === 'use client') { usesClient = true; keptStmts.add(st); continue; }
  const names = declaredNames(st);
  const isDefault = hasMod(st, K.DefaultKeyword);
  if (!names.length || isDefault || hasMod(st, K.DeclareKeyword)) { keptStmts.add(st); if (names.length) for (const n of names) unitByName.set(n, { names, stmts: [st], keep: true, deps: new Set() }); continue; }
  const existing = unitByName.get(names[0]);
  if (existing && (ts.isFunctionDeclaration(st) || ts.isInterfaceDeclaration(st))) { existing.stmts.push(st); continue; } // overloads / merged interfaces
  const u = {
    names, stmts: [st], exported: hasMod(st, K.ExportKeyword),
    isType: ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st),
    mutable: ts.isVariableStatement(st) && !(st.declarationList.flags & ts.NodeFlags.Const),
    keep: false, deps: new Set(), hasJsx: false, touchesDb: false,
  };
  units.push(u);
  for (const n of names) unitByName.set(n, u);
}

// Identifier references (approximate, conservative: false positives only add deps).
function refsOf(node, acc = new Set(), flags = { jsx: false }) {
  const visit = (n) => {
    if (n.kind === K.JsxElement || n.kind === K.JsxSelfClosingElement || n.kind === K.JsxFragment) flags.jsx = true;
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const skip = (p && ((ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) ||
        (ts.isMethodDeclaration(p) && p.name === n) || (ts.isPropertySignature(p) && p.name === n) || (ts.isPropertyDeclaration(p) && p.name === n) ||
        (ts.isJsxAttribute(p) && p.name === n) || (ts.isQualifiedName(p) && p.right === n) || (ts.isBindingElement(p) && p.propertyName === n) ||
        (ts.isEnumMember(p) && p.name === n) || (ts.isPropertyAccessExpression(p) && false)));
      if (!skip) acc.add(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return acc;
}
const DB_HINTS = new Set(['prisma', 'deps', 'getPrisma', 'db', 'DB', 'masterDb', 'cached', 'cacheDel', 'cacheDelPrefix', 'fetch', 'require', 'AutomationEngine', 'getGateway']);
for (const u of [...units, ...[...unitByName.values()].filter((x) => x.keep)]) {
  if (u._refs) continue;
  const flags = { jsx: false };
  const refs = new Set();
  for (const st of u.stmts) refsOf(st, refs, flags);
  for (const n of u.names) refs.delete(n);
  u._refs = refs;
  u.hasJsx = flags.jsx;
  u.touchesDb = [...refs].some((r) => DB_HINTS.has(r)) || [...refs].some((r) => importsByLocal.get(r) && /prisma|store|cache|gateway|engine|service|d1|context|storage|repository|queue|outbound|whatsapp\/|fetch-page|web-search|google_sheets|ai\//i.test(importsByLocal.get(r).spec));
  for (const r of refs) { const t = unitByName.get(r); if (t && t !== u) u.deps.add(t); }
}
// Stmts that stay (default export, side effects) reference names too: those can still be extracted (main imports them).

// ── decide what stays ──────────────────────────────────────────────────────
for (const u of units) if (u.mutable) u.keep = true;
const isComponent = (u) => !u.isType && u.hasJsx && /^[A-Z]/.test(u.names[0]) && u.names.length === 1;
function propagateKeep() {
  let changed = true;
  while (changed) {
    changed = false;
    for (const u of units) if (!u.keep && [...u.deps].some((d) => d.keep)) { u.keep = true; changed = true; }
  }
}
propagateKeep();
if (mode === 'backend') {
  // DB-touching is transitive: a unit calling a store unit is store too.
  let ch = true;
  while (ch) { ch = false; for (const u of units) if (!u.touchesDb && !u.isType && [...u.deps].some((d) => d.touchesDb && !d.isType)) { u.touchesDb = true; ch = true; } }
}
const fileOf = (u) => {
  if (u.isType) return 'types.ts';
  if (mode === 'backend') return u.touchesDb ? 'store.ts' : 'pure.ts';
  if (isComponent(u)) return `${u.names[0]}.tsx`;
  return 'helpers'; // resolved to .ts/.tsx below
};
// Iteratively remove cycles between generated files (value edges only; type edges are erased).
for (let guard = 0; guard < 50; guard++) {
  const moving = units.filter((u) => !u.keep);
  const g = new Map();
  for (const u of moving) {
    const f = fileOf(u);
    if (!g.has(f)) g.set(f, new Set());
    for (const d of u.deps) if (!d.keep && !d.isType && fileOf(d) !== f) g.get(f).add(fileOf(d));
  }
  // find a cycle
  const state = new Map(); let cyc = null;
  const dfs = (f, stack) => {
    state.set(f, 1); stack.push(f);
    for (const t of g.get(f) ?? []) {
      if (state.get(t) === 1) { cyc = stack.slice(stack.indexOf(t)); return true; }
      if (!state.get(t) && dfs(t, stack)) return true;
    }
    state.set(f, 2); stack.pop(); return false;
  };
  for (const f of g.keys()) if (!state.get(f) && dfs(f, [])) break;
  if (!cyc) break;
  // keep the units of the smallest file in the cycle
  const victim = cyc.map((f) => [f, moving.filter((u) => fileOf(u) === f)]).sort((a, b) => a[1].length - b[1].length)[0];
  for (const u of victim[1]) u.keep = true;
  propagateKeep();
}

const moving = units.filter((u) => !u.keep);
if (!moving.length) { console.log(`split: ${file} — nothing extractable`); process.exit(0); }

// ── emit ────────────────────────────────────────────────────────────────────
const base = basename(file, extname(file));
const kebab = base.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
let folderName = mode === 'backend' ? `${kebab}` : kebab;
if (folderName === base || existsSync(join(dirname(file), folderName))) folderName = `${kebab}-parts`;
const folder = join(dirname(file), folderName);
const helpersHasJsx = moving.some((u) => fileOf(u) === 'helpers' && u.hasJsx);
const finalName = (f) => (f === 'helpers' ? (helpersHasJsx ? 'helpers.tsx' : 'helpers.ts') : f);
const modPath = (fname) => './' + fname.replace(/\.tsx?$/, '');
const relSpec = (spec) => (spec.startsWith('.') ? (spec.startsWith('./') ? '../' + spec.slice(2) : '../' + spec) : spec);
// Relative specifiers inside moved code (dynamic import()/require()) move one folder down.
const fixRelative = (t) => t.replace(/\b(import|require)\((\s*)(["'`])\.\.\//g, '$1($2$3../../').replace(/\b(import|require)\((\s*)(["'`])\.\//g, '$1($2$3../');
const stmtText = (st) => text.slice(st === sf.statements[0] ? st.getStart() : st.getFullStart(), st.getEnd()).replace(/^\n+/, '');

function importLines(refs, selfFile, fromMain) {
  // fromMain: imports for the original file (siblings live in ./<folder>/)
  const byMod = new Map();
  const add = (mod, line) => { if (!byMod.has(mod)) byMod.set(mod, []); byMod.get(mod).push(line); };
  const lines = [];
  const original = new Map(); // spec → {default, ns, named:[], typeNamed:[]} preserving type-only
  for (const r of refs) {
    const imp = importsByLocal.get(r);
    if (imp && !fromMain) {
      const spec = relSpec(imp.spec);
      if (!original.has(spec)) original.set(spec, { def: null, defType: false, ns: null, named: [], typeNamed: [] });
      const o = original.get(spec);
      if (imp.kind === 'default') { o.def = r; o.defType = imp.typeOnly; }
      else if (imp.kind === 'ns') o.ns = r;
      else (imp.typeOnly ? o.typeNamed : o.named).push(imp.imported === r ? r : `${imp.imported} as ${r}`);
    }
    const u = unitByName.get(r);
    if (u && !u.keep) {
      const f = finalName(fileOf(u));
      if (f === selfFile) continue;
      const mod = fromMain ? `./${folderName}/${f.replace(/\.tsx?$/, '')}` : modPath(f);
      add(mod, { name: r, type: u.isType });
    }
  }
  for (const [spec, o] of original) {
    if (o.ns) lines.push(`import * as ${o.ns} from "${spec}";`);
    if (o.def && o.defType) lines.push(`import type ${o.def} from "${spec}";`);
    const named = [...new Set(o.named)];
    if (o.def && !o.defType) lines.push(`import ${o.def}${named.length ? `, { ${named.join(', ')} }` : ''} from "${spec}";`);
    else if (named.length) lines.push(`import { ${named.join(', ')} } from "${spec}";`);
    const tn = [...new Set(o.typeNamed)];
    if (tn.length) lines.push(`import type { ${tn.join(', ')} } from "${spec}";`);
  }
  for (const [mod, items] of byMod) {
    const vals = [...new Set(items.filter((i) => !i.type).map((i) => i.name))];
    const types = [...new Set(items.filter((i) => i.type).map((i) => i.name))];
    if (vals.length) lines.push(`import { ${vals.join(', ')} } from "${mod}";`);
    if (types.length) lines.push(`import type { ${types.join(', ')} } from "${mod}";`);
  }
  return lines;
}

const files = new Map();
for (const u of moving) {
  const f = finalName(fileOf(u));
  if (!files.has(f)) files.set(f, []);
  files.get(f).push(u);
}
const ensureExported = (st) => {
  const t = stmtText(st);
  if (hasMod(st, K.ExportKeyword)) return t;
  // insert `export ` before the declaration keyword, after leading comments
  const lead = st === sf.statements[0] ? '' : text.slice(st.getFullStart(), st.getStart()).replace(/^\n+/, '');
  return lead + 'export ' + text.slice(st.getStart(), st.getEnd());
};
const header = (f) => `// Extracted verbatim from ${relative(join(dirname(file)), file).replace(/\\/g, '/') || base} by scripts/refactor/split-module.mjs.\n// ${base}${extname(file)} re-exports everything public here, so existing imports keep working.\n`;
const outputs = [];
for (const [f, us] of files) {
  const refs = new Set();
  for (const u of us) for (const r of u._refs) refs.add(r);
  const body = fixRelative(us.flatMap((u) => u.stmts.map(ensureExported)).join('\n\n'));
  const needsClient = usesClient && f.endsWith('.tsx');
  const content = `${needsClient ? '"use client";\n\n' : ''}${header(f)}${importLines(refs, f, false).join('\n')}\n\n${body}\n`;
  outputs.push([join(folder, f), content]);
}

// Rewrite the original file: keep its imports that are still used, import moved
// names it uses, re-export moved names it exported.
const keptText = sf.statements.filter((st) => !ts.isImportDeclaration(st) && !moving.some((u) => u.stmts.includes(st)));
const keptRefs = new Set();
for (const st of keptText) refsOf(st, keptRefs);
const mainImports = [];
for (const st of importStmts) {
  const cl = st.importClause;
  if (!cl) { mainImports.push(stmtText(st)); continue; } // side-effect import
  const names = [];
  if (cl.name) names.push(cl.name.text);
  if (cl.namedBindings) { if (ts.isNamespaceImport(cl.namedBindings)) names.push(cl.namedBindings.name.text); else for (const el of cl.namedBindings.elements) names.push(el.name.text); }
  if (names.some((n) => keptRefs.has(n))) {
    if (names.every((n) => keptRefs.has(n))) mainImports.push(stmtText(st));
    else {
      // rebuild with only the used bindings
      const parts = [];
      const def = cl.name && keptRefs.has(cl.name.text) ? cl.name.text : null;
      let named = null;
      if (cl.namedBindings && ts.isNamespaceImport(cl.namedBindings)) named = keptRefs.has(cl.namedBindings.name.text) ? `* as ${cl.namedBindings.name.text}` : null;
      else if (cl.namedBindings) {
        const els = cl.namedBindings.elements.filter((el) => keptRefs.has(el.name.text)).map((el) => text.slice(el.getStart(), el.getEnd()));
        named = els.length ? `{ ${els.join(', ')} }` : null;
      }
      if (def) parts.push(def);
      if (named) parts.push(named);
      mainImports.push(`import ${cl.isTypeOnly ? 'type ' : ''}${parts.join(', ')} from ${st.moduleSpecifier.getText()};`);
    }
  }
}
const usedMoved = [...keptRefs].filter((r) => unitByName.get(r) && !unitByName.get(r).keep);
const moveImports = importLines(new Set(usedMoved), null, true);
const reexports = [];
const byFile = new Map();
for (const u of moving) if (u.exported) {
  const f = finalName(fileOf(u));
  if (!byFile.has(f)) byFile.set(f, { v: [], t: [] });
  for (const n of u.names) (u.isType ? byFile.get(f).t : byFile.get(f).v).push(n);
}
for (const [f, { v, t }] of byFile) {
  const mod = `./${folderName}/${f.replace(/\.tsx?$/, '')}`;
  if (v.length) reexports.push(`export { ${v.join(', ')} } from "${mod}";`);
  if (t.length) reexports.push(`export type { ${t.join(', ')} } from "${mod}";`);
}
const directive = usesClient ? '"use client";\n\n' : '';
const leadComment = (() => { const first = sf.statements[0]; const lead = first ? text.slice(0, first.getStart()) : ''; return lead.trim() ? lead.trimEnd() + '\n' : ''; })();
const keptBody = keptText.filter((st) => !(ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression) && st.expression.text === 'use client')).map(stmtText).join('\n\n');
const mainOut = `${directive}${leadComment.replace(/^"use client";?\s*/, '')}${[...mainImports, ...moveImports].join('\n')}\n${reexports.length ? '\n// Pieces split into ./' + folderName + '/ (importable on their own); re-exported for compat.\n' + reexports.join('\n') + '\n' : ''}\n${keptBody}\n`;

const summary = `split: ${file} → ${folderName}/ {${[...files.keys()].join(', ')}}  moved ${moving.length}/${units.length} units  main ${text.split('\n').length}→${mainOut.split('\n').length} lines`;
if (dry) { console.log(summary); process.exit(0); }
mkdirSync(folder, { recursive: true });
for (const [p, c] of outputs) writeFileSync(p, c);
writeFileSync(file, mainOut);
console.log(summary);
