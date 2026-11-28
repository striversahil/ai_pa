// hr-controller-delete.test.mjs — Guard: a document requirement is DELETED,
// never archived, and only while no employee file is filed under it.
//
// Founder rule (2026-11-28): "instead of archiving an employee document,
// delete that document need altogether; if HR have already added the
// supporting employee then don't allow delete that document requirement."
// Expense categories and asset types keep archiving — expenses and issued
// assets point at them as history.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bundleToFile, BACKEND_DIR, FRONTEND_SRC } from "./_bundle.mjs";

const be = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, "src/automations/human-resources/lookups-parse.ts"))).href);

const lookups = readFileSync(join(BACKEND_DIR, "src/automations/human-resources/lookups.ts"), "utf8");
const route = readFileSync(join(BACKEND_DIR, "src/worker/routes/human-resources-controller.ts"), "utf8");
const feApi = readFileSync(join(FRONTEND_SRC, "hr/api.ts"), "utf8");
const feTab = readFileSync(join(FRONTEND_SRC, "components/human-resources/ControllerTab.tsx"), "utf8");
const feTypes = readFileSync(join(FRONTEND_SRC, "hr/lookups.ts"), "utf8");

describe("hr controller delete: requirements are deleted, not archived", () => {
  it("deletes a document type when nothing is filed under it", () => {
    assert.deepEqual(be.lookupDeletionPlan("document-types", 0), { archival: false });
    assert.deepEqual(be.lookupDeletionPlan("document-types", "0"), { archival: false });
  });

  it("refuses a document type that already holds employee files", () => {
    for (const count of [1, 2, 17]) {
      assert.throws(
        () => be.lookupDeletionPlan("document-types", count),
        (err) => err.status === 409 && new RegExp(String(count) + " employee document").test(err.message),
        String(count),
      );
    }
    const message = (count) => {
      try { be.lookupDeletionPlan("document-types", count); } catch (err) { return err.message; }
      return "";
    };
    assert.match(message(1), /remove it before deleting the requirement/);
    assert.match(message(4), /remove them before deleting the requirement/);
  });

  it("keeps archiving for the lists history points at", () => {
    for (const kind of ["expense-categories", "asset-types"]) {
      assert.deepEqual(be.lookupDeletionPlan(kind, 0), { archival: true });
      assert.deepEqual(be.lookupDeletionPlan(kind, 9), { archival: true });
    }
  });

  it("store hard-deletes the type and its removed tombstones", () => {
    assert.match(lookups, /export async function deleteLookup/);
    assert.match(lookups, /lookupDeletionPlan\(kind, filed\)/);
    assert.match(lookups, /deleted: false/);
    assert.match(lookups, /await model\.delete\(\{ where: \{ id: String\(id\) \} \}\);/);
    assert.match(lookups, /humanResourcesMemberDocument\.deleteMany/);
    assert.match(lookups, /usageCount/);
  });

  it("list exposes how many files are filed under each requirement", () => {
    assert.match(lookups, /filedDocumentCount/);
    assert.match(lookups, /lookupJson\("document-types", r, filed/);
    assert.match(feTypes, /usageCount\?: number/);
    assert.match(feTab, /filed/);
    assert.match(feTab, /Remove those files from the employee first/);
  });

  it("DELETE route goes through deleteLookup, never archiveLookup", () => {
    assert.match(route, /await deleteLookup\(kind/);
    assert.doesNotMatch(route, /archiveLookup/);
  });

  it("the controller confirms before removing and has one delete helper", () => {
    assert.match(feTab, /ConfirmDialog/);
    assert.match(feTab, /Delete document requirement\?/);
    assert.match(feTab, /isDoc \? "Delete" : "Archive"/);
    assert.match(feApi, /export async function deleteLookup\(kind: LookupKind, id: string\)/);
    assert.doesNotMatch(feApi, /export async function archiveLookup/);
  });
});