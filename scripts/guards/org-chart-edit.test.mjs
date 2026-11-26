// org-chart-edit.test.mjs — the DB seed must stay equal to the repo chart.
//
// organization.json remains the source/fallback the frontend renders before
// the D1 table is seeded. This guard keeps the backend seed rows in lockstep
// with it, so a fresh database cannot show a different reporting line.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const chart = JSON.parse(readFileSync(join(ROOT, "organization.json"), "utf8")).organization;
const seedSource = readFileSync(join(ROOT, "founder-os_backend", "src", "modules", "org", "chart", "seed.ts"), "utf8");

const ROW = /row\("([^"]+)", "([^"]+)", (null|"[^"]*"), "([^"]+)", (null|"[^"]*"), (true|false), (null|"[^"]*"), (\d+)\)/g;
const rows = [...seedSource.matchAll(ROW)].map(([, id, title, department, wing, reportsToId, isHead, loginPosition, order]) => ({
  id,
  title,
  department: department === "null" ? null : department.slice(1, -1),
  wing,
  reportsToId: reportsToId === "null" ? null : reportsToId.slice(1, -1),
  isHead: isHead === "true",
  isTop: title === chart.top_position,
  loginPosition: loginPosition === "null" ? null : loginPosition.slice(1, -1),
  order: Number(order),
}));

const flat = chart.departments.flatMap((d) => d.positions.map((p) => ({ ...p, department: d.name })));
const byId = new Map(rows.map((r) => [r.id, r]));
const byTitle = new Map(rows.map((r) => [r.title, r]));
const WING_OF_DEPT = { Sales: "Sales", "Digital Marketing": "Marketing", Accounts: "Operations", "Operations & Support": "Operations" };

describe("organization chart seed (D1 fresh install)", () => {
  it("parses the seeded rows", () => {
    assert.equal(rows.length, flat.length + 1);
    assert.equal(rows[0].title, chart.top_position);
    assert.equal(rows[0].isTop, true);
  });

  it("mirrors every static position, department, parent and head flag", () => {
    for (const p of flat) {
      const row = byTitle.get(p.title);
      assert.ok(row, "seed missing " + p.title);
      assert.equal(row.department, p.department, p.title + " department");
      assert.equal(byId.get(row.reportsToId)?.title ?? null, p.reports_to, p.title + " reports_to");
      assert.equal(row.isHead, chart.departments.find((d) => d.name === p.department)?.head === p.title, p.title + " head");
      assert.equal(row.wing, WING_OF_DEPT[p.department], p.title + " wing");
    }
  });

  it("orders every position, top first", () => {
    const orders = rows.map((r) => r.order);
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
    assert.equal(new Set(orders).size, orders.length);
    assert.equal(rows.filter((r) => r.isTop).length, 1);
  });

  it("keeps the top position out of every department", () => {
    const top = byTitle.get(chart.top_position);
    assert.equal(top.department, null);
    assert.equal(top.reportsToId, null);
    assert.equal(top.isHead, false);
  });

  it("registers the read + write routes and never trusts a client order", () => {
    const route = readFileSync(join(ROOT, "founder-os_backend", "src", "worker", "routes", "org-chart.ts"), "utf8");
    assert.match(route, /\/api\/org\/chart/);
    assert.match(route, /\/positions\/\:id/);
    const write = readFileSync(join(ROOT, "founder-os_backend", "src", "modules", "org", "chart", "write.ts"), "utf8");
    assert.doesNotMatch(write, /order\s*:/);
  });
});
