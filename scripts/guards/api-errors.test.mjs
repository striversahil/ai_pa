// api-errors.test.mjs — a failed request must SAY what failed.
//
// Two regressions, one theme (2026-11-26):
//  1. createApp() had no onError, so any uncaught throw answered Hono's
//     plain-text "Internal Server Error". The dashboard reads `error` out of
//     the body, so every such failure collapsed into the generic "request
//     failed" users reported, with the cause only in the Worker log.
//  2. POST /api/enquiries awaited the whole AI extraction + vision intake on
//     the response path (PATCH had already moved it to waitUntil). The row was
//     saved, the response died at the platform/proxy limit, the browser showed
//     "request failed" and the retry created a duplicate enquiry.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BACKEND_DIR, FRONTEND_SRC } from "./_bundle.mjs";

const read = (...p) => readFileSync(join(...p), "utf8");
const context = read(BACKEND_DIR, "src", "worker", "context.ts");
const routes = read(BACKEND_DIR, "src", "worker", "routes", "enquiries.ts");

describe("API errors are JSON and never block a save", () => {
  it("createApp answers uncaught throws with JSON + a request id", () => {
    assert.ok(context.includes("app.onError("), "createApp must register onError");
    assert.ok(context.includes("requestId"), "the JSON error must carry a requestId");
    assert.ok(context.includes("console.error("), "the throw must be logged with that id");
  });

  it("enquiry create hands the AI pass to waitUntil, like PATCH", () => {
    const start = routes.indexOf("app.post('/api/enquiries'");
    const end = routes.indexOf("app.patch('/api/enquiries/:id'");
    assert.ok(start > 0 && end > start, "POST and PATCH blocks must both exist");
    const post = routes.slice(start, end);
    // The pass may only run INSIDE the background task, and the response must
    // be scheduled (waitUntil) before it is returned.
    const afterAt = post.indexOf("const after = (async () =>");
    const aiAt = post.indexOf("await runEnquiryAi(");
    const schedAt = post.indexOf("waitUntil(after)");
    const returnAt = post.indexOf("return c.json(r.body");
    assert.ok(afterAt > 0, "create must wrap the AI pass in a background task");
    assert.ok(aiAt > afterAt, "the AI pass must run inside that task, never before it");
    assert.ok(schedAt > afterAt && schedAt < returnAt, "create must schedule the task on waitUntil before responding");
  });

  it("the dashboard names the status instead of a bare 'request failed'", () => {
    const fe = read(FRONTEND_SRC, "hooks", "useEnquiryData.ts");
    assert.ok(fe.includes("HTTP "), "a non-JSON error page must surface its HTTP status");
    assert.ok(fe.includes("requestId"), "a JSON API error must surface its request id");
  });
});
