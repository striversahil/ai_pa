// format-canonical.test.mjs — src/lib/format.ts must reproduce, exactly, every
// legacy local formatter it replaced (frozen below, copied from main before
// 2026-11-12). Each legacy copy maps to one canonical variant.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const f = await import(bundleToFile(join(FRONTEND_SRC, 'lib', 'format.ts')));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const LEGACY = {
  // accounts/payment-calendar.ts + field-staff/expense-calendar.ts
  inr: [(n) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `₹${Number(n).toLocaleString('en-IN')}`), 'inr'],
  // CrmDashboard, SalesDispatchPanel, crm/OrderPanel
  inrWhole: [(n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, 'inrWhole'],
  // DigitalMarketingAds
  inrRounded: [(n) => (n === null || n === undefined ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`), 'inrRounded'],
  // stock/shared
  inrRoundedOrZero: [(n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`, 'inrRoundedOrZero'],
  // accounts/payment-calendar.ts + field-staff/expense-calendar.ts
  fmtDay: [(date) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date); if (!m) return date; return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`; }, 'fmtDay'],
  // telecalling/format.ts + TelecallingDashboard
  fmtDate_tele: [(iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); if (!m) return iso; const [, , mo, d] = m; return `${Number(d)} ${MONTHS[Number(mo) - 1] ?? mo}`; }, 'fmtDayMonth'],
  // DigitalMarketingAds + DigitalMarketingOpenTasks (MO vs MONTHS name only)
  fmtDay_dm: [(iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) return String(iso || '—'); const MO = MONTHS; return `${Number(m[3])} ${MO[Number(m[2]) - 1] ?? m[2]} ${m[1]}`; }, 'fmtDayYear'],
  // SoAttachments (isNaN) — ProcurementQueue used Number.isNaN
  fmtDate_soa: [(iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d.getTime())) return ''; return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }, 'fmtShortDate'],
};
const NUMS = [null, undefined, NaN, Infinity, -Infinity, 0, -0, 1, 0.4, 0.5, 1.5, -2.5, 999.999, 46099, 99999, 100000, 123456.78, 25000000, -1234567.89, 1e12];
const DATES = ['', '2026-11-05', '2026-01-31T10:00:00Z', '2026-13-01', '2026-00-10', 'garbage', '2026-11-05 extra', '05/11/2026', null, undefined];

describe('lib/format.ts reproduces every legacy formatter', () => {
  for (const [legacyName, [legacy, canon]] of Object.entries(LEGACY)) {
    it(`${legacyName} ≡ ${canon}`, () => {
      const inputs = /fmt/i.test(legacyName) ? DATES : NUMS;
      for (const x of inputs) {
        let a, b, ea = null, eb = null;
        try { a = legacy(x); } catch (e) { ea = e.constructor.name; }
        try { b = f[canon](x); } catch (e) { eb = e.constructor.name; }
        assert.deepEqual([b, eb], [a, ea], `${canon}(${String(x)})`);
      }
    });
  }
});
