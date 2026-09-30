// zoho-dates.js — IST date helpers shared by both sync pipelines.

'use strict';

// YYYY-MM-DD in IST for a Date. The sales-orders-today boundary, the CRM
// override lookback, and the createdToday flag all key on this.
function istDateString(d) {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

module.exports = { istDateString };
