// pages-spa.test.mjs — a refresh on ANY route must never 404.
//
// The dashboard is ONE static route: every view (/automations, /leave,
// /session/<slug>, /crm…) is a History-API path pushed by useHashRoute, so the
// browser asks Cloudflare Pages for a file that was never built. Pages serves
// the app shell for those paths only while the artifact has NO 404.html — and
// it stops silently when one slips in. On 2026-11-26 production shipped exactly
// that (a dirty out/ holding two builds): every deep link answered 404 on
// refresh while booting from / still worked, which hides the bug from a deploy
// that only curls the homepage.
//
// So the fallback is VERSIONED (public/_redirects) instead of relying on a
// build step deleting a file, the build refuses to publish a mixed out/, and
// the deploy script proves the live alias before it exits 0.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FRONTEND_SRC } from "./_bundle.mjs";

const FRONTEND_DIR = join(FRONTEND_SRC, "..");
const read = (...p) => readFileSync(join(...p), "utf8");

describe("pages SPA fallback — deep links survive a refresh", () => {
  it("ships an explicit catch-all in public/_redirects", () => {
    const file = join(FRONTEND_DIR, "public", "_redirects");
    assert.ok(existsSync(file), "public/_redirects must exist — the fallback cannot depend on deleting out/404.html at build time");
    const rules = read(file).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const last = rules[rules.length - 1].split(" ").filter(Boolean);
    assert.deepEqual(last, ["/*", "/index.html", "200"], "the last rule must serve the app shell with 200");
  });

  it("the static export is explicit, not a NODE_ENV accident", () => {
    assert.ok(read(FRONTEND_DIR, "next.config.ts").includes("output: 'export'"), "next.config.ts must set output: export");
  });

  it("every build starts from a clean out/ and never ships 404.html", () => {
    const pkg = JSON.parse(read(FRONTEND_DIR, "package.json"));
    assert.ok((pkg.scripts.prebuild || "").includes("prebuild.mjs"), "the prebuild script must clear out/");
    assert.ok(pkg.scripts.build.includes("postbuild.mjs"), "build must run postbuild");
    const post = read(FRONTEND_DIR, "scripts", "postbuild.mjs");
    assert.ok(post.includes("survived removal"), "postbuild must FAIL when out/404.html survived");
    assert.ok(post.includes("webpack runtime"), "postbuild must refuse a mixed out/ (two builds)");
  });

  it("the deploy proves the live alias, not just the homepage", () => {
    const deploy = read(FRONTEND_DIR, "scripts", "deploy.mjs");
    assert.ok(deploy.includes('"/leave"'), "deploy must assert a deep link");
    assert.ok(deploy.includes("/session/leaderboard"), "deploy must assert a nested route");
    assert.ok(deploy.includes("/api/status"), "deploy must assert the Pages /api proxy");
  });
});
