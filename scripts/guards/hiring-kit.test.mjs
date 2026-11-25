// hiring-kit.test.mjs — Guard: questionnaire PDFs + video walkthrough parity.
//
// A hiring position holds any number of JD / SOP / questionnaire PDFs plus
// one http(s) video link. Backend and frontend mirrors must validate the link
// identically and expose the same document kinds.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bundleToFile, BACKEND_DIR, FRONTEND_SRC } from "./_bundle.mjs";

const be = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, "src/automations/human-resources/hiring-positions-parse.ts"))).href);
const fe = await import(pathToFileURL(bundleToFile(join(FRONTEND_SRC, "hr/hiring-positions.ts"), { alias: { "@": FRONTEND_SRC } })).href);
const feTypes = await import(pathToFileURL(bundleToFile(join(FRONTEND_SRC, "hr/types.ts"), { alias: { "@": FRONTEND_SRC } })).href);

const URLS = [
  "https://youtu.be/abc123",
  "youtu.be/abc123",
  "www.loom.com/share/example",
  "https://drive.google.com/file/d/xyz/view",
  "  https://example.com/walkthrough?t=10  ",
  "",
  "   ",
];

describe("hiring kit: questionnaire + video walkthrough", () => {
  it("document kinds match on both mirrors", () => {
    assert.deepEqual([...be.HIRING_DOC_KINDS], ["jd", "sop", "questionnaire"]);
    assert.deepEqual([...feTypes.HIRING_DOC_KINDS], [...be.HIRING_DOC_KINDS]);
    for (const kind of be.HIRING_DOC_KINDS) assert.equal(be.isHiringDocKind(kind), true);
    assert.equal(be.isHiringDocKind("resume"), false);
  });

  it("normalises http(s) links identically and keeps bare hosts", () => {
    for (const url of URLS) {
      assert.equal(fe.cleanVideoUrl(url), be.cleanVideoUrl(url), url);
    }
    assert.equal(be.cleanVideoUrl("youtu.be/abc123"), "https://youtu.be/abc123");
    assert.equal(be.cleanVideoUrl("   "), null);
  });

  it("rejects non-http(s) protocols and garbage", () => {
    for (const url of ["javascript://alert(1)", "data://text/html,x", "ftp://example.com/x", "not a url"]) {
      assert.throws(() => be.cleanVideoUrl(url), /valid video|http/i, url);
      assert.throws(() => fe.cleanVideoUrl(url), /valid video|http/i, url);
    }
  });

  it("completeness needs all three PDFs and the link", () => {
    const base = { id: "p1", name: "Sales", videoUrl: "https://youtu.be/x", docs: { jd: [{}], sop: [{}], questionnaire: [{}] } };
    assert.equal(fe.isComplete(base), true);
    assert.deepEqual(fe.missingDocs(base), []);
    assert.equal(fe.isComplete({ ...base, videoUrl: null }), false);
    assert.equal(fe.isComplete({ ...base, docs: { ...base.docs, questionnaire: [] } }), false);
    assert.deepEqual(fe.missingDocs({ ...base, docs: { jd: [], sop: [{}], questionnaire: [] } }), ["jd", "questionnaire"]);
  });

  it("store JSON carries the link and a questionnaire slot", () => {
    const store = readFileSync(join(BACKEND_DIR, "src/automations/human-resources/hiring-positions.ts"), "utf8");
    assert.match(store, /videoUrl:/);
    assert.match(store, /questionnaire: \[\]/);
    assert.match(store, /slots\.questionnaire/);
  });

  it("migration only adds the nullable video column", () => {
    const sql = readFileSync(join(BACKEND_DIR, "migrations/0170_hr_hiring_kit_media.sql"), "utf8");
    assert.match(sql, /ADD COLUMN "videoUrl" TEXT/);
    assert.doesNotMatch(sql, /UPDATE\s+"HumanResourcesHiringPosition"/i);
  });

  it("route accepts the questionnaire kind and PATCHes the link", () => {
    const route = readFileSync(join(BACKEND_DIR, "src/worker/routes/human-resources.ts"), "utf8");
    assert.match(route, /isHiringDocKind\(kind\)/);
    assert.match(route, /questionnaire/);
    assert.match(route, /updateHiringPosition/);
  });
});