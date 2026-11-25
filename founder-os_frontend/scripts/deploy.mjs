/**
 * deploy.mjs — the only way to publish the dashboard.
 *
 * Build → publish to Cloudflare Pages → then PROVE the production alias is
 * healthy before exiting 0. On 2026-11-26 a plain "wrangler pages deploy out"
 * published an out/ that still contained 404.html: Pages then turned off its
 * implicit SPA fallback and EVERY deep link (/leave, /session/<slug>, /crm…)
 * answered 404 on refresh, while the app still booted from /. A deploy that
 * cannot show the assertions below is a failed deploy.
 *
 * Env: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (wrangler); PAGES_BRANCH
 * defaults to main, PAGES_PROD_URL to https://founder-os-frontend.pages.dev.
 */
import { execFileSync } from "node:child_process";

const PROJECT = "founder-os-frontend";
const PROD = process.env.PAGES_PROD_URL || "https://founder-os-frontend.pages.dev";
const BRANCH = process.env.PAGES_BRANCH || "main";
// Every view is a History-API path, so each of these must serve the app shell.
const DEEP_LINKS = ["/", "/automations", "/leave", "/session/leaderboard", "/crm"];
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

execFileSync(NPM, ["run", "build"], { stdio: "inherit" });
execFileSync(NPX, ["wrangler", "pages", "deploy", "out", "--project-name", PROJECT,
  "--branch", BRANCH, "--commit-dirty=true"], { stdio: "inherit" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL_MARK = "app/page-";

async function get(path) {
  const res = await fetch(PROD + path, { headers: { "cache-control": "no-cache" } });
  return { status: res.status, body: await res.text() };
}

// Every deep link must serve the SAME app-shell bytes as "/". Never look for a
// "not found" string: the shell legitimately carries that text inside its Next
// payload, so a text test reports a false failure (it did, on 2026-11-26).
async function verify() {
  const failures = [];
  let root = null;
  try {
    root = await get("/");
    if (root.status !== 200 || !root.body.includes(SHELL_MARK)) {
      failures.push("/ → " + root.status + " (not the app shell)");
      root = null;
    }
  } catch (e) { failures.push("/ → " + (e && e.message)); }
  if (root) {
    for (const path of DEEP_LINKS.filter((x) => x !== "/")) {
      try {
        const r = await get(path);
        if (r.status !== 200) failures.push(path + " → " + r.status);
        else if (r.body !== root.body) failures.push(path + " → not the app shell (" + r.body.length + " bytes vs " + root.body.length + ")");
      } catch (e) { failures.push(path + " → " + (e && e.message)); }
    }
    try {
      const nf = await get("/404.html");
      if (nf.body !== root.body) failures.push("/404.html → its own not-found page (SPA fallback is OFF)");
    } catch (e) { failures.push("/404.html → " + (e && e.message)); }
  }
  try {
    const body = await (await fetch(PROD + "/api/status")).text();
    if (!body.includes('"success":true')) failures.push("/api/status → not JSON");
  } catch (e) { failures.push("/api/status → " + (e && e.message)); }
  return failures;
}

for (let attempt = 1; attempt <= 12; attempt++) {
  const failures = await verify();
  if (failures.length === 0) {
    console.log("deploy: " + PROD + " verified — " + DEEP_LINKS.join(", ") + " + /api/status");
    process.exit(0);
  }
  if (attempt === 12) {
    console.error("deploy: production verification FAILED\n  " + failures.join("\n  "));
    process.exit(1);
  }
  console.log("deploy: waiting for " + PROD + " (" + failures.join("; ") + ")");
  await sleep(5000);
}
