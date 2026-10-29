/**
 * Debtors Tracker — compatibility surface.
 *
 * The logic lives in focused modules; this file keeps the historical import
 * path (`.../debtors-tracker/service`) stable for routes and the harness:
 *   types/parse/shared/ledger — pure parsing + ageing math
 *   imports                   — paste imports, matching, corrections
 *   payload                   — KV-cached dashboard payload
 *   customers                 — contact master
 *   reminders                 — dry-run daily WhatsApp queue
 */
export { DebtorsTrackerError } from './errors';
export { DEBTORS_CACHE_PREFIX } from './cache';
export {
  importCollections,
  importDebtors,
  updateInvoiceFields,
  deleteInvoice,
  deleteCollection,
  resetDebtorsTracker,
  INVOICE_EDITABLE_FIELDS,
  FOLLOW_UP_FIELDS,
} from './imports';
export { getDebtorsTrackerData } from './payload';
export { getCustomerLedger } from './customer-ledger';
export {
  runReminderDryRun,
  loadRecentReminders,
  reminderConfigured,
  reminderMode,
} from './reminders';
export { updateCustomerContact, updateCustomerSituation } from './customers';
export { CUSTOMER_SITUATIONS, CUSTOMER_SITUATION_LABELS } from './situation';
export { addCustomerRemark, deleteCustomerRemark, listCustomerRemarks } from './remarks';
export type { CustomerRemark } from './remarks';
export { PROMISE_PRESET_DAYS, MAX_PROMISE_DAYS } from './promise';
export {
  getReceivablesExportCount,
  recordReceivablesExport,
  RECEIVABLES_EXPORT_SOURCE,
} from './export-counter';
export type { ReceivablesExportStats } from './export-counter';
