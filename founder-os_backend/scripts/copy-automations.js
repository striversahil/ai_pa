/**
 * Post-build step: tsc compiles only TypeScript, so the declarative parts of
 * each automation (README.md + rule.json) must be copied into dist/automations
 * for `npm start` (node dist/server.js) to load automations identically.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '../src/automations');
const dst = path.join(__dirname, '../dist/automations');

if (!fs.existsSync(src)) {
  console.log('scripts/copy-automations: src/automations not found, skipping');
  process.exit(0);
}

let copied = 0;
for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
  for (const file of ['README.md', 'rule.json']) {
    const sourceFile = path.join(src, entry.name, file);
    if (!fs.existsSync(sourceFile)) continue;
    const destFile = path.join(dst, entry.name, file);
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.copyFileSync(sourceFile, destFile);
    copied++;
  }
}
console.log(`scripts/copy-automations: copied ${copied} automation definition files to dist/automations`);
